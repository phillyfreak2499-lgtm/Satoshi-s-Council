"""
CoinGlass v4 — funding, open interest, liquidations for CARRY / CHAIN / CASCADE.

Key is loaded from env or the Render secret file. Never logged.
Futures on Binance fapi can 451 in Oregon; this feed is the fill-in.
Live windows are 30m then 1h only — never 4h/8h/1d into 1H Chair locks.
Hobbyist plan wall (HTTP 200 / body 401 Upgrade plan) is cached; do not re-probe 30m every cycle.
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
ALLOWED_INTERVALS = ("30m", "1h")  # 1H pack only. Never 1m. Never drop to 4h/8h/1d.
CHAIR_WINDOW_INTERVALS = ("30m", "1h", "60m")
HEATMAP_INTERVALS = ("1d", "24h", "4h", "12h", "1w", "7d", "daily")
PLAN_WALL_REASON = "plan wall: need Startup+ for 30m/1h"
CACHED_401_REASON = "401 · 30m/1h cached"
# Process-wide: BTC + ETH + hist share one latch. Stop re-probing after both windows wall.
_PLAN_WALL: Optional[str] = None
_PLAN_WALL_LOGGED = False
_PLAN_BLOCKED: set[str] = set()
_HTTP_401_BLOCKED: set[str] = set()
PATHS = (
    "/api/futures/funding-rate/history",
    "/api/futures/open-interest/history",
    "/api/futures/liquidation/history",
)  # Hist only. Never a list-endpoint probe — that is not a 1h-window feed.
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
    daily_heatmap = iv in HEATMAP_INTERVALS
    chair_iv = iv in CHAIR_WINDOW_INTERVALS
    has_nums = funding is not None or oi is not None or last_liq is not None
    # Chair-healthy / coinglass_ok: real 30m/1h numbers only. 4h is Hobbyist floor, not a 1H lock.
    healthy = bool(has_nums and chair_iv and not daily_heatmap)
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


def is_chair_window_interval(interval: Any) -> bool:
    return str(interval or "").strip().lower() in CHAIR_WINDOW_INTERVALS


def chair_window_ok(snap: Any) -> bool:
    """True only if a 30m/1h hist actually returned a number. Not 4h. Not exchange-list."""
    if not isinstance(snap, dict):
        return False
    if snap.get("plan_wall") or snap.get("daily_heatmap"):
        return False
    if not is_chair_window_interval(snap.get("interval")):
        return False
    return (
        snap.get("funding_rate") is not None
        or snap.get("open_interest") is not None
        or snap.get("liq_long_usd") is not None
        or snap.get("liq_short_usd") is not None
    )


def apply_hist_to_market(market: Dict[str, Any], cg: Dict[str, Any]) -> Dict[str, Any]:
    """Inject CoinGlass hist fields the live pipeline already uses. Merge, don't wipe."""
    out = dict(market or {})
    if not isinstance(cg, dict):
        return out
    out["coinglass"] = cg
    out["cg_interval"] = cg.get("interval") or out.get("cg_interval") or "30m"
    if not chair_window_ok(cg):
        # 4h / empty / plan wall must not overwrite lock fields.
        out["cg_daily_heatmap"] = False
        return out
    out["funding_rate"] = cg.get("funding_rate")
    out["open_interest"] = cg.get("open_interest")
    out["oi_delta_1h"] = cg.get("oi_delta_1h")
    out["funding_history"] = list(cg.get("funding_history") or [])
    out["oi_history"] = list(cg.get("oi_history") or [])
    out["liq_long_usd"] = cg.get("liq_long_usd")
    out["liq_short_usd"] = cg.get("liq_short_usd")
    out["liq_net_usd"] = cg.get("liq_net_usd")
    out["liq_history"] = list(cg.get("liq_history") or [])
    out["cg_daily_heatmap"] = False
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


def is_plan_wall_body(code: Any, msg: Any, http_status: Any = None) -> bool:
    """Hobbyist wall: HTTP 200 / body 401 Upgrade plan, or interval not allowed. Not HTTP 401 auth."""
    code_s = "" if code is None else str(code)
    msg_s = str(msg or "")
    blob = f"{code_s} {msg_s}".lower()
    if "upgrade plan" in blob:
        return True
    try:
        http_n = int(http_status) if http_status is not None else None
    except (TypeError, ValueError):
        http_n = None
    if http_n == 200 and code_s == "401":
        return True
    return is_plan_interval_error(code, msg)


def reset_plan_wall() -> None:
    """Tests only. Live desk never clears the latch."""
    global _PLAN_WALL, _PLAN_WALL_LOGGED
    _PLAN_WALL = None
    _PLAN_WALL_LOGGED = False
    _PLAN_BLOCKED.clear()
    _HTTP_401_BLOCKED.clear()


def plan_wall_latched() -> Optional[str]:
    return _PLAN_WALL


def latch_plan_wall(reason: Optional[str] = None) -> str:
    """Both 30m and 1h hit the Hobbyist wall or 401. Stop HTTP. Do not invent bars."""
    global _PLAN_WALL
    for iv in ALLOWED_INTERVALS:
        _PLAN_BLOCKED.add(iv)
    _PLAN_WALL = reason or PLAN_WALL_REASON
    return _PLAN_WALL


def note_plan_interval(interval: str, http_401: bool = False) -> Optional[str]:
    """Remember a plan/upgrade/401 miss. Latch only after both live windows wall."""
    iv = str(interval or "").strip().lower()
    if iv not in ALLOWED_INTERVALS:
        return _PLAN_WALL
    _PLAN_BLOCKED.add(iv)
    if http_401:
        _HTTP_401_BLOCKED.add(iv)
    if all(x in _PLAN_BLOCKED for x in ALLOWED_INTERVALS):
        if _HTTP_401_BLOCKED:
            return latch_plan_wall(CACHED_401_REASON)
        return latch_plan_wall()
    return _PLAN_WALL


def interval_plan_blocked(interval: str) -> bool:
    iv = str(interval or "").strip().lower()
    return bool(_PLAN_WALL) or iv in _PLAN_BLOCKED


def coinglass_hud_ok(ok: Any, reason: Any = None) -> bool:
    """HUD Glass light only. Plan wall / 401 Upgrade plan is not-ok. Does not chase the key."""
    if not ok:
        return False
    text = str(reason or "").lower()
    if "401" in text or "upgrade plan" in text or "upgrade" in text or "plan wall" in text:
        return False
    if "4h" in text or "8h" in text or "exchange-list" in text or "exchange list" in text:
        return False
    return True


def apply_coinglass_health(health: Dict[str, Any], cg: Any) -> Dict[str, Any]:
    """CoinGlass health only. Binance funding/OI last-print must not flip this."""
    out = health if isinstance(health, dict) else {}
    snap = cg if isinstance(cg, dict) else {}
    reason = str(snap.get("reason") or snap.get("coinglass_reason") or "")
    if (
        _PLAN_WALL
        or snap.get("plan_wall")
        or "plan wall" in reason.lower()
        or "401" in reason.lower()
    ):
        out["coinglass"] = False
        if _PLAN_WALL:
            out["coinglass_reason"] = _PLAN_WALL
        elif "401" in reason.lower() and "plan wall" not in reason.lower():
            out["coinglass_reason"] = reason or CACHED_401_REASON
        else:
            out["coinglass_reason"] = PLAN_WALL_REASON
        return out
    ok = chair_window_ok(snap)
    if not coinglass_hud_ok(ok, reason):
        out["coinglass"] = False
        if not reason:
            reason = "no usable funding/OI/liq this cycle"
        out["coinglass_reason"] = reason
        return out
    out["coinglass"] = True
    out["coinglass_reason"] = reason or None
    return out


def glass_seats_must_wait(market_data: Any = None) -> bool:
    """
    CARRY/CHAIN/CASCADE sit WAIT while Glass is dark.
    401 / plan wall / 4h / BTC 15m / missing chair window — never Binance-as-live.
    """
    md = market_data if isinstance(market_data, dict) else {}
    try:
        from backend.learning.btc15m import (
            is_btc_15m_series,
            is_btc_15m_ticker,
            is_15m_window,
        )
        ticker = md.get("ticker") or md.get("kalshi_ticker") or md.get("market_ticker")
        series = md.get("series_ticker")
        window = md.get("window_minutes")
        # Ticker/series/window identify the 15m book. Bare asset=btc is not enough —
        # 1H display fixtures still tag asset=btc.
        if is_btc_15m_ticker(ticker) or is_btc_15m_series(series):
            return True
        if is_15m_window(window, ticker, series, None):
            return True
    except Exception:
        pass
    if plan_wall_latched():
        return True
    health = md.get("health") if isinstance(md.get("health"), dict) else {}
    if health.get("coinglass") is False:
        return True
    cg = md.get("coinglass") if isinstance(md.get("coinglass"), dict) else {}
    if cg.get("plan_wall") or cg.get("daily_heatmap"):
        return True
    reason = str(health.get("coinglass_reason") or cg.get("reason") or "")
    low = reason.lower()
    if "401" in low or "plan wall" in low or "upgrade" in low:
        return True
    iv = str(cg.get("interval") or md.get("cg_interval") or "").strip().lower()
    if iv in HEATMAP_INTERVALS:
        return True
    if cg and not chair_window_ok(cg) and (
        cg.get("healthy") is False or bool(cg.get("reason"))
    ):
        return True
    return False


def live_interval_order(cached_ok: Optional[str] = None) -> List[str]:
    """30m then 1h. Never 1m. A known-good interval may lead later cycles."""
    order = [iv for iv in ALLOWED_INTERVALS if iv != "1m"]
    cached = str(cached_ok or "").strip().lower()
    if cached in ALLOWED_INTERVALS and cached != "1m":
        order = [cached] + [iv for iv in order if iv != cached]
    return order


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
        self._cycle_misses: List[_Fetch] = []
        self._plan_wall_logged: bool = False

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

    def _note_miss(self, miss: _Fetch) -> None:
        key = (miss.path, miss.interval)
        if any((m.path, m.interval) == key for m in self._cycle_misses):
            return
        self._cycle_misses.append(miss)

    def _format_miss(self, miss: _Fetch) -> str:
        secret = load_coinglass_api_key()
        msg = _snippet(miss.cg_msg, secret)
        body = _snippet(miss.body, secret)
        return (
            f"path={miss.path} interval={miss.interval} "
            f"symbol={self.symbol} exchange={self.exchange} "
            f"http={miss.http_status} code={miss.cg_code} msg={msg} body={body}"
        )

    def _wall(self) -> Optional[str]:
        return plan_wall_latched()

    @property
    def _plan_wall(self) -> Optional[str]:
        return self._wall()

    def _plan_wall_snap(self) -> Dict[str, Any]:
        snap = self._empty(self._wall() or PLAN_WALL_REASON)
        snap["plan_wall"] = True
        snap["daily_heatmap"] = False
        snap["interval"] = None
        return snap

    def _mark_plan_wall(self) -> None:
        global _PLAN_WALL_LOGGED
        if not self._wall():
            latch_plan_wall()
        if _PLAN_WALL_LOGGED or self._plan_wall_logged:
            return
        _PLAN_WALL_LOGGED = True
        self._plan_wall_logged = True
        logger.warning(
            "CoinGlass plan wall — " + (self._wall() or PLAN_WALL_REASON)
            + " · stop re-probing 30m/1h · CARRY/CHAIN/CASCADE sit WAIT · no 4h heatmap into 1H locks"
        )

    def _note_plan_interval(self, interval: str, *, http_401: bool = False) -> None:
        if note_plan_interval(interval, http_401=http_401):
            self._mark_plan_wall()

    def _reason_for_health(self, snap: Dict[str, Any]) -> str:
        if self._wall():
            return self._wall() or PLAN_WALL_REASON
        if snap.get("healthy") and not self._cycle_misses:
            return ""
        if snap.get("healthy") and self._cycle_misses:
            first = self._cycle_misses[0]
            used = snap.get("interval") or self._interval_ok or "1h"
            secret = load_coinglass_api_key()
            return (
                f"{first.interval} rejected (code={first.cg_code} "
                f"msg={_snippet(first.cg_msg, secret)}); using {used}"
            )
        if self._cycle_misses:
            return self._format_miss(self._cycle_misses[0])
        return "no usable funding/OI/liq this cycle"

    def _log_cycle_miss(self, snap: Dict[str, Any]) -> None:
        if self._cycle_misses:
            parts = [self._format_miss(m) for m in self._cycle_misses]
            logger.warning(
                "CoinGlass miss this cycle — CARRY/CHAIN/CASCADE sit WAIT "
                + " || ".join(parts)
            )
            return
        if snap.get("healthy"):
            return
        reason = snap.get("reason") or "no usable funding/OI/liq this cycle"
        logger.warning(
            "CoinGlass miss this cycle — CARRY/CHAIN/CASCADE sit WAIT "
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
        if self._wall() or interval_plan_blocked(interval):
            return _Fetch(
                path=path,
                interval=interval,
                reason=self._wall() or PLAN_WALL_REASON,
                plan_interval=True,
            )
        iv = str(interval or "").strip().lower()
        if iv not in ALLOWED_INTERVALS:
            return _Fetch(
                path=path,
                interval=interval,
                reason="not a 1h-window interval",
            )
        headers = self._headers()
        if not headers:
            miss = _Fetch(path=path, interval=interval, reason="key missing")
            self._note_miss(miss)
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
            miss.plan_interval = is_plan_wall_body(miss.cg_code, miss.cg_msg, r.status_code)
            if r.status_code in (401, 403):
                miss.auth_fail = True
                miss.plan_interval = True
                miss.reason = f"auth failed ({r.status_code})"
                self._note_miss(miss)
                return miss
            if r.status_code >= 400:
                miss.reason = f"http {r.status_code}"
                self._note_miss(miss)
                return miss
            code_s = "" if miss.cg_code is None else str(miss.cg_code)
            if code_s not in ("0", "200", ""):
                miss.reason = f"coinglass code={code_s}"
                self._note_miss(miss)
                return miss
            data = body.get("data")
            if not isinstance(data, list):
                miss.reason = "data not a list"
                self._note_miss(miss)
                return miss
            rows = [row for row in data if isinstance(row, dict)]
            if not rows:
                miss.reason = "empty data"
                self._note_miss(miss)
                return miss
            miss.rows = rows
            miss.ok = True
            return miss
        except Exception as e:
            miss.reason = type(e).__name__
            self._note_miss(miss)
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
        if got.plan_interval:
            self._note_plan_interval(
                interval,
                http_401=bool(got.auth_fail and got.http_status in (401, 403)),
            )
        return list(got.rows)

    async def _rows_with_interval(self, path: str) -> Tuple[List[Dict[str, Any]], str]:
        if self._wall():
            return [], "30m"
        order = live_interval_order(self._interval_ok)
        last_iv = order[0] if order else "30m"
        for iv in order:
            last_iv = iv
            if interval_plan_blocked(iv):
                continue
            got = await self._probe(path, iv)
            if got.ok and got.rows:
                self._interval_ok = iv
                return got.rows, iv
            if got.plan_interval:
                self._note_plan_interval(
                    iv,
                    http_401=bool(got.auth_fail and got.http_status in (401, 403)),
                )
            if self._wall():
                return [], iv
        if all(interval_plan_blocked(x) for x in ALLOWED_INTERVALS):
            self._mark_plan_wall()
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
        if self._wall():
            return self._plan_wall_snap()
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
            if self._wall():
                snap = self._plan_wall_snap()
                if self._cycle_misses:
                    self._log_cycle_miss(snap)
                return snap
            interval = fund_iv or oi_iv or liq_iv or "30m"
            snap = summarize_derivatives(fund_rows, oi_rows, liq_rows, interval)
            snap["reason"] = self._reason_for_health(snap)
            if snap.get("healthy"):
                self._cache = snap
                self._cache_at = now
                if self._cycle_misses:
                    self._log_cycle_miss(snap)
            else:
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
        """Reuse live _get_rows. 30m then 1h. Never 1m. Never 4h."""
        if self._wall():
            return [], "30m"
        last_iv = "30m"
        for iv in live_interval_order():
            if iv == "1m":
                continue
            if interval_plan_blocked(iv):
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
        if self._wall():
            empty["skip_reason"] = "plan_wall"
            empty["reason"] = self._wall() or PLAN_WALL_REASON
            empty["plan_wall"] = True
            return empty
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
