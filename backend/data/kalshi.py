"""
Kalshi public market data for series KXBTC15M.
No authentication required for markets / orderbook / series.
Orderbook is optional / throttled — markets payload already has yes_bid.
"""
from __future__ import annotations
import time
import httpx
from typing import Any, Dict, List, Optional
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential
from backend.config import settings


class KalshiClient:
    def __init__(self):
        self.base = settings.KALSHI_BASE
        timeout = httpx.Timeout(settings.HTTP_TIMEOUT, connect=min(4.0, settings.HTTP_TIMEOUT))
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self._last_orderbook: Dict[str, Any] = {}
        self._last_orderbook_ticker: Optional[str] = None

    async def close(self):
        await self.client.aclose()

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.3, min=0.3, max=2))
    async def get_open_markets(self) -> List[Dict[str, Any]]:
        url = f"{self.base}/markets"
        params = {
            "series_ticker": settings.SERIES_TICKER,
            "status": "open",
            "limit": 8,  # only need the soonest few for 15m
        }
        r = await self.client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        return data.get("markets", [])

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.3, min=0.3, max=2))
    async def get_orderbook(self, ticker: str) -> Dict[str, Any]:
        url = f"{self.base}/markets/{ticker}/orderbook"
        r = await self.client.get(url)
        r.raise_for_status()
        return r.json()

    async def get_current_market_state(self, cycle: int = 0) -> Dict[str, Any]:
        """Soonest-expiring open 15m market. Orderbook only every N cycles."""
        try:
            markets = await self.get_open_markets()
            if not markets:
                return {"healthy": False, "error": "no open markets", "markets": [], "fetched_at": time.time()}

            markets_sorted = sorted(markets, key=lambda m: m.get("close_time", ""))
            primary = markets_sorted[0]
            ticker = primary.get("ticker")

            orderbook = {}
            every = max(1, int(settings.KALSHI_ORDERBOOK_EVERY))
            want_ob = (cycle % every == 1) or (ticker != self._last_orderbook_ticker)
            if want_ob and ticker:
                try:
                    orderbook = await self.get_orderbook(ticker)
                    self._last_orderbook = orderbook
                    self._last_orderbook_ticker = ticker
                except Exception as e:
                    logger.warning(f"Orderbook fetch failed for {ticker}: {e}")
                    orderbook = self._last_orderbook if self._last_orderbook_ticker == ticker else {}
            else:
                orderbook = self._last_orderbook if self._last_orderbook_ticker == ticker else {}

            floor_strike = primary.get("floor_strike")
            try:
                floor_strike = float(floor_strike) if floor_strike is not None else None
            except (TypeError, ValueError):
                floor_strike = None

            return {
                "source": "kalshi",
                "healthy": True,
                "primary_market": primary,
                "all_open": markets_sorted[:3],  # trim payload
                "orderbook": orderbook,
                "yes_bid": primary.get("yes_bid_dollars") or primary.get("yes_bid"),
                "yes_ask": primary.get("yes_ask_dollars") or primary.get("yes_ask"),
                "volume": primary.get("volume_fp") or primary.get("volume"),
                "open_interest": primary.get("open_interest_fp") or primary.get("open_interest"),
                "close_time": primary.get("close_time"),
                "ticker": ticker,
                "floor_strike": floor_strike,
                "cap_strike": primary.get("cap_strike"),
                "strike_type": primary.get("strike_type"),
                "title": primary.get("title") or primary.get("yes_sub_title"),
                "fetched_at": time.time(),
            }
        except Exception as e:
            logger.error(f"Kalshi state failed: {e}")
            return {"source": "kalshi", "healthy": False, "error": str(e), "fetched_at": time.time()}
