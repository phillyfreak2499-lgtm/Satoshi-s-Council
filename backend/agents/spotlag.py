"""
SPOTLAG / VEL – Binance spot velocity; Kalshi often lags CEX by a few seconds.

Research: microstructure + latency windows; when spot is moving hard,
Kalshi mid has not fully repriced → follow spot for short horizon.
"""
from __future__ import annotations
from typing import Any, Dict, List, Tuple
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


class SpotLagSpecialist(BaseSpecialist):
    name = "spotlag"
    category = "velocity"
    base_weight = settings.BASE_WEIGHTS.get("spotlag", 0.10)

    def __init__(self):
        super().__init__()
        self._px_hist: List[Tuple[float, float]] = []  # (ts, price)

    def _velocity_bps(self, price: float) -> Dict[str, float]:
        now = time.time()
        self._px_hist.append((now, price))
        cutoff = now - 300
        self._px_hist = [(t, p) for t, p in self._px_hist if t >= cutoff]
        out = {"bps_30s": 0.0, "bps_60s": 0.0, "bps_3m": 0.0}
        if len(self._px_hist) < 2 or price <= 0:
            return out
        for key, secs in (("bps_30s", 30), ("bps_60s", 60), ("bps_3m", 180)):
            target = now - secs
            older = min(self._px_hist, key=lambda x: abs(x[0] - target))
            if abs(older[0] - target) < secs * 0.55 and older[1] > 0:
                out[key] = (price - older[1]) / older[1] * 10000.0  # bps
        return out

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        px = market_data.get("current_price")
        try:
            px = float(px) if px is not None else None
        except Exception:
            px = None
        if px is None or px <= 0:
            return AgentSignal(self.name, "WAIT", 40, "No spot price", self.category)

        vel = self._velocity_bps(px)
        # Prefer 30–60s for latency edge
        lead = vel["bps_30s"] if abs(vel["bps_30s"]) >= abs(vel["bps_60s"]) * 0.7 else vel["bps_60s"]
        thr = float(getattr(settings, "SPOTLAG_BPS", 8.0))  # ~0.08%

        features = {
            **vel,
            "threshold_bps": thr,
            "subs": [
                {"name": "30S", "detail": f"{vel['bps_30s']:+.1f}bp"},
                {"name": "60S", "detail": f"{vel['bps_60s']:+.1f}bp"},
                {"name": "3M", "detail": f"{vel['bps_3m']:+.1f}bp"},
            ],
        }

        if abs(lead) < thr:
            return AgentSignal(
                self.name, "WAIT", 48,
                f"Spot quiet ({lead:+.1f}bp)",
                self.category, features=features,
            )

        direction = "UP" if lead > 0 else "DOWN"
        conf = min(88, 54 + int(abs(lead) * 1.2))
        # If 3m agrees with short burst, boost
        if vel["bps_3m"] * lead > 0 and abs(vel["bps_3m"]) > thr * 0.5:
            conf = min(90, conf + 5)

        return AgentSignal(
            self.name, direction, conf,
            f"Spot {lead:+.1f}bp / {direction} (Kalshi lag window)",
            self.category, features=features,
        )
