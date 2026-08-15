"""
CoinGlass v4 — funding, open interest, liquidations for CARRY / CHAIN / CASCADE.

Key is loaded from env or the Render secret file. Never logged.
Futures on Binance fapi can 451 in Oregon; this feed is the fill-in.
Hist: 30m then 1h. Live feeds: 1h then 4h separately. Never 1m.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger

from backend.config import settings
from backend.data.secrets import load_coinglass_api_key
from backend.services.runtime_settings import runtime_settings

BASE = "https://open-api-v4.coinglass.com"
ALLOWED_INTERVALS = ("30m", "1h")  # hist: 30m then 1h, never 1m
FEED_INTERVALS = ("1h", "4h")  # live funding/OI/liq each climb these; never 1m
HOBBYIST_REASON = "Upgrade plan on 30m/1h; 4h ok — key looks Hobbyist"
PATHS = (
    "/api/futures/funding-rate/history",
    "/api/futures/open-interest/history",
    "/api/futures/liquidation/history",
)
_PLAN_INTERVAL_HINTS = (
    "interval",
    "plan",
    "upgrade",
    "permission",
    "not allowed",
    "not support",
    "hobbyist",
    "startup",
    "timeframe",
    "resolution",
)


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
        "reason": "",
    }


def empty_derivatives(interval: str = "30m") -> Dict[str, Any]:
    """Empty hist snapshot. Does not rewrite the live client empty shape."""
    snap = summarize_derivatives([], [], [], interval)
    snap["healthy"] = False
    snap["feeds"] = {"funding": False, "open_interest": False, "liquidations": False}
    snap["skip_reason"] = ""
    return snap


def feeds_present(cg: Dict[str, Any] | None) -> Dict[str, bool]:
    """Which of the three hist feeds actually returned bars. Never invents a print."""
    if not isinstance(cg, dict):
        return {"funding": False, "open_interest": False, "liquidations": False}
    feeds = cg.get("feeds") if isinstance(cg.get("feeds"), dict) else {}
    return {
        "funding": bool(feeds.get("funding") or cg.get("funding_rate") is not None),
        "open_interest": bool(feeds.get("open_interest") or cg.get("open_interest") is not None),
        "liquidations": bool(
            feeds.get("liquidations")
            or cg.get("liq_long_usd") is not None
            or cg.get("liq_short_usd") is not None
        ),
    }


def apply_hist_to_market(market: Dict[str, Any], cg: Dict[str, Any]) -> Dict[str, Any]:
    """Inject CoinGlass hist fields the live pipeline already uses. Merge, don't wipe."""
    out = dict(market or {})
    if not isinstance(cg, dict):
        return out
    out["coinglass"] = cg
    out["funding_rate"] = cg.get("funding_rate")
    out["open_interest"] = cg.get("open_interest")
    out["oi_delta_1h"] = cg.get("oi_delta_1h")
    out["funding_history"] = list(cg.get("funding_history") or [])
    out["oi_history"] = list(cg.get("oi_history") or [])
    out["liq_long_usd"] = cg.get("liq_long_usd")
    out["liq_short_usd"] = cg.get("liq_short_usd")
    out["liq_net_usd"] = cg.get("liq_net_usd")
    out["liq_history"] = list(cg.get("liq_history") or [])
    out["cg_interval"] = cg.get("interval") or "30m"
    out["cg_daily_heatmap"] = bool(cg.get("daily_heatmap"))
    return out


def _redact(text: Any, secret: Optional[str]) -> str:
    s = "" if text is None else str(text)
    if secret:
        s = s.replace(secret, "[redacted]")
    return s


def _snippet(text: Any, secret: Optional[str], n: int = 200) -> str:
    return _redact(text, secret)[:n]


def is_plan_interval_error(code: Any, msg: Any) -> bool:
    blob = f"{code} {msg}".lower()
    return any(h in blob for h in _PLAN_INTERVAL_HINTS)


def is_upgrade_plan_error(code: Any, msg: Any) -> bool:
    blob = f"{code} {msg}".lower()
    return "upgrade" in blob and "plan" in blob


def live_interval_order(cached_ok: Optional[str] = None) -> List[str]:
    """Hist helper: 30m then 1h. Never 1m."""
    order = [iv for iv in ALLOWED_INTERVALS if iv != "1m"]
    cached = str(cached_ok or "").strip().lower()
    if cached in ALLOWED_INTERVALS and cached != "1m":
        order = [cached] + [iv for iv in order if iv != cached]
    return order


def feed_interval_order(cached_ok: Optional[str] = None) -> List[str]:
    """Live funding / OI / liq separately: 1h then 4h. Never 1m."""
    order = [iv for iv in FEED_INTERVALS if iv != "1m"]
    cached = str(cached_ok or "").strip().lower()
    if cached in FEED_INTERVALS and cached != "1m":
        order = [cached] + [iv for iv in order if iv != cached]
    return order


def format_coinglass_reason(
    last: Optional["_Fetch"] = None,
    succeeded: Optional[str] = None,
    upgrade_intervals: Optional[List[str]] = None,
    succeeded_intervals: Optional[List[str]] = None,
) -> str:
    """Plain /health string. Hobbyist: 1h Upgrade plan and 4h ok."""
    up = [str(x) for x in (upgrade_intervals or [])]
    ok = [str(x) for x in (succeeded_intervals or [])]
    if succeeded and succeeded not in ok:
        ok = [succeeded] + ok
    if "1h" in up and "4h" in ok:
        return HOBBYIST_REASON
    if ok:
        return f"{','.join(ok)} ok"
    if up:
        return "Upgrade plan on 30m/1h/4h; no feed returned data"
    if last is None:
        return "no usable funding/OI/liq this cycle"
    msg = _snippet(last.cg_msg, None)
    return (
        f"last={last.interval} path={last.path} "
        f"http={last.http_status} code={last.cg_code} msg={msg}; "
        f"succeeded=none"
    )


@dataclass
class _Fetch:
    rows: List[Dict[str, Any]] = field(default_factory=list)
    ok: bool = False
    path: str = ""
    interval: str = ""
    http_status: Optional[int] = None
    cg_code: Any = None
    cg_msg: str = ""
    body: str = ""
    reason: str = ""
    auth_fail: bool = False
    plan_interval: bool = False


class CoinGlassClient:
    def __init__(self, symbol: str | None = None):
        self.symbol = symbol or getattr(settings, "SYMBOL", "BTCUSDT")
        self.exchange = str(getattr(settings, "COINGLASS_EXCHANGE", "Binance"))
        timeout = httpx.Timeout(float(getattr(settings, "HTTP_TIMEOUT", 6.0)), connect=4.0)
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self._cache: Dict[str, Any] = {}
        self._cache_at: float = 0.0
        self._interval_ok: Optional[str] = None
        self._interval_ok_by_path: Dict[str, str] = {}
        self._cycle_misses: List[_Fetch] = []
        self._cycle_attempts: List[_Fetch] = []

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

    def _note_attempt(self, got: _Fetch) -> None:
        key = (got.path, got.interval)
        if any((a.path, a.interval) == key for a in self._cycle_attempts):
            return
        self._cycle_attempts.append(got)
        if not got.ok:
            self._note_miss(got)

    def _note_miss(self, miss: _Fetch) -> None:
        key = (miss.path, miss.interval)
        if any((m.path, m.interval) == key for m in self._cycle_misses):
            return
        self._cycle_misses.append(miss)

    def _format_attempt(self, got: _Fetch) -> str:
        secret = load_coinglass_api_key()
        msg = _snippet(got.cg_msg, secret)
        return (
            f"path={got.path} interval={got.interval} "
            f"symbol={self.symbol} exchange={self.exchange} "
            f"http={got.http_status} code={got.cg_code} msg={msg}"
        )

    def _last_attempt(self) -> Optional[_Fetch]:
        if not self._cycle_attempts:
            return None
        rank_iv = {iv: i for i, iv in enumerate(FEED_INTERVALS)}
        rank_path = {p: i for i, p in enumerate(PATHS)}
        return max(
            self._cycle_attempts,
            key=lambda a: (rank_iv.get(a.interval, -1), rank_path.get(a.path, -1)),
        )

    def _succeeded_intervals(self) -> List[str]:
        found = {a.interval for a in self._cycle_attempts if a.ok and a.rows}
        return [iv for iv in FEED_INTERVALS if iv in found]

    def _upgrade_intervals(self) -> List[str]:
        found = {
            a.interval
            for a in self._cycle_attempts
            if is_upgrade_plan_error(a.cg_code, a.cg_msg) or a.plan_interval
        }
        return [iv for iv in ("30m", "1h", "4h") if iv in found]

    def _reason_for_health(self, snap: Dict[str, Any]) -> str:
        last = self._last_attempt()
        ok = self._succeeded_intervals()
        if snap.get("healthy") and not ok and snap.get("interval"):
            ok = [str(snap.get("interval"))]
        if last is None and not snap.get("healthy"):
            return snap.get("reason") or "no usable funding/OI/liq this cycle"
        secret = load_coinglass_api_key()
        reason = format_coinglass_reason(
            last,
            None,
            upgrade_intervals=self._upgrade_intervals(),
            succeeded_intervals=ok,
        )
        return _redact(reason, secret)

    def _log_cycle_miss(self, snap: Dict[str, Any]) -> None:
        attempts = self._cycle_attempts or self._cycle_misses
        if attempts:
            secret = load_coinglass_api_key()
            for a in attempts:
                logger.warning(
                    f"CoinGlass {a.path} interval={a.interval} "
                    f"http={a.http_status} code={a.cg_code} "
                    f"msg={_snippet(a.cg_msg, secret)}"
                )
            return
        if snap.get("healthy"):
            return
        reason = snap.get("reason") or "no usable funding/OI/liq this cycle"
        logger.warning(
            "CoinGlass miss this cycle — CARRY/CHAIN/CASCADE keep last/Binance "
            f"symbol={self.symbol} exchange={self.exchange} {reason}"
        )

    async def _probe(
        self,
        path: str,
        interval: str,
        limit: int = 24,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> _Fetch:
        headers = self._headers()
        if not headers:
            miss = _Fetch(path=path, interval=interval, reason="key missing")
            self._note_attempt(miss)
            return miss
        base = str(getattr(settings, "COINGLASS_BASE", BASE) or BASE)
        url = f"{base}{path}"
        params: Dict[str, Any] = {
            "exchange": self.exchange,
            "symbol": self.symbol,
            "interval": interval,
            "limit": limit,
        }
        if start_time is not None:
            params["start_time"] = start_time
        if end_time is not None:
            params["end_time"] = end_time
        miss = _Fetch(path=path, interval=interval)
        try:
            r = await self.client.get(url, params=params, headers=headers)
            miss.http_status = r.status_code
            try:
                miss.body = r.text or ""
            except Exception:
                miss.body = ""
            body: Any = {}
            try:
                body = r.json() if getattr(r, "content", None) is not None else {}
            except Exception:
                body = {}
            if not isinstance(body, dict):
                body = {}
            miss.cg_code = body.get("code")
            miss.cg_msg = str(body.get("msg") or body.get("message") or "")
            miss.plan_interval = is_plan_interval_error(miss.cg_code, miss.cg_msg) or is_upgrade_plan_error(
                miss.cg_code, miss.cg_msg
            )
            if r.status_code in (401, 403) and not miss.plan_interval:
                miss.auth_fail = True
                miss.reason = f"auth failed ({r.status_code})"
                self._note_attempt(miss)
                return miss
            if r.status_code >= 400 and not miss.plan_interval:
                miss.reason = f"http {r.status_code}"
                self._note_attempt(miss)
                return miss
            if r.status_code >= 400 and miss.plan_interval:
                miss.reason = f"http {r.status_code} plan/interval"
                self._note_attempt(miss)
                return miss
            code_s = "" if miss.cg_code is None else str(miss.cg_code)
            if code_s not in ("0", "200", ""):
                miss.reason = f"coinglass code={code_s}"
                self._note_attempt(miss)
                return miss
            data = body.get("data")
            if not isinstance(data, list):
                miss.reason = "data not a list"
                self._note_attempt(miss)
                return miss
            rows = [row for row in data if isinstance(row, dict)]
            if not rows:
                miss.reason = "empty data"
                self._note_attempt(miss)
                return miss
            miss.rows = rows
            miss.ok = True
            self._note_attempt(miss)
            return miss
        except Exception as e:
            miss.reason = type(e).__name__
            self._note_attempt(miss)
            return miss

    async def _get_rows(
        self,
        path: str,
        interval: str,
        limit: int = 24,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Hist-safe: returns rows (possibly empty). Miss reason stays on the client."""
        got = await self._probe(
            path, interval, limit=limit, start_time=start_time, end_time=end_time
        )
        return list(got.rows)

    async def _rows_with_interval(self, path: str) -> Tuple[List[Dict[str, Any]], str]:
        order = feed_interval_order(self._interval_ok_by_path.get(path))
        last_iv = order[0] if order else "1h"
        for iv in order:
            last_iv = iv
            got = await self._probe(path, iv)
            if got.ok and got.rows:
                self._interval_ok_by_path[path] = iv
                self._interval_ok = iv
                return got.rows, iv
            if got.auth_fail:
                return [], iv
        return [], last_iv

    def _empty(self, reason: str = "") -> Dict[str, Any]:
        return {
            "source": "coinglass",
            "healthy": False,
            "interval": None,
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
            "reason": reason,
        }

    async def get_derivatives(self) -> Dict[str, Any]:
        self._cycle_misses = []
        self._cycle_attempts = []
        if not self.configured():
            snap = self._empty("key missing")
            self._log_cycle_miss(snap)
            return snap
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
                self._rows_with_interval(PATHS[0]),
                self._rows_with_interval(PATHS[1]),
                self._rows_with_interval(PATHS[2]),
            )
            interval = fund_iv or oi_iv or liq_iv or "1h"
            snap = summarize_derivatives(fund_rows, oi_rows, liq_rows, interval)
            snap["reason"] = self._reason_for_health(snap)
            if snap.get("healthy"):
                self._cache = snap
                self._cache_at = now
            self._log_cycle_miss(snap)
            return snap
        except Exception as e:
            snap = self._empty(f"snapshot fail: {type(e).__name__}")
            self._log_cycle_miss(snap)
            return snap

    async def _hist_rows(
        self,
        path: str,
        start_ms: int,
        end_ms: int,
        limit: int,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Reuse live _get_rows. 30m then 1h. Never 1m."""
        last_iv = "30m"
        for iv in live_interval_order():
            if iv == "1m":
                continue
            last_iv = iv
            rows = await self._get_rows(
                path,
                iv,
                limit=limit,
                start_time=int(start_ms),
                end_time=int(end_ms),
            )
            if rows:
                return rows, iv
        return [], last_iv

    async def get_historical_derivatives(
        self,
        start_ms: int,
        end_ms: int,
        limit: int = 24,
    ) -> Dict[str, Any]:
        """
        Hist funding / OI / liq for a settled hour. Reuses live PATHS + _get_rows.
        Tries 30m then 1h. Never 1m. Empty → skip_reason. Never invents prints.
        Never logs the API key. Does not rewrite live cycle logging / health.
        """
        empty = empty_derivatives("30m")
        if not self.configured():
            empty["skip_reason"] = "no_key"
            empty["reason"] = "key missing"
            return empty
        if start_ms <= 0 or end_ms <= 0 or end_ms <= start_ms:
            empty["skip_reason"] = "bad_window"
            return empty
        saved = list(getattr(self, "_cycle_misses", []) or [])
        self._cycle_misses = []
        try:
            (fund_rows, fund_iv), (oi_rows, oi_iv), (liq_rows, liq_iv) = await asyncio.gather(
                self._hist_rows(PATHS[0], start_ms, end_ms, limit),
                self._hist_rows(PATHS[1], start_ms, end_ms, limit),
                self._hist_rows(PATHS[2], start_ms, end_ms, limit),
            )
            interval = fund_iv or oi_iv or liq_iv or "30m"
            snap = summarize_derivatives(fund_rows, oi_rows, liq_rows, interval)
            snap["feeds"] = {
                "funding": bool(fund_rows),
                "open_interest": bool(oi_rows),
                "liquidations": bool(liq_rows),
            }
            missing = []
            if not fund_rows:
                missing.append("funding")
            if not oi_rows:
                missing.append("open_interest")
            if not liq_rows:
                missing.append("liquidations")
            if missing:
                snap["missing_feeds"] = missing
            if not snap.get("healthy"):
                snap["skip_reason"] = "empty_or_404"
            return snap
        except Exception as e:
            empty["skip_reason"] = "error"
            empty["reason"] = type(e).__name__
            return empty
        finally:
            self._cycle_misses = saved
