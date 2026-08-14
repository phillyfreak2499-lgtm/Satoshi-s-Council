"""
Unified data pipeline with graceful fallbacks.
Parameterized per asset (BTC / ETH) for dual-table mode.
"""
from __future__ import annotations
import asyncio
import time
from typing import Any, Dict, Optional
from loguru import logger
from backend.data.binance import BinanceClient, coinbase_product_for_symbol
from backend.data.kalshi import KalshiClient
from backend.data.coinbase import CoinbaseClient
from backend.data.coinglass import CoinGlassClient
from backend.data.spot_health import coalesce_spot_price, spot_feed_ok
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
            coinbase_product = coinbase_product_for_symbol(self.symbol)
        self.binance = BinanceClient(symbol=self.symbol)
        self.kalshi = KalshiClient(series_ticker=self.series_ticker)
        self.coinbase = CoinbaseClient(product_id=coinbase_product)
        self.coinglass = CoinGlassClient(symbol=self.symbol)
        self.last_good: Dict[str, Any] = {}
        self.health = {
            "binance": True,
            "kalshi": True,
            "coinbase": False,
            "coinglass": False,
            "spot_source": None,
            "last_error": None,
            "last_fetch_ms": None,
        }
        self._cycle = 0

    async def close(self):
        await self.binance.close()
        await self.kalshi.close()
        await self.coinbase.close()
        try:
            await self.coinglass.close()
        except Exception:
            pass

    async def fetch(self) -> Dict[str, Any]:
        t0 = time.perf_counter()
        self._cycle += 1

        tasks = [
            self.binance.get_snapshot(),
            self.kalshi.get_current_market_state(cycle=self._cycle),
            self.coinbase.get_spot(),
        ]
        if self.coinglass.configured():
            tasks.append(self.coinglass.get_derivatives())
        results = await asyncio.gather(*tasks, return_exceptions=True)
        binance_data, kalshi_data = results[0], results[1]
        coinbase_data = results[2]
        cg_data: Dict[str, Any] = {"source": "coinglass", "healthy": False}
        if len(results) > 3:
            cg_data = results[3] if not isinstance(results[3], Exception) else cg_data

        # Shared spot cache (both tables)
        import time as _t
        global _SPOT_CACHE
        try:
            if not isinstance(binance_data, Exception) and binance_data and (
                binance_data.get("healthy") or (binance_data.get("candles") and binance_data.get("price"))
            ):
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

        if isinstance(binance_data, Exception):
            logger.error(f"Binance gather error ({self.asset}): {type(binance_data).__name__}")
            binance_data = {"source": "binance", "healthy": False, "error": type(binance_data).__name__}
        if isinstance(kalshi_data, Exception):
            err_name = type(kalshi_data).__name__
            logger.debug(f"Kalshi gather flap ({self.asset}): {err_name}")
            last_k = (self.last_good or {}).get("kalshi") if isinstance(self.last_good, dict) else None
            if isinstance(last_k, dict) and last_k:
                kalshi_data = dict(last_k)
                kalshi_data["stale"] = True
                kalshi_data["healthy"] = True
                kalshi_data["error"] = err_name
            else:
                kalshi_data = {
                    "source": "kalshi",
                    "healthy": False,
                    "stale": True,
                    "error": err_name,
                }
        if isinstance(coinbase_data, Exception):
            coinbase_data = {"source": "coinbase", "healthy": False, "error": str(coinbase_data)}
        if not isinstance(cg_data, dict):
            cg_data = {"source": "coinglass", "healthy": False}

        if not isinstance(binance_data, dict):
            binance_data = {"source": "binance", "healthy": False}

        bn_price = coalesce_spot_price(
            binance_data.get("current_price"),
            binance_data.get("price"),
            binance_data.get("mark_price"),
        )
        cb_price = coalesce_spot_price(
            coinbase_data.get("price") if isinstance(coinbase_data, dict) else None
        )
        candles = binance_data.get("candles") or []
        spot_source = binance_data.get("spot_source")
        cb_ok = bool(isinstance(coinbase_data, dict) and coinbase_data.get("healthy") and cb_price)
        bn_candles_ok = bool(candles) and bn_price is not None
        if not bn_price and cb_ok:
            bn_price = cb_price
            if not spot_source:
                spot_source = "coinbase"
            binance_data = dict(binance_data)
            binance_data["current_price"] = bn_price
            binance_data["price"] = bn_price
            binance_data["healthy"] = True
            binance_data["spot_source"] = spot_source
        elif bn_candles_ok:
            binance_data = dict(binance_data)
            binance_data["healthy"] = True
            binance_data["current_price"] = bn_price
            if spot_source:
                binance_data["spot_source"] = spot_source

        # Spot is OK when vision/us/coinbase candles+price (or Coinbase ticker) are live
        spot_ok = bool(binance_data.get("healthy")) or bn_candles_ok or cb_ok

        # Re-pick ATM strike with live spot
        spot = bn_price or cb_price
        if spot and kalshi_data.get("healthy"):
            try:
                kalshi_data = await self.kalshi.get_current_market_state(
                    cycle=self._cycle, spot_price=spot
                )
            except Exception as e:
                logger.debug(f"Kalshi ATM re-pick skipped: {e}")

        self.health["binance"] = bool(spot_ok)
        self.health["kalshi"] = bool(kalshi_data.get("healthy", False))
        self.health["coinbase"] = bool(cb_ok)
        self.health["coinglass"] = bool(cg_data.get("healthy", False))
        self.health["spot_source"] = spot_source or ("coinbase" if cb_ok else None)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        self.health["last_fetch_ms"] = elapsed_ms
        self.health["last_error"] = binance_data.get("error") or kalshi_data.get("error")

        if not self.health["binance"] and not self.health["kalshi"]:
            logger.error(f"Both primary sources unhealthy ({self.asset}) – last good")
            stale = {**self.last_good, "stale": True, "health": dict(self.health), "asset": self.asset}
            return stale

        cg_fund = cg_data.get("funding_rate")
        bn_fund = binance_data.get("funding_rate")
        if bn_fund is None:
            bn_fund = binance_data.get("funding")
        funding_rate = cg_fund if cg_fund is not None else bn_fund

        cg_oi = cg_data.get("open_interest")
        bn_oi = binance_data.get("open_interest")
        open_interest = cg_oi if cg_oi is not None else bn_oi

        snapshot = {
            "asset": self.asset,
            "symbol": self.symbol,
            "series_ticker": self.series_ticker,
            "binance": binance_data,
            "kalshi": kalshi_data,
            "candles": binance_data.get("candles", []),
            "current_price": bn_price or binance_data.get("current_price") or binance_data.get("mark_price"),
            "binance_price": bn_price or binance_data.get("current_price") or binance_data.get("mark_price"),
            "coinbase_price": cb_price,
            "coinbase": coinbase_data if isinstance(coinbase_data, dict) else {},
            "coinglass": cg_data,
            "spot_source": self.health["spot_source"],
            "funding_rate": funding_rate,
            "open_interest": open_interest,
            "liq_long_usd": cg_data.get("liq_long_usd"),
            "liq_short_usd": cg_data.get("liq_short_usd"),
            "liq_net_usd": cg_data.get("liq_net_usd"),
            "funding_history": cg_data.get("funding_history") or [],
            "oi_history": cg_data.get("oi_history") or [],
            "liq_history": cg_data.get("liq_history") or [],
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
                dual = bool(runtime_settings.get("dual_spot", True))
                snapshot["current_price"] = mid if (dual and divergence_bps < 25) else float(bp)
            elif cp and float(cp) > 0 and not bp:
                snapshot["current_price"] = float(cp)
        except Exception:
            pass

        if not snapshot.get("spot_source"):
            snapshot["spot_source"] = self.health.get("spot_source")
        snapshot["health"] = dict(self.health)
        # Keep Warden BN aligned with live Coinbase/vision even if fapi is 451
        if spot_feed_ok(self.health, snapshot):
            self.health["binance"] = True
            snapshot["health"]["binance"] = True

        if self.health["binance"] or self.health["kalshi"]:
            self.last_good = snapshot
        return snapshot
