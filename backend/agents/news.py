"""
NEWS specialist — public crypto sentiment proxy (Fear & Greed).
Leans WAIT unless extreme reading.
"""
from __future__ import annotations
import time
from typing import Any, Dict, Optional
import httpx
from loguru import logger
from backend.agents.base import BaseSpecialist, AgentSignal

_CACHE: Dict[str, Any] = {"at": 0.0, "fng": None, "label": None}


async def _fear_greed() -> Optional[Dict[str, Any]]:
    now = time.time()
    if _CACHE["fng"] is not None and now - _CACHE["at"] < 300:
        return {"value": _CACHE["fng"], "label": _CACHE["label"]}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get("https://api.alternative.me/fng/?limit=1")
            r.raise_for_status()
            data = r.json().get("data") or []
            if not data:
                return None
            row = data[0]
            val = int(row.get("value", 50))
            label = str(row.get("value_classification") or "")
            _CACHE.update({"at": now, "fng": val, "label": label})
            return {"value": val, "label": label}
    except Exception as e:
        logger.debug(f"FNG fetch: {e}")
        return None


class NewsSpecialist(BaseSpecialist):
    name = "news"
    category = "news"
    base_weight = 0.06

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        fng = await _fear_greed()
        if not fng:
            return AgentSignal(
                self.name, "WAIT", 35, "News feed quiet — no Fear&Greed read",
                self.category, features={"fng": None},
            )
        val = int(fng["value"])
        label = fng.get("label") or ""
        if val >= 78:
            return AgentSignal(
                self.name, "DOWN", min(72, 40 + (val - 70)),
                f"Extreme greed F&G {val} ({label}) — soft fade lean",
                self.category,
                features={"fng": val, "fng_label": label},
            )
        if val <= 22:
            return AgentSignal(
                self.name, "UP", min(72, 40 + (30 - val)),
                f"Extreme fear F&G {val} ({label}) — soft recovery lean",
                self.category,
                features={"fng": val, "fng_label": label},
            )
        return AgentSignal(
            self.name, "WAIT", 40 + abs(50 - val) // 5,
            f"Sentiment neutral-ish F&G {val} ({label})",
            self.category,
            features={"fng": val, "fng_label": label},
        )
