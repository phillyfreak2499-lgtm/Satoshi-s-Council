"""
VOLT – Volatility Scout.

Multi-window vol regime, not a single ATR tick.
- Compares current realized vol / ATR to the last several windows
- Detects vol compression → expansion transitions (breakout fuel)
- In dead vol: forces WAIT / high confidence floor for the council
- In expanding vol: allows directional risk, especially at ENTRY

Horizon split:
  ENTRY: is vol regime supportive of a full-window directional bet?
  MID/FINAL: has vol regime flipped enough to invalidate the entry thesis?
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class VolatilitySpecialist(BaseSpecialist):
    name = "volatility"
    category = "volatility"
    base_weight = settings.BASE_WEIGHTS.get("volatility", 0.07)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        candles = market_data.get("candles") or []
        atr = _f(market_data.get("atr_pct"))
        rv = _f(market_data.get("realized_vol"))
        volp = _f(market_data.get("volume_percentile"))

        # Local realized vol from recent candles (multi-minute, not single tick)
        local_rv = None
        if len(candles) >= 20:
            closes = np.array([c["close"] for c in candles[-30:]], dtype=float)
            if len(closes) > 5 and closes[-1] > 0:
                rets = np.diff(closes) / closes[:-1]
                local_rv = float(np.std(rets) * 100.0)  # percent

        # Compression / expansion vs recent path
        compression = False
        expansion = False
        if atr is not None:
            if atr < 0.10:
                compression = True
            elif atr > 0.30:
                expansion = True
        if local_rv is not None:
            if local_rv < 0.08:
                compression = True
            elif local_rv > 0.25:
                expansion = True

        quiet = compression or self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=60)

        features = {
            "atr_pct": atr,
            "realized_vol": rv,
            "local_rv": local_rv,
            "volume_percentile": volp,
            "compression": compression,
            "expansion": expansion,
            "quiet": quiet,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "conf_floor": floor,
        }

        direction = "WAIT"
        conf = 55
        notes = []

        if quiet:
            conf = max(floor, 72)
            notes.append("vol compressed — no directional edge")
            reason = self.annotate_reason(market_data, "; ".join(notes))
            return AgentSignal(self.name, "WAIT", conf, reason, self.category, features=features)

        if expansion and phase == "entry":
            # Expansion alone is not a direction — wait for price structure
            conf = 58
            notes.append("vol expanding — structure can travel")
        elif expansion and phase in ("mid", "final"):
            path = self.path_move(market_data)
            entry = self.entry_dir(market_data)
            if path is not None and entry in ("UP", "DOWN"):
                # Expanding vol in the direction of entry → support continuation
                if entry == "UP" and path > 2.0:
                    direction, conf = "UP", 64
                    notes.append(f"expansion supports entry UP (path +{path:.1f})")
                elif entry == "DOWN" and path < -2.0:
                    direction, conf = "DOWN", 64
                    notes.append(f"expansion supports entry DOWN (path {path:.1f})")
                elif entry == "UP" and path < -4.0:
                    direction, conf = "DOWN", 60
                    notes.append(f"expansion against entry — revise (path {path:.1f})")
                elif entry == "DOWN" and path > 4.0:
                    direction, conf = "UP", 60
                    notes.append(f"expansion against entry — revise (path +{path:.1f})")

        if not notes:
            notes.append("vol regime neutral")

        reason = self.annotate_reason(market_data, "; ".join(notes))
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)


def _f(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None
