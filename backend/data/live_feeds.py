"""Shared cache + math for the five live-desk feeds.

1. Kalshi quote cache (fast REST stand-in for ticker/trades)
2. Quote age
3. Binance / Bybit force liquidations
4. Combined YES+NO leftover
5. Hyperliquid funding / OI size cap

Fail-soft. Never locks. Never invents a number that was not printed.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

KALSHI_STALE_S = 25.0
FORCE_WINDOW_S = 120.0
HL_CROWD_HOURLY = 0.00005  # ~44% annualized


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def to_cents(raw: Any) -> Optional[float]:
    n = _f(raw)
    if n is None:
        return None
    if 0.0 <= n <= 1.5:
        return n * 100.0
    return n


def combined_leftover(yes_ask: Any, no_ask: Any) -> Dict[str, Any]:
    """100c - YES ask - NO ask. Positive = leftover after buying both sides."""
    y = to_cents(yes_ask)
    n = to_cents(no_ask)
    if y is None or n is None:
        return {
            "yes_ask_cents": y,
            "no_ask_cents": n,
            "combined_ask_cents": None,
            "leftover_cents": None,
            "both_cheap": False,
            "no_edge": None,
        }
    combined = y + n
    leftover = 100.0 - combined
    return {
        "yes_ask_cents": round(y, 2),
        "no_ask_cents": round(n, 2),
        "combined_ask_cents": round(combined, 2),
        "leftover_cents": round(leftover, 2),
        "both_cheap": leftover > 0,
        "no_edge": leftover <= 0,
    }


_CACHE: Dict[str, Dict[str, Any]] = {
    "btc": {},
    "eth": {},
}


def cache_for(asset: str) -> Dict[str, Any]:
    key = "eth" if str(asset or "").lower().startswith("eth") else "btc"
    row = _CACHE.setdefault(key, {})
    return row


def put(asset: str, **fields: Any) -> Dict[str, Any]:
    row = cache_for(asset)
    row.update({k: v for k, v in fields.items() if v is not None})
    row["updated_at"] = time.time()
    return row


def quote_age_s(row: Dict[str, Any] | None = None, fetched_at: Any = None) -> Optional[float]:
    ts = _f(fetched_at)
    if ts is None and isinstance(row, dict):
        ts = _f(row.get("kalshi_fetched_at") or row.get("quote_at") or row.get("updated_at"))
    if ts is None:
        return None
    return max(0.0, time.time() - ts)


def quote_stale(age: Optional[float], max_age: float = KALSHI_STALE_S) -> bool:
    return bool(age is not None and age > max_age)


def _force_totals(row: Dict[str, Any]) -> Dict[str, float]:
    now = time.time()
    events = [e for e in (row.get("force_events") or []) if isinstance(e, dict)]
    fresh = [e for e in events if now - float(e.get("ts") or 0) <= FORCE_WINDOW_S]
    long_usd = sum(float(e.get("usd") or 0) for e in fresh if str(e.get("side") or "").upper() == "SELL")
    short_usd = sum(float(e.get("usd") or 0) for e in fresh if str(e.get("side") or "").upper() == "BUY")
    return {
        "force_long_usd": round(long_usd, 0),
        "force_short_usd": round(short_usd, 0),
        "force_n": len(fresh),
    }


def record_force(asset: str, *, side: str, usd: float, px: float | None = None) -> None:
    row = cache_for(asset)
    events = list(row.get("force_events") or [])
    events.append({"ts": time.time(), "side": str(side or "").upper(), "usd": float(usd or 0), "px": px})
    cutoff = time.time() - FORCE_WINDOW_S
    events = [e for e in events if float(e.get("ts") or 0) >= cutoff][-80:]
    row["force_events"] = events
    row.update(_force_totals(row))
    row["force_at"] = time.time()


def record_hl(asset: str, *, funding: float | None, oi: float | None, mark: float | None = None) -> None:
    crowded = bool(funding is not None and abs(float(funding)) >= HL_CROWD_HOURLY)
    put(
        asset,
        hl_funding=funding,
        hl_oi=oi,
        hl_mark=mark,
        hl_crowded=crowded,
        hl_at=time.time(),
    )


def record_quote(asset: str, quote: Dict[str, Any]) -> None:
    leftover = combined_leftover(quote.get("yes_ask"), quote.get("no_ask"))
    put(
        asset,
        ticker=quote.get("ticker"),
        yes_bid=quote.get("yes_bid"),
        yes_ask=quote.get("yes_ask"),
        no_bid=quote.get("no_bid"),
        no_ask=quote.get("no_ask"),
        last_side=quote.get("last_side"),
        last_size=quote.get("last_size"),
        quote_source=quote.get("source") or "kalshi_rest",
        kalshi_fetched_at=time.time(),
        **leftover,
    )


def public_payload(asset: str = "btc") -> Dict[str, Any]:
    row = dict(cache_for(asset))
    age = quote_age_s(row)
    leftover = combined_leftover(row.get("yes_ask"), row.get("no_ask"))
    force = _force_totals(row)
    return {
        "asset": "eth" if str(asset).lower().startswith("eth") else "btc",
        "ticker": row.get("ticker"),
        "quote_age_s": round(age, 1) if age is not None else None,
        "quote_stale": quote_stale(age),
        "quote_source": row.get("quote_source"),
        "yes_ask": row.get("yes_ask"),
        "no_ask": row.get("no_ask"),
        **leftover,
        **force,
        "hl_funding": row.get("hl_funding"),
        "hl_oi": row.get("hl_oi"),
        "hl_crowded": bool(row.get("hl_crowded")),
        "size_cap_pct": 2.5 if row.get("hl_crowded") else None,
        "ok": bool(row.get("kalshi_fetched_at") or row.get("hl_at") or force["force_n"]),
    }


def enrich_snap(snap: Dict[str, Any]) -> Dict[str, Any]:
    """Merge fresher cache into a pipeline snap. Last printed number wins."""
    if not isinstance(snap, dict):
        return snap
    asset = snap.get("asset") or "btc"
    row = cache_for(asset)
    km = snap.get("kalshi_market") if isinstance(snap.get("kalshi_market"), dict) else {}

    if row.get("yes_ask") is not None:
        snap["kalshi_yes_ask"] = row.get("yes_ask")
        km["yes_ask"] = row.get("yes_ask")
    if row.get("yes_bid") is not None:
        snap["kalshi_yes_bid"] = row.get("yes_bid")
        km["yes_bid"] = row.get("yes_bid")
    if row.get("no_ask") is not None:
        snap["kalshi_no_ask"] = row.get("no_ask")
        km["no_ask"] = row.get("no_ask")
    if row.get("no_bid") is not None:
        snap["kalshi_no_bid"] = row.get("no_bid")
        km["no_bid"] = row.get("no_bid")
    if row.get("ticker") and not km.get("ticker"):
        km["ticker"] = row.get("ticker")
        snap["market_ticker"] = row.get("ticker")
    if row.get("kalshi_fetched_at"):
        prev = _f(snap.get("kalshi_fetched_at")) or 0.0
        if float(row["kalshi_fetched_at"]) >= prev:
            snap["kalshi_fetched_at"] = row["kalshi_fetched_at"]

    leftover = combined_leftover(
        snap.get("kalshi_yes_ask") if snap.get("kalshi_yes_ask") is not None else km.get("yes_ask"),
        snap.get("kalshi_no_ask") if snap.get("kalshi_no_ask") is not None else km.get("no_ask"),
    )
    snap["leftover_cents"] = leftover["leftover_cents"]
    snap["combined_ask_cents"] = leftover["combined_ask_cents"]
    snap["combined_leftover"] = leftover

    force = _force_totals(row)
    snap["force_liq"] = force
    if snap.get("liq_long_usd") is None and force["force_long_usd"]:
        snap["liq_long_usd"] = force["force_long_usd"]
    if snap.get("liq_short_usd") is None and force["force_short_usd"]:
        snap["liq_short_usd"] = force["force_short_usd"]

    if row.get("hl_funding") is not None and snap.get("funding_rate") is None:
        snap["funding_rate"] = row.get("hl_funding")
        health = snap.setdefault("health", {})
        health["derivs_ok"] = True
        health["derivs_source"] = health.get("derivs_source") or "hyperliquid"
    if row.get("hl_oi") is not None and snap.get("open_interest") is None:
        snap["open_interest"] = row.get("hl_oi")
        snap["oi"] = row.get("hl_oi")
    snap["hl_crowded"] = bool(row.get("hl_crowded"))
    snap["hl_funding"] = row.get("hl_funding")
    snap["hl_oi"] = row.get("hl_oi")

    age = quote_age_s(snap, snap.get("kalshi_fetched_at"))
    health = snap.setdefault("health", {})
    health["quote_age_s"] = round(age, 1) if age is not None else None
    health["quote_stale"] = quote_stale(age)
    health["quote_source"] = row.get("quote_source") or "pipeline"
    health["hl_crowded"] = bool(row.get("hl_crowded"))
    health["force_n"] = force["force_n"]
    if leftover["leftover_cents"] is not None:
        health["leftover_cents"] = leftover["leftover_cents"]
    snap["kalshi_market"] = km
    snap["book"] = km
    return snap
