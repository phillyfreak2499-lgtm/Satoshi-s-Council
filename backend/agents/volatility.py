"""
VOLT – realized volatility / ATR regime for 15m windows.
High vol + directional impulse → lean with the move; extreme stretch → soft fade.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class VolatilitySpecialist(BaseSpecialist):
    name = "volatility"
    category = "volatility"
    base_weight = settings.BASE_WEIGHTS.get("volatility", 0.10)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 25:
            return AgentSignal(self.name, "WAIT", 25, "Thin vol history", self.category)

        closes = np.array([c["close"] for c in candles[-30:]], dtype=float)
        highs = np.array([c["high"] for c in candles[-30:]], dtype=float)
        lows = np.array([c["low"] for c in candles[-30:]], dtype=float)

        tr = np.maximum(
            highs[1:] - lows[1:],
            np.maximum(np.abs(highs[1:] - closes[:-1]), np.abs(lows[1:] - closes[:-1])),
        )
        atr = float(tr[-14:].mean()) if len(tr) >= 14 else float(tr.mean() or 0)
        last = float(closes[-1] or 1)
        atr_pct = atr / last if last else 0.0

        ret5 = (closes[-1] - closes[-6]) / closes[-6] if len(closes) > 5 else 0.0
        ret15 = (closes[-1] - closes[-16]) / closes[-16] if len(closes) > 15 else 0.0

        direction = "WAIT"
        conf = 40
        reason = "Vol regime neutral"

        # Impulse in elevated vol → lean with the move (15m scalp)
        if atr_pct > 0.0035 and ret5 > 0.0007:
            direction = "UP"
            conf = min(78, 50 + int(abs(ret5) * 8000))
            reason = f"High-vol impulse UP (ATR {atr_pct*100:.2f}%)"
        elif atr_pct > 0.0035 and ret5 < -0.0007:
            direction = "DOWN"
            conf = min(78, 50 + int(abs(ret5) * 8000))
            reason = f"High-vol impulse DOWN (ATR {atr_pct*100:.2f}%)"
        # Quiet grind continuation
        elif atr_pct < 0.0018 and ret15 > 0.0012 and ret5 > 0:
            direction = "UP"
            conf = 54
            reason = "Low-vol grind UP"
        elif atr_pct < 0.0018 and ret15 < -0.0012 and ret5 < 0:
            direction = "DOWN"
            conf = 54
            reason = "Low-vol grind DOWN"
        # Extreme stretch → soft mean-revert lean
        elif atr_pct > 0.0055 and abs(ret5) > 0.0025:
            direction = "DOWN" if ret5 > 0 else "UP"
            conf = 48
            reason = "Vol stretch – soft fade"

        return AgentSignal(
            self.name,
            direction,
            conf,
            reason,
            self.category,
            features={
                "atr_pct": round(atr_pct, 5),
                "ret_5": round(float(ret5), 5),
                "ret_15": round(float(ret15), 5),
            },
        )
