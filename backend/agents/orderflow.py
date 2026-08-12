"""
Order Flow & Liquidity Specialist.
Uses Kalshi orderbook imbalance + Binance taker buy volume where available.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class OrderFlowSpecialist(BaseSpecialist):
    name = "orderflow"
    category = "orderflow"
    base_weight = settings.BASE_WEIGHTS["orderflow"]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        kalshi = market_data.get("kalshi") or {}
        candles = market_data.get("candles") or []
        direction = "WAIT"
        conf = 40
        reason = "Order flow neutral"
        features: Dict[str, Any] = {}

        # Kalshi implied probability from mid
        yes_bid = kalshi.get("yes_bid")
        yes_ask = kalshi.get("yes_ask")
        try:
            if yes_bid and yes_ask:
                mid = (float(yes_bid) + float(yes_ask)) / 2
                features["kalshi_mid"] = round(mid, 3)
                # Extreme mid can indicate directional pressure
                if mid > 0.62:
                    direction = "UP"
                    conf = min(75, 50 + int((mid - 0.5) * 80))
                    reason = f"Kalshi mid {mid:.2f} leaning UP"
                elif mid < 0.38:
                    direction = "DOWN"
                    conf = min(75, 50 + int((0.5 - mid) * 80))
                    reason = f"Kalshi mid {mid:.2f} leaning DOWN"
        except Exception:
            pass

        # Taker buy ratio from recent candles
        if len(candles) >= 10:
            recent = candles[-8:]
            taker_buy = sum(c.get("taker_buy_base", 0) for c in recent)
            total_vol = sum(c.get("volume", 1) for c in recent) or 1
            ratio = taker_buy / total_vol
            features["taker_buy_ratio"] = round(ratio, 3)
            if ratio > 0.62 and direction != "DOWN":
                if direction == "WAIT":
                    direction = "UP"
                    conf = 55
                else:
                    conf = min(80, conf + 8)
                reason += " + aggressive buy flow"
            elif ratio < 0.38 and direction != "UP":
                if direction == "WAIT":
                    direction = "DOWN"
                    conf = 55
                else:
                    conf = min(80, conf + 8)
                reason += " + aggressive sell flow"

        if not features:
            reason = "Limited order flow data"

        return AgentSignal(self.name, direction, conf, reason.strip(" +"), self.category, features=features)
