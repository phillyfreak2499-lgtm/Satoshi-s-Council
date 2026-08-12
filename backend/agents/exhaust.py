"""
EXHAUST – fade continuation after a large 1h run when short momentum flips.

Research: after ≥~1–1.5% 1h BTC move near high/low, 5m flips against,
Kalshi still extreme → fade the crowded side.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class ExhaustSpecialist(BaseSpecialist):
    name = "exhaust"
    category = "fade"
    base_weight = settings.BASE_WEIGHTS.get("exhaust", 0.09)

    @staticmethod
    def _candle_returns(candles: List[Dict[str, Any]]) -> Dict[str, Optional[float]]:
        """Expect newest-last or newest-first; normalize to chronological."""
        if not candles or len(candles) < 5:
            return {"ret_5m": None, "ret_15m": None, "ret_60m": None, "near_high": None, "near_low": None}
        rows = []
        for c in candles:
            try:
                o = float(c.get("open") or c.get("o") or 0)
                h = float(c.get("high") or c.get("h") or 0)
                l = float(c.get("low") or c.get("l") or 0)
                cl = float(c.get("close") or c.get("c") or 0)
                ts = float(c.get("time") or c.get("t") or c.get("open_time") or 0)
                if cl > 0:
                    rows.append((ts, o, h, l, cl))
            except Exception:
                continue
        if len(rows) < 5:
            return {"ret_5m": None, "ret_15m": None, "ret_60m": None, "near_high": None, "near_low": None}
        rows.sort(key=lambda x: x[0])
        last = rows[-1][4]
        def ret_n(n):
            if len(rows) <= n:
                return None
            base = rows[-(n + 1)][4]
            if base <= 0:
                return None
            return (last - base) / base * 100.0
        # Assume ~1m candles if available
        window = rows[-60:] if len(rows) >= 60 else rows
        hi = max(r[2] for r in window)
        lo = min(r[3] for r in window)
        near_high = (hi - last) / hi * 100.0 if hi > 0 else None
        near_low = (last - lo) / lo * 100.0 if lo > 0 else None
        return {
            "ret_5m": ret_n(5),
            "ret_15m": ret_n(15),
            "ret_60m": ret_n(60) if len(rows) > 60 else ret_n(min(55, len(rows) - 1)),
            "near_high": near_high,
            "near_low": near_low,
        }

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        candles = market_data.get("candles") or []
        stats = self._candle_returns(candles)
        r60 = stats["ret_60m"]
        r5 = stats["ret_5m"]
        up = market_data.get("up_pct")
        try:
            up = float(up) if up is not None else None
        except Exception:
            up = None

        features = {
            **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in stats.items()},
            "up_pct": up,
            "subs": [
                {"name": "1H", "detail": f"{r60:+.2f}%" if r60 is not None else "—"},
                {"name": "5M", "detail": f"{r5:+.2f}%" if r5 is not None else "—"},
                {"name": "YES", "detail": f"{up:.0f}¢" if up is not None else "—"},
            ],
        }

        if r60 is None or r5 is None:
            return AgentSignal(self.name, "WAIT", 45, "Need more candle history", self.category, features=features)

        run_thr = float(getattr(settings, "EXHAUST_1H_PCT", 0.9))
        flip_thr = float(getattr(settings, "EXHAUST_5M_FLIP", 0.12))
        extreme_yes = float(getattr(settings, "EXHAUST_YES_HIGH", 68.0))
        extreme_no = float(getattr(settings, "EXHAUST_YES_LOW", 32.0))

        # Fade run-up: 1h up big, near high, 5m flips down, YES still expensive
        if r60 >= run_thr and r5 <= -flip_thr:
            near_hi = stats.get("near_high")
            if near_hi is not None and near_hi <= 0.35:  # within 0.35% of local high
                if up is None or up >= extreme_yes:
                    conf = min(88, 60 + int((r60 - run_thr) * 12))
                    return AgentSignal(
                        self.name, "DOWN", conf,
                        f"Exhaust fade · 1h +{r60:.2f}% but 5m {r5:+.2f}% · YES crowded",
                        self.category, features=features,
                    )

        # Fade dump: 1h down big, near low, 5m flips up, YES still cheap
        if r60 <= -run_thr and r5 >= flip_thr:
            near_lo = stats.get("near_low")
            if near_lo is not None and near_lo <= 0.35:
                if up is None or up <= extreme_no:
                    conf = min(88, 60 + int((abs(r60) - run_thr) * 12))
                    return AgentSignal(
                        self.name, "UP", conf,
                        f"Exhaust fade · 1h {r60:.2f}% but 5m {r5:+.2f}% · YES soft",
                        self.category, features=features,
                    )

        return AgentSignal(
            self.name, "WAIT", 50,
            f"No exhaust (1h {r60:+.2f}% · 5m {r5:+.2f}%)",
            self.category, features=features,
        )
