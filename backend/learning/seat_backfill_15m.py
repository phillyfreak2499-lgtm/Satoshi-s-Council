"""
Official Kalshi 15m BTC seat backfill — new brain, not a 1H replay.

Pulls settled KXBTC15M books (as many as the public API pages), grades
Satoshi seats + Bitcoin Pattern Specialist on those 15m books only, and
merges into council-learning-btc15m.json.

Paper only. No window_calls. No Follower. No live orders.
Does not load or write 1H BTC weights. Does not touch ETH 1H memory.
Does not use CoinGlass 1h features.
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

from backend.agents.chair_gates import (
    collect_official_results,
    lock_time_strike,
    official_y_finish,
)
from backend.config import settings
from backend.learning.adaptive import AdaptiveLearner
from backend.learning.btc15m import (
    BRAIN_FILE_BTC_15M,
    CANDLE_LOOKBACK_MIN_15M,
    COINGLASS_SEATS_15M,
    SERIES_BTC_15M,
    SNAPSHOT_MINS_INTO_15M,
    WINDOW_MINUTES_15M,
    event_ticker_from_15m,
    is_btc_15m_ticker,
)
from backend.learning.regime_keys import regime_from_call
from backend.learning.seat_backfill import (
    CANDLE_SEATS,
    KalshiHourSkip,
    REBUILDABLE_CALLSIGNS,
    build_market_data,
    fetch_historical_candles,
    filter_rebuildable_votes,
    is_rebuildable_seat,
    reconstructed_yes_mid,
    vote_rebuildable_seats,
)

ET = ZoneInfo("America/New_York")
UTC = timezone.utc
BACKFILL_TAG = "backfill_15m"
STATUS_NAME = "seat-backfill-15m-status.json"
DONE_NAME = "seat-backfill-15m.done"
MARKER_ENV = "SEAT_BACKFILL_15M_ONCE"
RATE_LIMIT = "rate_limit"
KALSHI_429_SLEEP_S = 12.0
PAGE_LIMIT = 200
MAX_PAGES = 80  # API ceiling we will walk; stop on empty cursor


def data_dir() -> Path:
    root = Path(getattr(settings, "DATA_DIR", None) or (Path(__file__).resolve().parents[2] / "data"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def status_path(root: Path | None = None) -> Path:
    return (root or data_dir()) / STATUS_NAME


def done_path(root: Path | None = None) -> Path:
    return (root or data_dir()) / DONE_NAME


def seed_path() -> Path:
    return Path(__file__).resolve().parent / "seeds" / BRAIN_FILE_BTC_15M


def backfill_15m_contract() -> Dict[str, Any]:
    seats = [REBUILDABLE_CALLSIGNS[k] for k in CANDLE_SEATS if k != "candle"]
    seats = ["WICK"] + [s for s in seats if s != "WICK"]
    return {
        "series": [SERIES_BTC_15M],
        "assets": ["btc"],
        "window_minutes": WINDOW_MINUTES_15M,
        "brain_file": BRAIN_FILE_BTC_15M,
        "seats_rebuilt": seats,
        "seats_skipped": [
            {"key": "funding", "callsign": "CARRY", "why": "CoinGlass 1h is the wrong timeframe"},
            {"key": "oi_pressure", "callsign": "CHAIN", "why": "CoinGlass 1h is the wrong timeframe"},
            {"key": "liq", "callsign": "CASCADE", "why": "CoinGlass 1h is the wrong timeframe"},
            {"key": "orderflow", "callsign": "TAPE", "why": "live book only"},
            {"key": "whale", "callsign": "WHALE", "why": "live tape only"},
        ],
        "coinglass": False,
        "official_result_only": False,
        "y_finish_marks_terminal_legs": True,
        "score": "realized_paper_pnl",
        "dual_sided": True,
        "impute_missing_result": False,
        "tag": BACKFILL_TAG,
        "merge": True,
        "wipe_live_brain": False,
        "wipe_eth_brain": False,
        "port_1h_weights": False,
        "paper": True,
        "follower": False,
        "live_orders": False,
        "displayed_hit_rate": "untouched — no window_calls written",
        "eth_1h": "untouched",
        "trigger": {
            "boot_once": f"DATA_DIR/{DONE_NAME} missing and {MARKER_ENV}!=0",
            "cli": "python -m backend.learning.seat_backfill_15m",
        },
    }


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
        "windows_graded": (report or {}).get("windows_graded"),
        "series": SERIES_BTC_15M,
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
    status_path(root).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _is_rate_limit(err: BaseException) -> bool:
    status = getattr(getattr(err, "response", None), "status_code", None)
    text = str(err).lower()
    return status == 429 or "429" in text or "kalshi_backoff" in text


async def fetch_settled_15m_markets(
    client: Any,
    *,
    limit: int = PAGE_LIMIT,
    max_pages: int = MAX_PAGES,
    sleep_s: float = 0.35,
) -> List[Dict[str, Any]]:
    """Walk official Kalshi settled KXBTC15M pages until the cursor dies."""
    out: List[Dict[str, Any]] = []
    cursor = None
    getter = getattr(client, "_get_json", None)
    base = getattr(client, "base", None) or getattr(settings, "KALSHI_BASE", "")
    url = f"{base}/markets"
    for page in range(int(max_pages)):
        params: Dict[str, Any] = {
            "series_ticker": SERIES_BTC_15M,
            "status": "settled",
            "limit": int(limit),
        }
        if cursor:
            params["cursor"] = cursor
        try:
            if callable(getter):
                data = await getter(url, params)
            else:
                import httpx
                async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http:
                    r = await http.get(url, params=params)
                    if r.status_code == 429:
                        raise KalshiHourSkip(RATE_LIMIT)
                    r.raise_for_status()
                    data = r.json()
        except Exception as e:
            if _is_rate_limit(e):
                await asyncio.sleep(KALSHI_429_SLEEP_S)
                continue
            logger.debug(f"15m settled page {page}: {type(e).__name__}")
            break
        rows = (data or {}).get("markets") if isinstance(data, dict) else None
        if not isinstance(rows, list) or not rows:
            break
        out.extend([m for m in rows if isinstance(m, dict) and is_btc_15m_ticker(m.get("ticker"))])
        cursor = (data or {}).get("cursor")
        if not cursor:
            break
        await asyncio.sleep(float(sleep_s))
    # Newest-first from the API; chronological train wants oldest first.
    out.sort(key=lambda m: str(m.get("close_time") or m.get("ticker") or ""))
    return out


class _CandleCache:
    """Reuse 1m bars across neighboring 15m windows. Do not invent missing bars."""

    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.start_ms: Optional[int] = None
        self.end_ms: Optional[int] = None

    async def get(self, start_ms: int, end_ms: int, symbol: str = "BTCUSDT") -> List[Dict[str, Any]]:
        need_lo = int(start_ms)
        need_hi = int(end_ms)
        if (
            self.start_ms is None
            or self.end_ms is None
            or need_lo < self.start_ms
            or need_hi > self.end_ms
        ):
            pad = 6 * 60 * 60 * 1000
            fetch_lo = min(need_lo, self.start_ms) - pad if self.start_ms is not None else need_lo - pad
            fetch_hi = max(need_hi, self.end_ms) + pad if self.end_ms is not None else need_hi + pad
            # Cap one fetch to ~18h so Binance 1m limit (1000) still covers the slice.
            fetch_hi = min(fetch_hi, fetch_lo + 18 * 60 * 60 * 1000)
            if need_hi > fetch_hi:
                fetch_lo = need_lo - 30 * 60 * 1000
                fetch_hi = need_hi + 30 * 60 * 1000
            fresh = await fetch_historical_candles(symbol, fetch_lo, fetch_hi)
            if fresh:
                if self.rows:
                    seen = {int(c.get("open_time") or 0) for c in self.rows}
                    for c in fresh:
                        t = int(c.get("open_time") or 0)
                        if t and t not in seen:
                            self.rows.append(c)
                            seen.add(t)
                    self.rows.sort(key=lambda c: int(c.get("open_time") or 0))
                else:
                    self.rows = list(fresh)
                times = [int(c.get("open_time") or 0) for c in self.rows if c.get("open_time")]
                if times:
                    self.start_ms = min(times)
                    self.end_ms = max(times)
        if not self.rows:
            return []
        return [
            c for c in self.rows
            if need_lo <= int(c.get("open_time") or 0) <= need_hi
        ]


def snapshot_into_15m(
    close_time: datetime,
    candles: List[Dict[str, Any]],
) -> Tuple[datetime, Optional[float]]:
    """Vote snapshot: 4 minutes into the 15m window (after the 3m sit)."""
    snap = close_time - timedelta(minutes=WINDOW_MINUTES_15M - SNAPSHOT_MINS_INTO_15M)
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


def filter_15m_votes(votes: Dict[str, Any] | None) -> Dict[str, Any]:
    """Drop CoinGlass 1h seats and live-only seats. Never invent a vote."""
    out: Dict[str, Any] = {}
    for name, vote in (votes or {}).items():
        if name in COINGLASS_SEATS_15M:
            continue
        if not is_rebuildable_seat(name):
            continue
        if not isinstance(vote, dict):
            continue
        if vote.get("direction") not in ("UP", "DOWN", "WAIT"):
            continue
        out[name] = vote
    return filter_rebuildable_votes(out)


async def grade_one_15m(
    market: Dict[str, Any],
    *,
    learner: AdaptiveLearner,
    already: set[str] | None = None,
    fetch_candles: Callable | None = None,
    candle_symbol: str = "BTCUSDT",
    candle_cache: _CandleCache | None = None,
) -> Dict[str, Any]:
    ticker = str(market.get("ticker") or "")
    event = event_ticker_from_15m(ticker) or str(market.get("event_ticker") or "")
    if already and (ticker in already or event in already):
        return {"status": "skip", "reason": "already_graded", "event": event, "ticker": ticker}
    y = official_y_finish(market)
    if y not in ("UP", "DOWN"):
        pulled = collect_official_results({"markets": [market]})
        inner = pulled.get(ticker) or (next(iter(pulled.values()), None) if pulled else None)
        y = official_y_finish(inner)
    if y not in ("UP", "DOWN"):
        return {"status": "skip", "reason": "no_official_result", "event": event, "ticker": ticker}

    close_utc = _as_utc(market.get("close_time"))
    if close_utc is None:
        from backend.learning.btc15m import close_time_from_15m_ticker
        close_utc = close_time_from_15m_ticker(ticker)
    if close_utc is None:
        return {"status": "skip", "reason": "no_close_time", "event": event, "ticker": ticker}

    snap_end = close_utc - timedelta(minutes=WINDOW_MINUTES_15M - SNAPSHOT_MINS_INTO_15M)
    window_open = close_utc - timedelta(minutes=WINDOW_MINUTES_15M)
    start_ms = int((window_open - timedelta(minutes=CANDLE_LOOKBACK_MIN_15M)).timestamp() * 1000)
    end_ms = int(close_utc.timestamp() * 1000)
    if fetch_candles is not None:
        candles = await fetch_candles()
    elif candle_cache is not None:
        candles = await candle_cache.get(start_ms, end_ms, candle_symbol)
    else:
        candles = await fetch_historical_candles(candle_symbol, start_ms, end_ms)
    if not candles:
        return {"status": "skip", "reason": "no_candles", "event": event, "ticker": ticker}

    as_of, spot = snapshot_into_15m(close_utc, candles)
    strike = lock_time_strike(ticker=ticker, kalshi_result=market)
    up_pct = reconstructed_yes_mid(spot, strike) if (spot and strike) else 50.0
    md = build_market_data(
        candles=candles,
        spot=spot,
        strike=strike,
        ticker=ticker,
        close_time=close_utc,
        as_of=as_of,
        up_pct=up_pct,
    )
    md["series_ticker"] = SERIES_BTC_15M
    md["window_minutes"] = WINDOW_MINUTES_15M
    md["asset"] = "btc"
    # Explicitly empty CoinGlass — 1h hist is the wrong timeframe.
    md["coinglass"] = {"healthy": False, "reason": "15m_wrong_timeframe"}
    md["funding_rate"] = None
    md["oi_delta_1h"] = None
    votes = await vote_rebuildable_seats(md, cg_feeds={})
    directional = {
        k: v for k, v in filter_15m_votes(votes).items()
        if isinstance(v, dict) and v.get("direction") in ("UP", "DOWN")
        and k not in COINGLASS_SEATS_15M
    }
    if not directional:
        return {
            "status": "skip",
            "reason": "no_directional_votes",
            "event": event,
            "ticker": ticker,
        }
    called_at = as_of.isoformat()
    reg = regime_from_call(called_at, close_utc.isoformat())
    from backend.learning.btc15m_path import simulate_path
    path = simulate_path(
        candles=candles,
        floor_strike=strike,
        close_time=close_utc,
        votes=directional,
        y_finish=y,
        ticker=ticker,
    )
    net = path.get("net_pnl")
    held = path.get("held_sides") or []
    if path.get("path_win") or path.get("path_loss"):
        learner.learn_from_path_pnl(
            directional,
            net,
            held,
            regime=reg,
            count_as_lock=False,
            source=BACKFILL_TAG,
        )
        learner.note_backfill_hour(
            ticker=ticker,
            seats=list(directional.keys()),
            outcome="UP" if path.get("path_win") else "DOWN",
        )
    elif not (path.get("fills") or []):
        return {
            "status": "skip",
            "reason": "no_path_fills",
            "event": event,
            "ticker": ticker,
            "y_finish": y,
        }
    return {
        "status": "graded",
        "event": event,
        "ticker": ticker,
        "y_finish": y,
        "net_pnl": net,
        "path_win": bool(path.get("path_win")),
        "held_sides": held,
        "actions": path.get("actions") or [],
        "score": "realized_paper_pnl",
        "seats": sorted(directional.keys()),
        "tag": BACKFILL_TAG,
        "asset": "btc",
        "window_minutes": WINDOW_MINUTES_15M,
        "hour_utc": as_of.astimezone(UTC).hour,
        "weekday": as_of.astimezone(UTC).weekday(),
    }


def _brain_is_path_pnl(learner: AdaptiveLearner | None) -> bool:
    rec = getattr(learner, "backfill", None) if learner is not None else None
    if not isinstance(rec, dict):
        return False
    return str(rec.get("score") or "") == "realized_paper_pnl"


def _brain_is_finish_era(learner: AdaptiveLearner | None) -> bool:
    rec = getattr(learner, "backfill", None) if learner is not None else None
    if not isinstance(rec, dict):
        return False
    if str(rec.get("score") or "") == "realized_paper_pnl":
        return False
    return bool(rec.get("windows_graded") or rec.get("tag"))


def ensure_15m_learner(
    learner: AdaptiveLearner | None = None,
    *,
    fresh: bool = False,
) -> AdaptiveLearner:
    """
    Path P&L is a new win rule. Do not keep finish-match weights on this brain.
    A tagged path_pnl brain may merge. Otherwise start from priors.
    """
    if learner is not None:
        if _brain_is_path_pnl(learner) and not fresh:
            return learner
        if _brain_is_finish_era(learner) or fresh:
            return AdaptiveLearner(asset="btc")
        return learner
    brain = AdaptiveLearner(asset="btc")
    if fresh:
        return brain
    try:
        brain.load()
    except Exception:
        return AdaptiveLearner(asset="btc")
    if _brain_is_path_pnl(brain):
        return brain
    return AdaptiveLearner(asset="btc")


async def run_btc_15m_backfill(
    *,
    learner: AdaptiveLearner | None = None,
    kalshi: Any = None,
    persist: bool = True,
    data_root: Path | None = None,
    fetch_markets: Callable | None = None,
    fetch_candles: Callable | None = None,
    max_windows: int | None = None,
    force: bool = False,
    markets: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    One pass over official settled KXBTC15M books. Merge into the 15m brain.
    Does not write window_calls. Does not touch ETH.
    """
    root = data_root or data_dir()
    contract = backfill_15m_contract()
    status = load_status(root)
    if already_done(root) and not force and markets is None:
        return {"ok": True, "skipped": "already_done", "contract": contract, "status": status}

    own_kalshi = False
    if kalshi is None and fetch_markets is None and markets is None:
        from backend.data.kalshi import KalshiClient
        kalshi = KalshiClient(series_ticker=SERIES_BTC_15M)
        own_kalshi = True

    try:
        if markets is None:
            if fetch_markets is not None:
                markets = await fetch_markets()
            else:
                markets = await fetch_settled_15m_markets(kalshi)
    finally:
        if own_kalshi and kalshi is not None and hasattr(kalshi, "close"):
            try:
                await kalshi.close()
            except Exception:
                pass

    rows = [m for m in (markets or []) if isinstance(m, dict) and official_y_finish(m) in ("UP", "DOWN")]
    if max_windows is not None:
        rows = rows[-int(max_windows):]

    brain = ensure_15m_learner(learner, fresh=bool(force))
    seen = set(status.get("events") or [])
    candle_cache = None if fetch_candles is not None else _CandleCache()
    graded = 0
    skip_result = 0
    skip_other = 0
    seat_n: Dict[str, int] = {}
    tickers: List[str] = []
    events: List[str] = []
    hour_hits = [0] * 24
    hour_n = [0] * 24
    dow_hits = [0] * 7
    dow_n = [0] * 7

    for i, market in enumerate(rows, start=1):
        try:
            rec = await grade_one_15m(
                market,
                learner=brain,
                already=seen,
                fetch_candles=fetch_candles,
                candle_cache=candle_cache,
            )
        except KalshiHourSkip as e:
            rec = {"status": "skip", "reason": e.reason}
        except Exception as e:
            logger.debug(f"15m backfill skip: {e}")
            rec = {"status": "skip", "reason": "error"}
        if rec.get("status") == "graded":
            graded += 1
            ev = rec.get("event")
            if ev:
                seen.add(str(ev))
                events.append(str(ev))
            if rec.get("ticker"):
                tickers.append(str(rec["ticker"]))
                seen.add(str(rec["ticker"]))
            for name in rec.get("seats") or []:
                seat_n[name] = seat_n.get(name, 0) + 1
            try:
                h = int(rec.get("hour_utc"))
                d = int(rec.get("weekday"))
                hour_n[h] += 1
                dow_n[d] += 1
                if rec.get("y_finish") == "UP":
                    hour_hits[h] += 1
                    dow_hits[d] += 1
            except (TypeError, ValueError):
                pass
        else:
            reason = rec.get("reason") or "other"
            if reason in ("no_official_result", "empty_event"):
                skip_result += 1
            elif reason != "already_graded":
                skip_other += 1
        if i == 1 or i % 100 == 0 or i == len(rows):
            logger.info(
                f"15m BTC backfill {i}/{len(rows)} · graded {graded} · "
                f"skip result {skip_result} · skip other {skip_other}"
            )

    report = {
        "ok": True,
        "tag": BACKFILL_TAG,
        "series": SERIES_BTC_15M,
        "windows_considered": len(rows),
        "windows_graded": graded,
        "windows_skipped_no_result": skip_result,
        "windows_skipped_other": skip_other,
        "seat_samples": seat_n,
        "tickers_tail": tickers[-12:],
        "events": events,
        "hour_up_rate": [
            None if hour_n[i] < 8 else round(hour_hits[i] / hour_n[i], 3)
            for i in range(24)
        ],
        "weekday_up_rate": [
            None if dow_n[i] < 8 else round(dow_hits[i] / dow_n[i], 3)
            for i in range(7)
        ],
        "brain_file": BRAIN_FILE_BTC_15M,
        "score": "realized_paper_pnl",
        "dual_sided": True,
        "coinglass": False,
        "port_1h_weights": False,
        "eth_1h": "untouched",
        "paper": True,
        "follower": False,
        "live_orders": False,
        "finished_at": datetime.now(UTC).isoformat(),
        "contract": contract,
    }
    if persist and hasattr(brain, "save"):
        rec = brain.backfill if isinstance(getattr(brain, "backfill", None), dict) else {}
        rec["tag"] = BACKFILL_TAG
        rec["series"] = SERIES_BTC_15M
        rec["window_minutes"] = WINDOW_MINUTES_15M
        rec["windows_graded"] = graded
        rec["hour_up_rate"] = report["hour_up_rate"]
        rec["weekday_up_rate"] = report["weekday_up_rate"]
        rec["coinglass"] = False
        rec["port_1h_weights"] = False
        rec["score"] = "realized_paper_pnl"
        rec["dual_sided"] = True
        brain.backfill = rec
        brain.save(Path(root) / BRAIN_FILE_BTC_15M)
        save_status({**report, "events": sorted(seen)[-800:]}, root)
        mark_done(root, report)
    logger.info(
        f"15m BTC backfill done · graded {graded} window(s) · "
        f"skip result {skip_result} · skip other {skip_other}"
    )
    return report


async def maybe_run_boot_backfill_15m(dual: Any) -> Dict[str, Any]:
    """Background boot-once for the 15m BTC brain. Never arms Follower / live."""
    if not boot_once_enabled():
        return {"ok": True, "skipped": "disabled"}
    if already_done():
        return {"ok": True, "skipped": "already_done"}
    learner = None
    kalshi = None
    for c in getattr(dual, "_councils", lambda: [])():
        if getattr(c, "asset", None) == "btc":
            learner = getattr(c, "learner", None)
            pipe = getattr(c, "pipeline", None)
            if pipe is not None:
                kalshi = getattr(pipe, "kalshi", None)
            break
    try:
        report = await run_btc_15m_backfill(learner=learner, kalshi=kalshi, persist=True)
        for c in getattr(dual, "_councils", lambda: [])():
            if getattr(c, "asset", None) != "btc":
                continue
            try:
                if hasattr(c, "leader") and hasattr(c.leader, "sync_from_learner"):
                    c.leader.sync_from_learner()
            except Exception:
                pass
        return report
    except Exception as e:
        logger.warning(f"15m seat backfill boot skip: {e}")
        return {"ok": False, "error": str(e)}


def _cli(argv: List[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Kalshi 15m BTC seat backfill (paper, new brain, no live)")
    p.add_argument("--contract", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--max-windows", type=int, default=None)
    args = p.parse_args(argv)
    if args.contract:
        print(json.dumps(backfill_15m_contract(), indent=2))
        return 0
    report = asyncio.run(
        run_btc_15m_backfill(persist=True, force=bool(args.force), max_windows=args.max_windows)
    )
    print(json.dumps({k: report.get(k) for k in (
        "ok", "windows_graded", "windows_considered", "seat_samples",
        "hour_up_rate", "weekday_up_rate", "brain_file",
    )}, indent=2))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(_cli())
