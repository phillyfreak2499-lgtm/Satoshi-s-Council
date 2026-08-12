"""
Funding & Derivatives Specialist.
Perpetual funding rate, OI changes, simple liquidation pressure proxy.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class FundingSpecialist(BaseSpecialist):
    name = "funding"
    category = "funding"
    base_weight = settings.BASE_WEIGHTS["funding"]

    def __init__(self):
        super().__init__()
        self._prev_oi: float | None = None

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        funding = market_data.get("funding_rate")
        oi = market_data.get("open_interest")
        direction = "WAIT"
        conf = 40
        reason = "Funding neutral"
        features: Dict[str, Any] = {}

        if funding is not None:
            features["funding_rate"] = round(float(funding), 6)
            # Extreme positive funding → crowded long → potential DOWN pressure
            if funding > 0.0004:
                direction = "DOWN"
                conf = min(78, 50 + int(funding * 20000))
                reason = f"High positive funding ({funding*100:.3f}%) – long crowded"
            elif funding < -0.0003:
                direction = "UP"
                conf = min(78, 50 + int(abs(funding) * 20000))
                reason = f"Negative funding ({funding*100:.3f}%) – short crowded"
            elif abs(funding) < 0.00005:
                conf = 45
                reason = "Funding near zero – balanced"

        if oi is not None:
            features["open_interest"] = round(float(oi), 1)
            if self._prev_oi is not None and self._prev_oi > 0:
                oi_chg = (oi - self._prev_oi) / self._prev_oi
                features["oi_change"] = round(oi_chg, 4)
                if oi_chg > 0.015 and direction == "UP":
                    conf = min(85, conf + 10)
                    reason += " + rising OI"
                elif oi_chg > 0.015 and direction == "DOWN":
                    conf = min(85, conf + 10)
                    reason += " + rising OI"
            self._prev_oi = float(oi)

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
