"""AGGR multi-exchange tape — public historical bars from api.aggr.trade.

Same feed https://aggr.trade/aegx uses for 5s BTCUSD / whale / liq panes.
No key. Cache 12s. Never invent numbers; empty snap on failure.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx
from loguru import logger

AGGR = "https://api.aggr.trade"
TF_MS = 15_000
LOOKBACK_MS = 5 * 60 * 1000
CACHE_S = 12.0
WHALE_USD = 100_000.0
LIQ_PRINT = 50_000.0

_HEADERS = {"User-Agent": "SatoshiCouncil/1.0 paper-desk", "Accept": "application/json"}

MARKETS = {
    "btc": "BINANCE_FUTURES:btcusdt+BINANCE:btcusdt+COINBASE:BTC-USD+COINBASE:BTC-USDT+BYBIT:BTCUSDT+OKEX:BTC-USDT-SWAP",
    "eth": "BINANCE_FUTURES:ethusdt+BINANCE:ethusdt+COINBASE:ETH-USD+COINBASE:ETH-USDT+BYBIT:ETHUSDT+OKEX:ETH-USDT-SWAP",
}

_COL = {
    "time": 0, "cbuy": 1, "close": 2, "csell": 3, "high": 4,
    "lbuy": 5, "low": 6, "lsell": 7, "market": 8, "open": 9,
    "vbuy": 10, "vsell": 11,
}

_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def empty_tape(asset: str = "btc", reason: str = "empty") -> Dict[str, Any]:
    return {
        "ok": False,
        "source": "aggr",
        "asset": (asset or "btc").lower(),
        "tf": "15s",
        "pressure": "mixed",
        "buy_ratio": None,
        "vbuy": 0.0,
        "vsell": 0.0,
        "cbuy": 0,
        "csell": 0,
        "lbuy": 0.0,
        "lsell": 0.0,
        "whale": False,
        "liq": "quiet",
        "close": None,
        "bars": 0,
        "whale_trades": [],
        "skip_reason": reason,
        "fetched_at": time.time(),
    }


def _f(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _row(cols: Dict[str, int], item: List[Any]) -> Dict[str, Any]:
    def g(name: str) -> Any:
        i = cols.get(name, _COL.get(name))
        if i is None or i >= len(item):
            return None
        return item[i]

    ts = _f(g("time"))
    if ts > 1e12:
        ts = ts / 1000.0
    return {
        "t": ts,
        "market": str(g("market") or ""),
        "close": _f(g("close")),
        "vbuy": _f(g("vbuy")),
        "vsell": _f(g("vsell")),
        "cbuy": int(_f(g("cbuy"))),
        "csell": int(_f(g("csell"))),
        "lbuy": _f(g("lbuy")),
        "lsell": _f(g("lsell")),
    }


def _grade(buy_ratio: Optional[float], lbuy: float, lsell: float, whale: bool) -> Dict[str, str]:
    pressure = "mixed"
    if buy_ratio is not None:
        if buy_ratio >= 0.62:
            pressure = "up"
        elif buy_ratio <= 0.38:
            pressure = "down"
    liq = "quiet"
    if lbuy >= LIQ_PRINT and lbuy > lsell * 1.25:
        liq = "longs_squeezed"
    elif lsell >= LIQ_PRINT and lsell > lbuy * 1.25:
        liq = "shorts_squeezed"
    elif (lbuy + lsell) >= LIQ_PRINT:
        liq = "both"
    return {"pressure": pressure, "liq": liq, "whale": whale}


def summarize(rows: List[Dict[str, Any]], asset: str) -> Dict[str, Any]:
    snap = empty_tape(asset, "empty")
    if not rows:
        return snap
    now = time.time()
    last_1 = now - 60
    last_5 = now - 300
    vbuy = vsell = lbuy = lsell = 0.0
    cbuy = csell = 0
    vbuy_1 = vsell_1 = 0.0
    close = None
    whales: List[Dict[str, Any]] = []
    for r in rows:
        t = float(r.get("t") or 0)
        if t and t < last_5:
            continue
        vb, vs = float(r["vbuy"]), float(r["vsell"])
        vbuy += vb
        vsell += vs
        cbuy += int(r["cbuy"])
        csell += int(r["csell"])
        lbuy += float(r["lbuy"])
        lsell += float(r["lsell"])
        if r.get("close"):
            close = r["close"]
        if t >= last_1:
            vbuy_1 += vb
            vsell_1 += vs
        if vb >= WHALE_USD:
            whales.append({"side": "buy", "size": round(vb, 0), "price": r.get("close"), "t": t})
        if vs >= WHALE_USD:
            whales.append({"side": "sell", "size": round(vs, 0), "price": r.get("close"), "t": t})
    total = vbuy + vsell
    ratio = (vbuy / total) if total > 0 else None
    whale = bool(whales) or max(vbuy_1, vsell_1) >= WHALE_USD
    graded = _grade(ratio, lbuy, lsell, whale)
    snap.update({
        "ok": True,
        "skip_reason": None,
        "buy_ratio": round(ratio, 4) if ratio is not None else None,
        "vbuy": round(vbuy, 0),
        "vsell": round(vsell, 0),
        "vbuy_1m": round(vbuy_1, 0),
        "vsell_1m": round(vsell_1, 0),
        "cbuy": cbuy,
        "csell": csell,
        "lbuy": round(lbuy, 0),
        "lsell": round(lsell, 0),
        "close": close,
        "bars": len(rows),
        "whale": whale,
        "whale_trades": whales[-12:],
        "pressure": graded["pressure"],
        "liq": graded["liq"],
        "workspace": "https://aggr.trade/aegx",
    })
    snap.pop("skip_reason", None)
    return snap


async def fetch_aggr(asset: str = "btc") -> Dict[str, Any]:
    key = "eth" if str(asset or "").lower().startswith("e") else "btc"
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_S:
        return dict(hit[1])
    markets = MARKETS[key]
    to_ms = int(now * 1000)
    frm = to_ms - LOOKBACK_MS
    url = f"{AGGR}/historical/{frm}/{to_ms}/{TF_MS}/{quote(markets, safe=':')}"
    snap = empty_tape(key, "fetch")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0), headers=_HEADERS) as client:
            r = await client.get(url)
            if r.status_code != 200:
                snap["skip_reason"] = f"HTTP {r.status_code}"
                _cache[key] = (now, snap)
                return snap
            body = r.json()
    except Exception as e:
        logger.warning(f"aggr fetch: {type(e).__name__}: {e}")
        snap["skip_reason"] = type(e).__name__
        return snap
    cols = body.get("columns") if isinstance(body, dict) else None
    colmap = dict(_COL)
    if isinstance(cols, dict):
        colmap = {str(k): int(v) for k, v in cols.items() if str(v).isdigit() or isinstance(v, int)}
    results = body.get("results") if isinstance(body, dict) else None
    rows: List[Dict[str, Any]] = []
    if isinstance(results, list):
        for item in results:
            if isinstance(item, list) and item:
                try:
                    rows.append(_row(colmap, item))
                except Exception:
                    continue
    snap = summarize(rows, key)
    snap["fetched_at"] = now
    _cache[key] = (now, snap)
    return dict(snap)


async def stamp_aggr(snap: Dict[str, Any], asset: str = "btc") -> Dict[str, Any]:
    """Attach tape to a pipeline snapshot. Fills liq/whale holes only."""
    out = dict(snap or {})
    tape = await fetch_aggr(asset)
    out["aggr"] = tape
    health = dict(out.get("health") or {})
    health["aggr"] = bool(tape.get("ok"))
    health["aggr_reason"] = None if tape.get("ok") else tape.get("skip_reason")
    out["health"] = health
    if not tape.get("ok"):
        return out
    out["buy_volume"] = tape.get("vbuy")
    out["sell_volume"] = tape.get("vsell")
    out["taker_buy_volume"] = tape.get("vbuy")
    out["taker_sell_volume"] = tape.get("vsell")
    if tape.get("whale_trades"):
        out["whale_trades"] = tape["whale_trades"]
    if out.get("liq_long_usd") is None:
        out["liq_long_usd"] = tape.get("lbuy")
    if out.get("liq_short_usd") is None:
        out["liq_short_usd"] = tape.get("lsell")
    return out


_HOOKED = False


def install_pipeline_hook() -> None:
    """Wrap DataPipeline.fetch once so every cycle carries an AGGR tape."""
    global _HOOKED
    if _HOOKED:
        return
    try:
        from backend.data.pipeline import DataPipeline
    except Exception:
        return

    original = DataPipeline.fetch

    async def fetch_with_aggr(self):
        snap = await original(self)
        try:
            return await stamp_aggr(snap, getattr(self, "asset", "btc"))
        except Exception as e:
            logger.warning(f"aggr stamp: {type(e).__name__}: {e}")
            return snap

    DataPipeline.fetch = fetch_with_aggr
    _HOOKED = True
    logger.info("AGGR tape hooked into pipeline.fetch")
