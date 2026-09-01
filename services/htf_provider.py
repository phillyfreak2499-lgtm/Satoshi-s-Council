"""
Real higher-timeframe candles for the HTF structure/regime layer.

`backend/services/htf.py` documents that its live feed is only 90 one-minute
bars — so without a provider it fakes "daily" structure from 90 minutes. It
exposes `set_provider(fn)` where `fn(asset, tf) -> candles` is called
**synchronously** during analysis. Binance fetches are async, so this module
bridges the two: an async `refresh()` pulls genuine 1h/4h/1d BTC candles into a
small cache, and the sync provider serves that cache.

Bitcoin only. Bulletproof fail-safe: if the cache is empty or a fetch fails,
the provider returns [] and htf falls back to its existing 1m aggregation —
never worse than before, only better when live data is available.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from loguru import logger

from backend.services import htf

# tf -> {"candles": [...], "at": epoch_seconds}
_CACHE: Dict[str, Dict[str, Any]] = {}
# Refresh cadence per timeframe (HTF candles move slowly; don't hammer).
_TTL = {"1d": 3600.0, "4h": 1800.0, "1h": 600.0}
_LIMIT = {"1d": 220, "4h": 220, "1h": 220}
_registered = False


def _provider(asset: str, tf: str) -> List[Dict[str, float]]:
    """Sync provider for htf.set_provider — serves cached BTC candles only."""
    try:
        a = str(asset or "").lower()
        if a not in ("btc", "bitcoin", ""):
            return []
        row = _CACHE.get(str(tf).lower())
        return list(row["candles"]) if row and row.get("candles") else []
    except Exception:
        return []


def register() -> None:
    """Point htf at this provider. Idempotent and safe to call at startup."""
    global _registered
    if _registered:
        return
    try:
        htf.set_provider(_provider)
        _registered = True
        logger.info("HTF provider registered (real 1h/4h/1d BTC candles)")
    except Exception as e:
        logger.debug(f"HTF provider register skipped: {e}")


async def refresh(binance_client: Any, *, now: Optional[float] = None) -> None:
    """
    Best-effort: refresh cached BTC HTF candles from a BinanceClient.

    Call from an already-async loop (e.g. the BTC pipeline fetch). Every path
    is guarded — a failure here must never disturb the caller.
    """
    if binance_client is None or not hasattr(binance_client, "get_klines_interval"):
        return
    now = now if now is not None else time.time()
    for tf in ("1d", "4h", "1h"):
        try:
            row = _CACHE.get(tf)
            if row and (now - float(row.get("at") or 0)) < _TTL[tf]:
                continue
            candles = await binance_client.get_klines_interval(tf, _LIMIT[tf])
            if candles:
                _CACHE[tf] = {"candles": candles, "at": now}
        except Exception:
            # Leave any stale cache in place; provider still fails safe.
            continue


def status() -> Dict[str, Any]:
    """Freshness snapshot, for an optional data-health tile."""
    now = time.time()
    return {
        tf: {
            "bars": len(row.get("candles") or []),
            "age_s": round(now - float(row.get("at") or 0), 1),
        }
        for tf, row in _CACHE.items()
    }
