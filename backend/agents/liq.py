"""
LIQ specialist — liquidation / OI pressure cluster proxy.
"""
from __future__ import annotations
from typing import Any, Dict, List
from backend.agents.base import BaseSpecialist, AgentSignal


class LiqSpecialist(BaseSpecialist):
    name = "liq"
    category = "liq"
    base_weight = 0.07

    def __init__(self):
        super().__init__()
        self._oi_hist: List[float] = []
        self._vol_hist: List[float] = []

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        oi = market_data.get("open_interest") or market_data.get("oi")
        candles = market_data.get("candles") or market_data.get("klines") or []
        last_vol = None
        if candles:
            try:
                c = candles[-1]
                last_vol = float(c.get("volume") or c.get("v") or 0)
            except Exception:
                pass

        if oi is not None:
            try:
                self._oi_hist.append(float(oi))
                self._oi_hist = self._oi_hist[-40:]
            except Exception:
                pass
        if last_vol is not None:
            self._vol_hist.append(float(last_vol))
            self._vol_hist = self._vol_hist[-40:]

        oi_delta = 0.0
        if len(self._oi_hist) >= 5:
            oi_delta = self._oi_hist[-1] - self._oi_hist[-5]

        vol_spike = 1.0
        if len(self._vol_hist) >= 10:
            avg = sum(self._vol_hist[:-1]) / max(1, len(self._vol_hist) - 1)
            if avg > 0:
                vol_spike = self._vol_hist[-1] / avg

        ret = 0.0
        if len(candles) >= 4:
            try:
                a = float(candles[-4].get("close") or candles[-4].get("c"))
                b = float(candles[-1].get("close") or candles[-1].get("c"))
                if a > 0:
                    ret = (b - a) / a * 100.0
            except Exception:
                pass

        if vol_spike >= 2.2 and abs(ret) >= 0.08:
            direction = "UP" if ret > 0 else "DOWN"
            conf = min(80, int(50 + vol_spike * 8 + abs(ret) * 40))
            return AgentSignal(
                self.name, direction, conf,
                f"Liq-pressure proxy: vol×{vol_spike:.1f}, ret {ret:+.2f}%, OIΔ {oi_delta:.0f}",
                self.category,
                features={
                    "vol_spike": round(vol_spike, 2),
                    "oi_delta": oi_delta,
                    "ret_pct": round(ret, 3),
                },
            )

        if vol_spike >= 1.6:
            return AgentSignal(
                self.name, "WAIT", 45,
                f"Elevated volume ×{vol_spike:.1f} — watching for cascade",
                self.category,
                features={"vol_spike": round(vol_spike, 2), "oi_delta": oi_delta},
            )

        return AgentSignal(
            self.name, "WAIT", 30,
            "No liquidation cluster signature",
            self.category,
            features={"vol_spike": round(vol_spike, 2) if vol_spike else None, "oi_delta": oi_delta},
        )
