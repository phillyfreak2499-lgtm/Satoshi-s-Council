"""Binance spot + Kalshi public book. Paper research only."""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

import httpx
from loguru import logger

BINANCE = "https://api.binance.com"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"

_SYMBOL = {"btc": "BTCUSDT", "eth": "ETHUSDT"}
_SERIES = {"btc": "KXBTC15M", "eth": "KXETH"}


class DataPipeline:
    def __init__(self, asset: str = "btc", series_ticker: str | None = None, symbol: str | None = None):
        self.asset = (asset or "btc").lower()
        self.series_ticker = series_ticker or _SERIES.get(self.asset, "KXBTC15M")
        self.symbol = symbol or _SYMBOL.get(self.asset, "BTCUSDT")
        self._client = httpx.AsyncClient(timeout=8.0)

    async def _get(self, url: str, params: Optional[dict] = None) -> Any:
        r = await self._client.get(url, params=params)
        r.raise_for_status()
        return r.json()

    async def fetch(self) -> Dict[str, Any]:
        now = time.time()
        price = None
        candles = []
        try:
            tick = await self._get(f"{BINANCE}/api/v3/ticker/price", {"symbol": self.symbol})
            price = float(tick.get("price") or 0)
        except Exception as e:
            logger.warning(f"binance ticker: {e}")
        try:
            raw = await self._get(
                f"{BINANCE}/api/v3/klines",
                {"symbol": self.symbol, "interval": "1m", "limit": 60},
            )
            candles = [
                {"t": int(c[0]), "o": float(c[1]), "h": float(c[2]), "l": float(c[3]), "c": float(c[4]), "v": float(c[5])}
                for c in (raw or [])
            ]
            if price is None and candles:
                price = candles[-1]["c"]
        except Exception as e:
            logger.warning(f"binance klines: {e}")

        km: Dict[str, Any] = {}
        up_pct = None
        mins_left = None
        try:
            book = await self._get(
                f"{KALSHI}/markets",
                {"status": "open", "series_ticker": self.series_ticker, "limit": 1},
            )
            markets = book.get("markets") or []
            m = markets[0] if markets else {}
            yes = m.get("yes_ask") or m.get("yes_bid")
            no = m.get("no_ask") or m.get("no_bid")
            close = m.get("close_time") or m.get("expected_expiration_time")
            if yes is not None:
                up_pct = float(yes)
            if close:
                try:
                    from datetime import datetime, timezone
                    ct = datetime.fromisoformat(str(close).replace("Z", "+00:00"))
                    mins_left = max(0.0, (ct.timestamp() - now) / 60.0)
                except Exception:
                    mins_left = None
            km = {
                "ticker": m.get("ticker") or self.series_ticker,
                "yes_ask": yes,
                "no_ask": no,
                "close_time": close,
                "status": m.get("status"),
            }
        except Exception as e:
            logger.warning(f"kalshi markets: {e}")

        return {
            "asset": self.asset,
            "current_price": price,
            "spot": price,
            "up_pct": up_pct,
            "mins_left": mins_left,
            "market_ticker": km.get("ticker") or self.series_ticker,
            "kalshi_market": km,
            "health": {
                "kalshi": bool(km.get("ticker")),
                "binance": price is not None,
                "coinglass": False,
                "last_fetch_ms": int(time.time() * 1000),
            },
            "candles": candles,
            "book": km,
        }

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            return
