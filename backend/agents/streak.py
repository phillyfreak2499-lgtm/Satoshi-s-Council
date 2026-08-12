"""
STREAK – consecutive candle direction / microstructure path for 15m scalps.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class StreakSpecialist(BaseSpecialist):
    name = "streak"
    category = "microstructure"
    base_weight = settings.BASE_WEIGHTS.get("streak", 0.10)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 10:
            return AgentSignal(self.name, "WAIT", 25, "Need more candles", self.category)

        recent = candles[-12:]
        signs = []
        for c in recent:
            body = float(c["close"]) - float(c["open"])
            if body > 0:
                signs.append(1)
            elif body < 0:
                signs.append(-1)
            else:
                signs.append(0)

        # Count trailing streak
        streak = 0
        if signs:
            last = signs[-1]
            if last != 0:
                for s in reversed(signs):
                    if s == last:
                        streak += 1
                    else:
                        break

        up_count = signs[-6:].count(1)
        down_count = signs[-6:].count(-1)

        direction = "WAIT"
        conf = 40
        reason = "No clear streak"

        if streak >= 4 and signs[-1] == 1:
            direction = "UP"
            conf = min(80, 48 + streak * 6)
            reason = f"{streak}-candle green streak"
        elif streak >= 4 and signs[-1] == -1:
            direction = "DOWN"
            conf = min(80, 48 + streak * 6)
            reason = f"{streak}-candle red streak"
        elif streak == 3 and signs[-1] == 1 and up_count >= 4:
            direction = "UP"
            conf = 56
            reason = "Building green path"
        elif streak == 3 and signs[-1] == -1 and down_count >= 4:
            direction = "DOWN"
            conf = 56
            reason = "Building red path"
        elif streak >= 5:
            # Very extended — soft continuation still, but note stretch
            direction = "UP" if signs[-1] == 1 else "DOWN"
            conf = 52
            reason = f"Extended {streak}-streak (watch fade)"
        elif up_count >= 5 and signs[-1] == 1:
            direction = "UP"
            conf = 50
            reason = "Majority green last 6m"
        elif down_count >= 5 and signs[-1] == -1:
            direction = "DOWN"
            conf = 50
            reason = "Majority red last 6m"

        return AgentSignal(
            self.name,
            direction,
            conf,
            reason,
            self.category,
            features={
                "streak": streak,
                "up_6": up_count,
                "down_6": down_count,
            },
        )
