"""
Noise reduction — spike guard, then a scalar Kalman smoother.

Funding and open-interest feeds print the occasional one-tick absurdity: a
single sample ten times the neighbours, usually a bad merge upstream. A raw
threshold check turns that into a false "extreme funding" veto, and RAIJIN
sits the table for no reason.

Two stages, in order:

    1. SpikeGuard   Median + MAD gate. A sample too far from its recent
                    neighbours is replaced by the median, not passed on.
                    Kills one-tick outliers before they reach the filter.

    2. Kalman1D     Scalar constant-position Kalman. Trades responsiveness
                    for stability via the ratio Q/R — higher is twitchier.

The raw value is always kept alongside the smoothed one, so a comparison is
one field away and nothing is hidden.

No particle filter, and nothing here is per-tick expensive: both stages are
O(1) per sample apart from a small median over the guard window.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from loguru import logger

from backend.services.rolling import PER_HOUR, RollingWindow, median

# ── Per-series tuning ─────────────────────────────────────────────────
# Q = process noise: how much the true value is believed to move per step.
# R = measurement noise: how much the feed is believed to lie.
# Responsiveness is the ratio Q/R. Bigger ratio reacts faster and smooths
# less. These are the only numbers to touch when tuning.
#
#   funding         smoothest. Funding moves on an 8h clock; a fast filter
#                   here buys nothing and invites false extremes.
#   open_interest   balanced. Must catch a real expansion without chasing
#                   every tick.
#   price           most reactive. Divergence and velocity need it live.
PRESETS: Dict[str, Dict[str, float]] = {
    "funding":       {"q": 1e-5, "r": 1e-2, "p0": 1.0, "guard": 5, "max_dev": 4.0},
    "open_interest": {"q": 1e-3, "r": 1e-2, "p0": 1.0, "guard": 5, "max_dev": 5.0},
    "price":         {"q": 1e-2, "r": 1e-3, "p0": 1.0, "guard": 5, "max_dev": 6.0},
}
DEFAULT_PRESET = "open_interest"

# Spike-guard scale floors. MAD alone goes to zero on a flat series, which
# would disable the gate precisely when an outlier stands out most.
REL_SCALE_FLOOR = 0.15    # fraction of the running median
ABS_SCALE_FLOOR = 1e-12   # keeps a median of exactly 0 from collapsing it

# Env overrides for experimentation without a redeploy:
#   COUNCIL_KALMAN_FUNDING_Q=2e-5  COUNCIL_KALMAN_FUNDING_R=5e-3
_ENV_PREFIX = "COUNCIL_KALMAN_"
# Set COUNCIL_FILTER_DEBUG=1 to log raw vs smoothed per update.
DEBUG_ENV = "COUNCIL_FILTER_DEBUG"


def _env_float(name: str) -> Optional[float]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def preset_for(series: str) -> Dict[str, float]:
    """Tuning for a named series, with env overrides applied."""
    key = str(series or "").strip().lower()
    base = dict(PRESETS.get(key) or PRESETS[DEFAULT_PRESET])
    for field in ("q", "r", "p0", "guard", "max_dev"):
        val = _env_float(f"{_ENV_PREFIX}{key.upper()}_{field.upper()}")
        if val is not None:
            base[field] = val
    return base


def _debug_on() -> bool:
    return (os.environ.get(DEBUG_ENV) or "").strip().lower() in ("1", "true", "yes", "on")


def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if val == val else None


# ── Stage 1: spike / median guard ─────────────────────────────────────
class SpikeGuard:
    """
    Median + MAD outlier gate.

    A sample further than `max_dev` MADs from the running median is treated
    as a bad print and replaced by the median. MAD is used rather than a
    standard deviation because one huge outlier inflates a stdev enough to
    hide itself, which defeats the point.
    """

    __slots__ = ("size", "max_dev", "_buf", "rejected", "last_raw", "last_out")

    def __init__(self, size: int = 5, max_dev: float = 4.0):
        self.size = max(3, int(size))
        self.max_dev = float(max_dev)
        self._buf: List[float] = []
        self.rejected = 0
        self.last_raw: Optional[float] = None
        self.last_out: Optional[float] = None

    def push(self, value: Any) -> Optional[float]:
        """Return the cleaned value, or None when the input is unusable."""
        val = _f(value)
        if val is None:
            return None
        self.last_raw = val

        # Not enough history to judge — accept and learn.
        if len(self._buf) < 3:
            self._buf.append(val)
            self._trim()
            self.last_out = val
            return val

        med = median(self._buf)
        if med is None:
            self._buf.append(val)
            self._trim()
            self.last_out = val
            return val

        devs = [abs(v - med) for v in self._buf]
        mad = median(devs) or 0.0
        # A perfectly flat series has MAD 0, which would make the gate a
        # no-op exactly when an outlier is most obvious. Floor the scale on
        # a fraction of the median so the guard still bites, and keep an
        # absolute floor so a median of 0 cannot collapse it either.
        scale = max(mad, REL_SCALE_FLOOR * abs(med), ABS_SCALE_FLOOR)
        out = val
        if scale > 0 and abs(val - med) > self.max_dev * scale:
            # One-tick absurdity. Substitute the median and remember it as
            # rejected, but still let the buffer see the real sample so a
            # genuine regime shift is not fought forever.
            out = med
            self.rejected += 1

        self._buf.append(val)
        self._trim()
        self.last_out = out
        return out

    def _trim(self) -> None:
        if len(self._buf) > self.size:
            self._buf = self._buf[-self.size:]

    def reset(self) -> None:
        self._buf.clear()
        self.rejected = 0


# ── Stage 2: scalar Kalman ────────────────────────────────────────────
class Kalman1D:
    """
    Scalar constant-position Kalman filter.

        predict:  P = P + Q
        gain:     K = P / (P + R)
        update:   x = x + K(z - x);  P = (1 - K)P

    Higher Q/R follows the measurement; lower Q/R trusts the estimate.
    """

    __slots__ = ("q", "r", "p", "x", "k", "n")

    def __init__(self, q: float = 1e-3, r: float = 1e-2, p0: float = 1.0, x0: Optional[float] = None):
        self.q = float(q)
        self.r = float(r)
        self.p = float(p0)
        self.x: Optional[float] = _f(x0)
        self.k = 0.0
        self.n = 0

    def update(self, z: Any) -> Optional[float]:
        val = _f(z)
        if val is None:
            return self.x
        if self.x is None:
            # Seed on the first real sample rather than easing up from zero.
            self.x = val
            self.n = 1
            return self.x
        self.p += self.q
        self.k = self.p / (self.p + self.r) if (self.p + self.r) else 0.0
        self.x = self.x + self.k * (val - self.x)
        self.p = (1.0 - self.k) * self.p
        self.n += 1
        return self.x

    @property
    def value(self) -> Optional[float]:
        return self.x

    def reset(self) -> None:
        self.x = None
        self.p = 1.0
        self.k = 0.0
        self.n = 0


# ── Combined series ───────────────────────────────────────────────────
class FilteredSeries:
    """
    SpikeGuard → Kalman1D → RollingWindow.

    Reads the smoothed value for decisions, keeps the raw for debugging,
    and derives velocity and trend from the *smoothed* series so a single
    bad print cannot manufacture a velocity spike.
    """

    def __init__(
        self,
        series: str,
        *,
        maxlen: int = 60,
        window_s: Optional[float] = None,
        q: Optional[float] = None,
        r: Optional[float] = None,
    ):
        cfg = preset_for(series)
        self.series = str(series or DEFAULT_PRESET)
        self.guard = SpikeGuard(size=int(cfg["guard"]), max_dev=float(cfg["max_dev"]))
        self.kalman = Kalman1D(
            q=float(q if q is not None else cfg["q"]),
            r=float(r if r is not None else cfg["r"]),
            p0=float(cfg["p0"]),
        )
        self.smooth = RollingWindow(maxlen=maxlen, window_s=window_s)
        self.raw = RollingWindow(maxlen=maxlen, window_s=window_s)
        self._last_key: Any = None

    def update(self, value: Any, ts: Optional[float] = None, key: Any = None) -> Optional[float]:
        """
        Push one observation. Returns the smoothed value.

        `key` makes the update idempotent for a given snapshot. read_funding
        and read_oi are each called several times while one board is built;
        without this the same print would be fed to the filter repeatedly,
        collapsing the gain and inventing velocity out of nothing.
        """
        val = _f(value)
        if val is None:
            return self.value
        if key is not None:
            if key == self._last_key:
                return self.value
            self._last_key = key
        self.raw.add(val, ts=ts)
        cleaned = self.guard.push(val)
        smoothed = self.kalman.update(cleaned)
        if smoothed is not None:
            self.smooth.add(smoothed, ts=ts)
        if _debug_on():
            logger.debug(
                f"[filter:{self.series}] raw={val:.6g} guard={cleaned:.6g} "
                f"smooth={smoothed:.6g} k={self.kalman.k:.4f} rejected={self.guard.rejected}"
            )
        return smoothed

    # ── reads ────────────────────────────────────────────────────────
    @property
    def value(self) -> Optional[float]:
        """Smoothed current value — what the signal layer should read."""
        return self.kalman.value

    @property
    def raw_value(self) -> Optional[float]:
        """Unfiltered latest sample, kept for comparison and debugging."""
        return self.raw.current()

    def velocity(self, per: float = PER_HOUR) -> Optional[float]:
        return self.smooth.velocity(per)

    def trend(self, eps: float = 0.0) -> str:
        return self.smooth.trend(eps)

    def is_extreme(self, threshold: float) -> bool:
        """Extremes are judged on the smoothed value, never a single print."""
        val = self.value
        return val is not None and abs(val) >= abs(threshold)

    def ready(self, n: int = 2) -> bool:
        return self.smooth.ready(n)

    def debug(self) -> Dict[str, Any]:
        return {
            "series": self.series,
            "raw": self.raw_value,
            "smoothed": self.value,
            "spikes_rejected": self.guard.rejected,
            "q": self.kalman.q,
            "r": self.kalman.r,
            "gain": round(self.kalman.k, 5),
            "n": len(self.smooth),
            "velocity_per_h": self.velocity(),
            "trend": self.trend(),
        }


# ── Shared per-asset series ───────────────────────────────────────────
# Funding and OI are the only two wired in, per scope.
_SERIES: Dict[str, FilteredSeries] = {}


def series_for(asset: str, kind: str) -> FilteredSeries:
    """
    The process-wide filtered series for one asset+kind, e.g. ("btc",
    "funding"). Created on first use so a fresh deploy needs no warm-up
    wiring.
    """
    key = f"{str(asset or 'btc').lower()}:{str(kind or '').lower()}"
    if key not in _SERIES:
        _SERIES[key] = FilteredSeries(kind, maxlen=120)
    return _SERIES[key]


def reset_series() -> None:
    """Tests only."""
    _SERIES.clear()
