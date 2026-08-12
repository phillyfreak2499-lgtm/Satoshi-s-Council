"""
ODDS – Kalshi mid / skew + odds velocity (rate of change of UP%).
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


class OddsSpecialist(BaseSpecialist):
    name = "odds"
    category = "kalshi"
    base_weight = settings.BASE_WEIGHTS.get("odds", 0.11)

    def __init__(self):
        super().__init__()
        # Rolling mid history for velocity: (ts, mid_0_1)
        self._mid_hist: List[tuple] = []

    def _track_mid(self, mid: float) -> Optional[float]:
        now = time.time()
        self._mid_hist.append((now, mid))
        # Keep ~3 minutes
        cutoff = now - 180
        self._mid_hist = [(t, m) for t, m in self._mid_hist if t >= cutoff]
        if len(self._mid_hist) < 2:
            return None
        # Velocity: change in UP% over last ~60s (or available span)
        t0, m0 = self._mid_hist[0]
        t1, m1 = self._mid_hist[-1]
        # Prefer sample ~60s ago if present
        target = now - 60
        older = min(self._mid_hist, key=lambda x: abs(x[0] - target))
        if abs(older[0] - target) < 45:
            m0 = older[1]
            t0 = older[0]
        dt = max(1.0, t1 - t0)
        # percentage points per minute
        vel = ((m1 - m0) * 100.0) / (dt / 60.0)
        return vel

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        bid = market_data.get("kalshi_yes_bid")
        ask = market_data.get("kalshi_yes_ask")
        features: Dict[str, Any] = {}

        if bid is None and ask is None:
            return AgentSignal(
                self.name, "WAIT", 30, "No Kalshi book", self.category, features=features
            )

        try:
            b = float(bid) if bid is not None else None
            a = float(ask) if ask is not None else None
        except Exception:
            return AgentSignal(self.name, "WAIT", 25, "Bad Kalshi quotes", self.category)

        if b is not None and b > 1.5:
            b = b / 100.0
        if a is not None and a > 1.5:
            a = a / 100.0

        if b is not None and a is not None:
            mid = (b + a) / 2.0
            spread = max(0.0, a - b)
        else:
            mid = float(b if b is not None else a)
            spread = 0.0

        mid = max(0.0, min(1.0, mid))
        up_pct = mid * 100.0
        vel = self._track_mid(mid)

        features = {
            "kalshi_mid": round(mid, 3),
            "up_pct": round(up_pct, 1),
            "spread": round(spread, 4),
            "velocity_ppm": round(vel, 2) if vel is not None else None,
        }

        direction = "WAIT"
        conf = 40
        reason = f"Kalshi mid {up_pct:.0f}% – neutral band"

        if mid >= 0.62:
            direction = "UP"
            conf = min(82, 52 + int((mid - 0.5) * 100))
            reason = f"Kalshi mid {up_pct:.0f}% leaning UP"
        elif mid <= 0.38:
            direction = "DOWN"
            conf = min(82, 52 + int((0.5 - mid) * 100))
            reason = f"Kalshi mid {up_pct:.0f}% leaning DOWN"
        elif mid >= 0.55:
            direction = "UP"
            conf = 54
            reason = f"Soft UP skew ({up_pct:.0f}%)"
        elif mid <= 0.45:
            direction = "DOWN"
            conf = 54
            reason = f"Soft DOWN skew ({up_pct:.0f}%)"

        # Velocity override / boost: fast odds move is a 15m signal
        if vel is not None:
            if vel >= 4.0:  # +4 pts per minute
                if direction != "DOWN":
                    direction = "UP"
                conf = min(88, max(conf, 58) + int(min(15, vel)))
                reason += f" · velocity +{vel:.1f}pp/m"
            elif vel <= -4.0:
                if direction != "UP":
                    direction = "DOWN"
                conf = min(88, max(conf, 58) + int(min(15, abs(vel))))
                reason += f" · velocity {vel:.1f}pp/m"
            elif abs(vel) >= 2.0 and direction != "WAIT":
                # Agreeing velocity boosts; conflicting cuts
                if (direction == "UP" and vel > 0) or (direction == "DOWN" and vel < 0):
                    conf = min(86, conf + 6)
                    reason += f" · vel confirms ({vel:+.1f})"
                else:
                    conf = max(42, conf - 8)
                    reason += f" · vel conflict ({vel:+.1f})"

        if spread > 0.08 and direction != "WAIT":
            conf = max(42, conf - 10)
            reason += " · wide spread"
        elif spread > 0.12:
            direction = "WAIT"
            conf = 55
            reason = f"Spread too wide ({spread:.0%}) – no ODDS edge"

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
