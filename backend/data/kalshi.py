"""
Kalshi public market data.
BTC Chair: KXBTC15M (15m up/down). ETH Chair: KXETHD (hourly ladder).
No authentication required for markets / orderbook / series.
Picks the soonest open window, then the best in-band-after-vig contract
on that stack (not ATM chalk 98/2). Sit if the stack is dead.
Satoshi / KXBTC15M uses 20–80 after vig + EV ≥ 0. ETH 1H ladder stays 20–80 / +3¢.

Feed flaps: one quiet retry, then last-good quotes. Do not raise RetryError
or error-log every cycle — the desk stays up on stale Kalshi.
"""
from __future__ import annotations
import time
import httpx
from typing import Any, Dict, List, Optional
from loguru import logger
from backend.config import settings
from backend.agents.chair_gates import (
    kalshi_taker_fee_cents,
    leftover_after_vig,
    odds_to_cents,
)
import asyncio

# ETH 1H ladder: skip chalk ≥80¢ / one-sided. Satoshi 15m uses the same 20–80 rail, EV ≥ 0.
LADDER_BAND_LO = 20.0
LADDER_BAND_HI = 80.0
LADDER_P_FINISH = 0.55

# Serialize Kalshi HTTP across BTC+ETH clients (one in-flight fetch family at a time)
_KALSHI_LOCK = asyncio.Lock()
_KALSHI_LAST: float = 0.0
_KALSHI_MIN_GAP = 0.55  # seconds between series fetches
_FAIL_QUIET_S = 180.0
_BACKOFF_S = 12.0
_kalshi_backoff_until: float = 0.0


def market_strike(m: Dict[str, Any]) -> Optional[float]:
    if not isinstance(m, dict):
        return None
    for k in ("floor_strike", "cap_strike", "strike_price"):
        v = m.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def market_quotes(m: Dict[str, Any]) -> Dict[str, Optional[float]]:
    row = m if isinstance(m, dict) else {}
    yb = odds_to_cents(row.get("yes_bid_dollars") if row.get("yes_bid_dollars") is not None else row.get("yes_bid"))
    ya = odds_to_cents(row.get("yes_ask_dollars") if row.get("yes_ask_dollars") is not None else row.get("yes_ask"))
    nb = odds_to_cents(row.get("no_bid_dollars") if row.get("no_bid_dollars") is not None else row.get("no_bid"))
    na = odds_to_cents(row.get("no_ask_dollars") if row.get("no_ask_dollars") is not None else row.get("no_ask"))
    if na is None and ya is not None:
        na = max(0.0, 100.0 - ya)
    if ya is None and na is not None:
        ya = max(0.0, 100.0 - na)
    mid = None
    if yb is not None and ya is not None:
        mid = (yb + ya) / 2.0
    elif ya is not None:
        mid = ya
    return {"yes_bid": yb, "yes_ask": ya, "no_bid": nb, "no_ask": na, "yes_mid": mid}


def hour_ladder(markets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = [m for m in (markets or []) if isinstance(m, dict)]
    if not rows:
        return []
    rows = sorted(rows, key=lambda m: m.get("close_time") or "")
    soonest = rows[0].get("close_time")
    return [m for m in rows if m.get("close_time") == soonest]


def _ladder_band_for(m: Dict[str, Any] | None) -> tuple[float, float, float]:
    """Satoshi 15m: 20–80 after vig + EV ≥ 0. ETH 1H ladder stays 20–80 + MIN_EV 3¢."""
    ticker = (m or {}).get("ticker")
    try:
        from backend.learning.btc15m import (
            MIN_EV_CENTS as MIN_EV_15M,
            SCORE_BAND_HI,
            SCORE_BAND_LO,
            is_btc_15m_ticker,
        )
        if is_btc_15m_ticker(ticker):
            return float(SCORE_BAND_LO), float(SCORE_BAND_HI), float(MIN_EV_15M)
    except Exception:
        pass
    try:
        from backend.config import settings
        min_ev = float(getattr(settings, "MIN_EV_CENTS", 3.0))
    except Exception:
        min_ev = 3.0
    return LADDER_BAND_LO, LADDER_BAND_HI, min_ev


def score_ladder_contract(
    m: Dict[str, Any],
    spot: Optional[float] = None,
) -> Dict[str, Any]:
    q = market_quotes(m)
    mid = q.get("yes_mid")
    ya, na = q.get("yes_ask"), q.get("no_ask")
    strike = market_strike(m)
    dist = None
    if strike is not None and spot is not None:
        try:
            dist = abs(float(strike) - float(spot))
        except (TypeError, ValueError):
            dist = None
    two_sided = ya is not None and na is not None
    band_lo, band_hi, min_ev = _ladder_band_for(m)
    # Herald/Patch: Satoshi 15m and ETH 1H both sit outside exclusive 20–80.
    # Satoshi min_ev is 0; ETH stays +3¢. One-sided / missing door is not playable.
    chalk = (
        (ya is not None and ya >= LADDER_BAND_HI)
        or (na is not None and na >= LADDER_BAND_HI)
        or (mid is not None and (mid >= LADDER_BAND_HI or mid <= LADDER_BAND_LO))
        or (ya is not None and ya >= 99.0)
        or (na is not None and na >= 99.0)
    )
    in_band = bool(
        two_sided
        and mid is not None
        and float(band_lo) < float(mid) < float(band_hi)
        and not chalk
    )
    leftover = None
    if in_band:
        spread = None
        if q.get("yes_bid") is not None and ya is not None:
            spread = max(0.0, float(ya) - float(q["yes_bid"]))
        p_yes = float(LADDER_P_FINISH)
        left_up = leftover_after_vig(p_yes, float(ya), spread, kalshi_taker_fee_cents(ya))
        left_dn = leftover_after_vig(1.0 - p_yes, float(na), spread, kalshi_taker_fee_cents(na))
        leftover = max(left_up, left_dn)
    playable = leftover is not None and leftover >= min_ev
    if playable:
        why = "leftover"
    elif chalk or not in_band:
        why = "chalk"
    else:
        why = "in-band"
    return {
        "ticker": (m or {}).get("ticker"),
        "strike": strike,
        "yes_mid": mid,
        "leftover": None if leftover is None else round(float(leftover), 2),
        "dist": dist,
        "playable": playable,
        "in_band": in_band,
        "two_sided": two_sided,
        "chalk": bool(chalk),
        "why": why,
    }


def nearest_spot_contract(
    markets: List[Dict[str, Any]],
    spot: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    rows = [m for m in (markets or []) if isinstance(m, dict)]
    if not rows:
        return None
    if spot is None:
        return rows[0]
    best, best_dist = rows[0], None
    for m in rows:
        s = market_strike(m)
        if s is None:
            continue
        dist = abs(s - float(spot))
        if best_dist is None or dist < best_dist:
            best, best_dist = m, dist
    return best


def pick_hour_book(
    markets: List[Dict[str, Any]],
    spot: Optional[float] = None,
    sit_if_dead: bool = False,
) -> Optional[Dict[str, Any]]:
    """Best in-band-after-vig contract on this window's stack, not ATM chalk."""
    cohort = hour_ladder(markets)
    if not cohort:
        return None

    def _rank(sc: Dict[str, Any]) -> tuple:
        leftover = sc.get("leftover")
        mid = sc.get("yes_mid")
        dist = sc.get("dist")
        mid_dev = abs(float(mid) - 50.0) if mid is not None else 99.0
        # Near-spot two-sided book first. Do not max leftover onto a 21¢ wing.
        return (
            dist if dist is not None else 1e18,
            mid_dev,
            -(leftover if leftover is not None else -99.0),
        )

    scored = [(score_ladder_contract(m, spot), m) for m in cohort]
    playable = [pair for pair in scored if pair[0].get("playable")]
    if playable:
        playable.sort(key=lambda pair: _rank(pair[0]))
        return playable[0][1]
    in_band = [pair for pair in scored if pair[0].get("in_band")]
    if in_band:
        in_band.sort(key=lambda pair: _rank(pair[0]))
        return in_band[0][1]
    if sit_if_dead:
        return None
    return nearest_spot_contract(cohort, spot)


class KalshiClient:
    def __init__(self, series_ticker: Optional[str] = None):
        self.base = settings.KALSHI_BASE
        self.series_ticker = series_ticker or getattr(settings, "SERIES_TICKER", "KXBTC15M")
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
        depth_n = max(1, int(getattr(settings, "KALSHI_ORDERBOOK_DEPTH", 10)))
        try:
            data = await self._get_json(url, params={"depth": depth_n})
            if isinstance(data.get("orderbook_fp"), dict):
                return data["orderbook_fp"]
            book = data.get("orderbook") if isinstance(data.get("orderbook"), dict) else data
            if isinstance(book, dict) and isinstance(book.get("orderbook_fp"), dict):
                return book["orderbook_fp"]
            return book if isinstance(book, dict) else {}
        except Exception as e:
            self._note_fail("orderbook", e)
            if self._last_orderbook_ticker == ticker:
                return dict(self._last_orderbook)
            return {}

    async def get_cfbenchmarks_values(self, index_id: str) -> Dict[str, Any]:
        """
        Kalshi /cfbenchmarks passthrough → CFB RTI prints (BRTI / ETHUSD_RTI).
        Public first; signed retry if keys exist. Never logs credentials.
        A 401 here must not trip the markets backoff.
        """
        if not index_id:
            return {}
        url = f"{self.base}/cfbenchmarks/values"
        params = {"id": index_id}
        try:
            r = await self.client.get(url, params=params)
            if r.status_code == 200:
                data = r.json()
                return data if isinstance(data, dict) else {}
            if r.status_code not in (401, 403, 404):
                logger.debug(f"Kalshi cfbenchmarks {index_id} HTTP {r.status_code}")
        except Exception as e:
            logger.debug(f"Kalshi cfbenchmarks flap: {type(e).__name__}")
        try:
            from backend.data.kalshi_trade import KalshiTradeClient
            trade = KalshiTradeClient.from_settings()
            if not trade.ready():
                return {}
            rel = "/cfbenchmarks/values"
            headers = trade._headers("GET", rel)
            r = await self.client.get(f"{self.base}{rel}", params=params, headers=headers)
            if r.status_code == 200:
                data = r.json()
                return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.debug(f"Kalshi cfbenchmarks signed skip: {type(e).__name__}")
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

    async def get_event(self, event_ticker: str) -> Dict[str, Any]:
        """Hour event + all strikes (finalized markets carry official result)."""
        if not event_ticker:
            return {}
        url = f"{self.base}/events/{event_ticker}"
        try:
            data = await self._get_json(url)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            self._note_fail("event", e)
            return {}

    def _strike_of(self, m: Dict[str, Any]) -> Optional[float]:
        return market_strike(m)

    def _pick_primary(self, markets: List[Dict[str, Any]], spot: Optional[float] = None) -> Optional[Dict[str, Any]]:
        sit = str(self.series_ticker or "").upper() == "KXBTC15M"
        picked = pick_hour_book(markets, spot=spot, sit_if_dead=sit)
        if picked is not None:
            return picked
        # Dead 15m stack: still surface the book so the Chair can sit. Do not lock it.
        return pick_hour_book(markets, spot=spot, sit_if_dead=False)

    def _pack_state(
        self,
        markets: List[Dict[str, Any]],
        primary: Dict[str, Any],
        orderbook: Dict[str, Any],
        *,
        stale: bool = False,
    ) -> Dict[str, Any]:
        ticker = primary.get("ticker")
        from backend.agents.chair_gates import lock_time_strike
        ladder = hour_ladder(markets)
        floor_strike = lock_time_strike(
            ticker=ticker,
            floor_strike=primary.get("floor_strike"),
            cap_strike=primary.get("cap_strike"),
            strike_price=primary.get("strike_price"),
        )
        return {
            "source": "kalshi",
            "healthy": True,
            "stale": stale,
            "series_ticker": self.series_ticker,
            "primary_market": primary,
            "all_open": ladder,
            "ladder_n": len(ladder),
            "pick_why": score_ladder_contract(primary, None).get("why"),
            "orderbook": orderbook,
            "yes_bid": primary.get("yes_bid_dollars") or primary.get("yes_bid"),
            "yes_ask": primary.get("yes_ask_dollars") or primary.get("yes_ask"),
            "no_bid": primary.get("no_bid_dollars") or primary.get("no_bid"),
            "no_ask": primary.get("no_ask_dollars") or primary.get("no_ask"),
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
            last_has_size = False
            if ticker and self._last_orderbook_ticker == ticker and self._last_orderbook:
                try:
                    from backend.agents.chair_gates import parse_book_depth
                    last_has_size = bool(parse_book_depth(self._last_orderbook).get("has_size"))
                except Exception:
                    last_has_size = False
            want_ob = (
                (cycle % every == 1)
                or (ticker != self._last_orderbook_ticker)
                or not last_has_size
            )
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
