"""
Regime & Time Specialist.
Tracks hour-of-day, day-of-week, volatility regime.
Outputs aggressiveness multiplier for the Leader.
"""
from __future__ import annotations
from typing import Any, Dict
from datetime import datetime, timezone
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class RegimeSpecialist(BaseSpecialist):
    name = "regime"
    category = "regime"
    base_weight = settings.BASE_WEIGHTS["regime"]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        now = datetime.now(timezone.utc)
        hour = now.hour
        dow = now.weekday()  # 0=Mon

        candles = market_data.get("candles") or []
        vol_regime = "normal"
        atr_pct = 0.0
        if len(candles) >= 20:
            highs = np.array([c["high"] for c in candles[-20:]])
            lows = np.array([c["low"] for c in candles[-20:]])
            closes = np.array([c["close"] for c in candles[-20:]])
            tr = np.maximum(highs[1:] - lows[1:], np.abs(highs[1:] - closes[:-1]))
            atr = tr.mean()
            atr_pct = atr / closes[-1] if closes[-1] else 0
            if atr_pct > settings.HIGH_VOL_THRESHOLD:
                vol_regime = "high"
            elif atr_pct < settings.HIGH_VOL_THRESHOLD * 0.4:
                vol_regime = "low"

        # Aggressiveness: 0.6 (very cautious) → 1.3 (more aggressive)
        aggressiveness = 1.0
        reason_parts = []

        if hour in settings.LOW_EDGE_HOURS_UTC:
            aggressiveness *= 0.75
            reason_parts.append(f"low-edge hour {hour} UTC")
        if vol_regime == "high":
            aggressiveness *= 0.85
            reason_parts.append("high-vol regime")
        elif vol_regime == "low":
            aggressiveness *= 1.1
            reason_parts.append("low-vol regime")
        if dow >= 5:  # weekend
            aggressiveness *= 0.9
            reason_parts.append("weekend")

        aggressiveness = max(0.55, min(1.35, aggressiveness))

        # Regime specialist rarely votes strong direction; mostly modulates
        direction = "WAIT"
        conf = 50
        if aggressiveness < 0.8:
            conf = 65
            reason = "Raise WAIT threshold – " + (", ".join(reason_parts) or "cautious regime")
        else:
            reason = "Normal regime – " + (", ".join(reason_parts) or "standard conditions")

        features = {
            "hour_utc": hour,
            "dow": dow,
            "vol_regime": vol_regime,
            "atr_pct": round(float(atr_pct), 5),
            "aggressiveness": round(aggressiveness, 3),
        }
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
