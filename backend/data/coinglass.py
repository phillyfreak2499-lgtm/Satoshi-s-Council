"""
CoinGlass v4 — funding, open interest, liquidations for CARRY / CHAIN / CASCADE.

Key is loaded from env or the Render secret file. Never logged.
Futures on Binance fapi can 451 in Oregon; this feed is the fill-in.
Startup plan: 30m / 1h history (no 1m backtest).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger

from backend.config import settings
from backend.data.secrets import load_coinglass_api_key
from backend.services.runtime_settings import runtime_settings

BASE = "https://open-api-v4.coinglass.com"
_INTERVALS = ("1h", "30m")  # 1h OI/liq only; never a daily heatmap as a 1h tell


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _bar_close(row: Dict[str, Any]) -> Optional[float]:
    return _f(row.get("close") if row.get("close") is not None else row.get("c"))


def _bar_time_s(row: Dict[str, Any]) -> Optional[float]:
    t = row.get("time") if row.get("time") is not None else row.get("t")
    try:
        ms = float(t)
    except (TypeError, ValueError):
        return None
    return ms / 1000.0 if ms > 1e12 else ms


def parse_funding_bars(rows: List[Dict[str, Any]]) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        t = _bar_time_s(row)
        v = _bar_close(row)
        if t is None or v is None:
            continue
        out.append((t, v))
    return out


def parse_oi_bars(rows: List[Dict[str, Any]]) -> List[Tuple[float, float]]:
    return parse_funding_bars(rows)


def parse_liq_bars(rows: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    out: List[Dict[str, float]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        t = _bar_time_s(row)
        lng = _f(row.get("long_liquidation_usd") or row.get("longLiquidationUsd"))
        sht = _f(row.get("short_liquidation_usd") or row.get("shortLiquidationUsd"))
        if t is None:
            continue
        out.append({
            "t": t,
            "long_usd": float(lng or 0.0),
            "short_usd": float(sht or 0.0),
        })
    return out


def summarize_derivatives(
    funding_rows: List[Dict[str, Any]],
    oi_rows: List[Dict[str, Any]],
    liq_rows: List[Dict[str, Any]],
    interval: str,
) -> Dict[str, Any]:
    """Pure merge used by tests and the live client."""
    fund_hist = parse_funding_bars(funding_rows)
    oi_hist = parse_oi_bars(oi_rows)
    liq_hist = parse_liq_bars(liq_rows)
    funding = fund_hist[-1][1] if fund_hist else None
    oi = oi_hist[-1][1] if oi_hist else None
    last_liq = liq_hist[-1] if liq_hist else None
    long_usd = last_liq["long_usd"] if last_liq else None
    short_usd = last_liq["short_usd"] if last_liq else None
    oi_delta_1h = None
    iv = str(interval or "").strip().lower()
    if iv in ("1h", "60m") and len(oi_hist) >= 2:
        try:
            oi_delta_1h = float(oi_hist[-1][1]) - float(oi_hist[-2][1])
        except (TypeError, ValueError, IndexError):
            oi_delta_1h = None
    daily_heatmap = iv in ("1d", "24h", "4h", "12h", "1w", "7d", "daily")
    healthy = funding is not None or oi is not None or last_liq is not None
    return {
        "source": "coinglass",
        "healthy": healthy,
        "interval": interval,
        "funding_rate": funding,
        "open_interest": oi,
        "oi_delta_1h": oi_delta_1h,
        "daily_heatmap": daily_heatmap,
        "liq_long_usd": long_usd,
        "liq_short_usd": short_usd,
        "liq_net_usd": (
            None if long_usd is None or short_usd is None else (short_usd - long_usd)
        ),
        "funding_history": fund_hist[-24:],
        "oi_history": oi_hist[-24:],
        "liq_history": liq_hist[-24:],
    }


class CoinGlassClient:
    def __init__(self, symbol: str | None = None):
        self.symbol = symbol or getattr(settings, "SYMBOL", "BTCUSDT")
        self.exchange = str(getattr(settings, "COINGLASS_EXCHANGE", "Binance"))
        timeout = httpx.Timeout(float(getattr(settings, "HTTP_TIMEOUT", 6.0)), connect=4.0)
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self._cache: Dict[str, Any] = {}
        self._cache_at: float = 0.0
        self._interval_ok: Optional[str] = None
        self._logged_empty = False

    def configured(self) -> bool:
        return bool(load_coinglass_api_key())

    async def close(self):
        await self.client.aclose()

    def _headers(self) -> Optional[Dict[str, str]]:
        key = load_coinglass_api_key()
        if not key:
            return None
        return {
            "CG-API-KEY": key,
            "Accept": "application/json",
        }

    async def _get_rows(self, path: str, interval: str, limit: int = 24) -> List[Dict[str, Any]]:
        headers = self._headers()
        if not headers:
            return []
        url = f"{BASE}{path}"
        params = {
            "exchange": self.exchange,
            "symbol": self.symbol,
            "interval": interval,
            "limit": limit,
        }
        try:
            r = await self.client.get(url, params=params, headers=headers)
            if r.status_code in (401, 403):
                logger.warning(f"CoinGlass {path} auth failed ({r.status_code})")
                return []
            r.raise_for_status()
            body = r.json()
        except Exception as e:
            logger.debug(f"CoinGlass {path} {interval} fail: {type(e).__name__}")
            return []
        code = str(body.get("code", ""))
        if code not in ("0", "200", ""):
            return []
        data = body.get("data")
        if not isinstance(data, list):
            return []
        return [row for row in data if isinstance(row, dict)]

    async def _rows_with_interval(self, path: str) -> Tuple[List[Dict[str, Any]], str]:
        preferred = str(getattr(settings, "COINGLASS_INTERVAL", "30m") or "30m")
        order = [preferred] + [iv for iv in _INTERVALS if iv != preferred]
        if self._interval_ok:
            order = [self._interval_ok] + [iv for iv in order if iv != self._interval_ok]
        for iv in order:
            rows = await self._get_rows(path, iv)
            if rows:
                self._interval_ok = iv
                return rows, iv
        return [], preferred

    async def get_derivatives(self) -> Dict[str, Any]:
        empty = {
            "source": "coinglass",
            "healthy": False,
            "funding_rate": None,
            "open_interest": None,
            "oi_delta_1h": None,
            "daily_heatmap": False,
            "liq_long_usd": None,
            "liq_short_usd": None,
            "liq_net_usd": None,
            "funding_history": [],
            "oi_history": [],
            "liq_history": [],
        }
        if not self.configured():
            return empty
        ttl = float(
            runtime_settings.get(
                "slow_metrics_ttl",
                getattr(settings, "COINGLASS_TTL", getattr(settings, "SLOW_METRICS_TTL", 60.0)),
            )
        )
        now = time.monotonic()
        if self._cache and (now - self._cache_at) < max(30.0, ttl):
            return dict(self._cache)
        try:
            (fund_rows, fund_iv), (oi_rows, oi_iv), (liq_rows, liq_iv) = await asyncio.gather(
                self._rows_with_interval("/api/futures/funding-rate/history"),
                self._rows_with_interval("/api/futures/open-interest/history"),
                self._rows_with_interval("/api/futures/liquidation/history"),
            )
            interval = fund_iv or oi_iv or liq_iv or "30m"
            snap = summarize_derivatives(fund_rows, oi_rows, liq_rows, interval)
            if snap.get("healthy"):
                self._cache = snap
                self._cache_at = now
                self._logged_empty = False
            elif not self._logged_empty:
                logger.info("CoinGlass derivatives empty this cycle — CARRY/CHAIN keep last/Binance")
                self._logged_empty = True
            return snap
        except Exception as e:
            logger.debug(f"CoinGlass snapshot fail: {type(e).__name__}")
            return empty
