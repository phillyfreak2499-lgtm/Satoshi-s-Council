"""
Rolling windows — one implementation, reused everywhere.

Ranking decay, funding trend, OI velocity, divergence and backtesting all
need "the last N of something" with the same handful of derived numbers.
This is that, with no dependencies beyond the standard library.

Two window modes, and you can use both at once:

    RollingWindow(maxlen=30)              last 30 observations
    RollingWindow(window_s=3600)          last hour
    RollingWindow(maxlen=30, window_s=3600)  whichever bites first

Timestamps are seconds. Pass them explicitly (`add(v, ts=...)`) when
replaying history — a backtest must not depend on wall-clock time.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Iterable, List, Optional, Tuple

UP = "up"
DOWN = "down"
FLAT = "flat"

# Per-hour is the natural unit for funding and OI on this desk.
PER_SECOND = 1.0
PER_MINUTE = 60.0
PER_HOUR = 3600.0


def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if val == val else None  # drop NaN


def median(values: Iterable[float]) -> Optional[float]:
    vals = sorted(v for v in values if v is not None)
    n = len(vals)
    if not n:
        return None
    mid = n // 2
    if n % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


class RollingWindow:
    """
    A bounded series of (timestamp, value) with the derived numbers the
    signal layer keeps asking for.

    Every accessor returns None rather than raising when there is not
    enough history yet, so callers degrade to "no opinion" instead of
    guessing from one sample.
    """

    __slots__ = ("maxlen", "window_s", "decay", "_rows", "_now")

    def __init__(
        self,
        maxlen: Optional[int] = None,
        *,
        window_s: Optional[float] = None,
        decay: Optional[float] = None,
        now: Optional[Callable[[], float]] = None,
    ):
        if maxlen is None and window_s is None:
            maxlen = 100
        self.maxlen = int(maxlen) if maxlen else None
        self.window_s = float(window_s) if window_s else None
        # Exponential weight applied by age when decay is set (newest = age 0).
        self.decay = float(decay) if decay else None
        self._rows: List[Tuple[float, float]] = []
        self._now = now or time.time

    # ── writes ───────────────────────────────────────────────────────
    def add(self, value: Any, ts: Optional[float] = None) -> bool:
        """Append one observation. Non-numeric input is ignored."""
        val = _f(value)
        if val is None:
            return False
        stamp = float(ts) if ts is not None else float(self._now())
        self._rows.append((stamp, val))
        self._trim()
        return True

    def extend(self, values: Iterable[Any]) -> int:
        return sum(1 for v in values if self.add(v))

    def clear(self) -> None:
        self._rows.clear()

    def _trim(self) -> None:
        if self.window_s:
            cutoff = self._rows[-1][0] - self.window_s
            # Rows arrive in time order in practice; a linear trim is fine
            # at these sizes and tolerates the occasional out-of-order add.
            self._rows = [r for r in self._rows if r[0] >= cutoff]
        if self.maxlen and len(self._rows) > self.maxlen:
            self._rows = self._rows[-self.maxlen:]

    # ── shape ────────────────────────────────────────────────────────
    def __len__(self) -> int:
        return len(self._rows)

    def __bool__(self) -> bool:
        return bool(self._rows)

    def values(self) -> List[float]:
        return [v for _t, v in self._rows]

    def timestamps(self) -> List[float]:
        return [t for t, _v in self._rows]

    def ready(self, n: int = 2) -> bool:
        return len(self._rows) >= max(1, int(n))

    # ── reads ────────────────────────────────────────────────────────
    def current(self) -> Optional[float]:
        return self._rows[-1][1] if self._rows else None

    def first(self) -> Optional[float]:
        return self._rows[0][1] if self._rows else None

    def mean(self, *, decayed: bool = False) -> Optional[float]:
        if not self._rows:
            return None
        vals = self.values()
        if not decayed or not self.decay:
            return sum(vals) / len(vals)
        # age 0 = newest
        total = 0.0
        weight = 0.0
        for age, val in enumerate(reversed(vals)):
            w = self.decay ** age
            total += val * w
            weight += w
        return (total / weight) if weight else None

    def min(self) -> Optional[float]:
        return min(self.values()) if self._rows else None

    def max(self) -> Optional[float]:
        return max(self.values()) if self._rows else None

    def median(self) -> Optional[float]:
        return median(self.values())

    def change(self) -> Optional[float]:
        """Absolute change across the window (newest − oldest)."""
        if len(self._rows) < 2:
            return None
        return self._rows[-1][1] - self._rows[0][1]

    def change_pct(self) -> Optional[float]:
        """Percent change across the window. None when the base is zero."""
        if len(self._rows) < 2:
            return None
        base = self._rows[0][1]
        if base == 0:
            return None
        return (self._rows[-1][1] - base) / abs(base) * 100.0

    def span_s(self) -> Optional[float]:
        if len(self._rows) < 2:
            return None
        return self._rows[-1][0] - self._rows[0][0]

    def velocity(self, per: float = PER_HOUR) -> Optional[float]:
        """Rate of change in units per `per` seconds. Default: per hour."""
        delta = self.change()
        span = self.span_s()
        if delta is None or not span:
            return None
        return delta / span * float(per)

    def trend(self, eps: float = 0.0) -> str:
        """
        up / down / flat, comparing the newest value against the mean of
        the rest. `eps` is the dead-band that keeps noise reading flat.
        """
        if len(self._rows) < 2:
            return FLAT
        vals = self.values()
        recent = vals[-1]
        prior = vals[:-1]
        base = sum(prior) / len(prior)
        delta = recent - base
        if abs(delta) <= abs(eps):
            return FLAT
        return UP if delta > 0 else DOWN

    def slope(self, per: float = PER_HOUR) -> Optional[float]:
        """Least-squares slope in units per `per` seconds. Needs 3+ points."""
        n = len(self._rows)
        if n < 3:
            return None
        t0 = self._rows[0][0]
        xs = [t - t0 for t, _v in self._rows]
        ys = self.values()
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = sum((x - mx) ** 2 for x in xs)
        if den == 0:
            return None
        return num / den * float(per)

    def stdev(self) -> Optional[float]:
        n = len(self._rows)
        if n < 2:
            return None
        vals = self.values()
        m = sum(vals) / n
        var = sum((v - m) ** 2 for v in vals) / (n - 1)
        return var ** 0.5

    def zscore(self, value: Optional[float] = None) -> Optional[float]:
        """How many standard deviations from the window mean."""
        n = len(self._rows)
        if n < 2:
            return None
        val = self.current() if value is None else _f(value)
        if val is None:
            return None
        sd = self.stdev()
        m = self.mean()
        if sd is None or m is None or sd == 0:
            return None
        return (val - m) / sd

    def is_extreme(self, threshold: float, *, absolute: bool = True) -> bool:
        """
        True when the newest value breaches `threshold`. Absolute by
        default, because funding and OI care about magnitude either way.
        """
        val = self.current()
        if val is None:
            return False
        return (abs(val) >= abs(threshold)) if absolute else (val >= threshold)

    def snapshot(self, *, per: float = PER_HOUR) -> dict:
        """Everything at once, for HUDs and debug payloads."""
        return {
            "n": len(self._rows),
            "current": self.current(),
            "mean": self.mean(),
            "median": self.median(),
            "min": self.min(),
            "max": self.max(),
            "change": self.change(),
            "change_pct": self.change_pct(),
            "velocity": self.velocity(per),
            "trend": self.trend(),
            "stdev": self.stdev(),
            "span_s": self.span_s(),
        }
