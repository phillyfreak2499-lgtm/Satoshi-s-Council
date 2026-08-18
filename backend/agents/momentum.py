"""
DRIFT – Trend Scout (Momentum).

Multi-horizon momentum:
  - 5m / 15m / 30m returns (not just last tick)
  - Prior-window direction streak (is this a trend day?)
  - Path since entry inside the current window

ENTRY: Is momentum aligned across horizons enough to bet the full window?
MID/FINAL: Has momentum flipped against the entry hard enough to revise?
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class MomentumSpecialist(BaseSpecialist):
    name = "momentum"
    category = "momentum"
    base_weight = settings.BASE_WEIGHTS.get("momentum", 0.10)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 20:
            return AgentSignal(self.name, "WAIT", 28, "Insufficient history", self.category)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=54)
        streak_dir, streak_n = self.streak(market_data)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)

        fifteen = False
        try:
            from backend.learning.btc15m import is_15m_btc_book, momentum_horizons_15m
            fifteen = is_15m_btc_book(market_data)
        except Exception:
            fifteen = False
        if fifteen:
            hz = momentum_horizons_15m()
            b0, b1, b2 = hz["bars"]
            full_ret = float(hz["full_ret"])
            partial_ret = float(hz["partial_ret"])
            hz_label = str(hz["label"])
        else:
            b0, b1, b2 = 5, 15, 30
            full_ret, partial_ret, hz_label = 0.0015, 0.001, "5/15/30"

        closes = np.array([c["close"] for c in candles[-60:]], dtype=float)
        ret_a = (closes[-1] - closes[-(b0 + 1)]) / closes[-(b0 + 1)] if len(closes) > b0 else 0.0
        ret_b = (closes[-1] - closes[-(b1 + 1)]) / closes[-(b1 + 1)] if len(closes) > b1 else 0.0
        ret_c = (closes[-1] - closes[-(b2 + 1)]) / closes[-(b2 + 1)] if len(closes) > b2 else 0.0
        # Keep 1H feature names; 15m overwrites with the shorter stack.
        ret_5, ret_15, ret_30 = ret_a, ret_b, ret_c

        # Alignment score across horizons
        signs = [np.sign(ret_5), np.sign(ret_15), np.sign(ret_30)]
        aligned_up = sum(1 for s in signs if s > 0)
        aligned_down = sum(1 for s in signs if s < 0)

        features = {
            "ret_5": round(float(ret_5), 5),
            "ret_15": round(float(ret_15), 5),
            "ret_30": round(float(ret_30), 5),
            "aligned_up": aligned_up,
            "aligned_down": aligned_down,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "horizon_stack": hz_label,
            "path_move": path,
            "streak_n": streak_n,
        }

        direction = "WAIT"
        conf = 45
        notes = []

        if phase == "entry":
            if aligned_up >= 3 and ret_15 > full_ret:
                direction, conf = "UP", min(86, 58 + int(ret_15 * 6000))
                notes.append(f"aligned UP {hz_label} · mid +{ret_15*100:.2f}%")
            elif aligned_down >= 3 and ret_15 < -full_ret:
                direction, conf = "DOWN", min(86, 58 + int(abs(ret_15) * 6000))
                notes.append(f"aligned DOWN {hz_label} · mid {ret_15*100:.2f}%")
            elif aligned_up >= 2 and ret_5 > partial_ret:
                direction, conf = "UP", 60
                notes.append("partial UP alignment")
            elif aligned_down >= 2 and ret_5 < -partial_ret:
                direction, conf = "DOWN", 60
                notes.append("partial DOWN alignment")
            else:
                notes.append("horizons mixed — no entry momentum")

            # Multi-window streak reinforcement
            if direction in ("UP", "DOWN") and streak_dir == direction and streak_n >= 3:
                conf = min(90, conf + 6)
                notes.append(f"streak {streak_dir}×{streak_n}")
            elif direction in ("UP", "DOWN") and streak_dir and streak_dir != direction and streak_n >= 4:
                conf = max(50, conf - 10)
                notes.append("counter-streak risk")

        else:
            # Revision: momentum vs entry
            if entry in ("UP", "DOWN"):
                adverse = (
                    (entry == "UP" and aligned_down >= 2 and ret_15 < -full_ret)
                    or (entry == "DOWN" and aligned_up >= 2 and ret_15 > full_ret)
                )
                supportive = (
                    (entry == "UP" and aligned_up >= 2)
                    or (entry == "DOWN" and aligned_down >= 2)
                )
                if adverse and path is not None and abs(path) >= 4.0:
                    direction = "DOWN" if entry == "UP" else "UP"
                    conf = 66
                    notes.append(f"momentum flipped vs entry {entry} (path {path:+.1f})")
                elif supportive:
                    direction, conf = entry, 60
                    notes.append(f"momentum still with entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"momentum soft — hold entry {entry}")
            else:
                if aligned_up >= 3:
                    direction, conf = "UP", 58
                    notes.append("late aligned UP")
                elif aligned_down >= 3:
                    direction, conf = "DOWN", 58
                    notes.append("late aligned DOWN")
                else:
                    notes.append("no revision momentum")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "momentum neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
