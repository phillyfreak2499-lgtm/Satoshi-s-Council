"""
Kalshi public market data for hourly series (KXBTCD / KXETHD).
No authentication required for markets / orderbook / series.
Picks the soonest open event and the strike nearest to spot when a ladder exists.
"""
from __future__ import annotations
import time
import httpx
from typing import Any, Dict, List, Optional
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential
from backend.config import settings


class KalshiClient:
    def __init__(self, series_ticker: Optional[str] = None):
        self.base = settings.KALSHI_BASE
        self.series_ticker = series_ticker or getattr(settings, "SERIES_TICKER", "KXBTCD")
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
            "series_ticker": self.series_ticker,
            "status": "open",
            "limit": 200,
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

    def _strike_of(self, m: Dict[str, Any]) -> Optional[float]:
        for k in ("floor_strike", "cap_strike", "strike_price"):
            v = m.get(k)
            if v is None:
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    def _pick_primary(self, markets: List[Dict[str, Any]], spot: Optional[float] = None) -> Optional[Dict[str, Any]]:
        if not markets:
            return None
        markets_sorted = sorted(markets, key=lambda m: m.get("close_time") or "")
        soonest_close = markets_sorted[0].get("close_time")
        cohort = [m for m in markets_sorted if m.get("close_time") == soonest_close]
        if len(cohort) == 1 or spot is None:
            return cohort[0]
        best, best_dist = cohort[0], None
        for m in cohort:
            s = self._strike_of(m)
            if s is None:
                continue
            dist = abs(s - float(spot))
            if best_dist is None or dist < best_dist:
                best, best_dist = m, dist
        return best

    async def get_current_market_state(
        self, cycle: int = 0, spot_price: Optional[float] = None
    ) -> Dict[str, Any]:
        try:
            markets = await self.get_open_markets()
            if not markets:
                return {
                    "healthy": False,
                    "error": f"no open markets for {self.series_ticker}",
                    "markets": [],
                    "series_ticker": self.series_ticker,
                    "fetched_at": time.time(),
                }

            primary = self._pick_primary(markets, spot=spot_price)
            if not primary:
                return {
                    "healthy": False,
                    "error": "no primary market",
                    "series_ticker": self.series_ticker,
                    "fetched_at": time.time(),
                }

            ticker = primary.get("ticker")
            orderbook: Dict[str, Any] = {}
            every = max(1, int(getattr(settings, "KALSHI_ORDERBOOK_EVERY", 4)))
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
                "series_ticker": self.series_ticker,
                "primary_market": primary,
                "all_open": sorted(markets, key=lambda m: m.get("close_time") or "")[:5],
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
            logger.error(f"Kalshi state failed ({self.series_ticker}): {e}")
            return {
                "source": "kalshi",
                "healthy": False,
                "error": str(e),
                "series_ticker": self.series_ticker,
                "fetched_at": time.time(),
            }
