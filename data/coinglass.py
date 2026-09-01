"""CoinGlass helpers. Live key optional — empty snap, never invent.

When the plan wall / missing key / 401 hits, CARRY / CHAIN / CASCADE must
NOT go dark if Binance perps already stamped funding_rate / open_interest
onto the market snapshot. glass_seats_must_wait is the gate for that.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx

PLAN_WALL_REASON = "CoinGlass plan wall"
_CG = "https://open-api.coinglass.com"


def plan_wall_latched() -> bool:
    return False


def chair_window_ok(snap=None) -> bool:
    return True


def coinglass_hud_ok(raw_ok: bool = False, reason=None) -> bool:
    return bool(raw_ok)


def _has_num(v: Any) -> bool:
    if v is None or v == "" or v == {}:
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, dict):
        return any(_has_num(x) for x in v.values())
    return True


def glass_seats_must_wait(market_data=None, *args, **kwargs) -> bool:
    """Sit only when no derivatives of any kind are on the snapshot.

    CoinGlass down + Binance perps fallback → seats stay live.
    """
    md = market_data if isinstance(market_data, dict) else {}
    if md.get("funding_rate") is not None or md.get("open_interest") is not None or md.get("oi") is not None:
        return False
    if md.get("liq_long_usd") is not None or md.get("liq_short_usd") is not None:
        return False
    health = md.get("health") if isinstance(md.get("health"), dict) else {}
    if health.get("derivs_ok"):
        return False
    cg = md.get("coinglass") if isinstance(md.get("coinglass"), dict) else {}
    if _has_num(cg.get("funding")) or _has_num(cg.get("oi")) or _has_num(cg.get("liq")):
        return False
    return True


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
        "funding": _has_num(snap.get("funding")),
        "oi": _has_num(snap.get("oi")),
        "liq": _has_num(snap.get("liq")),
    }


class CoinGlassClient:
    def __init__(self, *a, **k):
        self.symbol = (k.get("symbol") or "BTCUSDT").upper()
        self.api_key = (k.get("api_key") or os.environ.get("COINGLASS_API_KEY") or "").strip()
        coin = self.symbol.replace("USDT", "").replace("USD", "")
        self.coin = coin or "BTC"

    async def get_historical_derivatives(self, *a, **k):
        snap = empty_derivatives("1h")
        if not self.api_key:
            snap["skip_reason"] = "no_key"
            return snap
        headers = {"CG-API-KEY": self.api_key, "coinglassSecret": self.api_key}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(3.5, connect=2.0)) as client:
                fund = oi = liq = None
                try:
                    r = await client.get(
                        f"{_CG}/public/v2/funding",
                        params={"symbol": self.coin},
                        headers=headers,
                    )
                    if r.status_code == 200:
                        body = r.json()
                        data = body.get("data") if isinstance(body, dict) else body
                        if isinstance(data, list) and data:
                            fund = data[0].get("rate") if isinstance(data[0], dict) else None
                        elif isinstance(data, dict):
                            fund = data.get("rate") or data.get("funding") or data.get("fundingRate")
                    elif r.status_code in (401, 403, 429):
                        snap["skip_reason"] = PLAN_WALL_REASON if r.status_code in (401, 403) else "rate_limited"
                        return snap
                except Exception:
                    pass
                try:
                    r = await client.get(
                        f"{_CG}/public/v2/open_interest",
                        params={"symbol": self.coin},
                        headers=headers,
                    )
                    if r.status_code == 200:
                        body = r.json()
                        data = body.get("data") if isinstance(body, dict) else body
                        if isinstance(data, dict):
                            oi = data.get("openInterest") or data.get("oi")
                except Exception:
                    pass
                try:
                    r = await client.get(
                        f"{_CG}/public/v2/liquidation_history",
                        params={"symbol": self.coin, "time_type": "h1"},
                        headers=headers,
                    )
                    if r.status_code == 200:
                        body = r.json()
                        data = body.get("data") if isinstance(body, dict) else body
                        if isinstance(data, dict):
                            liq = data
                            snap["liq_long_usd"] = data.get("longVolUsd") or data.get("buyVolUsd")
                            snap["liq_short_usd"] = data.get("shortVolUsd") or data.get("sellVolUsd")
                except Exception:
                    pass
                snap["funding"] = fund
                snap["oi"] = oi
                snap["liq"] = liq
                if fund is None and oi is None and liq is None:
                    snap["skip_reason"] = snap.get("skip_reason") or "empty"
                else:
                    snap.pop("skip_reason", None)
                return snap
        except Exception as e:
            snap["skip_reason"] = type(e).__name__
            return snap

    async def close(self):
        return None
