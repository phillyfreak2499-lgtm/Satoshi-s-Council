"""
NEWS – public crypto sentiment specialist (Fear & Greed + multi-window context).

Leans WAIT unless extremes. Multi-window:
  ENTRY: extreme sentiment as a soft whole-window prior
  MID/FINAL: only revise if path confirms the sentiment fade/recovery thesis
"""
from __future__ import annotations
import time
from typing import Any, Dict, Optional
import httpx
from loguru import logger
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings

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
    base_weight = settings.BASE_WEIGHTS.get("news", 0.06)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=52)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)

        fng = await _fear_greed()
        features: Dict[str, Any] = {
            "fng": None,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
        }

        if not fng:
            return AgentSignal(
                self.name, "WAIT", 35,
                self.annotate_reason(market_data, "news feed quiet — no Fear&Greed"),
                self.category, features=features,
            )

        val = int(fng["value"])
        label = fng.get("label") or ""
        features.update({"fng": val, "fng_label": label})
        features["subs"] = [
            {"name": "F&G", "detail": f"{val}"},
            {"name": "LBL", "detail": label[:12] or "—"},
        ]

        notes = []
        local_dir = None
        local_conf = 40

        if val >= 78:
            local_dir, local_conf = "DOWN", min(72, 40 + (val - 70))
            notes.append(f"extreme greed F&G {val} ({label}) — soft fade")
        elif val <= 22:
            local_dir, local_conf = "UP", min(72, 40 + (30 - val))
            notes.append(f"extreme fear F&G {val} ({label}) — soft recovery")
        else:
            notes.append(f"sentiment neutral-ish F&G {val} ({label})")

        direction = "WAIT"
        conf = 40 + abs(50 - val) // 5

        if phase == "entry":
            if local_dir:
                direction, conf = local_dir, local_conf
                if mean_rev == local_dir:
                    conf = min(80, conf + 5)
                    notes.append("mean-rev agrees")
                if streak_dir and streak_dir != local_dir and streak_n >= 3:
                    conf = min(82, conf + 4)
                    notes.append(f"fade after streak {streak_dir}×{streak_n}")
            else:
                notes.append("no whole-window news edge")
        else:
            if entry in ("UP", "DOWN"):
                # Sentiment only revises if path confirms
                if local_dir and local_dir != entry and path is not None and abs(path) >= 5.0:
                    direction, conf = local_dir, max(local_conf, 58)
                    notes.append(f"sentiment + path flipped vs entry {entry}")
                elif local_dir == entry:
                    direction, conf = entry, max(local_conf, 52)
                    notes.append(f"sentiment still with entry {entry}")
                else:
                    direction, conf = entry, 50
                    notes.append(f"hold entry {entry} — news not decisive")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision news edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "news neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
