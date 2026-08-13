"""
SPOTLAG / VEL – Binance/Coinbase spot velocity; Kalshi often lags CEX.

Enhancements:
- Regime-aware thresholds (different sensitivity by time-of-day pocket)
- Lag sample logging so the bot learns when lag is historically predictive
- Compares spot move vs Kalshi mid move when both available
"""
from __future__ import annotations
from typing import Any, Dict, List, Tuple, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


# Default regime → bps threshold overrides (can be tuned via settings later)
_REGIME_BPS = {
    "US_AM_EARLY": 6.0,
    "US_AM_MID": 7.0,
    "US_AM_LATE": 8.0,
    "US_PM_EARLY": 7.0,
    "US_PM_MID": 8.0,
    "US_PM_LATE": 9.0,
    "US_PM_PIN": 10.0,
    "ASIA": 11.0,
    "EU": 9.0,
    "UNKNOWN_MID": 8.0,
}


class SpotLagSpecialist(BaseSpecialist):
    name = "spotlag"
    category = "velocity"
    base_weight = settings.BASE_WEIGHTS.get("spotlag", 0.10)

    def __init__(self):
        super().__init__()
        self._px_hist: List[Tuple[float, float]] = []  # (ts, price)
        self._kalshi_hist: List[Tuple[float, float]] = []  # (ts, up_pct 0-100)
        # Regime lag log: regime_key → list of (spot_bps, kalshi_delta_pts, lag_s_estimate)
        self._lag_log: Dict[str, List[Dict[str, float]]] = {}

    def _velocity_bps(self, price: float) -> Dict[str, float]:
        now = time.time()
        self._px_hist.append((now, price))
        cutoff = now - 300
        self._px_hist = [(t, p) for t, p in self._px_hist if t >= cutoff]
        out = {"bps_30s": 0.0, "bps_60s": 0.0, "bps_3m": 0.0}
        if len(self._px_hist) < 2 or price <= 0:
            return out
        for key, secs in (("bps_30s", 30), ("bps_60s", 60), ("bps_3m", 180)):
            target = now - secs
            older = min(self._px_hist, key=lambda x: abs(x[0] - target))
            if abs(older[0] - target) < secs * 0.55 and older[1] > 0:
                out[key] = (price - older[1]) / older[1] * 10000.0
        return out

    def _kalshi_delta(self, up_pct: Optional[float]) -> float:
        """Change in Kalshi mid (pts) over ~30-60s."""
        if up_pct is None:
            return 0.0
        try:
            up = float(up_pct)
            if up <= 1.5:
                up *= 100.0
        except Exception:
            return 0.0
        now = time.time()
        self._kalshi_hist.append((now, up))
        cutoff = now - 180
        self._kalshi_hist = [(t, p) for t, p in self._kalshi_hist if t >= cutoff]
        if len(self._kalshi_hist) < 2:
            return 0.0
        target = now - 45
        older = min(self._kalshi_hist, key=lambda x: abs(x[0] - target))
        if abs(older[0] - target) > 40:
            older = self._kalshi_hist[0]
        return up - older[1]

    def _log_lag_sample(
        self,
        regime: str,
        spot_bps: float,
        kalshi_delta: float,
    ) -> None:
        """Accumulate samples so lag quality can be measured by regime over days."""
        if abs(spot_bps) < 3:
            return
        entry = {
            "ts": time.time(),
            "spot_bps": round(spot_bps, 2),
            "kalshi_delta": round(kalshi_delta, 2),
            # Crude lag quality: did Kalshi move same direction?
            "aligned": 1.0 if spot_bps * kalshi_delta > 0 else 0.0,
        }
        bucket = self._lag_log.setdefault(regime or "UNKNOWN", [])
        bucket.append(entry)
        # Keep last 200 samples per regime
        if len(bucket) > 200:
            self._lag_log[regime] = bucket[-200:]

    def _regime_hit_rate(self, regime: str) -> Optional[float]:
        samples = self._lag_log.get(regime) or []
        if len(samples) < 8:
            return None
        recent = samples[-40:]
        return sum(s["aligned"] for s in recent) / len(recent)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        px = market_data.get("current_price")
        try:
            px = float(px) if px is not None else None
        except Exception:
            px = None
        if px is None or px <= 0:
            return AgentSignal(self.name, "WAIT", 40, "No spot price", self.category)

        vel = self._velocity_bps(px)
        lead = vel["bps_30s"] if abs(vel["bps_30s"]) >= abs(vel["bps_60s"]) * 0.7 else vel["bps_60s"]

        # Regime-aware threshold
        regime = (
            market_data.get("regime_key")
            or (market_data.get("regime") or {}).get("regime_key")
            if isinstance(market_data.get("regime"), dict)
            else market_data.get("regime")
        )
        if not isinstance(regime, str):
            regime = "UNKNOWN_MID"

        base_thr = float(getattr(settings, "SPOTLAG_BPS", 8.0))
        thr = float(_REGIME_BPS.get(regime, base_thr))
        # If we have enough lag samples and this regime is historically weak, raise bar
        hit = self._regime_hit_rate(regime)
        if hit is not None and hit < 0.48:
            thr *= 1.35  # lag not predictive here — demand bigger move
        elif hit is not None and hit >= 0.62:
            thr *= 0.85  # lag is working — allow slightly smaller moves

        up_pct = market_data.get("up_pct")
        kalshi_delta = self._kalshi_delta(up_pct)
        self._log_lag_sample(regime, lead, kalshi_delta)

        features = {
            **vel,
            "threshold_bps": thr,
            "regime": regime,
            "kalshi_delta_45s": round(kalshi_delta, 2),
            "regime_lag_hit_rate": round(hit, 3) if hit is not None else None,
            "lag_samples": len(self._lag_log.get(regime) or []),
            "subs": [
                {"name": "30S", "detail": f"{vel['bps_30s']:+.1f}bp"},
                {"name": "60S", "detail": f"{vel['bps_60s']:+.1f}bp"},
                {"name": "3M", "detail": f"{vel['bps_3m']:+.1f}bp"},
                {"name": "REG", "detail": regime[:10]},
            ],
        }

        if abs(lead) < thr:
            return AgentSignal(
                self.name, "WAIT", 48,
                f"Spot quiet ({lead:+.1f}bp < {thr:.0f}bp {regime})",
                self.category, features=features,
            )

        direction = "UP" if lead > 0 else "DOWN"
        conf = min(88, 54 + int(abs(lead) * 1.2))

        # Kalshi already moved same way → lag may be closing, slightly less edge
        if kalshi_delta * lead > 0 and abs(kalshi_delta) >= 3:
            conf = max(50, conf - 6)
            features["lag_status"] = "closing"
        elif kalshi_delta * lead < 0 and abs(kalshi_delta) >= 2:
            # Spot leading, Kalshi still opposite → classic lag window
            conf = min(92, conf + 7)
            features["lag_status"] = "open_window"
        else:
            features["lag_status"] = "neutral"

        if vel["bps_3m"] * lead > 0 and abs(vel["bps_3m"]) > thr * 0.5:
            conf = min(92, conf + 4)

        if hit is not None:
            features["subs"].append({"name": "HIT", "detail": f"{hit:.0%}"})

        return AgentSignal(
            self.name, direction, conf,
            f"Spot {lead:+.1f}bp / {direction} · {regime} lag"
            + (f" · window open" if features.get("lag_status") == "open_window" else ""),
            self.category, features=features,
        )
