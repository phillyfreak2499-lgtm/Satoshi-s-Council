"""Spot-feed health: Binance vision/us, Coinbase, or live candles+price."""
from __future__ import annotations

from typing import Any, Dict, Optional


def _price_ok(raw: Any) -> bool:
    try:
        return raw is not None and float(raw) > 0
    except (TypeError, ValueError):
        return False


def spot_source_label(base_or_name: Any) -> str:
    text = str(base_or_name or "").lower()
    if "binance.vision" in text or text == "vision":
        return "vision"
    if "binance.us" in text or text in ("binance.us", "binance_us", "us"):
        return "binance.us"
    if "coinbase" in text:
        return "coinbase"
    if "binance.com" in text or text in ("binance.com", "binance"):
        return "binance.com"
    return text or "unknown"


def spot_feed_ok(
    health: Dict[str, Any] | None = None,
    market_data: Dict[str, Any] | None = None,
) -> bool:
    """True when Warden should treat spot (BN) as OK — Binance or Coinbase live."""
    h = health or {}
    md = market_data or {}
    if h.get("binance") or h.get("coinbase"):
        return True
    src = spot_source_label(h.get("spot_source") or md.get("spot_source"))
    if src in ("vision", "binance.us", "coinbase"):
        return True
    candles = md.get("candles") or []
    price = md.get("current_price") or md.get("price") or md.get("binance_price") or md.get("coinbase_price")
    if candles and _price_ok(price):
        return True
    if _price_ok(md.get("coinbase_price")):
        return True
    return False


def coalesce_spot_price(*vals: Any) -> Optional[float]:
    for v in vals:
        try:
            px = float(v)
        except (TypeError, ValueError):
            continue
        if px > 0:
            return px
    return None
