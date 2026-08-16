"""
90-day Kalshi seat backfill — fill brains with settled 1h tape the bot never sat.

Paper only. No live orders. No Follower. Does not write Chair lock rows
(displayed hit-rate stays put). Merges into the live AdaptiveLearner brain
under DATA_DIR (`council-learning-{btc,eth}.json`). One pass, then persist.

Official `market.result` only. Missing result → skip that hour. Kalshi 429 →
back off and skip that hour. Do not impute holes (W27–W30 stays empty).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from loguru import logger

from backend.agents.candle import BitcoinPatternSpecialist, EthereumPatternSpecialist
from backend.agents.chair_gates import (
    collect_official_results,
    lock_time_strike,
    official_y_finish,
    pattern_specialist_name,
    strike_from_kalshi_ticker,
    ticker_asset,
)
from backend.agents.cheap import CheapSpecialist
from backend.agents.exhaust import ExhaustSpecialist
from backend.agents.funding import FundingSpecialist
from backend.agents.liq import LiqSpecialist
from backend.agents.momentum import MomentumSpecialist
from backend.agents.odds import OddsSpecialist
from backend.agents.oi_pressure import OIPressureSpecialist
from backend.agents.session_tod import SessionTodSpecialist
from backend.agents.strike import StrikeSpecialist
from backend.agents.volatility import VolatilitySpecialist
from backend.agents.volume import VolumeSpecialist
from backend.config import settings
from backend.data.coinglass import (
    apply_hist_to_market,
    empty_derivatives,
    feeds_present,
)
from backend.learning.adaptive import AdaptiveLearner
from backend.learning.regime_keys import regime_from_call
from backend.services.huddle import PRUNE_DAYS

ET = ZoneInfo("America/New_York")
UTC = timezone.utc

# Same prune window as nightly huddle. Do not widen.
BACKFILL_DAYS = int(PRUNE_DAYS)
BACKFILL_TAG = "backfill"
SERIES_BTC = "KXBTCD"
SERIES_ETH = "KXETHD"
BACKFILL_SERIES = (SERIES_BTC, SERIES_ETH)

# Seats that can vote from historical 1m candles + strike + clock. No live book.
CANDLE_SEATS: Tuple[str, ...] = (
    "candle",       # WICK
    "momentum",     # DRIFT
    "volume",       # PULSE
    "strike",       # STRIKE
    "odds",         # ODDS
    "session_tod",  # CLOCK
    "cheap",        # CHEAP
    "exhaust",      # EXHAUST
    "volatility",   # VOLT
)
# Same CoinGlass client as live. Grade only when that hist feed answered.
COINGLASS_SEATS: Tuple[str, ...] = (
    "funding",      # CARRY ← funding
    "oi_pressure",  # CHAIN ← open interest / OI change
    "liq",          # CASCADE ← liquidations
)
REBUILDABLE_SEATS: Tuple[str, ...] = CANDLE_SEATS + COINGLASS_SEATS
REBUILDABLE_CALLSIGNS = {
    "candle": "WICK",
    "momentum": "DRIFT",
    "volume": "PULSE",
    "strike": "STRIKE",
    "odds": "ODDS",
    "session_tod": "CLOCK",
    "cheap": "CHEAP",
    "exhaust": "EXHAUST",
    "volatility": "VOLT",
    "funding": "CARRY",
    "oi_pressure": "CHAIN",
    "liq": "CASCADE",
}
COINGLASS_FEED_TO_SEAT = {
    "funding": "CARRY",
    "open_interest": "CHAIN",
    "liquidations": "CASCADE",
}
# Live-book seats we still do not have hist for.
SKIP_SEATS: Dict[str, str] = {
    "orderflow": "TAPE depth needs a live book",
    "whale": "WHALE needs a live tape",
}
SKIP_CALLSIGNS = {"orderflow": "TAPE", "whale": "WHALE"}
LIVE_ONLY_SEATS = tuple(SKIP_SEATS.keys())
CG_LOOKBACK_HOURS = 8
CG_HIST_LIMIT = 12

STATUS_NAME = "seat-backfill-status.json"
DONE_NAME = "seat-backfill.done"
MARKER_ENV = "SEAT_BACKFILL_ONCE"
RATE_LIMIT = "rate_limit"
SNAPSHOT_MINS_INTO_HOUR = 20.0  # after the 10m no-lock; not the close print
CANDLE_LOOKBACK_MIN = 90
KALSHI_429_SLEEP_S = 12.0


class KalshiHourSkip(Exception):
    """Skip this hour. Never invent a finish."""

    def __init__(self, reason: str, hour: str | None = None):
        self.reason = reason
        self.hour = hour
        super().__init__(reason)


def data_dir() -> Path:
    root = Path(getattr(settings, "DATA_DIR", None) or (Path(__file__).resolve().parents[2] / "data"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def status_path(root: Path | None = None) -> Path:
    return (root or data_dir()) / STATUS_NAME


def done_path(root: Path | None = None) -> Path:
    return (root or data_dir()) / DONE_NAME


def backfill_contract() -> Dict[str, Any]:
    """Live-run contract. Printed by CLI / admin / PR body."""
    return {
        "days": BACKFILL_DAYS,
        "window": f"last {BACKFILL_DAYS} days (same prune window as huddle)",
        "series": [SERIES_ETH],
        "assets": ["eth"],
        "seats_rebuilt": [REBUILDABLE_CALLSIGNS[k] for k in REBUILDABLE_SEATS],
        "seats_rebuilt_keys": list(REBUILDABLE_SEATS),
        "seats_skipped": [
            {"key": k, "callsign": SKIP_CALLSIGNS[k], "why": why}
            for k, why in SKIP_SEATS.items()
        ],
        "coinglass": {
            "base": "https://open-api-v4.coinglass.com",
            "header": "CG-API-KEY",
            "key_load": "env COINGLASS_API_KEY first, else /etc/secrets/COINGLASS_API_KEY",
            "key_in_git": False,
            "seats": ["CARRY", "CHAIN", "CASCADE"],
            "map": dict(COINGLASS_FEED_TO_SEAT),
            "interval_order": ["30m", "1h"],
            "never": "1m",
            "optional": True,
            "blocks_candle_replay": False,
            "reuses_live_client": True,
        },
        "official_result_only": True,
        "impute_missing_result": False,
        "impute_429": False,
        "tag": BACKFILL_TAG,
        "merge": True,
        "wipe_live_brain": False,
        "paper": True,
        "follower": False,
        "live_orders": False,
        "law_lock": "untouched",
        "chair_gates": "untouched",
        "displayed_hit_rate": "untouched — no window_calls written",
        "brain_files": ["council-learning-btc.json", "council-learning-eth.json"],
        "persist_under": "DATA_DIR only (not git)",
        "trigger": {
            "boot_once": f"DATA_DIR/{DONE_NAME} missing and {MARKER_ENV}!=0",
            "admin": "POST /api/admin/seat-backfill",
            "cli": "python -m backend.learning.seat_backfill",
        },
    }


def print_contract(report: Dict[str, Any] | None = None) -> str:
    c = backfill_contract()
    lines = [
        "90-day Kalshi seat backfill",
        f"Days pulled: {c['days']} (huddle prune window)",
        f"Series: {', '.join(c['series'])} (ETH 1H only — BTC 15m is a separate pass)",
        f"Seats rebuilt: {', '.join(c['seats_rebuilt'])}",
        "Seats skipped: TAPE (live book), WHALE (live tape)",
        "CoinGlass hist: CARRY (funding), CHAIN (OI), CASCADE (liq) — 30m then 1h, never 1m.",
        "Grade when the feed answers. Empty hist does not block WICK/DRIFT/PULSE/STRIKE/ODDS/CLOCK/CHEAP/EXHAUST/VOLT.",
        "Official market.result only. Missing result → skip hour. 429 → backoff + skip hour.",
        "Merge into live council-learning-{btc,eth}.json. Tag: backfill. Do not wipe.",
        "No window_calls (hit-rate untouched). Paper. Follower OFF. No live orders. LAW LOCK untouched.",
        f"Trigger: boot-once ({c['trigger']['boot_once']}); {c['trigger']['admin']}; {c['trigger']['cli']}",
    ]
    if report:
        lines.append(
            f"This pass: hours_graded={report.get('hours_graded')} "
            f"skipped_no_result={report.get('hours_skipped_no_result')} "
            f"skipped_429={report.get('hours_skipped_429')} "
            f"assets={report.get('assets')}"
        )
        cg = report.get("coinglass") if isinstance(report.get("coinglass"), dict) else {}
        samples = cg.get("seats_with_samples") or []
        lines.append(
            f"CoinGlass samples: {', '.join(samples) if samples else 'none'} "
            f"feeds={cg.get('feeds')}"
        )
    text = "\n".join(lines)
    print(text)
    return text


def event_ticker_for_hour(series: str, hour_et: datetime) -> str:
    """KXBTCD + 2026-08-14 15:00 ET → KXBTCD-26AUG1415."""
    local = hour_et.astimezone(ET)
    mon = local.strftime("%b").upper()
    return f"{series}-{local.strftime('%y')}{mon}{local.strftime('%d%H')}"


def hour_slots(days: int = BACKFILL_DAYS, now: datetime | None = None) -> List[datetime]:
    """Closed 1h ET windows in the last `days`. Oldest first. Current hour excluded."""
    n = int(days)
    if n != BACKFILL_DAYS:
        # Tests may pass 90 explicitly; refuse a wider live window.
        n = min(n, BACKFILL_DAYS)
    now_et = (now or datetime.now(UTC)).astimezone(ET).replace(minute=0, second=0, microsecond=0)
    start = now_et - timedelta(days=n)
    out: List[datetime] = []
    cur = start
    while cur < now_et:
        out.append(cur)
        cur = cur + timedelta(hours=1)
    return out


def series_for_asset(asset: str) -> str:
    return SERIES_ETH if (asset or "").lower() == "eth" else SERIES_BTC


def asset_for_series(series: str) -> str:
    return "eth" if str(series).upper().startswith("KXETH") else "btc"


def is_rebuildable_seat(name: str) -> bool:
    n = str(name or "")
    if n in ("candle", "candle_btc", "candle_eth"):
        return True
    return n in REBUILDABLE_SEATS


def is_live_only_seat(name: str) -> bool:
    return str(name or "") in LIVE_ONLY_SEATS


def is_coinglass_seat(name: str) -> bool:
    return str(name or "") in COINGLASS_SEATS


def callsigns_from_feeds(feeds: Dict[str, Any] | None) -> List[str]:
    out: List[str] = []
    for feed, callsign in COINGLASS_FEED_TO_SEAT.items():
        if (feeds or {}).get(feed):
            out.append(callsign)
    return out


def _cg_seat_allowed(name: str, feeds: Dict[str, bool] | None) -> bool:
    """CARRY/CHAIN/CASCADE vote only when that hist feed returned bars."""
    if name not in COINGLASS_SEATS:
        return True
    feeds = feeds or {}
    if name == "funding":
        return bool(feeds.get("funding"))
    if name == "oi_pressure":
        return bool(feeds.get("open_interest"))
    if name == "liq":
        return bool(feeds.get("liquidations"))
    return False


def merge_feeds(*rows: Dict[str, bool] | None) -> Dict[str, bool]:
    out = {"funding": False, "open_interest": False, "liquidations": False}
    for row in rows:
        for key in out:
            if (row or {}).get(key):
                out[key] = True
    return out


def filter_rebuildable_votes(votes: Dict[str, Any] | None) -> Dict[str, Any]:
    """Drop live-only / non-rebuildable seats. Never invent a vote."""
    out: Dict[str, Any] = {}
    for name, vote in (votes or {}).items():
        if not is_rebuildable_seat(name):
            continue
        if not isinstance(vote, dict):
            continue
        out[name] = vote
    return out


def reconstructed_yes_mid(spot: Any, strike: Any) -> Optional[float]:
    """
    Offline YES mid from spot vs strike at the snapshot.
    Never uses official result (that would be lookahead). None if we cannot score.
    """
    try:
        px = float(spot)
        st = float(strike)
    except (TypeError, ValueError):
        return None
    if px <= 0 or st <= 0:
        return None
    dist_pct = (px - st) / st
    mid = 50.0 + dist_pct * 5000.0
    return max(8.0, min(92.0, mid))


def snapshot_close_and_spot(
    close_time: datetime,
    candles: List[Dict[str, Any]],
) -> Tuple[datetime, Optional[float]]:
    """Vote snapshot: 20 minutes into the hour. Spot from the last 1m close at/before then."""
    snap = close_time - timedelta(minutes=60.0 - SNAPSHOT_MINS_INTO_HOUR)
    spot = None
    for c in candles:
        try:
            t = int(c.get("open_time") or c.get("close_time") or 0)
        except (TypeError, ValueError):
            continue
        ts = datetime.fromtimestamp(t / 1000.0, tz=UTC) if t > 10_000_000_000 else datetime.fromtimestamp(t, tz=UTC)
        if ts <= snap:
            try:
                spot = float(c.get("close") or 0) or spot
            except (TypeError, ValueError):
                pass
    if spot is None and candles:
        try:
            spot = float(candles[-1].get("close") or 0) or None
        except (TypeError, ValueError):
            spot = None
    return snap, spot


def pick_atm_with_official_result(
    markets: List[Dict[str, Any]],
    spot: Optional[float],
) -> Optional[Dict[str, Any]]:
    """Nearest-to-spot strike that already has an official yes/no. No impute."""
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for m in markets or []:
        if not isinstance(m, dict):
            continue
        if not official_y_finish(m):
            continue
        strike = lock_time_strike(ticker=m.get("ticker"), kalshi_result=m)
        if strike is None:
            continue
        dist = abs(float(strike) - float(spot)) if spot else 0.0
        scored.append((dist, m))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0])
    return scored[0][1]


def _as_utc(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
    text = str(raw).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except Exception:
        return None


def build_market_data(
    *,
    candles: List[Dict[str, Any]],
    spot: Optional[float],
    strike: Optional[float],
    ticker: str,
    close_time: datetime,
    as_of: datetime,
    up_pct: Optional[float],
) -> Dict[str, Any]:
    mins_left = max(0.0, (close_time - as_of).total_seconds() / 60.0)
    return {
        "candles": candles,
        "current_price": spot,
        "price": spot,
        "kalshi_floor_strike": strike,
        "kalshi_target": strike,
        "kalshi_market": {"ticker": ticker, "close_time": close_time.isoformat()},
        "close_time": close_time.isoformat(),
        "ticker": ticker,
        "asset": ticker_asset(ticker) or ("eth" if "ETH" in str(ticker).upper() else "btc"),
        "mins_left": mins_left,
        "up_pct": up_pct,
        "kalshi_yes_bid": up_pct,
        "as_of": as_of,
        "now": as_of,
        "wm": {"phase": "entry"},
        "phase": "entry",
    }


def _agent_factory(asset: str | None = None) -> Dict[str, Any]:
    book = "eth" if str(asset or "").lower() == "eth" else "btc"
    pattern_key = pattern_specialist_name(book)
    pattern_cls = EthereumPatternSpecialist if book == "eth" else BitcoinPatternSpecialist
    return {
        pattern_key: pattern_cls,
        "momentum": MomentumSpecialist,
        "volume": VolumeSpecialist,
        "strike": StrikeSpecialist,
        "odds": OddsSpecialist,
        "session_tod": SessionTodSpecialist,
        "cheap": CheapSpecialist,
        "exhaust": ExhaustSpecialist,
        "volatility": VolatilitySpecialist,
        "funding": FundingSpecialist,
        "oi_pressure": OIPressureSpecialist,
        "liq": LiqSpecialist,
    }


async def vote_rebuildable_seats(
    market_data: Dict[str, Any],
    *,
    cg_feeds: Dict[str, bool] | None = None,
) -> Dict[str, Any]:
    """Run offline seats. CoinGlass seats only when that hist feed answered."""
    votes: Dict[str, Any] = {}
    book = ticker_asset((market_data or {}).get("ticker")) or (market_data or {}).get("asset")
    for name, cls in _agent_factory(book).items():
        if not is_rebuildable_seat(name):
            continue
        if not _cg_seat_allowed(name, cg_feeds):
            continue
        agent = cls()
        try:
            sig = await agent.get_signal(market_data)
        except Exception as e:
            logger.debug(f"backfill {name} skip: {e}")
            continue
        if sig is None:
            continue
        d = sig.to_dict() if hasattr(sig, "to_dict") else {}
        d["source"] = BACKFILL_TAG
        votes[name] = d
    return filter_rebuildable_votes(votes)


async def fetch_historical_coinglass(
    start_ms: int,
    end_ms: int,
    *,
    client: Any = None,
    symbol: str | None = None,
    limit: int = CG_HIST_LIMIT,
) -> Dict[str, Any]:
    """
    Same CoinGlassClient as live. 404 / no key / flap → empty. Never invents.
    Never logs the API key.
    """
    empty = empty_derivatives("1h")
    cg = client
    own = False
    try:
        if cg is None:
            from backend.data.coinglass import CoinGlassClient
            from backend.data.secrets import load_coinglass_api_key
            if not load_coinglass_api_key():
                empty["skip_reason"] = "no_key"
                return empty
            cg = CoinGlassClient(symbol=symbol)
            own = True
        getter = getattr(cg, "get_historical_derivatives", None)
        if not callable(getter):
            empty["skip_reason"] = "no_client"
            return empty
        snap = await getter(start_ms, end_ms, limit=limit)
        return snap if isinstance(snap, dict) else empty
    except Exception as e:
        logger.debug(f"CoinGlass hist skip: {type(e).__name__}")
        empty["skip_reason"] = "error"
        return empty
    finally:
        if own and cg is not None and hasattr(cg, "close"):
            try:
                await cg.close()
            except Exception:
                pass


def merge_backfill_into_learner(
    learner: AdaptiveLearner,
    votes: Dict[str, Any],
    outcome: str,
    *,
    regime: str | None = None,
    ticker: str | None = None,
) -> Dict[str, Any]:
    """
    Grade rebuildable votes into the *existing* brain. Does not reset weights.
    count_as_lock=False so Chair lock_n / displayed hit-rate stay alone.
    """
    if outcome not in ("UP", "DOWN"):
        return {"graded": 0, "skipped": "no_official_result"}
    clean = filter_rebuildable_votes(votes)
    if not clean:
        return {"graded": 0, "skipped": "no_rebuildable_votes"}
    graded = learner.learn_from_settled(
        clean,
        outcome,
        regime=regime,
        credit=1.0,
        count_as_lock=False,
        source=BACKFILL_TAG,
    )
    learner.note_backfill_hour(ticker=ticker, seats=list(clean.keys()), outcome=outcome)
    return graded or {"graded": 0}


def boot_once_enabled() -> bool:
    raw = str(os.environ.get(MARKER_ENV, "1")).strip().lower()
    return raw not in ("0", "false", "off", "no")


def already_done(root: Path | None = None) -> bool:
    return done_path(root).is_file()


def mark_done(root: Path | None = None, report: Dict[str, Any] | None = None) -> None:
    path = done_path(root)
    payload = {
        "tag": BACKFILL_TAG,
        "at": datetime.now(UTC).isoformat(),
        "hours_graded": (report or {}).get("hours_graded"),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_status(root: Path | None = None) -> Dict[str, Any]:
    path = status_path(root)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_status(data: Dict[str, Any], root: Path | None = None) -> None:
    path = status_path(root)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _is_rate_limit(err: BaseException) -> bool:
    status = getattr(getattr(err, "response", None), "status_code", None)
    if status == 429:
        return True
    name = type(err).__name__
    text = str(err).lower()
    return status == 429 or "429" in text or "kalshi_backoff" in text or name in ("HTTPStatusError",) and "429" in text


async def fetch_event_official(
    client: Any,
    event_ticker: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Official Kalshi event body. Returns (payload, skip_reason).
    429 → ('rate_limit'). Empty / no result is the caller's skip.
    """
    if not event_ticker or client is None:
        return None, "no_client"
    getter = getattr(client, "_get_json", None)
    url = f"{getattr(client, 'base', '')}/events/{event_ticker}"
    try:
        if callable(getter):
            data = await getter(url)
        else:
            data = await client.get_event(event_ticker)
    except Exception as e:
        if _is_rate_limit(e):
            return None, RATE_LIMIT
        logger.debug(f"backfill event {event_ticker}: {type(e).__name__}")
        return None, "fetch_error"
    if not isinstance(data, dict) or not data:
        return None, "empty_event"
    return data, None


async def fetch_historical_candles(
    symbol: str,
    start_ms: int,
    end_ms: int,
    *,
    client: Any = None,
    http_get: Callable | None = None,
) -> List[Dict[str, Any]]:
    """
    Same spot stack the desk uses: data-api.binance.vision → api.binance.us
    → Coinbase BTC-USD / ETH-USD. Empty list on miss — do not invent bars.
    """
    if client is not None and hasattr(client, "get_historical_klines"):
        try:
            rows = await client.get_historical_klines(start_ms, end_ms)
            if rows:
                return list(rows)
        except Exception as e:
            logger.debug(f"hist klines client: {e}")
    from backend.data.binance import coinbase_product_for_symbol, spot_source_from_base

    bases = [
        "https://data-api.binance.vision",
        "https://api.binance.us",
    ]
    params = {
        "symbol": symbol,
        "interval": "1m",
        "startTime": int(start_ms),
        "endTime": int(end_ms),
        "limit": 1000,
    }

    async def _get(url: str, q: dict) -> Any:
        if http_get:
            return await http_get(url, q)
        import httpx
        timeout = httpx.Timeout(float(getattr(settings, "HTTP_TIMEOUT", 8.0)), connect=4.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as http:
            r = await http.get(url, params=q)
            r.raise_for_status()
            return r.json()

    last_err = None
    for base in bases:
        try:
            raw = await _get(f"{base}/api/v3/klines", params)
            candles = []
            for row in raw or []:
                candles.append({
                    "open_time": int(row[0]),
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]),
                    "close_time": int(row[6]),
                    "spot_source": spot_source_from_base(base),
                })
            if candles:
                return candles
        except Exception as e:
            last_err = e
            continue
    product = coinbase_product_for_symbol(symbol)
    try:
        start_iso = datetime.fromtimestamp(start_ms / 1000.0, tz=UTC).isoformat()
        end_iso = datetime.fromtimestamp(end_ms / 1000.0, tz=UTC).isoformat()
        raw = await _get(
            f"https://api.exchange.coinbase.com/products/{product}/candles",
            {"granularity": 60, "start": start_iso, "end": end_iso},
        )
        candles = []
        for row in reversed(list(raw or [])):
            t, low, high, o, c, vol = row
            candles.append({
                "open_time": int(t) * 1000,
                "open": float(o),
                "high": float(high),
                "low": float(low),
                "close": float(c),
                "volume": float(vol),
                "close_time": int(t) * 1000 + 59999,
                "spot_source": "coinbase",
            })
        return candles
    except Exception as e:
        logger.debug(f"hist klines failed vision/us ({last_err}); coinbase: {e}")
        return []


async def grade_one_hour(
    *,
    series: str,
    hour_et: datetime,
    learner: AdaptiveLearner,
    kalshi: Any,
    candle_symbol: str,
    already: set[str] | None = None,
    fetch_event: Callable | None = None,
    fetch_candles: Callable | None = None,
    fetch_coinglass: Callable | None = None,
    coinglass: Any = None,
) -> Dict[str, Any]:
    """
    One settled hour → rebuildable votes → merge into learner.
    Skip (do not fake) on missing official result, 429, or missing candles.
    CoinGlass hist is optional — 404 / no key never blocks candle seats.
    """
    event = event_ticker_for_hour(series, hour_et)
    if already and event in already:
        return {"status": "skip", "reason": "already_graded", "event": event}

    closer = hour_et.astimezone(ET).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    close_utc = closer.astimezone(UTC)

    fn_event = fetch_event or (lambda ev: fetch_event_official(kalshi, ev))
    payload, skip = await fn_event(event)
    if skip == RATE_LIMIT:
        await asyncio.sleep(KALSHI_429_SLEEP_S)
        return {"status": "skip", "reason": RATE_LIMIT, "event": event}
    if skip or not payload:
        return {"status": "skip", "reason": skip or "empty_event", "event": event}

    pulled = collect_official_results(payload)
    if not pulled:
        return {"status": "skip", "reason": "no_official_result", "event": event}

    snap_end = close_utc - timedelta(minutes=60.0 - SNAPSHOT_MINS_INTO_HOUR)
    start_ms = int((snap_end - timedelta(minutes=CANDLE_LOOKBACK_MIN)).timestamp() * 1000)
    end_ms = int(snap_end.timestamp() * 1000)
    fn_candles = fetch_candles or (
        lambda: fetch_historical_candles(candle_symbol, start_ms, end_ms)
    )
    candles = await fn_candles()
    if not candles:
        return {"status": "skip", "reason": "no_candles", "event": event}

    as_of, spot = snapshot_close_and_spot(close_utc, candles)
    market = pick_atm_with_official_result(list(pulled.values()), spot)
    if market is None:
        return {"status": "skip", "reason": "no_official_result", "event": event}

    y = official_y_finish(market)
    if y not in ("UP", "DOWN"):
        return {"status": "skip", "reason": "no_official_result", "event": event}

    ticker = str(market.get("ticker") or event)
    strike = lock_time_strike(ticker=ticker, kalshi_result=market) or strike_from_kalshi_ticker(ticker)
    last_px = None
    try:
        raw_last = market.get("last_price")
        if raw_last is not None:
            lp = float(raw_last)
            if lp <= 1.0:
                lp *= 100.0
            if 10.0 < lp < 90.0:
                last_px = lp
    except (TypeError, ValueError):
        last_px = None
    up_pct = last_px if last_px is not None else reconstructed_yes_mid(spot, strike)

    md = build_market_data(
        candles=candles,
        spot=spot,
        strike=strike,
        ticker=ticker,
        close_time=close_utc,
        as_of=as_of,
        up_pct=up_pct,
    )
    cg_start = int((snap_end - timedelta(hours=CG_LOOKBACK_HOURS)).timestamp() * 1000)
    cg_end = int(snap_end.timestamp() * 1000)
    cg_snap = empty_derivatives("1h")
    try:
        if fetch_coinglass is not None:
            cg_snap = await fetch_coinglass(cg_start, cg_end)
        elif coinglass is not None:
            cg_snap = await fetch_historical_coinglass(
                cg_start, cg_end, client=coinglass, symbol=candle_symbol
            )
        else:
            cg_snap = empty_derivatives("1h")
            cg_snap["skip_reason"] = "no_client"
    except Exception as e:
        logger.debug(f"CoinGlass hist skip: {type(e).__name__}")
        cg_snap = empty_derivatives("1h")
        cg_snap["skip_reason"] = "error"
    if not isinstance(cg_snap, dict):
        cg_snap = empty_derivatives("1h")
        cg_snap["skip_reason"] = "error"
    md = apply_hist_to_market(md, cg_snap)
    cg_feeds = feeds_present(cg_snap)
    votes = await vote_rebuildable_seats(md, cg_feeds=cg_feeds)
    directional = {
        k: v for k, v in votes.items()
        if isinstance(v, dict) and v.get("direction") in ("UP", "DOWN")
    }
    if not directional:
        return {
            "status": "skip",
            "reason": "no_directional_votes",
            "event": event,
            "ticker": ticker,
            "coinglass_feeds": cg_feeds,
            "coinglass_skip": cg_snap.get("skip_reason"),
        }

    called_at = as_of.isoformat()
    reg = regime_from_call(called_at, close_utc.isoformat())
    merge_backfill_into_learner(
        learner, directional, y, regime=reg, ticker=ticker,
    )
    return {
        "status": "graded",
        "event": event,
        "ticker": ticker,
        "y_finish": y,
        "seats": sorted(directional.keys()),
        "tag": BACKFILL_TAG,
        "asset": ticker_asset(ticker) or asset_for_series(series),
        "coinglass_feeds": cg_feeds,
        "coinglass_skip": cg_snap.get("skip_reason"),
        "coinglass_seats": callsigns_from_feeds(cg_feeds),
    }


async def run_asset_backfill(
    *,
    asset: str,
    learner: AdaptiveLearner,
    kalshi: Any = None,
    days: int = BACKFILL_DAYS,
    now: datetime | None = None,
    persist: bool = True,
    already: set[str] | None = None,
    fetch_event: Callable | None = None,
    fetch_candles: Callable | None = None,
    fetch_coinglass: Callable | None = None,
    coinglass: Any = None,
    max_hours: int | None = None,
    data_root: Path | None = None,
) -> Dict[str, Any]:
    """Merge settled hours into an already-loaded learner. One asset. Persist once."""
    asset = (asset or "btc").lower()
    series = series_for_asset(asset)
    symbol = getattr(settings, "SYMBOL_ETH", "ETHUSDT") if asset == "eth" else getattr(settings, "SYMBOL_BTC", "BTCUSDT")
    slots = hour_slots(days=days, now=now)
    if max_hours is not None:
        slots = slots[-int(max_hours):]
    seen = set(already or [])
    graded = 0
    skip_result = 0
    skip_429 = 0
    skip_other = 0
    seat_n: Dict[str, int] = {k: 0 for k in REBUILDABLE_SEATS}
    tickers: List[str] = []
    events: List[str] = []
    feeds_any = {"funding": False, "open_interest": False, "liquidations": False}
    cg_skips: set[str] = set()
    own_cg = False
    if fetch_coinglass is None and coinglass is None:
        from backend.data.secrets import load_coinglass_api_key
        if load_coinglass_api_key():
            from backend.data.coinglass import CoinGlassClient
            coinglass = CoinGlassClient(symbol=symbol)
            own_cg = True

    try:
        for hour in slots:
            try:
                rec = await grade_one_hour(
                    series=series,
                    hour_et=hour,
                    learner=learner,
                    kalshi=kalshi,
                    candle_symbol=symbol,
                    already=seen,
                    fetch_event=fetch_event,
                    fetch_candles=fetch_candles,
                    fetch_coinglass=fetch_coinglass,
                    coinglass=coinglass,
                )
            except KalshiHourSkip as e:
                rec = {"status": "skip", "reason": e.reason, "event": e.hour}
            except Exception as e:
                logger.debug(f"backfill hour fail {series} {hour}: {e}")
                rec = {"status": "skip", "reason": "error"}
            feeds_any = merge_feeds(feeds_any, rec.get("coinglass_feeds"))
            if rec.get("coinglass_skip"):
                cg_skips.add(str(rec["coinglass_skip"]))
            if rec.get("status") == "graded":
                graded += 1
                ev = rec.get("event")
                if ev:
                    seen.add(str(ev))
                    events.append(str(ev))
                if rec.get("ticker"):
                    tickers.append(str(rec["ticker"]))
                for name in rec.get("seats") or []:
                    if name in seat_n:
                        seat_n[name] += 1
            else:
                reason = rec.get("reason") or "other"
                if reason == RATE_LIMIT:
                    skip_429 += 1
                elif reason in ("no_official_result", "empty_event"):
                    skip_result += 1
                elif reason != "already_graded":
                    skip_other += 1
    finally:
        if own_cg and coinglass is not None and hasattr(coinglass, "close"):
            try:
                await coinglass.close()
            except Exception:
                pass

    if persist and hasattr(learner, "save"):
        if data_root is not None:
            learner.save(Path(data_root) / f"council-learning-{asset}.json")
        else:
            learner.save()

    return {
        "asset": asset,
        "series": series,
        "days": min(int(days), BACKFILL_DAYS),
        "hours_considered": len(slots),
        "hours_graded": graded,
        "hours_skipped_no_result": skip_result,
        "hours_skipped_429": skip_429,
        "hours_skipped_other": skip_other,
        "seat_samples": seat_n,
        "tickers_tail": tickers[-12:],
        "events": events,
        "tag": BACKFILL_TAG,
        "merge": True,
        "coinglass": {
            "feeds": feeds_any,
            "seats_with_samples": callsigns_from_feeds(feeds_any),
            "skip_reasons": sorted(cg_skips),
        },
    }


async def run_seat_backfill(
    *,
    learners: Dict[str, AdaptiveLearner] | None = None,
    kalshi_clients: Dict[str, Any] | None = None,
    coinglass_clients: Dict[str, Any] | None = None,
    days: int = BACKFILL_DAYS,
    persist: bool = True,
    data_root: Path | None = None,
    now: datetime | None = None,
    fetch_event: Callable | None = None,
    fetch_candles: Callable | None = None,
    fetch_coinglass: Callable | None = None,
    max_hours: int | None = None,
    force: bool = False,
) -> Dict[str, Any]:
    """
    One pass over BTC + ETH. Loads each live brain first (merge, never wipe).
    Writes status under DATA_DIR. Does not write window_calls.
    """
    root = data_root or data_dir()
    contract = backfill_contract()
    status = load_status(root)
    already_by_asset = {
        "btc": set(status.get("btc_events") or []),
        "eth": set(status.get("eth_events") or []),
    }
    if already_done(root) and not force:
        return {
            "ok": True,
            "skipped": "already_done",
            "contract": contract,
            "status": status,
        }

    # 1H pass is ETH only. BTC 15m is a separate brain (seat_backfill_15m).
    # Do not merge KXBTCD hours into council-learning-btc15m.json.
    assets = ("eth",)
    per: Dict[str, Any] = {}
    own_learners: List[AdaptiveLearner] = []
    for asset in assets:
        learner = (learners or {}).get(asset)
        if learner is None:
            learner = AdaptiveLearner(asset=asset)
            try:
                learner.load()
            except Exception:
                pass
            own_learners.append(learner)
        kalshi = (kalshi_clients or {}).get(asset)
        rec = await run_asset_backfill(
            asset=asset,
            learner=learner,
            kalshi=kalshi,
            days=days,
            now=now,
            persist=persist,
            already=already_by_asset.get(asset),
            fetch_event=fetch_event,
            fetch_candles=fetch_candles,
            fetch_coinglass=fetch_coinglass,
            coinglass=(coinglass_clients or {}).get(asset),
            max_hours=max_hours,
            data_root=root if data_root is not None else None,
        )
        per[asset] = rec
        already_by_asset[asset].update(rec.get("events") or [])

    cg_merged = merge_feeds(
        ((per.get("btc") or {}).get("coinglass") or {}).get("feeds"),
        ((per.get("eth") or {}).get("coinglass") or {}).get("feeds"),
    )
    cg_skips: List[str] = []
    for a in assets:
        for reason in ((per.get(a) or {}).get("coinglass") or {}).get("skip_reasons") or []:
            if reason not in cg_skips:
                cg_skips.append(reason)
    report = {
        "ok": True,
        "tag": BACKFILL_TAG,
        "days": min(int(days), BACKFILL_DAYS),
        "hours_graded": sum(int(per[a].get("hours_graded") or 0) for a in assets),
        "hours_skipped_no_result": sum(int(per[a].get("hours_skipped_no_result") or 0) for a in assets),
        "hours_skipped_429": sum(int(per[a].get("hours_skipped_429") or 0) for a in assets),
        "assets": per,
        "seats_rebuilt": contract["seats_rebuilt"],
        "seats_skipped": contract["seats_skipped"],
        "coinglass": {
            "feeds": cg_merged,
            "seats_with_samples": callsigns_from_feeds(cg_merged),
            "skip_reasons": cg_skips,
            "btc": (per.get("btc") or {}).get("coinglass"),
            "eth": (per.get("eth") or {}).get("coinglass"),
        },
        "merge": True,
        "wipe_live_brain": False,
        "paper": True,
        "follower": False,
        "live_orders": False,
        "finished_at": datetime.now(UTC).isoformat(),
        "contract": contract,
    }
    save_status(
        {
            **report,
            "btc_events": sorted(already_by_asset["btc"])[-400:],
            "eth_events": sorted(already_by_asset["eth"])[-400:],
        },
        root,
    )
    if persist:
        mark_done(root, report)
    logger.info(
        f"Seat backfill done · graded {report['hours_graded']} hour(s) · "
        f"skip result {report['hours_skipped_no_result']} · "
        f"skip 429 {report['hours_skipped_429']}"
    )
    return report


async def maybe_run_boot_backfill(dual: Any) -> Dict[str, Any]:
    """Background boot-once. Never blocks HTTP. Never arms Follower / live."""
    if not boot_once_enabled():
        return {"ok": True, "skipped": "disabled"}
    if already_done():
        return {"ok": True, "skipped": "already_done"}
    learners = {}
    clients = {}
    cg_clients = {}
    for c in getattr(dual, "_councils", lambda: [])():
        asset = getattr(c, "asset", None)
        if not asset:
            continue
        if str(asset).lower() in ("btc", "bitcoin", "btc15m"):
            # BTC 15m brain is seat_backfill_15m. Do not hand the 15m learner to the 1H pass.
            continue
        learners[asset] = c.learner
        pipe = getattr(c, "pipeline", None)
        if pipe is not None:
            clients[asset] = getattr(pipe, "kalshi", None)
            cg_clients[asset] = getattr(pipe, "coinglass", None)
    try:
        report = await run_seat_backfill(
            learners=learners,
            kalshi_clients=clients,
            coinglass_clients=cg_clients,
            persist=True,
        )
        for c in getattr(dual, "_councils", lambda: [])():
            try:
                if hasattr(c, "leader") and hasattr(c.leader, "sync_from_learner"):
                    c.leader.sync_from_learner()
            except Exception:
                pass
        return report
    except Exception as e:
        logger.warning(f"seat backfill boot skip: {e}")
        return {"ok": False, "error": str(e)}


def _cli(argv: List[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="90-day Kalshi seat backfill (paper, merge, no live)")
    p.add_argument("--contract", action="store_true", help="Print the live-run contract and exit")
    p.add_argument("--force", action="store_true", help="Re-run even if seat-backfill.done exists")
    p.add_argument("--days", type=int, default=BACKFILL_DAYS, help="Lookback days (capped at 90)")
    args = p.parse_args(argv)
    if args.contract:
        print_contract()
        return 0
    days = min(int(args.days), BACKFILL_DAYS)
    report = asyncio.run(run_seat_backfill(days=days, persist=True, force=bool(args.force)))
    print_contract(report)
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(_cli())
