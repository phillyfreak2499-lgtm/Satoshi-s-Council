"""
CARRY – Funding & Derivatives specialist.

Perpetual funding rate + open interest path across windows.

Multi-window thinking:
  - Extreme funding that has *persisted* is a stronger mean-rev signal
    than a single-print spike
  - Rising OI with extreme funding = crowded positioning (fuel for squeeze/fade)
  - Falling OI with extreme funding = already flushing

ENTRY: Is positioning skewed enough to bet a full 15m mean-rev or continuation?
MID/FINAL: Is funding normalizing while path fights the entry? Revise.

Does not overtrade mild funding — needs real extremes or clear OI confirmation.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Deque, Tuple
from collections import deque
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


class FundingSpecialist(BaseSpecialist):
    name = "funding"
    category = "funding"
    base_weight = settings.BASE_WEIGHTS.get("funding", 0.08)

    def __init__(self):
        super().__init__()
        self._prev_oi: float | None = None
        # (ts, funding) history for persistence
        self._fund_hist: Deque[Tuple[float, float]] = deque(maxlen=60)
        self._oi_hist: Deque[Tuple[float, float]] = deque(maxlen=40)

    def _persist_funding(self, funding: float) -> Dict[str, float]:
        now = time.time()
        self._fund_hist.append((now, funding))
        cutoff = now - 900  # 15 min of samples
        while self._fund_hist and self._fund_hist[0][0] < cutoff:
            self._fund_hist.popleft()

        out = {"avg_5m": funding, "avg_15m": funding, "same_sign_frac": 1.0}
        if len(self._fund_hist) < 3:
            return out

        def _avg_since(sec: float) -> float:
            target = now - sec
            vals = [v for t, v in self._fund_hist if t >= target]
            return sum(vals) / len(vals) if vals else funding

        out["avg_5m"] = round(_avg_since(300), 6)
        out["avg_15m"] = round(_avg_since(900), 6)
        sign = 1 if funding > 0 else (-1 if funding < 0 else 0)
        if sign != 0:
            same = sum(1 for _, v in self._fund_hist if (v > 0) == (sign > 0))
            out["same_sign_frac"] = round(same / len(self._fund_hist), 3)
        return out

    def _oi_change(self, oi: Optional[float]) -> Dict[str, Optional[float]]:
        out: Dict[str, Optional[float]] = {"oi": None, "oi_chg": None, "oi_chg_5m": None}
        if oi is None:
            return out
        try:
            oi_f = float(oi)
        except (TypeError, ValueError):
            return out
        now = time.time()
        out["oi"] = round(oi_f, 1)
        self._oi_hist.append((now, oi_f))
        cutoff = now - 600
        self._oi_hist = [(t, v) for t, v in self._oi_hist if t >= cutoff]

        if self._prev_oi is not None and self._prev_oi > 0:
            out["oi_chg"] = round((oi_f - self._prev_oi) / self._prev_oi, 4)
        self._prev_oi = oi_f

        if len(self._oi_hist) >= 2:
            # ~5m change
            target = now - 300
            prev = self._oi_hist[0]
            for t, v in self._oi_hist:
                if t <= target:
                    prev = (t, v)
                else:
                    break
            if prev[1] > 0:
                out["oi_chg_5m"] = round((oi_f - prev[1]) / prev[1], 4)
        return out

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=54)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)

        hist = market_data.get("funding_history") or []
        if hist and len(self._fund_hist) < 3:
            for t, v in hist[-20:]:
                try:
                    self._fund_hist.append((float(t), float(v)))
                except (TypeError, ValueError):
                    continue
        oi_hist = market_data.get("oi_history") or []
        if oi_hist and len(self._oi_hist) < 3:
            for t, v in oi_hist[-20:]:
                try:
                    self._oi_hist.append((float(t), float(v)))
                except (TypeError, ValueError):
                    continue

        funding = market_data.get("funding_rate")
        oi = market_data.get("open_interest")

        features: Dict[str, Any] = {
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "quiet": quiet,
            # Funding is an 8h clock — display only; never force a 1h lock
            "lock_force": False,
            "advisory": True,
            "clock": "8h",
        }

        notes = []
        local_dir = None
        local_conf = 45

        if funding is None:
            return AgentSignal(
                self.name, "WAIT", 38,
                self.annotate_reason(market_data, "no funding data"),
                self.category, features=features,
            )

        try:
            fund = float(funding)
        except (TypeError, ValueError):
            return AgentSignal(
                self.name, "WAIT", 38,
                self.annotate_reason(market_data, "bad funding data"),
                self.category, features=features,
            )

        persist = self._persist_funding(fund)
        oi_info = self._oi_change(oi if isinstance(oi, (int, float)) else None)
        features.update({
            "funding_rate": round(fund, 6),
            **persist,
            **{k: v for k, v in oi_info.items() if v is not None},
            "subs": [
                {"name": "FUND", "detail": f"{fund*100:.3f}%"},
                {"name": "5M", "detail": f"{persist['avg_5m']*100:.3f}%"},
                {"name": "PER", "detail": f"{persist['same_sign_frac']:.0%}"},
            ],
        })
        if oi_info.get("oi_chg") is not None:
            features["subs"].append({"name": "OI", "detail": f"{oi_info['oi_chg']*100:+.1f}%"})

        # Extremes (typical perp funding in decimal per 8h period)
        high_pos = fund > 0.00035 or persist["avg_5m"] > 0.00030
        high_neg = fund < -0.00025 or persist["avg_5m"] < -0.00020
        persistent = persist["same_sign_frac"] >= 0.70
        oi_rising = (oi_info.get("oi_chg") or 0) > 0.01 or (oi_info.get("oi_chg_5m") or 0) > 0.012
        oi_falling = (oi_info.get("oi_chg") or 0) < -0.01 or (oi_info.get("oi_chg_5m") or 0) < -0.012

        # Crowded long → fade DOWN; crowded short → fade UP
        if high_pos:
            local_dir = "DOWN"
            local_conf = min(82, 52 + int(abs(fund) * 25000))
            notes.append(f"longs crowded ({fund*100:.3f}%)")
            if persistent:
                local_conf = min(88, local_conf + 6)
                notes.append("persistent")
            if oi_rising:
                local_conf = min(90, local_conf + 5)
                notes.append("OI rising — fuel")
            elif oi_falling:
                local_conf = max(50, local_conf - 6)
                notes.append("OI already flushing")
        elif high_neg:
            local_dir = "UP"
            local_conf = min(82, 52 + int(abs(fund) * 25000))
            notes.append(f"shorts crowded ({fund*100:.3f}%)")
            if persistent:
                local_conf = min(88, local_conf + 6)
                notes.append("persistent")
            if oi_rising:
                local_conf = min(90, local_conf + 5)
                notes.append("OI rising — fuel")
            elif oi_falling:
                local_conf = max(50, local_conf - 6)
                notes.append("OI already flushing")
        elif abs(fund) < 0.00005:
            notes.append("funding near zero — balanced")
            local_dir, local_conf = None, 45
        else:
            notes.append(f"funding mild ({fund*100:.3f}%)")
            local_dir, local_conf = None, 48

        direction = "WAIT"
        conf = 46

        if phase == "entry":
            if local_dir and (high_pos or high_neg):
                direction, conf = local_dir, local_conf
                # Multi-window: if prior windows already ran one way, fade is stronger
                if mean_rev == local_dir:
                    conf = min(92, conf + 6)
                    notes.append("mean-rev agrees")
                if streak_dir and streak_dir != local_dir and streak_n >= 3:
                    # Funding fade against a hot streak — still valid but slightly less conf
                    conf = max(52, conf - 4)
                    notes.append(f"fade vs streak {streak_dir}×{streak_n}")
                if streak_dir == local_dir and streak_n >= 4 and not persistent:
                    conf = max(50, conf - 8)
                    notes.append("funding lean with streak but not sticky")
            else:
                notes.append("no whole-window funding edge")
        else:
            if entry in ("UP", "DOWN"):
                # Funding thesis broken?
                adverse = local_dir and local_dir != entry and (high_pos or high_neg) and persistent
                supportive = local_dir == entry and (high_pos or high_neg)
                # Funding normalized while path against entry
                normalized = abs(fund) < 0.00012 and abs(persist["avg_5m"]) < 0.00010

                if adverse and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf, 64)
                    notes.append(f"funding flipped vs entry {entry} (path {path:+.1f})")
                elif normalized and path is not None and entry == "DOWN" and path > 5:
                    # We faded longs, but funding cooled and path went up — revise
                    direction, conf = "UP", 60
                    notes.append(f"funding cooled · path against fade ({path:+.1f})")
                elif normalized and path is not None and entry == "UP" and path < -5:
                    direction, conf = "DOWN", 60
                    notes.append(f"funding cooled · path against fade ({path:+.1f})")
                elif supportive:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"funding still supports entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry} — funding not decisive")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision funding edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "funding neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
