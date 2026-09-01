"""
Route an accepted Follower live intent to Kalshi.

evaluate_order never places. This module runs only after accept + live.
Sick-feed / LAW / huddle / caps must already have refused.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict

from backend.data.kalshi_trade import KalshiTradeClient, quote_yes_price, trade_creds_ready

PlaceFn = Callable[..., Awaitable[Dict[str, Any]]]


async def route_accepted_live(
    rec: Dict[str, Any],
    lock: Dict[str, Any] | None = None,
    *,
    place: PlaceFn | None = None,
) -> Dict[str, Any]:
    """
    rec is the evaluate_order result. Mutates a copy.
    Paper (live=False) is never sent to Kalshi.
    """
    out = dict(rec or {})
    out["routed"] = False
    out["order_id"] = out.get("order_id") or ""
    if not out.get("accepted"):
        return out
    if not out.get("live"):
        return out
    if out.get("refuse"):
        out["accepted"] = False
        return out
    if not trade_creds_ready() and place is None:
        out["accepted"] = False
        out["refuse"] = "no_keys"
        return out
    ticker = str((lock or {}).get("ticker") or out.get("ticker") or "").strip()
    side = str(out.get("side") or (lock or {}).get("side") or "").upper()
    yes_px = quote_yes_price(lock or {}) if lock else out.get("yes_price")
    if not ticker or side not in ("UP", "DOWN"):
        out["accepted"] = False
        out["refuse"] = "intent"
        return out
    if yes_px is None:
        out["accepted"] = False
        out["refuse"] = "quote"
        return out
    placer = place or _default_place
    placed = await placer(
        ticker=ticker,
        direction=side,
        contracts=int(out.get("contracts") or 1),
        yes_price=yes_px,
        client_order_id=out.get("idempotency_key") or None,
    )
    if not isinstance(placed, dict) or not placed.get("ok"):
        out["accepted"] = False
        out["refuse"] = (placed or {}).get("refuse") or "broker"
        out["routed"] = False
        return out
    out["routed"] = True
    out["order_id"] = str(placed.get("order_id") or "")
    out["refuse"] = ""
    return out


async def _default_place(**kwargs: Any) -> Dict[str, Any]:
    if not trade_creds_ready():
        return {"ok": False, "refuse": "no_keys"}
    client = KalshiTradeClient()
    create = getattr(client, "create_order", None)
    if create is None:
        return {"ok": False, "refuse": "no_keys"}
    return await create(**kwargs)
