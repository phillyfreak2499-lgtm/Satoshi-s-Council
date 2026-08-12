"""
Volume Specialist – spikes, divergences, relative volume.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class VolumeSpecialist(BaseSpecialist):
    name = "volume"
    category = "volume"
    base_weight = settings.BASE_WEIGHTS["volume"]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 30:
            return AgentSignal(self.name, "WAIT", 25, "Insufficient volume history", self.category)

        volumes = np.array([c["volume"] for c in candles[-40:]], dtype=float)
        closes = np.array([c["close"] for c in candles[-40:]], dtype=float)

        avg_vol = volumes[:-3].mean() or 1.0
        recent_vol = volumes[-3:].mean()
        spike_ratio = recent_vol / avg_vol

        price_change = (closes[-1] - closes[-4]) / closes[-4] if len(closes) > 3 else 0

        direction = "WAIT"
        conf = 40
        reason = "Volume neutral"

        if spike_ratio > 2.2 and price_change > 0.0006:
            direction = "UP"
            conf = min(82, 50 + int(spike_ratio * 12))
            reason = f"Volume spike ({spike_ratio:.1f}x) with price rise"
        elif spike_ratio > 2.2 and price_change < -0.0006:
            direction = "DOWN"
            conf = min(82, 50 + int(spike_ratio * 12))
            reason = f"Volume spike ({spike_ratio:.1f}x) with price drop"
        elif spike_ratio < 0.55:
            direction = "WAIT"
            conf = 55
            reason = "Low volume – reduced edge"
        else:
            # mild directional bias from volume-price agreement
            if price_change > 0.0004 and spike_ratio > 1.1:
                direction = "UP"
                conf = 52
                reason = "Mild volume confirmation of up move"
            elif price_change < -0.0004 and spike_ratio > 1.1:
                direction = "DOWN"
                conf = 52
                reason = "Mild volume confirmation of down move"

        features = {
            "spike_ratio": round(float(spike_ratio), 2),
            "avg_vol": round(float(avg_vol), 2),
            "recent_vol": round(float(recent_vol), 2),
            "price_change_3m": round(float(price_change), 5),
        }
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
