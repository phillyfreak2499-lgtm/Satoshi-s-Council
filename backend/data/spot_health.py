"""Spot-feed health: CFB RTI, Binance vision, Coinbase. us is a separate book."""
from __future__ import annotations

from typing import Any, Dict, Optional


def _price_ok(raw: Any) -> bool:
    try:
        return raw is not None and float(raw) > 0
    except (TypeError, ValueError):
        return False


def spot_source_label(base_or_name: Any) -> str:
    text = str(base_or_name or "").lower()
    if text in ("cfb", "cfbenchmarks", "brti", "erti", "ethusd_rti") or "cfbenchmark" in text:
        return "cfb"
    if "binance.vision" in text or text == "vision":
        return "vision"
    if "binance.us" in text or text in ("binance.us", "binance_us", "us"):
        return "binance.us"
    if "coinbase" in text:
        return "coinbase"
    if "binance.com" in text or text in ("binance.com", "binance"):
        return "binance.com"
    return text or "unknown"


def research_spot_ok(source: Any) -> bool:
    """Research rank only: CFB, vision, Coinbase. Not api.binance.us."""
    return spot_source_label(source) in ("cfb", "vision", "coinbase")


def spot_feed_ok(
    health: Dict[str, Any] | None = None,
    market_data: Dict[str, Any] | None = None,
) -> bool:
    """True when Warden should treat spot (BN) as OK — CFB, vision, or Coinbase live."""
    h = health or {}
    md = market_data or {}
    if h.get("binance") or h.get("coinbase") or h.get("cfb"):
        return True
    src = spot_source_label(
        h.get("research_spot_source") or h.get("spot_source") or md.get("spot_source")
    )
    if src in ("cfb", "vision", "coinbase"):
        return True
    # us may be up as a separate book; that is not the research print
    if src == "binance.us":
        return True
    candles = md.get("candles") or []
    price = (
        md.get("research_spot")
        or md.get("cfb_avg_60s")
        or md.get("current_price")
        or md.get("price")
        or md.get("binance_price")
        or md.get("coinbase_price")
    )
    if candles and _price_ok(price):
        return True
    if _price_ok(md.get("cfb_avg_60s")) or _price_ok(md.get("cfb_rti")):
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
