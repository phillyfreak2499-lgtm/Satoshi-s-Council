"""
PANIC / FADE – research edge #1 on KXBTC15M.

Turbine 5k-strategy backtests: panic_fade was ~93/96 profitable variants.
When Kalshi mid moves hard in a short window, take the OTHER side.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


class PanicSpecialist(BaseSpecialist):
    name = "panic"
    category = "fade"
    base_weight = settings.BASE_WEIGHTS.get("panic", 0.12)

    def __init__(self):
        super().__init__()
        self._mid_hist: List[Tuple[float, float]] = []  # (ts, mid_0_100)

    def _track(self, mid: float) -> Dict[str, float]:
        now = time.time()
        self._mid_hist.append((now, mid))
        cutoff = now - 180
        self._mid_hist = [(t, m) for t, m in self._mid_hist if t >= cutoff]
        out = {"mid": mid, "move_30s": 0.0, "move_60s": 0.0, "move_120s": 0.0}
        if len(self._mid_hist) < 2:
            return out
        first_t, first_m = self._mid_hist[0]
        span = max(1.0, now - first_t)
        # Always expose total move over available history
        total_move = mid - first_m
        for label, secs in (("move_30s", 30), ("move_60s", 60), ("move_120s", 120)):
            target = now - secs
            older = min(self._mid_hist, key=lambda x: abs(x[0] - target))
            if abs(older[0] - target) < secs * 0.65:
                out[label] = mid - older[1]
            elif span >= secs * 0.25:
                # Scale total move to this window if samples are dense but short
                out[label] = total_move * min(1.0, secs / span)
            else:
                out[label] = total_move  # cold start: use what we have
        return out

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        # Prefer mid (already blended upstream); fall back to bid
        up = market_data.get("up_pct")
        if up is None:
            bid = market_data.get("kalshi_yes_bid")
            ask = market_data.get("kalshi_yes_ask")
            try:
                if bid is not None and ask is not None:
                    b, a = float(bid), float(ask)
                    if b <= 1.0:
                        b *= 100.0
                    if a <= 1.0:
                        a *= 100.0
                    up = (b + a) / 2.0
                elif bid is not None:
                    up = float(bid)
                    if up <= 1.0:
                        up *= 100.0
            except Exception:
                up = None
        if up is None:
            return AgentSignal(self.name, "WAIT", 40, "No Kalshi mid", self.category)

        stats = self._track(float(up))
        # Strongest short-window move drives the fade
        move = max(
            abs(stats["move_30s"]),
            abs(stats["move_60s"]) * 0.85,
            abs(stats["move_120s"]) * 0.6,
        )
        signed = stats["move_30s"] if abs(stats["move_30s"]) >= abs(stats["move_60s"]) else stats["move_60s"]
        if abs(signed) < abs(stats["move_30s"]):
            signed = stats["move_30s"]

        thr = float(getattr(settings, "PANIC_THRESHOLD_PTS", 4.0))
        features = {
            **stats,
            "threshold": thr,
            "subs": [
                {"name": "30S", "detail": f"{stats['move_30s']:+.1f}pt"},
                {"name": "60S", "detail": f"{stats['move_60s']:+.1f}pt"},
                {"name": "THR", "detail": f"≥{thr:g}pt fade"},
            ],
        }

        if move < thr:
            return AgentSignal(
                self.name, "WAIT", 48,
                f"No panic ({move:.1f}pt < {thr:g})",
                self.category, features=features,
            )

        # Fade the move: odds ripped UP → fade DOWN (buy NO), and vice versa
        if signed > 0:
            direction = "DOWN"
            reason = f"Panic fade · mid +{signed:.1f}pt → fade DOWN"
        else:
            direction = "UP"
            reason = f"Panic fade · mid {signed:.1f}pt → fade UP"

        # Confidence scales with how violent the panic was
        conf = min(88, 55 + int(move * 3.5))
        if move >= thr * 2:
            conf = min(92, conf + 6)
            reason += " · hard panic"

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
