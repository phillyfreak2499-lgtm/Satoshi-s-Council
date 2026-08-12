"""
WHALE – large-player proxy from volume spikes, taker aggression, and range expansion.
No exchange whale wallet feed required — uses tape microstructure available on Binance 1m.
"""
from __future__ import annotations
from typing import Any, Dict
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class WhaleSpecialist(BaseSpecialist):
    name = "whale"
    category = "whale"
    base_weight = settings.BASE_WEIGHTS.get("whale", 0.10)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 25:
            return AgentSignal(self.name, "WAIT", 25, "Thin history for whale tape", self.category)

        vols = np.array([float(c.get("volume") or 0) for c in candles[-40:]], dtype=float)
        closes = np.array([float(c["close"]) for c in candles[-40:]], dtype=float)
        highs = np.array([float(c["high"]) for c in candles[-40:]], dtype=float)
        lows = np.array([float(c["low"]) for c in candles[-40:]], dtype=float)

        # Taker buy base if present
        taker = []
        for c in candles[-20:]:
            tb = c.get("taker_buy_base")
            if tb is not None:
                try:
                    taker.append(float(tb))
                except Exception:
                    pass

        avg_vol = float(vols[:-3].mean()) if len(vols) > 3 else float(vols.mean() or 1)
        recent = vols[-3:]
        peak = float(recent.max()) if len(recent) else 0.0
        spike = peak / (avg_vol or 1.0)

        # Range expansion on spike bar
        last = candles[-1]
        rng = float(last["high"]) - float(last["low"])
        avg_rng = float(np.mean(highs[-20:] - lows[-20:])) or 1e-9
        range_x = rng / avg_rng

        ret3 = (closes[-1] - closes[-4]) / closes[-4] if len(closes) > 3 else 0.0

        taker_ratio = None
        if taker and len(candles) >= len(taker):
            recent_c = candles[-len(taker):]
            tot = sum(float(c.get("volume") or 0) for c in recent_c) or 1.0
            taker_ratio = sum(taker) / tot

        features: Dict[str, Any] = {
            "vol_spike": round(spike, 2),
            "range_x": round(range_x, 2),
            "ret_3": round(float(ret3), 5),
            "taker_buy_ratio": round(taker_ratio, 3) if taker_ratio is not None else None,
        }

        direction = "WAIT"
        conf = 40
        reason = "No whale-sized tape"

        # Whale print: huge volume + range expansion + direction
        if spike >= 2.8 and range_x >= 1.4:
            if ret3 > 0.0003:
                direction = "UP"
                conf = min(86, 55 + int(spike * 6))
                reason = f"Whale lift · {spike:.1f}x vol · range {range_x:.1f}x"
            elif ret3 < -0.0003:
                direction = "DOWN"
                conf = min(86, 55 + int(spike * 6))
                reason = f"Whale dump · {spike:.1f}x vol · range {range_x:.1f}x"
            else:
                conf = 50
                reason = f"Large print {spike:.1f}x but flat close"
        elif spike >= 2.0 and abs(ret3) > 0.0005:
            direction = "UP" if ret3 > 0 else "DOWN"
            conf = min(74, 50 + int(spike * 5))
            reason = f"Elevated flow {spike:.1f}x with path"

        # Taker aggression confirmation
        if taker_ratio is not None and direction != "WAIT":
            if direction == "UP" and taker_ratio > 0.58:
                conf = min(88, conf + 6)
                reason += " · aggressive buyers"
            elif direction == "DOWN" and taker_ratio < 0.42:
                conf = min(88, conf + 6)
                reason += " · aggressive sellers"
            elif direction == "UP" and taker_ratio < 0.42:
                conf = max(44, conf - 8)
                reason += " · taker conflict"
            elif direction == "DOWN" and taker_ratio > 0.58:
                conf = max(44, conf - 8)
                reason += " · taker conflict"
        elif taker_ratio is not None and direction == "WAIT":
            if taker_ratio > 0.62 and spike > 1.3:
                direction = "UP"
                conf = 52
                reason = f"Taker buy dominance {taker_ratio:.0%}"
            elif taker_ratio < 0.38 and spike > 1.3:
                direction = "DOWN"
                conf = 52
                reason = f"Taker sell dominance {taker_ratio:.0%}"

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
