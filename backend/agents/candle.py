"""
WICK – Pattern Seer (Candle).

Upgraded from single-candle heuristics to multi-horizon structure:
  - Last 30–60 1m bars for local pattern
  - Prior window direction streak / mean-reversion context
  - Current window path since entry (are we still in the structure?)

ENTRY: Is there a clean structural edge that can carry 15 minutes?
MID/FINAL: Has structure broken relative to the entry thesis?
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class CandlePatternSpecialist(BaseSpecialist):
    name = "candle"
    category = "candle"
    base_weight = settings.BASE_WEIGHTS.get("candle", 0.12)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 20:
            return AgentSignal(self.name, "WAIT", 30, "Insufficient candle history", self.category)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=55)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)

        closes = np.array([c["close"] for c in candles[-60:]], dtype=float)
        opens = np.array([c["open"] for c in candles[-60:]], dtype=float)
        highs = np.array([c["high"] for c in candles[-60:]], dtype=float)
        lows = np.array([c["low"] for c in candles[-60:]], dtype=float)

        last = candles[-1]
        body = abs(last["close"] - last["open"])
        range_ = (last["high"] - last["low"]) or 1e-9
        body_ratio = body / range_

        ret_5 = (closes[-1] - closes[-6]) / closes[-6] if len(closes) > 5 else 0.0
        ret_15 = (closes[-1] - closes[-16]) / closes[-16] if len(closes) > 15 else 0.0
        ret_30 = (closes[-1] - closes[-31]) / closes[-31] if len(closes) > 30 else 0.0

        # Higher-timeframe structure: are we making higher highs / lower lows?
        hh = len(closes) >= 20 and closes[-1] > closes[-20:].max() * 0.999
        ll = len(closes) >= 20 and closes[-1] < closes[-20:].min() * 1.001
        # Rejection wicks
        upper_wick = last["high"] - max(last["close"], last["open"])
        lower_wick = min(last["close"], last["open"]) - last["low"]
        upper_rej = upper_wick / range_ > 0.55 and body_ratio < 0.35
        lower_rej = lower_wick / range_ > 0.55 and body_ratio < 0.35

        features = {
            "body_ratio": round(body_ratio, 3),
            "ret_5": round(float(ret_5), 5),
            "ret_15": round(float(ret_15), 5),
            "ret_30": round(float(ret_30), 5),
            "hh": bool(hh),
            "ll": bool(ll),
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "streak_n": streak_n,
        }

        direction = "WAIT"
        conf = 42
        notes = []

        # ── local structure signals ────────────────────────────────
        local_dir = None
        local_conf = 0
        if last["close"] > last["open"] and body_ratio > 0.65 and ret_5 > 0.0008:
            local_dir, local_conf = "UP", min(82, 55 + int(abs(ret_5) * 8000))
            notes.append(f"bull body {body_ratio:.0%} · 5m +{ret_5*100:.2f}%")
        elif last["close"] < last["open"] and body_ratio > 0.65 and ret_5 < -0.0008:
            local_dir, local_conf = "DOWN", min(82, 55 + int(abs(ret_5) * 8000))
            notes.append(f"bear body {body_ratio:.0%} · 5m {ret_5*100:.2f}%")
        elif lower_rej and ret_5 > -0.0003:
            local_dir, local_conf = "UP", 64
            notes.append("lower wick rejection")
        elif upper_rej and ret_5 < 0.0003:
            local_dir, local_conf = "DOWN", 64
            notes.append("upper wick rejection")
        elif ret_15 > 0.0025 and ret_5 > 0:
            local_dir, local_conf = "UP", 62
            notes.append(f"15m trend +{ret_15*100:.2f}%")
        elif ret_15 < -0.0025 and ret_5 < 0:
            local_dir, local_conf = "DOWN", 62
            notes.append(f"15m trend {ret_15*100:.2f}%")
        elif hh and ret_5 > 0:
            local_dir, local_conf = "UP", 58
            notes.append("higher-high break")
        elif ll and ret_5 < 0:
            local_dir, local_conf = "DOWN", 58
            notes.append("lower-low break")

        # ── multi-window overlay ───────────────────────────────────
        if phase == "entry":
            if local_dir:
                direction, conf = local_dir, local_conf
                # Boost when multi-window agrees
                if mean_rev == local_dir:
                    conf = min(90, conf + 8)
                    notes.append("mean-rev agrees")
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(90, conf + 5)
                    notes.append(f"streak {streak_dir}×{streak_n}")
                if streak_dir and streak_dir != local_dir and streak_n >= 4:
                    conf = max(50, conf - 8)
                    notes.append("fighting strong streak")
            elif mean_rev and not quiet:
                direction, conf = mean_rev, 56
                notes.append(f"structure quiet — multi-window mean-rev {mean_rev}")
            else:
                notes.append("no clean entry structure")
        else:
            # Revision phase: compare path + structure to entry
            if entry in ("UP", "DOWN") and path is not None:
                if entry == "UP" and path <= -5.0 and (local_dir == "DOWN" or ret_15 < -0.001):
                    direction, conf = "DOWN", max(local_conf, 62)
                    notes.append(f"structure broke entry UP (path {path:.1f})")
                elif entry == "DOWN" and path >= 5.0 and (local_dir == "UP" or ret_15 > 0.001):
                    direction, conf = "UP", max(local_conf, 62)
                    notes.append(f"structure broke entry DOWN (path +{path:.1f})")
                elif local_dir == entry:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"structure still with entry {entry}")
                elif local_dir:
                    direction, conf = local_dir, max(52, local_conf - 6)
                    notes.append(f"local {local_dir} vs entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry} — no break")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        if not notes:
            notes.append("chop / mixed wicks")

        reason = self.annotate_reason(market_data, " · ".join(notes))
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
