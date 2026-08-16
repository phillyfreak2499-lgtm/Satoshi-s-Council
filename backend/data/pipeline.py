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
from backend.data.coinglass import CoinGlassClient, apply_coinglass_health, chair_window_ok
from backend.data.cfbenchmarks import (
    RtiWindow,
    last15_spot,
    parse_cfb_values,
    pick_research_spot,
    rti_id_for_asset,
)
from backend.data.spot_health import coalesce_spot_price, research_spot_ok, spot_feed_ok
from backend.config import settings


# Shared across BTC+ETH pipelines in-process
_SPOT_CACHE: dict = {"btc": None, "eth": None, "ts": 0.0}
_SPOT_TTL = 2.5  # seconds


def _window_minutes_for_snapshot(asset: str, ticker: Any, series: Any) -> float:
    try:
        from backend.learning.btc15m import window_minutes_for
        return float(window_minutes_for(asset=asset, ticker=ticker, series=series))
    except Exception:
        return 15.0 if str(asset or "").lower() in ("btc", "bitcoin") else 60.0


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
            else getattr(settings, "SERIES_BTC", "KXBTC15M")
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
            "cfb": False,
            "spot_source": None,
            "research_spot_source": None,
            "last_error": None,
            "last_fetch_ms": None,
        }
        self._cycle = 0
        self._rti = RtiWindow()

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

        cfb_id = rti_id_for_asset(self.asset)
        tasks = [
            self.binance.get_snapshot(),
            self.kalshi.get_current_market_state(cycle=self._cycle),
            self.coinbase.get_spot(),
            self.kalshi.get_cfbenchmarks_values(cfb_id),
        ]
        try:
            from backend.learning.btc15m import coinglass_allowed_on_book
            _cg_ok = coinglass_allowed_on_book(series=self.series_ticker, asset=self.asset)
        except Exception:
            _cg_ok = self.asset != "btc"
        if self.coinglass.configured() and _cg_ok:
            tasks.append(self.coinglass.get_derivatives())
        results = await asyncio.gather(*tasks, return_exceptions=True)
        binance_data, kalshi_data = results[0], results[1]
        coinbase_data = results[2]
        cfb_raw = results[3]
        cg_data: Dict[str, Any] = {"source": "coinglass", "healthy": False}
        if len(results) > 4:
            if isinstance(results[4], Exception):
                cg_data = {
                    "source": "coinglass",
                    "healthy": False,
                    "reason": type(results[4]).__name__,
                }
            else:
                cg_data = results[4]
        elif not self.coinglass.configured():
            cg_data = {"source": "coinglass", "healthy": False, "reason": "key missing"}

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
        if isinstance(cfb_raw, Exception):
            cfb_raw = {}
        if not isinstance(cg_data, dict):
            cg_data = {"source": "coinglass", "healthy": False, "reason": "bad payload"}

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

        cfb_snap = parse_cfb_values(cfb_raw if isinstance(cfb_raw, dict) else {}, asset=self.asset)
        now_ts = time.time()
        if cfb_snap.get("prints"):
            for ts, px in cfb_snap["prints"]:
                self._rti.add(ts, px, "cfb")
        elif cfb_snap.get("rti"):
            self._rti.add(now_ts, cfb_snap["rti"], "cfb")
        elif bn_price and (spot_source == "vision" or not spot_source):
            self._rti.add(now_ts, bn_price, "vision")
            if not spot_source:
                spot_source = "vision"
        elif cb_ok and cb_price:
            self._rti.add(now_ts, cb_price, "coinbase")

        cfb_win = self._rti.stats(("cfb",), now=now_ts)
        vis_win = self._rti.stats(("vision",), now=now_ts)
        cb_win = self._rti.stats(("coinbase",), now=now_ts)
        research = pick_research_spot(
            cfb_avg_60s=cfb_snap.get("avg_60s"),
            cfb_rti=cfb_snap.get("rti"),
            cfb_window=cfb_win,
            vision=bn_price if (spot_source == "vision" or not spot_source) else None,
            vision_window=vis_win,
            coinbase=cb_price,
            coinbase_window=cb_win,
            binance_us=None,
            last_tick=bn_price or cb_price,
        )
        research_px = last15_spot(research)
        display_px = research_px or research.get("display_spot") or bn_price or cb_price
        if research.get("source") and research_spot_ok(research.get("source")):
            spot_source = research["source"]

        # Spot is OK when CFB / vision / Coinbase candles+price are live.
        # api.binance.us is a separate book — not this research print.
        cfb_ok = bool(cfb_snap.get("healthy"))
        spot_ok = bool(binance_data.get("healthy")) or bn_candles_ok or cb_ok or cfb_ok

        # Re-pick the hour's playable ladder rung with the research print
        spot = research_px or display_px or bn_price or cb_price
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
        # CoinGlass health is CoinGlass-only. Binance funding/OI last-print
        # may still fill CARRY below and must not flip this flag.
        apply_coinglass_health(self.health, cg_data)
        self.health["cfb"] = bool(cfb_ok)
        self.health["spot_source"] = spot_source or ("cfb" if cfb_ok else ("coinbase" if cb_ok else None))
        self.health["research_spot_source"] = research.get("source")
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        self.health["last_fetch_ms"] = elapsed_ms
        self.health["last_error"] = binance_data.get("error") or kalshi_data.get("error")

        if not self.health["binance"] and not self.health["kalshi"]:
            logger.error(f"Both primary sources unhealthy ({self.asset}) – last good")
            stale = {**self.last_good, "stale": True, "health": dict(self.health), "asset": self.asset}
            return stale

        try:
            from backend.learning.btc15m import coinglass_allowed_on_book
            chair_ok = chair_window_ok(cg_data) and coinglass_allowed_on_book(
                series=self.series_ticker, asset=self.asset,
            )
        except Exception:
            chair_ok = chair_window_ok(cg_data)
        cg_fund = cg_data.get("funding_rate") if chair_ok else None
        bn_fund = binance_data.get("funding_rate")
        if bn_fund is None:
            bn_fund = binance_data.get("funding")
        funding_rate = cg_fund if cg_fund is not None else bn_fund

        cg_oi = cg_data.get("open_interest") if chair_ok else None
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
            "cfb": cfb_snap,
            "cfb_rti": cfb_snap.get("rti"),
            "cfb_avg_60s": cfb_snap.get("avg_60s") or research_px,
            "research_spot": research_px,
            "research_spot_source": research.get("source"),
            "research_spot_kind": research.get("kind"),
            "spot_source": self.health["spot_source"],
            "funding_rate": funding_rate,
            "open_interest": open_interest,
            "liq_long_usd": cg_data.get("liq_long_usd") if chair_ok else None,
            "liq_short_usd": cg_data.get("liq_short_usd") if chair_ok else None,
            "liq_net_usd": cg_data.get("liq_net_usd") if chair_ok else None,
            "oi_delta_1h": cg_data.get("oi_delta_1h") if chair_ok else None,
            "cg_interval": cg_data.get("interval"),
            "cg_daily_heatmap": False,
            "funding_history": list(cg_data.get("funding_history") or []) if chair_ok else [],
            "oi_history": list(cg_data.get("oi_history") or []) if chair_ok else [],
            "liq_history": list(cg_data.get("liq_history") or []) if chair_ok else [],
            "kalshi_market": kalshi_data.get("primary_market"),
            "kalshi_orderbook": kalshi_data.get("orderbook"),
            "kalshi_yes_bid": kalshi_data.get("yes_bid"),
            "kalshi_yes_ask": kalshi_data.get("yes_ask"),
            "kalshi_no_bid": kalshi_data.get("no_bid"),
            "kalshi_no_ask": kalshi_data.get("no_ask"),
            "kalshi_volume": kalshi_data.get("volume"),
            "kalshi_floor_strike": kalshi_data.get("floor_strike"),
            "kalshi_cap_strike": kalshi_data.get("cap_strike"),
            "kalshi_title": kalshi_data.get("title"),
            "kalshi_ticker": kalshi_data.get("ticker"),
            "window_minutes": _window_minutes_for_snapshot(self.asset, kalshi_data.get("ticker"), self.series_ticker),
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
            # last-15 / P(finish) use the 60s CFB (or ranked 60s) average, not a
            # Coinbase/Binance mid or a last-tick wick.
            if research_px:
                snapshot["current_price"] = float(research_px)
            elif display_px:
                snapshot["current_price"] = float(display_px)
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
        # Re-pin after Binance fill so CARRY last-print cannot flip Glass.
        apply_coinglass_health(self.health, cg_data)
        snapshot["health"]["coinglass"] = self.health.get("coinglass")
        snapshot["health"]["coinglass_reason"] = self.health.get("coinglass_reason")

        if self.health["binance"] or self.health["kalshi"]:
            self.last_good = snapshot
        return snapshot
