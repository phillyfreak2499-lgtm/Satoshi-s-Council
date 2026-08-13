"""
Momentum Specialist – RSI, MACD-style, Stochastic on short timeframes.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


def rsi(closes: np.ndarray, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes[-(period + 1):])
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = gains.mean() or 1e-9
    avg_loss = losses.mean() or 1e-9
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


class MomentumSpecialist(BaseSpecialist):
    name = "momentum"
    category = "momentum"
    base_weight = settings.BASE_WEIGHTS["momentum"]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 25:
            return AgentSignal(self.name, "WAIT", 30, "Need more bars before volume edge data for momentum", self.category)

        closes = np.array([c["close"] for c in candles], dtype=float)
        r = rsi(closes, 14)

        # Simple MACD-ish: EMA12 vs EMA26 approximation with SMA for speed
        ema_fast = closes[-12:].mean()
        ema_slow = closes[-26:].mean() if len(closes) >= 26 else closes.mean()
        macd = (ema_fast - ema_slow) / closes[-1]

        direction = "WAIT"
        conf = 40
        reason = f"RSI {r:.0f} mid-range — no edge, WAIT"

        if r > 68 and macd > 0:
            direction = "UP"
            conf = min(80, 50 + int((r - 50) * 0.8))
            reason = f"RSI {r:.0f} hot but MACD still green — momentum not exhausted yet"
        elif r < 32 and macd < 0:
            direction = "DOWN"
            conf = min(80, 50 + int((50 - r) * 0.8))
            reason = f"RSI {r:.0f} washed out + MACD red — downside momentum live"
        elif r > 55 and macd > 0.0003:
            direction = "UP"
            conf = 60
            reason = f"RSI {r:.0f} + MACD lift — short-term drift UP"
        elif r < 45 and macd < -0.0003:
            direction = "DOWN"
            conf = 60
            reason = f"RSI {r:.0f} + MACD drag — short-term drift DOWN"
        else:
            conf = 45
            reason = f"RSI {r:.0f} mid-range — no edge, WAIT"

        features = {"rsi_14": round(r, 1), "macd_approx": round(macd, 6)}
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
