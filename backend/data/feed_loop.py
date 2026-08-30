"""Background polls + pipeline hook for live_feeds.

Kalshi official WebSocket needs signed API keys. Public REST orderbook /
markets is unauthenticated, so we poll it on a 1.5s loop and stamp the
same quote object the Chair already reads. Reconnect snapshot = the
next successful REST print.

forceOrder tries Binance fstream first (often 451 from Oregon), then
Bybit public linear liquidation stream.

Hyperliquid metaAndAssetCtxs is one public POST.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, Optional

import httpx
from loguru import logger

from backend.data.live_feeds import enrich_snap, public_payload, record_force, record_hl, record_quote

KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
HL = "https://api.hyperliquid.xyz/info"
BYBIT_WS = "wss://stream.bybit.com/v5/public/linear"
BINANCE_WS = "wss://fstream.binance.com/market/ws/btcusdt@forceOrder"

_SERIES = {"btc": "KXBTC15M", "eth": "KXETHD"}
_HL_COIN = {"btc": "BTC", "eth": "ETH"}
_BYBIT_SYM = {"btc": "BTCUSDT", "eth": "ETHUSDT"}

_TIMEOUT = httpx.Timeout(3.0, connect=2.0)
_HEADERS = {"User-Agent": "SatoshiCouncil/1.0 paper-desk", "Accept": "application/json"}

_INSTALLED = False
_TASKS: list = []
_CLIENT: Optional[httpx.AsyncClient] = None


def _http() -> httpx.AsyncClient:
    global _CLIENT
    if _CLIENT is None or _CLIENT.is_closed:
        _CLIENT = httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True)
    return _CLIENT


def _f(v: Any) -> Optional[float]:
    try:
        n = float(v)
        return n if n == n else None
    except (TypeError, ValueError):
        return None


async def _get(url: str, params: Optional[dict] = None) -> Any:
    try:
        r = await _http().get(url, params=params)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.debug(f"live_feed get {url}: {e}")
        return None


async def poll_kalshi(asset: str) -> None:
    series = _SERIES["eth" if asset == "eth" else "btc"]
    body = await _get(f"{KALSHI}/markets", {"status": "open", "series_ticker": series, "limit": 1})
    markets = (body or {}).get("markets") if isinstance(body, dict) else None
    m = markets[0] if isinstance(markets, list) and markets else {}
    if not isinstance(m, dict) or not m.get("ticker"):
        return
    ticker = str(m.get("ticker"))
    book = await _get(f"{KALSHI}/markets/{ticker}/orderbook", {"depth": 1})
    yes_ask = _f(m.get("yes_ask"))
    no_ask = _f(m.get("no_ask"))
    yes_bid = _f(m.get("yes_bid"))
    no_bid = _f(m.get("no_bid"))
    fp = (book or {}).get("orderbook_fp") if isinstance(book, dict) else None
    if isinstance(fp, dict):
        yes_lvls = fp.get("yes_dollars") or []
        no_lvls = fp.get("no_dollars") or []
        if yes_lvls:
            yes_bid = _f(yes_lvls[-1][0]) or yes_bid
        if no_lvls:
            no_bid = _f(no_lvls[-1][0]) or no_bid
        if no_bid is not None and yes_ask is None:
            yes_ask = 1.0 - no_bid if no_bid <= 1.5 else 100.0 - no_bid
        if yes_bid is not None and no_ask is None:
            no_ask = 1.0 - yes_bid if yes_bid <= 1.5 else 100.0 - yes_bid
    record_quote(
        asset,
        {
            "ticker": ticker,
            "yes_bid": yes_bid,
            "yes_ask": yes_ask,
            "no_bid": no_bid,
            "no_ask": no_ask,
            "source": "kalshi_rest",
        },
    )


async def poll_hyperliquid(asset: str) -> None:
    try:
        r = await _http().post(HL, json={"type": "metaAndAssetCtxs"})
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.debug(f"hyperliquid: {e}")
        return
    if not isinstance(body, list) or len(body) < 2:
        return
    meta, ctxs = body[0], body[1]
    universe = (meta or {}).get("universe") if isinstance(meta, dict) else None
    if not isinstance(universe, list) or not isinstance(ctxs, list):
        return
    want = _HL_COIN[asset]
    for i, spec in enumerate(universe):
        if not isinstance(spec, dict) or spec.get("name") != want:
            continue
        if i >= len(ctxs) or not isinstance(ctxs[i], dict):
            return
        ctx = ctxs[i]
        record_hl(
            asset,
            funding=_f(ctx.get("funding")),
            oi=_f(ctx.get("openInterest")),
            mark=_f(ctx.get("markPx") or ctx.get("oraclePx")),
        )
        return


async def _ws_loop(url: str, on_msg) -> None:
    try:
        import websockets
    except Exception:
        return
    delay = 2.0
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, close_timeout=5, max_size=2**20) as ws:
                delay = 2.0
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    await on_msg(msg)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"ws {url}: {e}")
            await asyncio.sleep(delay)
            delay = min(30.0, delay * 1.7)


async def _on_binance_force(msg: Dict[str, Any]) -> None:
    o = msg.get("o") if isinstance(msg, dict) else None
    if not isinstance(o, dict):
        return
    qty = _f(o.get("q") or o.get("z")) or 0.0
    px = _f(o.get("ap") or o.get("p")) or 0.0
    usd = qty * px
    if usd <= 0:
        return
    record_force("btc", side=str(o.get("S") or ""), usd=usd, px=px)


async def _on_bybit_liq(msg: Dict[str, Any], asset: str) -> None:
    topic = str(msg.get("topic") or "")
    if "liquidation" not in topic:
        return
    data = msg.get("data")
    rows = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    for row in rows:
        if not isinstance(row, dict):
            continue
        qty = _f(row.get("size") or row.get("sz")) or 0.0
        px = _f(row.get("price") or row.get("p")) or 0.0
        usd = qty * px
        if usd <= 0:
            continue
        side = str(row.get("side") or row.get("S") or "")
        record_force(asset, side=side, usd=usd, px=px)


async def bybit_liq_loop(asset: str) -> None:
    try:
        import websockets
    except Exception:
        return
    symbol = _BYBIT_SYM[asset]
    delay = 2.0
    while True:
        try:
            async with websockets.connect(BYBIT_WS, ping_interval=20, close_timeout=5) as ws:
                await ws.send(json.dumps({"op": "subscribe", "args": [f"liquidation.{symbol}"]}))
                delay = 2.0
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    await _on_bybit_liq(msg, asset)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"bybit liq {asset}: {e}")
            await asyncio.sleep(delay)
            delay = min(30.0, delay * 1.7)


async def rest_loop() -> None:
    while True:
        try:
            await asyncio.gather(
                poll_kalshi("btc"),
                poll_kalshi("eth"),
                poll_hyperliquid("btc"),
                poll_hyperliquid("eth"),
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"live rest loop: {e}")
        await asyncio.sleep(1.6)


def ensure_tasks() -> None:
    global _TASKS
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _TASKS:
        return
    _TASKS = [
        loop.create_task(rest_loop(), name="live-rest"),
        loop.create_task(_ws_loop(BINANCE_WS, _on_binance_force), name="bn-force"),
        loop.create_task(bybit_liq_loop("btc"), name="bybit-liq-btc"),
        loop.create_task(bybit_liq_loop("eth"), name="bybit-liq-eth"),
    ]
    logger.info("live feeds: rest + forceOrder + hyperliquid started")


def install_live_feeds() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    from backend.data.pipeline import DataPipeline

    orig = DataPipeline.fetch

    async def wrapped(self):
        ensure_tasks()
        snap = await orig(self)
        try:
            return enrich_snap(snap)
        except Exception as e:
            logger.debug(f"live enrich: {e}")
            return snap

    DataPipeline.fetch = wrapped

    try:
        from backend.agents import structure_gates as sg

        orig_stake = sg.structure_stake_pct

        def capped_stake(*args, **kwargs):
            pct = orig_stake(*args, **kwargs)
            from backend.data.live_feeds import cache_for

            if cache_for("btc").get("hl_crowded") or cache_for("eth").get("hl_crowded"):
                return min(float(pct), 2.5)
            return pct

        sg.structure_stake_pct = capped_stake
    except Exception:
        pass

    _INSTALLED = True
    ensure_tasks()


def desk_feeds() -> Dict[str, Any]:
    return {
        "btc": public_payload("btc"),
        "eth": public_payload("eth"),
        "server_time": time.time(),
        "note": "Advisory tape. Paper only. Does not lock.",
    }
