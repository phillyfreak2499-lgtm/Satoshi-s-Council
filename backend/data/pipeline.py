"""
Unified data pipeline with graceful fallbacks. Owned conceptually by Guardian.
Binance + Kalshi fetched in parallel for lowest end-to-end latency.
"""
from __future__ import annotations
import asyncio
import time
from typing import Any, Dict
from loguru import logger
from backend.data.binance import BinanceClient
from backend.data.kalshi import KalshiClient
from backend.data.coinbase import CoinbaseClient
from backend.services.runtime_settings import runtime_settings


class DataPipeline:
    def __init__(self):
        self.binance = BinanceClient()
        self.kalshi = KalshiClient()
        self.coinbase = CoinbaseClient()
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

        # Parallel primary sources — Binance + Kalshi (+ Coinbase if DUAL_SPOT)
        from backend.config import settings
        tasks = [
            self.binance.get_snapshot(),
            self.kalshi.get_current_market_state(cycle=self._cycle),
        ]
        dual = bool(runtime_settings.get("dual_spot", True))
        if dual:
            tasks.append(self.coinbase.get_spot())
        results = await asyncio.gather(*tasks, return_exceptions=True)
        binance_data, kalshi_data = results[0], results[1]
        coinbase_data = results[2] if dual else {"source": "coinbase", "healthy": False, "price": None}

        if isinstance(binance_data, Exception):
            logger.error(f"Binance gather error: {binance_data}")
            binance_data = {"source": "binance", "healthy": False, "error": str(binance_data)}
        if isinstance(kalshi_data, Exception):
            logger.error(f"Kalshi gather error: {kalshi_data}")
            kalshi_data = {"source": "kalshi", "healthy": False, "error": str(kalshi_data)}
        if isinstance(coinbase_data, Exception):
            coinbase_data = {"source": "coinbase", "healthy": False, "error": str(coinbase_data)}

        self.health["binance"] = bool(binance_data.get("healthy", False))
        self.health["kalshi"] = bool(kalshi_data.get("healthy", False))
        self.health["coinbase"] = bool(coinbase_data.get("healthy", False))
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        self.health["last_fetch_ms"] = elapsed_ms
        self.health["last_error"] = binance_data.get("error") or kalshi_data.get("error")

        if not self.health["binance"] and not self.health["kalshi"]:
            logger.error("Both primary sources unhealthy – returning last good snapshot")
            stale = {**self.last_good, "stale": True, "health": dict(self.health)}
            return stale

        snapshot = {
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
            "health": dict(self.health),
            "stale": False,
            "fetched_at": time.time(),
            "fetch_ms": elapsed_ms,
        }

        # Dual-spot consensus: average healthy CEX prints when both alive
        try:
            bp = snapshot.get("binance_price")
            cp = snapshot.get("coinbase_price")
            if bp and cp and float(bp) > 0 and float(cp) > 0:
                # If they diverge >0.15%, prefer Binance futures mark for Kalshi-style
                # but still publish mid for VEL/exhaust
                mid = (float(bp) + float(cp)) / 2.0
                divergence_bps = abs(float(bp) - float(cp)) / float(bp) * 10000.0
                snapshot["spot_divergence_bps"] = round(divergence_bps, 2)
                snapshot["spot_mid"] = mid
                if divergence_bps < 25:
                    snapshot["current_price"] = mid
                else:
                    snapshot["current_price"] = float(bp)  # stick to primary on dislocation
            elif cp and float(cp) > 0 and not bp:
                snapshot["current_price"] = float(cp)
        except Exception:
            pass

        if self.health["binance"] or self.health["kalshi"]:
            self.last_good = snapshot

        return snapshot
