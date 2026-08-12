"""
Candle Pattern Specialist – highest base weight.
Looks for short-term reversal / continuation patterns and S/R reactions on 1m.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class CandlePatternSpecialist(BaseSpecialist):
    name = "candle"
    category = "candle"
    base_weight = settings.BASE_WEIGHTS["candle"]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 20:
            return AgentSignal(self.name, "WAIT", 30, "Insufficient candle history", self.category)

        closes = np.array([c["close"] for c in candles[-30:]], dtype=float)
        opens = np.array([c["open"] for c in candles[-30:]], dtype=float)
        highs = np.array([c["high"] for c in candles[-30:]], dtype=float)
        lows = np.array([c["low"] for c in candles[-30:]], dtype=float)

        last = candles[-1]
        body = abs(last["close"] - last["open"])
        range_ = last["high"] - last["low"] or 1e-9
        body_ratio = body / range_

        # Simple heuristics
        direction = "WAIT"
        conf = 40
        reason = "No clear pattern"

        # Recent momentum bias
        ret_5 = (closes[-1] - closes[-6]) / closes[-6] if len(closes) > 5 else 0
        ret_15 = (closes[-1] - closes[-16]) / closes[-16] if len(closes) > 15 else 0

        # Engulfing-like or strong close
        if last["close"] > last["open"] and body_ratio > 0.65 and ret_5 > 0.0008:
            direction = "UP"
            conf = min(85, 55 + int(abs(ret_5) * 8000))
            reason = "Strong bullish close + short-term momentum"
        elif last["close"] < last["open"] and body_ratio > 0.65 and ret_5 < -0.0008:
            direction = "DOWN"
            conf = min(85, 55 + int(abs(ret_5) * 8000))
            reason = "Strong bearish close + short-term momentum"
        elif ret_15 > 0.0025 and ret_5 > 0:
            direction = "UP"
            conf = 62
            reason = "Continuation of 15m uptrend"
        elif ret_15 < -0.0025 and ret_5 < 0:
            direction = "DOWN"
            conf = 62
            reason = "Continuation of 15m downtrend"
        else:
            # Near local S/R
            recent_high = highs[-15:].max()
            recent_low = lows[-15:].min()
            if last["close"] > recent_high * 0.999:
                direction = "UP"
                conf = 58
                reason = "Breaking local high"
            elif last["close"] < recent_low * 1.001:
                direction = "DOWN"
                conf = 58
                reason = "Breaking local low"

        features = {
            "body_ratio": round(body_ratio, 3),
            "ret_5": round(ret_5, 5),
            "ret_15": round(ret_15, 5),
            "last_close": last["close"],
        }
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
