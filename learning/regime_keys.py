"""
Regime keys for split adaptive weights.

A bot that is strong in US overlap can be weak in Asia quiet hours.
Weights are tracked per SESSION × WINDOW-PHASE so the Chair can listen
differently in each pocket of the day.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

UTC = timezone.utc

# UTC hour buckets (same spirit as SESSION / TOD bot)
SESSION_BUCKETS = [
    (0, 7, "ASIA"),
    (7, 12, "EUROPE"),
    (12, 17, "US_AM"),
    (17, 21, "US_PM"),
    (21, 24, "LATE"),
]


def session_for_hour(hour: int) -> str:
    for start, end, name in SESSION_BUCKETS:
        if start <= hour < end:
            return name
    return "UNKNOWN"


def phase_for_mins_left(mins_left: Optional[float]) -> str:
    """
    Window phase inside a 15m Kalshi contract.
    EARLY: >= 10m left · MID: 5–10m · LATE: < 5m · PIN: < 2m
    """
    if mins_left is None:
        return "MID"
    try:
        m = float(mins_left)
    except Exception:
        return "MID"
    if m >= 10.0:
        return "EARLY"
    if m >= 5.0:
        return "MID"
    if m >= 2.0:
        return "LATE"
    return "PIN"


def classify_regime(
    when: Optional[datetime] = None,
    mins_left: Optional[float] = None,
) -> str:
    """Return key like US_AM_EARLY or ASIA_LATE."""
    dt = when or datetime.now(UTC)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    dt = dt.astimezone(UTC)
    session = session_for_hour(dt.hour)
    phase = phase_for_mins_left(mins_left)
    return f"{session}_{phase}"


def parse_mins_left(close_time: Optional[str], when: Optional[datetime] = None) -> Optional[float]:
    if not close_time:
        return None
    try:
        ct = datetime.fromisoformat(str(close_time).replace("Z", "+00:00"))
        if ct.tzinfo is None:
            ct = ct.replace(tzinfo=UTC)
        ref = when or datetime.now(UTC)
        if ref.tzinfo is None:
            ref = ref.replace(tzinfo=UTC)
        return max(0.0, (ct - ref).total_seconds() / 60.0)
    except Exception:
        return None


def regime_from_market(market_data: Dict[str, Any] | None) -> str:
    """Classify current regime from live market payload."""
    md = market_data or {}
    close_time = None
    km = md.get("kalshi_market") or {}
    if isinstance(km, dict):
        close_time = km.get("close_time")
    close_time = close_time or md.get("close_time")
    mins = parse_mins_left(close_time)
    return classify_regime(mins_left=mins)


def regime_from_call(called_at: Optional[str], close_time: Optional[str] = None) -> str:
    """Classify regime at the moment a paper/path call was opened."""
    when = None
    if called_at:
        try:
            when = datetime.fromisoformat(str(called_at).replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=UTC)
        except Exception:
            when = None
    mins = parse_mins_left(close_time, when)
    return classify_regime(when=when, mins_left=mins)


def split_key(regime: str) -> Tuple[str, str]:
    """US_AM_EARLY → (US_AM, EARLY)."""
    if "_" not in regime:
        return regime, "MID"
    session, phase = regime.rsplit("_", 1)
    if phase not in ("EARLY", "MID", "LATE", "PIN"):
        return regime, "MID"
    return session, phase
