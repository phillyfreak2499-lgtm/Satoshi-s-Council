"""
CHEAP / VALUE – buy the soft side when Kalshi mid is discounted.

Turbine 1k-run winners: buy YES when cheap (~0.50), sell/recover toward 0.70.
We generalize: lean the side that is underpriced vs 50 when not in a panic.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class CheapSpecialist(BaseSpecialist):
    name = "cheap"
    category = "value"
    base_weight = settings.BASE_WEIGHTS.get("cheap", 0.10)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        up = market_data.get("up_pct")
        if up is None:
            bid = market_data.get("kalshi_yes_bid")
            try:
                if bid is not None:
                    up = float(bid)
                    if up <= 1.0:
                        up *= 100.0
            except Exception:
                up = None
        if up is None:
            return AgentSignal(self.name, "WAIT", 40, "No Kalshi mid", self.category)

        up = float(up)
        down = 100.0 - up
        cheap_thr = float(getattr(settings, "CHEAP_SIDE_MAX", 42.0))
        fair_band = float(getattr(settings, "CHEAP_FAIR_BAND", 8.0))  # ignore 42–58 mush

        features = {
            "up_pct": up,
            "down_pct": down,
            "cheap_thr": cheap_thr,
            "subs": [
                {"name": "YES", "detail": f"{up:.0f}¢"},
                {"name": "NO", "detail": f"{down:.0f}¢"},
                {"name": "BAND", "detail": f"≤{cheap_thr:g}¢ lean"},
            ],
        }

        # Soft YES → lean UP (buy the cheap side, expect recovery toward 50+)
        if up <= cheap_thr:
            conf = min(86, 58 + int((cheap_thr - up) * 1.8))
            return AgentSignal(
                self.name, "UP", conf,
                f"Cheap YES {up:.0f}¢ → lean UP (value)",
                self.category, features=features,
            )
        # Soft NO (expensive YES) → lean DOWN
        if down <= cheap_thr:
            conf = min(86, 58 + int((cheap_thr - down) * 1.8))
            return AgentSignal(
                self.name, "DOWN", conf,
                f"Cheap NO {down:.0f}¢ → lean DOWN (value)",
                self.category, features=features,
            )

        # Near fair — no edge from value
        if abs(up - 50.0) <= fair_band:
            return AgentSignal(
                self.name, "WAIT", 50,
                f"Fair mid {up:.0f}¢ — no value lean",
                self.category, features=features,
            )

        # Mild lean if still off-fair but not "cheap enough" for full conviction
        if up < 50.0:
            return AgentSignal(
                self.name, "UP", 52,
                f"Mild value UP ({up:.0f}¢)",
                self.category, features=features,
            )
        return AgentSignal(
            self.name, "DOWN", 52,
            f"Mild value DOWN ({down:.0f}¢)",
            self.category, features=features,
        )
