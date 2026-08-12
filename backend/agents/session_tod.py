"""
SESSION / TOD – time-of-day + 15m window clock + historical session trends.
UTC session buckets: Asia / Europe / US with typical BTC behavior priors.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


# Soft priors (not guarantees): session character for BTC 15m
# hour_utc ranges → (name, trend_bias -1..+1, activity 0..1)
SESSION_PRIORS = [
    # Asia: often range / mean-revert lean
    (0, 7, "ASIA", -0.05, 0.45),
    # Europe open: more directional
    (7, 12, "EUROPE", 0.08, 0.7),
    # US morning / overlap: highest activity
    (12, 17, "US_AM", 0.12, 0.95),
    # US afternoon
    (17, 21, "US_PM", 0.05, 0.75),
    # Late US / early Asia
    (21, 24, "LATE", -0.02, 0.4),
]


def _session_for(hour: int):
    for start, end, name, bias, act in SESSION_PRIORS:
        if start <= hour < end:
            return name, bias, act
    return "UNKNOWN", 0.0, 0.5


class SessionTodSpecialist(BaseSpecialist):
    name = "session_tod"
    category = "session"
    base_weight = settings.BASE_WEIGHTS.get("session_tod", 0.08)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        now = datetime.now(timezone.utc)
        hour = now.hour
        dow = now.weekday()  # 0=Mon
        session, bias, activity = _session_for(hour)

        candles = market_data.get("candles") or []
        ret15 = 0.0
        if len(candles) >= 16:
            c0 = float(candles[-1]["close"])
            c15 = float(candles[-16]["close"])
            ret15 = (c0 - c15) / c15 if c15 else 0.0

        # Window clock
        mins_left: Optional[float] = None
        close_time = None
        km = market_data.get("kalshi_market") or {}
        if isinstance(km, dict):
            close_time = km.get("close_time")
        close_time = close_time or market_data.get("close_time")
        if close_time:
            try:
                ct = datetime.fromisoformat(str(close_time).replace("Z", "+00:00"))
                if ct.tzinfo is None:
                    ct = ct.replace(tzinfo=timezone.utc)
                mins_left = max(0.0, (ct - now).total_seconds() / 60.0)
            except Exception:
                pass

        features: Dict[str, Any] = {
            "hour_utc": hour,
            "dow": dow,
            "session": session,
            "session_bias": bias,
            "activity": activity,
            "ret_15": round(ret15, 5),
            "mins_left": round(mins_left, 2) if mins_left is not None else None,
            "weekend": dow >= 5,
        }

        direction = "WAIT"
        conf = 42
        reason = f"{session} session · activity {activity:.0%}"

        # Combine session prior with short path
        lean = bias
        if ret15 > 0.0008:
            lean += 0.15
        elif ret15 < -0.0008:
            lean -= 0.15

        # Early window: trends more trustworthy; late: caution
        if mins_left is not None:
            if mins_left >= 10:
                lean *= 1.15
                reason += " · early window"
            elif mins_left <= 3:
                lean *= 0.7
                conf = max(conf, 50)
                reason += " · late window caution"

        if dow >= 5:
            lean *= 0.6
            activity *= 0.7
            reason += " · weekend"

        if lean > 0.08 and activity >= 0.4:
            direction = "UP"
            conf = min(72, 46 + int(abs(lean) * 80) + int(activity * 12))
            reason = f"{session} UP lean · path {ret15*100:.2f}%"
        elif lean < -0.08 and activity >= 0.4:
            direction = "DOWN"
            conf = min(72, 46 + int(abs(lean) * 80) + int(activity * 12))
            reason = f"{session} DOWN lean · path {ret15*100:.2f}%"
        elif activity < 0.45:
            direction = "WAIT"
            conf = 55
            reason = f"{session} low-activity – prefer WAIT/HOLD"

        features["aggressiveness"] = round(0.75 + activity * 0.35, 3)

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
