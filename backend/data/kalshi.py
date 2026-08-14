"""
Kalshi public market data for hourly series (KXBTCD / KXETHD).
No authentication required for markets / orderbook / series.
Picks the soonest open event and the strike nearest to spot when a ladder exists.

Feed flaps: one quiet retry, then last-good quotes. Do not raise RetryError
or error-log every cycle — the desk stays up on stale Kalshi.
"""
from __future__ import annotations
import time
import httpx
from typing import Any, Dict, List, Optional
from loguru import logger
from backend.config import settings
import asyncio

# Serialize Kalshi HTTP across BTC+ETH clients (one in-flight fetch family at a time)
_KALSHI_LOCK = asyncio.Lock()
_KALSHI_LAST: float = 0.0
_KALSHI_MIN_GAP = 0.55  # seconds between series fetches
_FAIL_QUIET_S = 180.0
_BACKOFF_S = 12.0
_kalshi_backoff_until: float = 0.0


class KalshiClient:
    def __init__(self, series_ticker: Optional[str] = None):
        self.base = settings.KALSHI_BASE
        self.series_ticker = series_ticker or getattr(settings, "SERIES_TICKER", "KXBTCD")
        timeout = httpx.Timeout(settings.HTTP_TIMEOUT, connect=min(4.0, settings.HTTP_TIMEOUT))
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self._last_orderbook: Dict[str, Any] = {}
        self._last_orderbook_ticker: Optional[str] = None
        self._last_markets: List[Dict[str, Any]] = []
        self._last_good: Dict[str, Any] = {}
        self._last_fail_log: float = 0.0

    async def close(self):
        await self.client.aclose()

    def _note_fail(self, where: str, err: BaseException) -> None:
        global _kalshi_backoff_until
        now = time.time()
        name = type(err).__name__
        code = getattr(err, "response", None)
        status = getattr(code, "status_code", None) if code is not None else None
        if status in (429, 500, 502, 503, 504) or name in ("TimeoutException", "ConnectError", "ReadTimeout"):
            _kalshi_backoff_until = max(_kalshi_backoff_until, now + _BACKOFF_S)
        if now - self._last_fail_log >= _FAIL_QUIET_S:
            extra = f" HTTP {status}" if status else ""
            logger.warning(
                f"Kalshi {where} flap ({self.series_ticker}): {name}{extra} — keeping last quotes"
            )
            self._last_fail_log = now
        else:
            logger.debug(f"Kalshi {where} flap ({self.series_ticker}): {name}")

    def _in_backoff(self) -> bool:
        return time.time() < float(_kalshi_backoff_until or 0)

    async def _get_json(self, url: str, params: Optional[dict] = None) -> Dict[str, Any]:
        if self._in_backoff():
            raise RuntimeError("kalshi_backoff")
        r = await self.client.get(url, params=params)
        if r.status_code in (429, 500, 502, 503, 504):
            exc = httpx.HTTPStatusError(
                f"Kalshi {r.status_code}", request=r.request, response=r
            )
            self._note_fail("http", exc)
            raise exc
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}

    async def get_open_markets(self) -> List[Dict[str, Any]]:
        global _KALSHI_LAST
        async with _KALSHI_LOCK:
            gap = time.time() - float(_KALSHI_LAST or 0)
            if gap < _KALSHI_MIN_GAP:
                await asyncio.sleep(_KALSHI_MIN_GAP - gap)
            url = f"{self.base}/markets"
            params = {
                "series_ticker": self.series_ticker,
                "status": "open",
                "limit": 200,
            }
            last_err: Optional[BaseException] = None
            attempts = 1 if self._in_backoff() else 2
            for attempt in range(attempts):
                try:
                    data = await self._get_json(url, params)
                    _KALSHI_LAST = time.time()
                    markets = data.get("markets") or []
                    if isinstance(markets, list) and markets:
                        self._last_markets = markets
                    return markets if isinstance(markets, list) else []
                except Exception as e:
                    last_err = e
                    if attempt == 0 and not self._in_backoff():
                        await asyncio.sleep(0.45)
                    else:
                        break
            if last_err is not None:
                self._note_fail("markets", last_err)
            return list(self._last_markets or [])

    async def get_orderbook(self, ticker: str) -> Dict[str, Any]:
        url = f"{self.base}/markets/{ticker}/orderbook"
        try:
            data = await self._get_json(url)
            book = data.get("orderbook") if isinstance(data.get("orderbook"), dict) else data
            return book if isinstance(book, dict) else {}
        except Exception as e:
            self._note_fail("orderbook", e)
            if self._last_orderbook_ticker == ticker:
                return dict(self._last_orderbook)
            return {}

    async def get_market(self, ticker: str) -> Dict[str, Any]:
        """Single contract, including closed/settled (for hour-close grade)."""
        if not ticker:
            return {}
        url = f"{self.base}/markets/{ticker}"
        try:
            data = await self._get_json(url)
            market = data.get("market") if isinstance(data.get("market"), dict) else data
            return market if isinstance(market, dict) else {}
        except Exception as e:
            self._note_fail("market", e)
            return {}

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

    def _pack_state(
        self,
        markets: List[Dict[str, Any]],
        primary: Dict[str, Any],
        orderbook: Dict[str, Any],
        *,
        stale: bool = False,
    ) -> Dict[str, Any]:
        ticker = primary.get("ticker")
        floor_strike = primary.get("floor_strike")
        try:
            floor_strike = float(floor_strike) if floor_strike is not None else None
        except (TypeError, ValueError):
            floor_strike = None
        return {
            "source": "kalshi",
            "healthy": True,
            "stale": stale,
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

    async def get_current_market_state(
        self, cycle: int = 0, spot_price: Optional[float] = None
    ) -> Dict[str, Any]:
        if self._in_backoff() and self._last_good:
            stale = dict(self._last_good)
            stale["stale"] = True
            stale["healthy"] = True
            return stale
        try:
            markets = await self.get_open_markets()
            if not markets:
                if self._last_good:
                    stale = dict(self._last_good)
                    stale["stale"] = True
                    stale["healthy"] = True
                    return stale
                return {
                    "healthy": False,
                    "stale": True,
                    "error": f"no open markets for {self.series_ticker}",
                    "markets": [],
                    "series_ticker": self.series_ticker,
                    "fetched_at": time.time(),
                }

            primary = self._pick_primary(markets, spot=spot_price)
            if not primary:
                if self._last_good:
                    stale = dict(self._last_good)
                    stale["stale"] = True
                    stale["healthy"] = True
                    return stale
                return {
                    "healthy": False,
                    "stale": True,
                    "error": "no primary market",
                    "series_ticker": self.series_ticker,
                    "fetched_at": time.time(),
                }

            ticker = primary.get("ticker")
            orderbook: Dict[str, Any] = {}
            every = max(1, int(getattr(settings, "KALSHI_ORDERBOOK_EVERY", 4)))
            want_ob = (cycle % every == 1) or (ticker != self._last_orderbook_ticker)
            if want_ob and ticker:
                orderbook = await self.get_orderbook(ticker)
                if orderbook:
                    self._last_orderbook = orderbook
                    self._last_orderbook_ticker = ticker
                elif self._last_orderbook_ticker == ticker:
                    orderbook = self._last_orderbook
            else:
                orderbook = self._last_orderbook if self._last_orderbook_ticker == ticker else {}

            state = self._pack_state(markets, primary, orderbook, stale=False)
            self._last_good = dict(state)
            return state
        except Exception as e:
            self._note_fail("state", e)
            if self._last_good:
                stale = dict(self._last_good)
                stale["stale"] = True
                stale["healthy"] = True
                stale["error"] = type(e).__name__
                return stale
            return {
                "source": "kalshi",
                "healthy": False,
                "stale": True,
                "error": type(e).__name__,
                "series_ticker": self.series_ticker,
                "fetched_at": time.time(),
            }
