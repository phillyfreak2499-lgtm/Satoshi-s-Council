"""Last painted table, on disk, so a deploy does not sit on WAIT for 90s.

The analysis loop and the official-finish sweep still run in the background.
This file is only the last thin paint: seats, clock, price, health flags.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from loguru import logger

from backend.services.state_poll import thin_table

_DIR_ENV = "DATA_DIR"


def _dir() -> Path:
    raw = (os.environ.get(_DIR_ENV) or "").strip() or "./data"
    p = Path(raw)
    p.mkdir(parents=True, exist_ok=True)
    return p


def snapshot_path(asset: str) -> Path:
    name = "btc" if str(asset or "").lower().startswith("b") else (
        "eth" if str(asset or "").lower().startswith("e") else str(asset or "desk")
    )
    return _dir() / f"last_desk_{name}.json"


def paint_snapshot(state: Any) -> Optional[Dict[str, Any]]:
    """Thin, paint-sized copy. No research book."""
    thin = thin_table(state)
    if not thin or not (thin.get("agents") or thin.get("market")):
        return None
    md = state.get("market") if isinstance(state, dict) and isinstance(state.get("market"), dict) else {}
    market = dict(thin.get("market") or {})
    if md.get("candles"):
        market["candles"] = md["candles"][-60:]
    if market.get("price") is None:
        for k in ("price", "current_price", "spot"):
            if md.get(k) is not None:
                market["price"] = md[k]
                break
    if market.get("funding") is None and md.get("funding") is not None:
        market["funding"] = md["funding"]
    if market.get("oi") is None and (md.get("oi") is not None or md.get("open_interest") is not None):
        market["oi"] = md.get("oi") if md.get("oi") is not None else md.get("open_interest")
    health = dict(thin.get("health") or {})
    health["from_snapshot"] = True
    health["binance"] = False
    health["coinbase"] = False
    health["spot_source"] = "last_good"
    thin["market"] = market
    thin["health"] = health
    thin["last_good"] = True
    thin["from_snapshot"] = True
    thin["hydrating"] = True
    return thin


def save_desk_snapshot(asset: str, state: Any) -> None:
    body = paint_snapshot(state)
    if not body:
        return
    path = snapshot_path(asset)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def load_desk_snapshot(asset: str) -> Optional[Dict[str, Any]]:
    path = snapshot_path(asset)
    if not path.is_file():
        return None
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.debug(f"desk snapshot read skip ({asset}): {e}")
        return None
    if not isinstance(body, dict) or not (body.get("agents") or body.get("market")):
        return None
    body["last_good"] = True
    body["from_snapshot"] = True
    body["hydrating"] = True
    health = body.get("health") if isinstance(body.get("health"), dict) else {}
    health = dict(health)
    health["from_snapshot"] = True
    health["binance"] = False
    health["coinbase"] = False
    health["spot_source"] = "last_good"
    body["health"] = health
    return body


def apply_snapshot_to_pipeline(pipeline: Any, snap: Optional[Dict[str, Any]]) -> None:
    """Seed in-memory last-good so the first live fetch can fill holes."""
    if not snap or not hasattr(pipeline, "_last_good"):
        return
    md = snap.get("market") if isinstance(snap.get("market"), dict) else {}
    seed = {
        "current_price": md.get("price"),
        "spot": md.get("price"),
        "funding_rate": md.get("funding"),
        "open_interest": md.get("oi"),
        "oi": md.get("oi"),
        "mins_left": md.get("mins_left"),
        "candles": md.get("candles") or [],
        "last_good": True,
    }
    if seed["current_price"] is None and not seed["candles"]:
        return
    pipeline._last_good = seed
