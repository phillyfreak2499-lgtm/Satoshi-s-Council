"""
CHAIN – open interest + price pressure (liquidation / crowding proxy).
OI rising with price → trend fuel; OI rising into opposite price → squeeze risk.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class OIPressureSpecialist(BaseSpecialist):
    name = "oi_pressure"
    category = "derivatives"
    base_weight = settings.BASE_WEIGHTS.get("oi_pressure", 0.10)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        oi = market_data.get("open_interest")
        candles = market_data.get("candles") or []
        funding = market_data.get("funding_rate")

        if len(candles) < 12:
            return AgentSignal(self.name, "WAIT", 25, "Thin history for OI path", self.category)

        closes = np.array([c["close"] for c in candles[-20:]], dtype=float)
        ret8 = (closes[-1] - closes[-9]) / closes[-9] if len(closes) > 8 else 0.0
        ret3 = (closes[-1] - closes[-4]) / closes[-4] if len(closes) > 3 else 0.0

        direction = "WAIT"
        conf = 40
        reason = "OI pressure neutral"
        features: Dict[str, Any] = {
            "oi": float(oi) if oi is not None else None,
            "ret_8": round(float(ret8), 5),
            "ret_3": round(float(ret3), 5),
            "funding": float(funding) if funding is not None else None,
        }

        # Without OI delta history we approximate pressure from funding + price path
        fund = float(funding) if funding is not None else 0.0

        # Long crowded + price rolling over → DOWN pressure
        if fund > 0.00025 and ret3 < -0.0004:
            direction = "DOWN"
            conf = min(76, 50 + int(fund * 25000))
            reason = "Crowded longs + short-term roll over"
        elif fund < -0.00018 and ret3 > 0.0004:
            direction = "UP"
            conf = min(76, 50 + int(abs(fund) * 25000))
            reason = "Crowded shorts + bounce"
        # OI present + strong path: treat as trend fuel
        elif oi is not None and ret8 > 0.0015 and ret3 > 0:
            direction = "UP"
            conf = 56
            reason = "OI-backed uptrend path"
        elif oi is not None and ret8 < -0.0015 and ret3 < 0:
            direction = "DOWN"
            conf = 56
            reason = "OI-backed downtrend path"
        elif ret8 > 0.0008 and fund > 0.0001:
            direction = "UP"
            conf = 50
            reason = "Mild long pressure"
        elif ret8 < -0.0008 and fund < -0.00005:
            direction = "DOWN"
            conf = 50
            reason = "Mild short pressure"

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
