"""CoinGlass helpers. Live key optional — empty snap, never invent."""
from __future__ import annotations
from typing import Any, Dict, Optional

PLAN_WALL_REASON = "CoinGlass plan wall"


def plan_wall_latched() -> bool:
    return False


def chair_window_ok(snap=None) -> bool:
    return True


def coinglass_hud_ok(raw_ok: bool = False, reason=None) -> bool:
    return bool(raw_ok)


def glass_seats_must_wait(*args, **kwargs) -> bool:
    return False


def empty_derivatives(tf: str = "1h") -> Dict[str, Any]:
    return {
        "tf": tf,
        "funding": None,
        "oi": None,
        "liq": None,
        "skip_reason": "no_key",
    }


def apply_hist_to_market(md: Optional[Dict[str, Any]], cg_snap: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(md or {})
    out["coinglass"] = cg_snap if isinstance(cg_snap, dict) else empty_derivatives()
    return out


def feeds_present(cg_snap: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    snap = cg_snap or {}
    return {
        "funding": bool(snap.get("funding")),
        "oi": bool(snap.get("oi")),
        "liq": bool(snap.get("liq")),
    }


class CoinGlassClient:
    def __init__(self, *a, **k):
        self.symbol = k.get("symbol")

    async def get_historical_derivatives(self, *a, **k):
        snap = empty_derivatives("1h")
        snap["skip_reason"] = "no_client"
        return snap

    async def close(self):
        return None
