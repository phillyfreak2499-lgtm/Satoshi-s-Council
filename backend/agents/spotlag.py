"""
VEL – Spot Lag specialist.

Binance/Coinbase spot often leads Kalshi. This bot measures that lead
and only calls when the lag window is open.

Multi-window upgrades:
  - Regime-aware thresholds (time-of-day pockets)
  - Lag sample log so we learn when lag is historically predictive
  - Phase-aware: ENTRY needs a clean open lag window for the whole 15m
  - MID/FINAL: lag closed or reversed vs entry → revise or hold

Does NOT spam direction on every small tick — requires meaningful lead.
"""
from __future__ import annotations
from typing import Any, Dict, List, Tuple, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


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
        # Regime lag log: regime_key → list of samples
        self._lag_log: Dict[str, List[Dict[str, float]]] = {}

    def _velocity_bps(self, price: float) -> Dict[str, float]:
        now = time.time()
        self._px_hist.append((now, price))
        cutoff = now - 300
        self._px_hist = [(t, p) for t, p in self._px_hist if t >= cutoff]
        out = {"bps_30s": 0.0, "bps_60s": 0.0, "bps_3m": 0.0}
        if len(self._px_hist) < 2 or price <= 0:
            return out

        def _bps_since(sec: float) -> float:
            target = now - sec
            # find closest sample at or before target
            prev = None
            for t, p in self._px_hist:
                if t <= target:
                    prev = (t, p)
                else:
                    break
            if prev is None:
                prev = self._px_hist[0]
            p0 = prev[1]
            if p0 <= 0:
                return 0.0
            return ((price - p0) / p0) * 10000.0  # bps

        out["bps_30s"] = round(_bps_since(30), 2)
        out["bps_60s"] = round(_bps_since(60), 2)
        out["bps_3m"] = round(_bps_since(180), 2)
        return out

    def _kalshi_delta(self, up_pct: Optional[float]) -> float:
        if up_pct is None:
            return 0.0
        try:
            up = float(up_pct)
        except (TypeError, ValueError):
            return 0.0
        now = time.time()
        self._kalshi_hist.append((now, up))
        cutoff = now - 120
        self._kalshi_hist = [(t, v) for t, v in self._kalshi_hist if t >= cutoff]
        if len(self._kalshi_hist) < 2:
            return 0.0
        # ~45s lookback
        target = now - 45
        prev = self._kalshi_hist[0]
        for t, v in self._kalshi_hist:
            if t <= target:
                prev = (t, v)
            else:
                break
        return round(up - prev[1], 2)

    def _regime_key(self, market_data: Dict[str, Any]) -> str:
        rk = (
            market_data.get("regime_key")
            or (market_data.get("wm") or {}).get("regime_key")
            or (market_data.get("regime_context") or {}).get("key")
            or "UNKNOWN_MID"
        )
        return str(rk)

    def _regime_hit_rate(self, regime: str) -> Optional[float]:
        samples = self._lag_log.get(regime) or []
        if len(samples) < 8:
            return None
        hits = sum(1 for s in samples if s.get("hit") == 1)
        return hits / len(samples)

    def _log_lag_sample(self, regime: str, lead_bps: float, kalshi_delta: float) -> None:
        if abs(lead_bps) < 3:
            return
        # Did Kalshi eventually move same way within sample window?
        hit = 1 if lead_bps * kalshi_delta > 0 and abs(kalshi_delta) >= 1.5 else 0
        bucket = self._lag_log.setdefault(regime, [])
        bucket.append({
            "lead": lead_bps,
            "k_delta": kalshi_delta,
            "hit": hit,
            "t": time.time(),
        })
        # keep last 80 per regime
        self._lag_log[regime] = bucket[-80:]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=54)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)

        price = market_data.get("current_price") or market_data.get("spot_price")
        try:
            price_f = float(price) if price is not None else None
        except (TypeError, ValueError):
            price_f = None
        if price_f is None or price_f <= 0:
            return AgentSignal(
                self.name, "WAIT", 30,
                self.annotate_reason(market_data, "no spot price"),
                self.category,
            )

        vel = self._velocity_bps(price_f)
        # Lead = strongest short-horizon move in consistent direction
        lead = vel["bps_60s"]
        if abs(vel["bps_30s"]) > abs(lead):
            lead = vel["bps_30s"]
        # Prefer 60s if 3m agrees
        if vel["bps_3m"] * lead > 0 and abs(vel["bps_3m"]) > abs(lead) * 0.5:
            lead = (lead + vel["bps_3m"] * 0.35)

        regime = self._regime_key(market_data)
        base_thr = float(getattr(settings, "SPOTLAG_BPS_THRESHOLD", 8.0))
        thr = float(_REGIME_BPS.get(regime, base_thr))
        hit = self._regime_hit_rate(regime)
        if hit is not None and hit < 0.48:
            thr *= 1.35
        elif hit is not None and hit >= 0.62:
            thr *= 0.85

        up_pct = market_data.get("up_pct")
        kalshi_delta = self._kalshi_delta(up_pct)
        self._log_lag_sample(regime, lead, kalshi_delta)

        lag_status = "neutral"
        if kalshi_delta * lead > 0 and abs(kalshi_delta) >= 3:
            lag_status = "closing"
        elif kalshi_delta * lead < 0 and abs(kalshi_delta) >= 2:
            lag_status = "open_window"

        features = {
            **vel,
            "lead_bps": round(float(lead), 2),
            "threshold_bps": round(thr, 2),
            "regime": regime,
            "kalshi_delta_45s": round(kalshi_delta, 2),
            "regime_lag_hit_rate": round(hit, 3) if hit is not None else None,
            "lag_status": lag_status,
            "lag_samples": len(self._lag_log.get(regime) or []),
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "quiet": quiet,
            "subs": [
                {"name": "30S", "detail": f"{vel['bps_30s']:+.1f}bp"},
                {"name": "60S", "detail": f"{vel['bps_60s']:+.1f}bp"},
                {"name": "3M", "detail": f"{vel['bps_3m']:+.1f}bp"},
                {"name": "REG", "detail": str(regime)[:10]},
            ],
        }
        if hit is not None:
            features["subs"].append({"name": "HIT", "detail": f"{hit:.0%}"})

        notes = []
        local_dir = None
        local_conf = 0

        if abs(lead) < thr:
            notes.append(f"spot quiet ({lead:+.1f}bp < {thr:.0f}bp {regime})")
            local_dir, local_conf = None, 48
        else:
            local_dir = "UP" if lead > 0 else "DOWN"
            local_conf = min(88, 54 + int(abs(lead) * 1.2))
            notes.append(f"spot {lead:+.1f}bp → {local_dir}")
            if lag_status == "closing":
                local_conf = max(50, local_conf - 6)
                notes.append("lag closing")
            elif lag_status == "open_window":
                local_conf = min(92, local_conf + 7)
                notes.append("lag window open")
            if vel["bps_3m"] * lead > 0 and abs(vel["bps_3m"]) > thr * 0.5:
                local_conf = min(92, local_conf + 4)
                notes.append("3m agrees")

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and abs(lead) >= thr and lag_status != "closing":
                direction, conf = local_dir, local_conf
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(94, conf + 4)
                    notes.append(f"streak {streak_dir}×{streak_n}")
            elif local_dir and lag_status == "open_window":
                direction, conf = local_dir, local_conf
            else:
                notes.append("no whole-window lag edge")
        else:
            if entry in ("UP", "DOWN"):
                # Lag reversed hard against entry
                adverse = (
                    local_dir and local_dir != entry
                    and abs(lead) >= thr
                    and lag_status == "open_window"
                )
                supportive = local_dir == entry and abs(lead) >= thr * 0.7
                if adverse and path is not None and abs(path) >= 3.5:
                    direction, conf = local_dir, max(local_conf, 64)
                    notes.append(f"spot lag flipped vs entry {entry} (path {path:+.1f})")
                elif supportive:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"spot still leads entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry} — lag not decisive")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision lag edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        if int(features.get("lag_samples") or 0) <= 0:
            direction, conf = "WAIT", 48
            notes.append("silent until lag_samples>0")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "spot lag neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
