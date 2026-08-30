"""
Kalshi read-only client — official results for the settle sweep.

The settle path (council._official_results_for_opens, seat_backfill) needs
GET /events/{event_ticker} and GET /markets/{ticker} bodies exactly as the
API returns them; chair_gates.collect_official_results / official_y_finish
parse the raw shapes. Public market data — no auth, no orders, ever.
Every call fails soft to {} so a Kalshi outage can never stall a cycle.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx
from loguru import logger

KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
_TIMEOUT = httpx.Timeout(4.0, connect=2.0)
_HEADERS = {"User-Agent": "SatoshiCouncil/1.0 paper-desk", "Accept": "application/json"}


class KalshiClient:
    def __init__(self, base: str = KALSHI):
        self.base = base.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True
            )
        return self._client

    async def _get(self, path: str, params: Optional[dict] = None) -> Dict[str, Any]:
        try:
            r = await self._http().get(f"{self.base}{path}", params=params)
            r.raise_for_status()
            body = r.json()
            return body if isinstance(body, dict) else {}
        except Exception as e:
            logger.debug(f"kalshi {path}: {e}")
            return {}

    async def get_market(self, ticker: str) -> Dict[str, Any]:
        """Raw GET /markets/{ticker} body: {"market": {...}}."""
        if not ticker:
            return {}
        return await self._get(f"/markets/{str(ticker).strip()}")

    async def get_event(self, event_ticker: str) -> Dict[str, Any]:
        """Raw GET /events/{event_ticker} body: {"event": {...}, "markets": [...]}."""
        if not event_ticker:
            return {}
        return await self._get(
            f"/events/{str(event_ticker).strip()}", params={"with_nested_markets": "true"}
        )

    async def markets(
        self, series_ticker: Optional[str] = None, status: str = "open", limit: int = 20
    ) -> List[Dict[str, Any]]:
        """GET /markets rows for a series. Kept for callers of the old stub."""
        params: Dict[str, Any] = {"status": status, "limit": int(limit)}
        if series_ticker:
            params["series_ticker"] = series_ticker
        body = await self._get("/markets", params=params)
        rows = body.get("markets")
        return rows if isinstance(rows, list) else []

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
