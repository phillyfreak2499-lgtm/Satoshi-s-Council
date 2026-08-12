"""
STRIKE – BTC vs Kalshi floor strike + time left in the 15m window.
Core contract feature: YES pays if BTC finishes above strike.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class StrikeSpecialist(BaseSpecialist):
    name = "strike"
    category = "strike"
    base_weight = settings.BASE_WEIGHTS.get("strike", 0.12)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        price = market_data.get("current_price")
        strike = market_data.get("kalshi_floor_strike") or market_data.get("kalshi_target")
        close_time = None
        km = market_data.get("kalshi_market") or {}
        if isinstance(km, dict):
            close_time = km.get("close_time")
        close_time = close_time or market_data.get("close_time")

        features: Dict[str, Any] = {}
        if price is None or strike is None:
            return AgentSignal(
                self.name, "WAIT", 30, "No price/strike pair", self.category, features=features
            )

        try:
            px = float(price)
            st = float(strike)
        except Exception:
            return AgentSignal(self.name, "WAIT", 25, "Bad price/strike", self.category)

        if st <= 0:
            return AgentSignal(self.name, "WAIT", 25, "Invalid strike", self.category)

        dist = px - st
        dist_pct = dist / st
        features = {
            "price": round(px, 2),
            "strike": round(st, 2),
            "dist": round(dist, 2),
            "dist_pct": round(dist_pct * 100, 4),
        }

        mins_left: Optional[float] = None
        if close_time:
            try:
                ct = datetime.fromisoformat(str(close_time).replace("Z", "+00:00"))
                if ct.tzinfo is None:
                    ct = ct.replace(tzinfo=timezone.utc)
                mins_left = max(0.0, (ct - datetime.now(timezone.utc)).total_seconds() / 60.0)
                features["mins_left"] = round(mins_left, 2)
            except Exception:
                pass

        direction = "WAIT"
        conf = 40
        reason = f"BTC {dist:+.0f} vs strike"

        # Far above strike → UP lean (YES favored)
        if dist_pct > 0.0015:
            direction = "UP"
            conf = min(84, 52 + int(abs(dist_pct) * 12000))
            reason = f"Above strike by {dist:.0f} ({dist_pct*100:.3f}%)"
        elif dist_pct < -0.0015:
            direction = "DOWN"
            conf = min(84, 52 + int(abs(dist_pct) * 12000))
            reason = f"Below strike by {abs(dist):.0f} ({abs(dist_pct)*100:.3f}%)"
        elif dist_pct > 0.0004:
            direction = "UP"
            conf = 52
            reason = f"Slightly above strike ({dist:.0f})"
        elif dist_pct < -0.0004:
            direction = "DOWN"
            conf = 52
            reason = f"Slightly below strike ({dist:.0f})"

        # Late window: distance matters more (less time to mean-revert)
        if mins_left is not None and mins_left <= 5 and direction != "WAIT":
            conf = min(90, conf + 8)
            reason += f" · {mins_left:.1f}m left (late weight)"
        elif mins_left is not None and mins_left <= 2 and abs(dist_pct) < 0.0003:
            direction = "WAIT"
            conf = 58
            reason = f"Pinning strike with {mins_left:.1f}m left – no edge"

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
