"""
Binance public data — US-friendly.
Spot klines via data-api (works worldwide). Futures funding/OI soft-fail once
and stay quiet while geo-blocked (no per-cycle DEBUG spam).
"""
from __future__ import annotations
import asyncio
import time
import httpx
from typing import Any, Dict, List
from loguru import logger
from backend.config import settings
from backend.services.runtime_settings import runtime_settings

# After a 451/403, don't retry futures for this many seconds
_FUTURES_COOLDOWN = 3600.0


class BinanceClient:
    def __init__(self):
        self.spot_bases = [
            "https://data-api.binance.vision",
            "https://api.binance.com",
            "https://api.binance.us",
        ]
        self.futures_bases = [
            "https://fapi.binance.com",
        ]
        timeout = httpx.Timeout(getattr(settings, "HTTP_TIMEOUT", 8.0), connect=4.0)
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self._spot_idx = 0
        self._slow_cache: Dict[str, Any] = {}
        self._slow_cache_at: float = 0.0
        # Geo-block latch for futures
        self._futures_blocked_until: float = 0.0
        self._futures_block_logged: bool = False

    async def close(self):
        await self.client.aclose()

    def _futures_allowed(self) -> bool:
        return time.monotonic() >= self._futures_blocked_until

    def _mark_futures_blocked(self, reason: str):
        self._futures_blocked_until = time.monotonic() + _FUTURES_COOLDOWN
        if not self._futures_block_logged:
            logger.info(
                f"Binance futures geo-blocked ({reason}). "
                f"Skipping funding/OI for {_FUTURES_COOLDOWN/60:.0f}m — spot candles still live."
            )
            self._futures_block_logged = True

    async def _get_json(self, url: str, params: dict = None) -> Any:
        r = await self.client.get(url, params=params or {})
        if r.status_code in (451, 403, 418):
            raise PermissionError(f"{r.status_code}")
        if r.status_code == 404:
            raise FileNotFoundError("404")
        r.raise_for_status()
        return r.json()

    async def get_klines(self, limit: int = 120) -> List[Dict[str, Any]]:
        symbol = getattr(settings, "SYMBOL", "BTCUSDT")
        params = {"symbol": symbol, "interval": "1m", "limit": limit}
        last_err = None
        for i in range(len(self.spot_bases)):
            base = self.spot_bases[(self._spot_idx + i) % len(self.spot_bases)]
            url = f"{base}/api/v3/klines"
            try:
                raw = await self._get_json(url, params)
                self._spot_idx = (self._spot_idx + i) % len(self.spot_bases)
                candles = []
                for row in raw:
                    candles.append({
                        "open_time": int(row[0]),
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": float(row[5]),
                        "close_time": int(row[6]),
                        "quote_volume": float(row[7]) if len(row) > 7 else 0.0,
                        "trades": int(row[8]) if len(row) > 8 else 0,
                        "taker_buy_base": float(row[9]) if len(row) > 9 else float(row[5]) * 0.5,
                        "taker_buy_quote": float(row[10]) if len(row) > 10 else 0.0,
                    })
                return candles
            except Exception as e:
                last_err = e
        # Coinbase fallback (US-friendly)
        try:
            url = "https://api.exchange.coinbase.com/products/BTC-USD/candles"
            raw = await self._get_json(url, {"granularity": 60})
            candles = []
            for row in reversed(raw[:limit]):
                t, low, high, o, c, vol = row
                candles.append({
                    "open_time": int(t) * 1000,
                    "open": float(o),
                    "high": float(high),
                    "low": float(low),
                    "close": float(c),
                    "volume": float(vol),
                    "close_time": int(t) * 1000 + 59999,
                    "taker_buy_base": float(vol) * 0.5,
                })
            logger.info("klines via Coinbase fallback")
            return candles
        except Exception as e:
            logger.error(f"klines failed: {last_err}; coinbase: {e}")
            return []

    async def get_premium_index(self) -> Dict[str, Any]:
        if not self._futures_allowed():
            return {}
        symbol = getattr(settings, "SYMBOL", "BTCUSDT")
        for base in self.futures_bases:
            try:
                url = f"{base}/fapi/v1/premiumIndex"
                d = await self._get_json(url, {"symbol": symbol})
                return {
                    "symbol": d.get("symbol"),
                    "mark_price": float(d.get("markPrice", 0) or 0),
                    "index_price": float(d.get("indexPrice", 0) or 0),
                    "last_funding_rate": float(d.get("lastFundingRate", 0) or 0),
                    "next_funding_time": int(d.get("nextFundingTime", 0) or 0),
                    "time": int(d.get("time", 0) or 0),
                }
            except PermissionError as e:
                self._mark_futures_blocked(str(e))
                return {}
            except Exception:
                continue
        return {}

    async def get_open_interest(self) -> Dict[str, Any]:
        if not self._futures_allowed():
            return {}
        symbol = getattr(settings, "SYMBOL", "BTCUSDT")
        for base in self.futures_bases:
            try:
                url = f"{base}/fapi/v1/openInterest"
                d = await self._get_json(url, {"symbol": symbol})
                return {
                    "open_interest": float(d.get("openInterest", 0) or 0),
                    "symbol": d.get("symbol"),
                    "time": int(d.get("time", 0) or 0),
                }
            except PermissionError as e:
                self._mark_futures_blocked(str(e))
                return {}
            except Exception:
                continue
        return {}

    async def get_snapshot(self) -> Dict[str, Any]:
        now = time.monotonic()
        need_slow = (now - self._slow_cache_at) >= float(
            runtime_settings.get("slow_metrics_ttl", getattr(settings, "SLOW_METRICS_TTL", 60))
        )
        try:
            if need_slow and self._futures_allowed():
                candles, premium, oi = await asyncio.gather(
                    self.get_klines(),
                    self.get_premium_index(),
                    self.get_open_interest(),
                    return_exceptions=True,
                )
            else:
                candles = await self.get_klines()
                premium = self._slow_cache.get("premium") or {}
                oi = self._slow_cache.get("oi") or {}

            if isinstance(candles, Exception):
                logger.error(f"candles exception: {candles}")
                candles = []
            if isinstance(premium, Exception):
                premium = {}
            if isinstance(oi, Exception):
                oi = self._slow_cache.get("oi") or {}

            if need_slow:
                if isinstance(premium, dict) and premium:
                    self._slow_cache["premium"] = premium
                if isinstance(oi, dict) and oi:
                    self._slow_cache["oi"] = oi
                self._slow_cache_at = now

            price = 0.0
            if candles:
                price = float(candles[-1]["close"])
            elif isinstance(premium, dict) and premium.get("mark_price"):
                price = float(premium["mark_price"])

            return {
                "source": "binance",
                "candles": candles or [],
                "price": price,
                "mark_price": float((premium or {}).get("mark_price") or price or 0),
                "funding": float((premium or {}).get("last_funding_rate") or 0),
                "open_interest": float((oi or {}).get("open_interest") or 0),
                "premium": premium or {},
                "oi": oi or {},
            }
        except Exception as e:
            logger.error(f"get_snapshot failed: {e}")
            return {
                "source": "binance",
                "candles": [],
                "price": 0.0,
                "mark_price": 0.0,
                "funding": 0.0,
                "open_interest": 0.0,
                "premium": {},
                "oi": {},
            }
