"""Live spot feed flag. last-good prices do not count."""
from __future__ import annotations

from typing import Any, Optional


def spot_feed_ok(health: Optional[Any] = None, table: Optional[Any] = None) -> bool:
    """True only when a live spot venue printed this cycle.

    /health.spot_ok must be allowed to go false. A stale last-good BTC
    print is not a feed.
    """
    h = health if isinstance(health, dict) else {}
    t = table if isinstance(table, dict) else {}
    if t.get("last_good") and not (h.get("binance") or h.get("coinbase") or h.get("cfb")):
        return False
    if h.get("binance") or h.get("coinbase") or h.get("cfb"):
        return True
    src = str(h.get("spot_source") or "")
    return src in ("binance", "binance_vision", "binance_us", "coinbase", "cfb")
