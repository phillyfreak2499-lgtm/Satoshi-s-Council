"""
Unified data pipeline with graceful fallbacks.
Parameterized per asset (BTC / ETH) for dual-table mode.
"""
from __future__ import annotations
import asyncio
import time
from typing import Any, Dict, Optional
from loguru import logger
from backend.data.binance import BinanceClient
from backend.data.kalshi import KalshiClient
from backend.data.coinbase import CoinbaseClient
from backend.services.runtime_settings import runtime_settings
from backend.config import settings


# Shared across BTC+ETH pipelines in-process
_SPOT_CACHE: dict = {"btc": None, "eth": None, "ts": 0.0}
_SPOT_TTL = 2.5  # seconds

class DataPipeline:

    def __init__(
        self,
        symbol: Optional[str] = None,
        series_ticker: Optional[str] = None,
        coinbase_product: Optional[str] = None,
        asset: str = "btc",
    ):
        self.asset = (asset or "btc").lower()
        self.symbol = symbol or (
            getattr(settings, "SYMBOL_ETH", "ETHUSDT")
            if self.asset == "eth"
            else getattr(settings, "SYMBOL_BTC", "BTCUSDT")
        )
        self.series_ticker = series_ticker or (
            getattr(settings, "SERIES_ETH", "KXETHD")
            if self.asset == "eth"
            else getattr(settings, "SERIES_BTC", "KXBTCD")
        )
        if coinbase_product is None:
            coinbase_product = "ETH-USD" if self.asset == "eth" else "BTC-USD"
        self.binance = BinanceClient(symbol=self.symbol)
        self.kalshi = KalshiClient(series_ticker=self.series_ticker)
        self.coinbase = CoinbaseClient(product_id=coinbase_product)
        self.last_good: Dict[str, Any] = {}
        self.health = {
            "binance": True,
            "kalshi": True,
            "last_error": None,
            "last_fetch_ms": None,
        }
        self._cycle = 0

    async def close(self):
        await self.binance.close()
        await self.kalshi.close()
        await self.coinbase.close()

    async def fetch(self) -> Dict[str, Any]:
        t0 = time.perf_counter()
        self._cycle += 1

        tasks = [
            self.binance.get_snapshot(),
            self.kalshi.get_current_market_state(cycle=self._cycle),
        ]
        dual = bool(runtime_settings.get("dual_spot", True))
        if dual:
            tasks.append(self.coinbase.get_spot())
        results = await asyncio.gather(*tasks, return_exceptions=True)
        binance_data, kalshi_data = results[0], results[1]
        # Shared spot cache (both tables)
        import time as _t
        global _SPOT_CACHE
        try:
            if not isinstance(binance_data, Exception) and binance_data and binance_data.get("healthy"):
                _SPOT_CACHE[self.asset] = binance_data
                _SPOT_CACHE["ts"] = _t.time()
            elif isinstance(binance_data, Exception) or not (binance_data or {}).get("healthy"):
                cached = _SPOT_CACHE.get(self.asset)
                if cached and (_t.time() - float(_SPOT_CACHE.get("ts") or 0)) < _SPOT_TTL:
                    binance_data = cached
                    binance_data = dict(binance_data)
                    binance_data["from_shared_cache"] = True
        except Exception:
            pass

        coinbase_data = results[2] if dual else {"source": "coinbase", "healthy": False, "price": None}

        if isinstance(binance_data, Exception):
            logger.error(f"Binance gather error ({self.asset}): {binance_data}")
            binance_data = {"source": "binance", "healthy": False, "error": str(binance_data)}
        if isinstance(kalshi_data, Exception):
            logger.error(f"Kalshi gather error ({self.asset}): {kalshi_data}")
            kalshi_data = {"source": "kalshi", "healthy": False, "error": str(kalshi_data)}
        if isinstance(coinbase_data, Exception):
            coinbase_data = {"source": "coinbase", "healthy": False, "error": str(coinbase_data)}

        # Re-pick ATM strike with live spot
        spot = None
        try:
            spot = binance_data.get("current_price") or binance_data.get("mark_price")
            if spot:
                spot = float(spot)
        except Exception:
            spot = None
        if spot and kalshi_data.get("healthy"):
            try:
                kalshi_data = await self.kalshi.get_current_market_state(
                    cycle=self._cycle, spot_price=spot
                )
            except Exception as e:
                logger.debug(f"Kalshi ATM re-pick skipped: {e}")

        self.health["binance"] = bool(binance_data.get("healthy", False))
        self.health["kalshi"] = bool(kalshi_data.get("healthy", False))
        self.health["coinbase"] = bool(coinbase_data.get("healthy", False))
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        self.health["last_fetch_ms"] = elapsed_ms
        self.health["last_error"] = binance_data.get("error") or kalshi_data.get("error")

        if not self.health["binance"] and not self.health["kalshi"]:
            logger.error(f"Both primary sources unhealthy ({self.asset}) – last good")
            stale = {**self.last_good, "stale": True, "health": dict(self.health), "asset": self.asset}
            return stale

        snapshot = {
            "asset": self.asset,
            "symbol": self.symbol,
            "series_ticker": self.series_ticker,
            "binance": binance_data,
            "kalshi": kalshi_data,
            "candles": binance_data.get("candles", []),
            "current_price": binance_data.get("current_price") or binance_data.get("mark_price"),
            "binance_price": binance_data.get("current_price") or binance_data.get("mark_price"),
            "coinbase_price": coinbase_data.get("price") if isinstance(coinbase_data, dict) else None,
            "coinbase": coinbase_data if isinstance(coinbase_data, dict) else {},
            "funding_rate": binance_data.get("funding_rate"),
            "open_interest": binance_data.get("open_interest"),
            "kalshi_market": kalshi_data.get("primary_market"),
            "kalshi_orderbook": kalshi_data.get("orderbook"),
            "kalshi_yes_bid": kalshi_data.get("yes_bid"),
            "kalshi_yes_ask": kalshi_data.get("yes_ask"),
            "kalshi_volume": kalshi_data.get("volume"),
            "kalshi_floor_strike": kalshi_data.get("floor_strike"),
            "kalshi_cap_strike": kalshi_data.get("cap_strike"),
            "kalshi_title": kalshi_data.get("title"),
            "kalshi_ticker": kalshi_data.get("ticker"),
            "health": dict(self.health),
            "stale": False,
            "fetched_at": time.time(),
            "fetch_ms": elapsed_ms,
        }

        try:
            bp = snapshot.get("binance_price")
            cp = snapshot.get("coinbase_price")
            if bp and cp and float(bp) > 0 and float(cp) > 0:
                mid = (float(bp) + float(cp)) / 2.0
                divergence_bps = abs(float(bp) - float(cp)) / float(bp) * 10000.0
                snapshot["spot_divergence_bps"] = round(divergence_bps, 2)
                snapshot["spot_mid"] = mid
                snapshot["current_price"] = mid if divergence_bps < 25 else float(bp)
            elif cp and float(cp) > 0 and not bp:
                snapshot["current_price"] = float(cp)
        except Exception:
            pass

        if self.health["binance"] or self.health["kalshi"]:
            self.last_good = snapshot
        return snapshot
