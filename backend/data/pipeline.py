"""Spot + perps + Kalshi public book. Paper research only.

CoinGlass is optional. api.binance.com / fapi.binance.com return 451 from
US regions (Render Oregon included). Spot uses Binance's public data API
(data-api.binance.vision) with Binance.US / Coinbase fallbacks. Perps
(funding + OI) try Binance USDT-M first, then OKX public swaps — the
path that actually answers from Render. Never invent numbers; last-good
is used only for fields that already printed.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict, Optional, Tuple

import httpx
from loguru import logger

# api.binance.com is geo-blocked from the US (HTTP 451). The vision host is
# Binance's public market-data API and answers from Render Oregon.
BINANCE = "https://data-api.binance.vision"
BINANCE_US = "https://api.binance.us"
BINANCE_COM = "https://api.binance.com"
FAPI = "https://fapi.binance.com"
OKX = "https://www.okx.com"
COINBASE = "https://api.coinbase.com"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"

_SYMBOL = {"btc": "BTCUSDT", "eth": "ETHUSDT"}
_SERIES = {"btc": "KXBTC15M", "eth": "KXETH15M"}  # both on the real 15m Kalshi books (ETH moved off hourly KXETHD)
_FETCH_TIMEOUT = httpx.Timeout(3.5, connect=2.0)
_HEADERS = {"User-Agent": "SatoshiCouncil/1.0 paper-desk", "Accept": "application/json"}

# Render Oregon is a restricted Binance location. Five 451s every cycle
# cost ~3.5s on the only worker. Default: skip. Set TRY_BINANCE_COM=1
# if you deploy somewhere Binance.com actually answers.
_SKIP_COM = (os.environ.get("TRY_BINANCE_COM") or "").strip().lower() not in ("1", "true", "yes")
_BLOCKED_HOSTS: set[str] = set()
if _SKIP_COM:
    _BLOCKED_HOSTS.update({"api.binance.com", "fapi.binance.com"})


def _host(url: str) -> str:
    try:
        return url.split("/", 3)[2]
    except Exception:
        return ""


def geo_blocked(url: str) -> bool:
    return _host(url) in _BLOCKED_HOSTS


def _note_451(url: str) -> None:
    h = _host(url)
    if not h or h in _BLOCKED_HOSTS:
        return
    _BLOCKED_HOSTS.add(h)
    logger.info(f"geo-block latched {h} — skipping for this process")



def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _candle(row: Any) -> Dict[str, Any]:
    t = int(row[0])
    o, h, l, c, v = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
    return {
        "t": t, "open_time": t,
        "o": o, "open": o,
        "h": h, "high": h,
        "l": l, "low": l,
        "c": c, "close": c,
        "v": v, "volume": v,
    }


def _okx_inst(asset: str) -> str:
    return "ETH-USDT-SWAP" if str(asset or "").lower().startswith("eth") else "BTC-USDT-SWAP"


def _cb_pair(asset: str) -> str:
    return "ETH-USD" if str(asset or "").lower().startswith("eth") else "BTC-USD"


def _okx_row(body: Any) -> Dict[str, Any]:
    if not isinstance(body, dict) or str(body.get("code")) != "0":
        return {}
    data = body.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return {}


def _okx_rows(body: Any) -> list:
    if not isinstance(body, dict) or str(body.get("code")) != "0":
        return []
    data = body.get("data")
    return data if isinstance(data, list) else []


def pick_spot(vision: Any, us: Any, coinbase: Any, com: Any = None) -> Tuple[Optional[float], Optional[str]]:
    """First live spot print. Vision is the Render-reachable Binance path."""
    for body, src in (
        (vision, "binance_vision"),
        (us, "binance_us"),
        (com, "binance"),
        (coinbase, "coinbase"),
    ):
        if src == "coinbase":
            data = body.get("data") if isinstance(body, dict) else None
            price = _f((data or {}).get("amount")) if isinstance(data, dict) else None
        else:
            price = _f((body or {}).get("price")) if isinstance(body, dict) else None
        if price is not None and price > 0:
            return price, src
    return None, None


class DataPipeline:
    def __init__(self, asset: str = "btc", series_ticker: str | None = None, symbol: str | None = None):
        self.asset = (asset or "btc").lower()
        self.series_ticker = series_ticker or _SERIES.get(self.asset, "KXBTC15M")
        self.symbol = symbol or _SYMBOL.get(self.asset, "BTCUSDT")
        self._client = httpx.AsyncClient(timeout=_FETCH_TIMEOUT, headers=_HEADERS, follow_redirects=True)
        self._last_good: Dict[str, Any] | None = None
        # Official-results client for the settle sweep (council reads
        # pipeline.kalshi via getattr — without it no call ever grades).
        from backend.data.kalshi import KalshiClient
        self.kalshi = KalshiClient()

    async def _get(self, url: str, params: Optional[dict] = None) -> Any:
        r = await self._client.get(url, params=params)
        r.raise_for_status()
        return r.json()

    async def _one(self, label: str, url: str, params: Optional[dict] = None) -> Any:
        try:
            return await self._get(url, params)
        except httpx.HTTPStatusError as e:
            code = int(getattr(e.response, "status_code", 0) or 0)
            if code == 451:
                _note_451(url)
            if code in (401, 403, 404, 418, 451):
                logger.debug(f"{label}: HTTP {code}")
            else:
                logger.warning(f"{label}: HTTP {code}")
            return None
        except Exception as e:
            logger.warning(f"{label}: {type(e).__name__}: {e}")
            return None

    def _merge_last_good(self, snap: Dict[str, Any]) -> Dict[str, Any]:
        prev = self._last_good
        if not prev:
            return snap
        filled = False
        for k in (
            "current_price", "spot", "funding_rate", "open_interest",
            "liq_long_usd", "liq_short_usd", "up_pct", "mins_left",
        ):
            if snap.get(k) is None and prev.get(k) is not None:
                snap[k] = prev[k]
                filled = True
        if not snap.get("candles") and prev.get("candles"):
            snap["candles"] = prev["candles"]
            filled = True
        if not (snap.get("kalshi_market") or {}).get("ticker") and prev.get("kalshi_market"):
            snap["kalshi_market"] = prev["kalshi_market"]
            snap["market_ticker"] = snap.get("market_ticker") or prev.get("market_ticker")
            filled = True
        if filled:
            snap["last_good"] = True
            snap["from_shared_cache"] = True
        return snap

    async def fetch(self) -> Dict[str, Any]:
        now = time.time()
        t0 = now
        symbol = self.symbol
        okx_inst = _okx_inst(self.asset)
        cb_pair = _cb_pair(self.asset)
        jobs: list = []
        keys: list = []

        def add(label: str, url: str, params: Optional[dict] = None) -> None:
            if geo_blocked(url):
                return
            jobs.append(self._one(label, url, params))
            keys.append(label)

        add("vision", f"{BINANCE}/api/v3/ticker/price", {"symbol": symbol})
        add("us", f"{BINANCE_US}/api/v3/ticker/price", {"symbol": symbol})
        add("com", f"{BINANCE_COM}/api/v3/ticker/price", {"symbol": symbol})
        add("coinbase", f"{COINBASE}/v2/prices/{cb_pair}/spot")
        add("klines", f"{BINANCE}/api/v3/klines", {"symbol": symbol, "interval": "1m", "limit": 60})
        add("klines_us", f"{BINANCE_US}/api/v3/klines", {"symbol": symbol, "interval": "1m", "limit": 60})
        add("kalshi", f"{KALSHI}/markets", {"status": "open", "series_ticker": self.series_ticker, "limit": 1})
        add("fund", f"{FAPI}/fapi/v1/premiumIndex", {"symbol": symbol})
        add("oi", f"{FAPI}/fapi/v1/openInterest", {"symbol": symbol})
        add("fund_hist", f"{FAPI}/fapi/v1/fundingRate", {"symbol": symbol, "limit": 20})
        add("ls", f"{FAPI}/futures/data/globalLongShortAccountRatio", {"symbol": symbol, "period": "5m", "limit": 2})
        add("okx_fund", f"{OKX}/api/v5/public/funding-rate", {"instId": okx_inst})
        add("okx_oi", f"{OKX}/api/v5/public/open-interest", {"instId": okx_inst})
        add("okx_hist", f"{OKX}/api/v5/public/funding-rate-history", {"instId": okx_inst, "limit": 20})
        raw = await asyncio.gather(*jobs) if jobs else []
        got = dict(zip(keys, raw))
        ticker = got.get("vision")
        ticker_us = got.get("us")
        ticker_com = got.get("com")
        cb_spot = got.get("coinbase")
        raw_klines = got.get("klines")
        raw_klines_us = got.get("klines_us")
        book = got.get("kalshi")
        prem = got.get("fund")
        oi_raw = got.get("oi")
        fund_hist = got.get("fund_hist")
        ls_raw = got.get("ls")
        okx_fund = got.get("okx_fund")
        okx_oi = got.get("okx_oi")
        okx_hist = got.get("okx_hist")

        price, spot_source = pick_spot(ticker, ticker_us, cb_spot, ticker_com)
        candles = []
        kline_src = raw_klines if isinstance(raw_klines, list) and raw_klines else raw_klines_us
        if isinstance(kline_src, list):
            try:
                candles = [_candle(c) for c in kline_src]
            except Exception as e:
                logger.warning(f"binance klines parse: {e}")
        if price is None and candles:
            price = _f(candles[-1].get("c"))
            spot_source = spot_source or "binance_vision"

        km: Dict[str, Any] = {}
        up_pct = None
        mins_left = None
        yes_bid = yes_ask = no_bid = no_ask = None
        if isinstance(book, dict):
            markets = book.get("markets") or []
            m = markets[0] if markets else {}
            if isinstance(m, dict) and m:
                yes_ask = _f(m.get("yes_ask"))
                yes_bid = _f(m.get("yes_bid"))
                no_ask = _f(m.get("no_ask"))
                no_bid = _f(m.get("no_bid"))
                close = m.get("close_time") or m.get("expected_expiration_time")
                yes = yes_ask if yes_ask is not None else yes_bid
                if yes is not None:
                    up_pct = yes
                    if up_pct <= 1.0:
                        up_pct = up_pct * 100.0
                if close:
                    try:
                        from datetime import datetime, timezone
                        ct = datetime.fromisoformat(str(close).replace("Z", "+00:00"))
                        mins_left = max(0.0, (ct.timestamp() - now) / 60.0)
                    except Exception:
                        mins_left = None
                km = {
                    "ticker": m.get("ticker") or self.series_ticker,
                    "yes_ask": yes_ask,
                    "yes_bid": yes_bid,
                    "no_ask": no_ask,
                    "no_bid": no_bid,
                    "close_time": close,
                    "status": m.get("status"),
                    "floor_strike": m.get("floor_strike") or m.get("strike_price"),
                    "cap_strike": m.get("cap_strike"),
                    "title": m.get("title"),
                }

        funding_rate = None
        derivs_source = None
        if isinstance(prem, dict):
            funding_rate = _f(prem.get("lastFundingRate"))
            if funding_rate is not None:
                derivs_source = "binance_perp"
        if funding_rate is None:
            funding_rate = _f(_okx_row(okx_fund).get("fundingRate"))
            if funding_rate is not None:
                derivs_source = "okx_perp"
        open_interest = None
        if isinstance(oi_raw, dict):
            open_interest = _f(oi_raw.get("openInterest"))
            if open_interest is not None:
                derivs_source = derivs_source or "binance_perp"
        if open_interest is None:
            row = _okx_row(okx_oi)
            open_interest = _f(row.get("oiCcy") or row.get("oi"))
            if open_interest is not None:
                derivs_source = derivs_source or "okx_perp"

        funding_history = []
        if isinstance(fund_hist, list):
            for row in fund_hist:
                if not isinstance(row, dict):
                    continue
                ts = _f(row.get("fundingTime"))
                rate = _f(row.get("fundingRate"))
                if ts is not None and rate is not None:
                    funding_history.append((ts / 1000.0 if ts > 1e12 else ts, rate))
        if not funding_history:
            for row in _okx_rows(okx_hist):
                if not isinstance(row, dict):
                    continue
                ts = _f(row.get("fundingTime"))
                rate = _f(row.get("fundingRate") or row.get("realizedRate"))
                if ts is not None and rate is not None:
                    funding_history.append((ts / 1000.0 if ts > 1e12 else ts, rate))

        liq_long = liq_short = None
        # Public long/short ratio is a crowding proxy, not a true liq print.
        # CASCADE already falls back to OI+volume; we only stamp USD when we
        # have a real CoinGlass key.
        if isinstance(ls_raw, list) and ls_raw:
            last = ls_raw[-1] if isinstance(ls_raw[-1], dict) else {}
            long_acct = _f(last.get("longAccount"))
            short_acct = _f(last.get("shortAccount"))
            # Keep as features, not fake USD liquidations.
            ls_long, ls_short = long_acct, short_acct
        else:
            ls_long = ls_short = None

        cg_snap: Dict[str, Any] = {}
        cg_ok = False
        cg_reason = None
        try:
            from backend.data.coinglass import CoinGlassClient, empty_derivatives
            key = (os.environ.get("COINGLASS_API_KEY") or "").strip()
            if key:
                client = CoinGlassClient(symbol=self.symbol, api_key=key)
                cg_snap = await client.get_historical_derivatives()
                feeds = (cg_snap or {}).get("funding") or (cg_snap or {}).get("oi") or (cg_snap or {}).get("liq")
                cg_ok = bool(feeds)
                if not cg_ok:
                    cg_reason = (cg_snap or {}).get("skip_reason") or "CoinGlass empty"
                if funding_rate is None:
                    funding_rate = _f((cg_snap or {}).get("funding"))
                if open_interest is None:
                    open_interest = _f((cg_snap or {}).get("oi"))
                liq_long = _f((cg_snap or {}).get("liq_long_usd"))
                liq_short = _f((cg_snap or {}).get("liq_short_usd"))
            else:
                cg_snap = empty_derivatives("1h")
                cg_reason = "no_key"
        except Exception as e:
            cg_reason = f"{type(e).__name__}"
            logger.warning(f"coinglass: {e}")

        derivs_ok = funding_rate is not None or open_interest is not None
        if not cg_ok:
            if derivs_ok:
                cg_reason = f"{cg_reason or 'CoinGlass down'} · {derivs_source} fallback"
            else:
                cg_reason = cg_reason or "no usable funding/OI/liq"
            if derivs_ok:
                cg_snap = {
                    **(cg_snap or {}),
                    "tf": "1h",
                    "funding": funding_rate,
                    "oi": open_interest,
                    "liq": {"long": liq_long, "short": liq_short} if (liq_long or liq_short) else None,
                    "source": derivs_source or "binance_perp",
                    "skip_reason": cg_reason,
                    "fetched_at": now,
                }

        fetch_ms = int((time.time() - t0) * 1000)
        snap: Dict[str, Any] = {
            "asset": self.asset,
            "current_price": price,
            "spot": price,
            "up_pct": up_pct,
            "mins_left": mins_left,
            "market_ticker": km.get("ticker") or self.series_ticker,
            "kalshi_market": km,
            "kalshi_yes_bid": yes_bid,
            "kalshi_yes_ask": yes_ask,
            "kalshi_no_bid": no_bid,
            "kalshi_no_ask": no_ask,
            "kalshi_floor_strike": km.get("floor_strike"),
            "kalshi_cap_strike": km.get("cap_strike"),
            "kalshi_title": km.get("title"),
            "kalshi_fetched_at": now if km.get("ticker") else None,
            "funding_rate": funding_rate,
            "open_interest": open_interest,
            "oi": open_interest,
            "funding_history": funding_history,
            "liq_long_usd": liq_long,
            "liq_short_usd": liq_short,
            "ls_long_acct": ls_long,
            "ls_short_acct": ls_short,
            "coinglass": cg_snap,
            "health": {
                "kalshi": bool(km.get("ticker")),
                "binance": spot_source in ("binance_vision", "binance_us", "binance") and price is not None,
                "coinbase": spot_source == "coinbase",
                "coinglass": bool(cg_ok),
                "coinglass_reason": cg_reason,
                "derivs_ok": bool(derivs_ok),
                "derivs_source": "coinglass" if cg_ok else (derivs_source if derivs_ok else None),
                "spot_source": spot_source if price is not None else None,
                "last_fetch_ms": fetch_ms,
            },
            "candles": candles,
            "book": km,
            "fetched_at": now,
            "fetch_ms": fetch_ms,
        }
        snap = self._merge_last_good(snap)
        # Recompute derivs after last-good fill so seats do not go dark on a flap.
        if snap.get("funding_rate") is not None or snap.get("open_interest") is not None:
            snap.setdefault("health", {})
            snap["health"]["derivs_ok"] = True
            if not snap["health"].get("derivs_source"):
                snap["health"]["derivs_source"] = "last_good"
        if snap.get("current_price") is not None:
            self._last_good = dict(snap)
        return snap

    async def close(self) -> None:
        try:
            await self.kalshi.close()
        except Exception:
            pass
        try:
            await self._client.aclose()
        except Exception:
            return
