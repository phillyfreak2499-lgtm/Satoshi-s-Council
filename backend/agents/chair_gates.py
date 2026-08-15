"""
Paper-only Chair gates: P(finish), EV, book depth, official window, odds bands.

No live Kalshi orders. Helpers stay pure so the lock path and tests share one
definition of the math.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


def odds_to_cents(raw: Any) -> Optional[float]:
    """Kalshi yes/no as 0–100¢. Dollars (0–1) are scaled."""
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v <= 1.0:
        v *= 100.0
    return max(0.0, min(100.0, v))


def clamp_p_finish(conf: Any) -> float:
    """Raw Chair conf → 0.01–0.99. Do not use as P(finish) until calibrated."""
    try:
        raw = float(conf) / 100.0
    except (TypeError, ValueError):
        raw = 0.01
    return max(0.01, min(0.99, raw))


def chair_conf_bin(conf: Any) -> str:
    """Chair confidence bin. 90%+ is its own bucket (fade until settled)."""
    try:
        c = float(conf)
    except (TypeError, ValueError):
        return "unknown"
    if c >= 90.0:
        return "90+"
    if c >= 80.0:
        return "80-90"
    if c >= 70.0:
        return "70-80"
    if c >= 60.0:
        return "60-70"
    if c >= 50.0:
        return "50-60"
    return "0-50"


def hot_chair_bin_faded(conf: Any, bin_settled_n: Any, min_n: int | None = None) -> bool:
    """
    Fade any 90%+ Chair bin until that bin has enough actually settled hours.
    OPEN rows (including live 1062/1063 while OPEN) do not count — pass only
    finish-graded hours into bin_settled_n.
    """
    try:
        c = float(conf)
    except (TypeError, ValueError):
        return False
    if c < 90.0:
        return False
    if bin_settled_n is None:
        return False
    try:
        n = int(bin_settled_n)
    except (TypeError, ValueError):
        n = 0
    need = min_n
    if need is None:
        try:
            from backend.config import settings
            need = int(getattr(settings, "CHAIR_HOT_BIN_MIN_N", getattr(settings, "P_FINISH_COLD_N", 15)))
        except Exception:
            need = 15
    return n < int(need)


def is_actually_settled(row: Any) -> bool:
    """
    True only for an official finish-graded hour.
    OPEN 1062/1063 (and any OPEN / path-era row) do not count.
    """
    if row is None:
        return False
    if isinstance(row, dict):
        cid = row.get("id")
        y = row.get("y_finish") or row.get("actual_outcome")
        settled_at = row.get("settled_at")
        reason = row.get("settle_reason")
        status = row.get("status")
    else:
        cid = getattr(row, "id", None)
        y = getattr(row, "y_finish", None) or getattr(row, "actual_outcome", None)
        settled_at = getattr(row, "settled_at", None)
        reason = getattr(row, "settle_reason", None)
        status = getattr(row, "status", None)
    if str(status or "").strip().lower() in ("open", "active", "initialized"):
        return False
    try:
        if int(cid) in KNOWN_OFFICIAL_BY_ID and not settled_at:
            return False
    except (TypeError, ValueError):
        pass
    if y not in ("UP", "DOWN"):
        return False
    if reason and str(reason) not in ("finish_match", "finish_miss"):
        return False
    return True


def chair_bin_settled_count(rows: Any, bin_key: str = "90+") -> int:
    """Count actually settled hours in one Chair confidence bin."""
    n = 0
    for row in rows or []:
        if not is_actually_settled(row):
            continue
        if isinstance(row, dict):
            conf = row.get("confidence")
        else:
            conf = getattr(row, "confidence", None)
        if chair_conf_bin(conf) == bin_key:
            n += 1
    return n


def chair_bins_from_settled(rows: Any) -> Dict[str, Any]:
    """Per-bin settled counts. 90%+ starts faded until CHAIR_HOT_BIN_MIN_N."""
    bins = ("90+", "80-90", "70-80", "60-70", "50-60", "0-50")
    out: Dict[str, Any] = {}
    for key in bins:
        settled = chair_bin_settled_count(rows, key)
        faded = key == "90+" and hot_chair_bin_faded(91, settled)
        out[key] = {"settled": settled, "faded": faded}
    return out


def estimate_p_finish(conf: Any, settled_n: int = 0, bin_settled_n: Any = None) -> float:
    """
    Shrink Chair confidence toward a coin-flip until enough finish-graded hours.
    91% Chair on a cold book is the lesson — that is not P(finish).
    A 90%+ Chair bin stays faded until that bin has enough actually settled hours.
    """
    raw = clamp_p_finish(conf)
    try:
        n = int(settled_n or 0)
    except (TypeError, ValueError):
        n = 0
    if hot_chair_bin_faded(conf, bin_settled_n):
        try:
            n = min(n, int(bin_settled_n or 0))
        except (TypeError, ValueError):
            n = 0
    cold_n, warm_n = 15, 40
    try:
        from backend.config import settings
        cold_n = int(getattr(settings, "P_FINISH_COLD_N", 15))
        warm_n = int(getattr(settings, "P_FINISH_WARM_N", 40))
    except Exception:
        pass
    if n < cold_n:
        shrink, cap = 0.30, 0.62
    elif n < warm_n:
        shrink, cap = 0.55, 0.70
    else:
        shrink, cap = 0.85, 0.80
    p = 0.50 + (raw - 0.50) * float(shrink)
    return max(0.01, min(float(cap), p))


def lock_force_allowed(features: Any) -> bool:
    """CARRY/CHAIN/CASCADE may display; lock_force=False cannot force a lock."""
    if not isinstance(features, dict):
        return True
    if features.get("lock_force") is False:
        return False
    if features.get("advisory") is True and features.get("lock_force") is not True:
        return False
    return True


def cg_interval_is_daily_heatmap(interval: Any) -> bool:
    text = str(interval or "").strip().lower()
    return text in ("1d", "24h", "4h", "12h", "1w", "7d", "daily")


def funding_cannot_force_lock() -> bool:
    """Funding is an 8h clock — never a 1h UP/DOWN lock tell."""
    return True


def liq_spike_is_not_p_finish() -> bool:
    """A 1h long/short liq spike is a local flush, not P(finish)."""
    return True


def kalshi_taker_fee_cents(ask_cents: Any) -> float:
    """Kalshi-style taker fee ≈ 7¢ * p * (1-p), in cents."""
    px = odds_to_cents(ask_cents)
    if px is None:
        return 1.75
    p = px / 100.0
    return max(0.0, 7.0 * p * (1.0 - p))


def compute_ev_cents(
    p_finish: float,
    side_ask: float,
    spread_cents: float | None = None,
    fee_cents: float | None = None,
) -> float:
    """Paper-fill at ask: 100*P(finish) − ask − fees − half-spread."""
    half = 0.0
    try:
        if spread_cents is not None:
            half = max(0.0, float(spread_cents) / 2.0)
    except (TypeError, ValueError):
        half = 0.0
    ask = float(side_ask)
    fee = float(fee_cents) if fee_cents is not None else kalshi_taker_fee_cents(ask)
    return float(100.0 * float(p_finish) - ask - fee - half)


def leftover_after_vig(
    p_finish: float,
    side_ask: float,
    spread_cents: float | None = None,
    fee_cents: float | None = None,
) -> float:
    """Zach leftover at the real ask: 100*P(finish) − ask − fee − half-spread."""
    return compute_ev_cents(p_finish, side_ask, spread_cents, fee_cents)


def ev_gate_blocks(p_finish: float, ev_cents: float, min_p: float, min_ev: float) -> bool:
    """WAIT if p_finish or EV is under the (possibly time-tightened) hurdle."""
    return float(p_finish) < float(min_p) or float(ev_cents) < float(min_ev)


def parse_iso_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    try:
        text = str(value).strip()
        if not text:
            return None
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


_KALSHI_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def ticker_asset(ticker: Any) -> Optional[str]:
    """KXBTCD-… → btc, KXETHD-… → eth."""
    text = str(ticker or "").upper()
    if text.startswith("KXETHD") or text.startswith("KXETH"):
        return "eth"
    if text.startswith("KXBTCD") or text.startswith("KXBTC"):
        return "btc"
    return None


def close_time_from_kalshi_ticker(ticker: Any) -> Optional[datetime]:
    """
    KXBTCD-26AUG1415-T62999.99 → 15:00 America/New_York on 2026-08-14.
    That is the official hourly close (19:00 UTC while EDT).
    """
    import re
    from zoneinfo import ZoneInfo

    m = re.search(r"-(\d{2})([A-Z]{3})(\d{2})(\d{2})(?:-|$)", str(ticker or ""), re.I)
    if not m:
        return None
    yy, mon, dd, hh = m.group(1), m.group(2).upper(), m.group(3), m.group(4)
    month = _KALSHI_MONTHS.get(mon)
    if month is None:
        return None
    try:
        day = int(dd)
        hour = int(hh)
        if hour > 23 or day < 1 or day > 31:
            return None
        local = datetime(2000 + int(yy), month, day, hour, 0, 0, tzinfo=ZoneInfo("America/New_York"))
        return local.astimezone(timezone.utc)
    except Exception:
        return None


def strike_from_kalshi_ticker(ticker: Any) -> Optional[float]:
    """KXBTCD-26AUG1415-T62999.99 → 62999.99 (locked strike baked into the contract)."""
    import re

    m = re.search(r"-T(\d+(?:\.\d+)?)$", str(ticker or ""), re.I)
    if not m:
        return None
    try:
        px = float(m.group(1))
    except (TypeError, ValueError):
        return None
    return px if px > 0 else None


def lock_time_strike(
    ticker: Any = None,
    floor_strike: Any = None,
    cap_strike: Any = None,
    strike_price: Any = None,
    kalshi_result: Any = None,
) -> Optional[float]:
    """
    Strike to persist on a paper row at lock time.

    Prefer Kalshi floor / cap / strike_price, else the -T value baked
    into the ticker. 1062/1063 stayed null because only live floor_strike
    was stored. This is identity, not an outcome — never a later-hour spot.
    """
    cands: list[Any] = [floor_strike, cap_strike, strike_price]
    inner = None
    if isinstance(kalshi_result, dict):
        inner = kalshi_result.get("market") if isinstance(kalshi_result.get("market"), dict) else kalshi_result
        if isinstance(inner, dict):
            cands.extend([
                inner.get("floor_strike"),
                inner.get("cap_strike"),
                inner.get("strike_price"),
            ])
            if not ticker:
                ticker = inner.get("ticker")
    for raw in cands:
        try:
            if raw is None or raw == "":
                continue
            px = float(raw)
        except (TypeError, ValueError):
            continue
        if px > 0:
            return px
    return strike_from_kalshi_ticker(ticker)


def kalshi_result_to_side(raw: Any) -> Optional[str]:
    """Official Kalshi market result → UP (yes) / DOWN (no)."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        inner = raw.get("market") if isinstance(raw.get("market"), dict) else raw
        raw = (
            inner.get("result")
            or inner.get("settlement_result")
            or inner.get("outcome")
            or inner.get("y_finish")
        )
    text = str(raw or "").strip().lower()
    if text in ("yes", "y", "up"):
        return "UP"
    if text in ("no", "n", "down"):
        return "DOWN"
    return None


_FINAL_STATUS = frozenset({"finalized", "determined", "settled", "final", "closed"})
_LIVE_STATUS = frozenset({"active", "initialized", "open", "unopened"})

# Public API snapshots (not a model). Used to unstick 1062/1063 if fetch flaps.
KNOWN_OFFICIAL_FINISH: Dict[str, Dict[str, Any]] = {
    "KXBTCD-26AUG1415-T62999.99": {
        "ticker": "KXBTCD-26AUG1415-T62999.99",
        "status": "finalized",
        "result": "no",
        "y_finish": "DOWN",
        "expiration_value": 62857.17,
        "settlement_ts": "2026-08-14T19:02:44Z",
        "ids": (1062,),
    },
    "KXETHD-26AUG1415-T1874.99": {
        "ticker": "KXETHD-26AUG1415-T1874.99",
        "status": "finalized",
        "result": "no",
        "y_finish": "DOWN",
        "expiration_value": 1873.96,
        "settlement_ts": "2026-08-14T19:02:34Z",
        "ids": (1063,),
    },
}
KNOWN_OFFICIAL_BY_ID: Dict[int, str] = {
    1062: "KXBTCD-26AUG1415-T62999.99",
    1063: "KXETHD-26AUG1415-T1874.99",
}


def known_official_market(ticker: Any = None, call_id: Any = None) -> Optional[Dict[str, Any]]:
    """Return a documented official Kalshi finish, or None. Never invents a side."""
    t = str(ticker or "").strip()
    rec = KNOWN_OFFICIAL_FINISH.get(t)
    if rec:
        return dict(rec)
    try:
        cid = int(call_id)
    except (TypeError, ValueError):
        return None
    mapped = KNOWN_OFFICIAL_BY_ID.get(cid)
    if not mapped:
        return None
    rec = KNOWN_OFFICIAL_FINISH.get(mapped)
    if not rec:
        return None
    if t and t != mapped:
        return None
    return dict(rec)


def event_ticker_from_kalshi_ticker(ticker: Any) -> Optional[str]:
    """KXBTCD-26AUG1415-T62999.99 → KXBTCD-26AUG1415. Event, not a guessed side."""
    import re

    text = str(ticker or "").strip()
    if not text:
        return None
    m = re.match(r"^(KX(?:BTC|ETH)D-\d{2}[A-Z]{3}\d{4})", text, re.I)
    if m:
        return m.group(1).upper()
    if "-T" in text:
        return text.rsplit("-T", 1)[0]
    return None


def kalshi_market_finalized(raw: Any) -> bool:
    """True when Kalshi marks the market or event finalized/determined/settled."""
    if not isinstance(raw, dict):
        return False
    inner = raw.get("market") if isinstance(raw.get("market"), dict) else raw
    status = str(inner.get("status") or "").strip().lower()
    if status in _LIVE_STATUS:
        return False
    if status in _FINAL_STATUS:
        return True
    event = inner.get("event") if isinstance(inner.get("event"), dict) else raw.get("event")
    if isinstance(event, dict):
        es = str(event.get("status") or "").strip().lower()
        if es in _LIVE_STATUS:
            return False
        if es in _FINAL_STATUS:
            return True
    return bool(official_y_finish(inner) and status not in _LIVE_STATUS)


def is_known_official_snapshot(raw: Any) -> bool:
    """Documented 1062/1063 snapshot — not a live Kalshi fetch."""
    if not isinstance(raw, dict):
        return False
    t = str(raw.get("ticker") or "").strip()
    return bool(t in KNOWN_OFFICIAL_FINISH and raw.get("ids"))


def collect_official_results(payload: Any) -> Dict[str, Any]:
    """
    Pull finalized markets out of a get_market or get_event body.
    yes→UP / no→DOWN only. No model. No spot.
    """
    out: Dict[str, Any] = {}
    if not isinstance(payload, dict):
        return out
    markets: list = []
    inner = payload.get("market") if isinstance(payload.get("market"), dict) else payload
    if isinstance(payload.get("markets"), list):
        markets.extend(payload["markets"])
    if isinstance(inner.get("markets"), list):
        markets.extend(inner["markets"])
    event = payload.get("event") if isinstance(payload.get("event"), dict) else None
    if event is None and isinstance(inner.get("event"), dict):
        event = inner["event"]
    if isinstance(event, dict) and isinstance(event.get("markets"), list):
        markets.extend(event["markets"])
    if inner.get("ticker") and (inner.get("result") is not None or inner.get("status")):
        markets.append(inner)
    for m in markets:
        if not isinstance(m, dict):
            continue
        t = m.get("ticker")
        if not t:
            continue
        if official_y_finish(m):
            out[str(t)] = m
    return out


def tape_backfill_stats(open_rows: Any, results: Any = None) -> Dict[str, int]:
    """OPEN paper rows vs unique tickers vs tickers with an official yes/no."""
    rows = list(open_rows or [])
    tickers: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            t = row.get("ticker")
        else:
            t = getattr(row, "ticker", None)
        if t:
            tickers.append(str(t).strip())
    unique = sorted({t for t in tickers if t})
    finalized = 0
    recs = results if isinstance(results, dict) else {}
    for t in unique:
        rec = recs.get(t) or recs.get(t.upper())
        if official_y_finish(rec):
            finalized += 1
    return {
        "open_n": len(rows),
        "unique_tickers": len(unique),
        "finalized_tickers": finalized,
    }


def official_y_finish(raw: Any) -> Optional[str]:
    """
    y_finish from an official Kalshi result only.
    yes → UP, no → DOWN. No later-hour spot. No model.
    Writes only when the market is finalized / determined / settled
    or the public result field is already yes/no.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return kalshi_result_to_side(raw)
    inner = raw.get("market") if isinstance(raw.get("market"), dict) else raw
    status = str(inner.get("status") or "").strip().lower()
    side = kalshi_result_to_side(inner)
    if not side:
        return None
    if status in _LIVE_STATUS:
        return None
    if status in _FINAL_STATUS or status == "" or inner.get("result"):
        return side
    return None


def resolve_close_time(close_time: Any, ticker: Any = None) -> Optional[datetime]:
    ct = parse_iso_utc(close_time)
    if ct is not None:
        if ct.tzinfo is None:
            ct = ct.replace(tzinfo=timezone.utc)
        return ct
    return close_time_from_kalshi_ticker(ticker)


def resolve_finish_side(
    *,
    spot: Any = None,
    locked_strike: Any = None,
    ticker: Any = None,
    kalshi_result: Any = None,
) -> Optional[str]:
    """Closer: official Kalshi result only. Spot is ignored (later-hour prints lie)."""
    y = official_y_finish(kalshi_result)
    if y:
        return y
    known = known_official_market(ticker)
    return official_y_finish(known)


def decide_open_lock_grade(
    *,
    ticker: Any = None,
    call_id: Any = None,
    close_time: Any = None,
    direction: Any = None,
    kalshi_result: Any = None,
    now: datetime | None = None,
) -> Optional[Dict[str, Any]]:
    """
    Grade an OPEN paper lock after the official Kalshi hour close.

    y_finish comes from the official yes/no result (or a documented
    known finish). Later-hour spot is never used. A live Kalshi
    finalized/determined/settled result grades the whole tape, not
    just 1062/1063. Returns None if the hour is still open or Kalshi
    has not finalized.
    """
    side = normalize_side(direction)
    if side not in ("UP", "DOWN"):
        return None
    live = kalshi_result if official_y_finish(kalshi_result) else None
    live_final = bool(
        live
        and kalshi_market_finalized(kalshi_result)
        and not is_known_official_snapshot(kalshi_result)
    )
    # Live Kalshi finalized/determined/settled + yes/no is enough.
    # Documented 1062/1063 snapshots still wait for the official hour clock.
    if not live_final and not official_window_due(close_time, now=now, ticker=ticker):
        return None
    official = live
    if official is None:
        official = known_official_market(ticker, call_id)
    y_finish = official_y_finish(official)
    if y_finish is None:
        return None
    ct = resolve_close_time(close_time, ticker)
    matched = y_finish == side
    return {
        "y_finish": y_finish,
        "correct": matched,
        "settle_reason": "finish_match" if matched else "finish_miss",
        "asset": ticker_asset(ticker),
        "floor_strike": strike_from_kalshi_ticker(ticker),
        "close_iso": ct.isoformat() if ct is not None else None,
    }


def window_minutes_from_times(open_time: Any, close_time: Any) -> Optional[float]:
    start = parse_iso_utc(open_time)
    end = parse_iso_utc(close_time)
    if start is None or end is None:
        return None
    mins = (end - start).total_seconds() / 60.0
    if mins < 1.0 or mins > 24.0 * 60.0:
        return None
    return mins


def time_ev_hurdles(
    mins_left: float | None,
    window_minutes: float | None = None,
    min_p: float = 0.55,
    min_ev: float = 3.0,
    early_window_mins: float = 20.0,
    late_window_mins: float = 15.0,
    early_ev_mult: float = 1.5,
    late_min_p: float = 0.70,
    late_min_ev: float = 8.0,
) -> Dict[str, Any]:
    """
    First ~20 min of the official window: patient (higher EV hurdle).
    Middle: selective (base knobs).
    Last ~15 min: only a strong misprice.
    Last-15 wins when both could apply (short windows).
    """
    phase = "middle"
    out_p = float(min_p)
    out_ev = float(min_ev)
    duration = float(window_minutes) if window_minutes else 60.0
    try:
        ml = float(mins_left) if mins_left is not None else None
    except (TypeError, ValueError):
        ml = None

    if ml is not None:
        if ml <= float(late_window_mins):
            phase = "late"
            out_p = max(out_p, float(late_min_p))
            out_ev = max(out_ev, float(late_min_ev))
        else:
            elapsed = duration - ml
            if elapsed < float(early_window_mins):
                phase = "early"
                out_ev = float(min_ev) * float(early_ev_mult)
    return {
        "phase": phase,
        "min_p": out_p,
        "min_ev": out_ev,
    }


def _level_price_size(level: Any) -> tuple[Optional[float], Optional[float]]:
    if isinstance(level, (list, tuple)) and len(level) >= 2:
        try:
            return float(level[0]), float(level[1])
        except (TypeError, ValueError):
            return None, None
    if isinstance(level, dict):
        px = level.get("price") or level.get("px") or level.get("yes") or level.get("no")
        sz = level.get("size") or level.get("quantity") or level.get("qty") or level.get("delta")
        try:
            return float(px), float(sz)
        except (TypeError, ValueError):
            return None, None
    return None, None


def _levels_from_side(raw: Any) -> list[tuple[float, float]]:
    levels: list[tuple[float, float]] = []
    if raw is None:
        return levels
    if isinstance(raw, dict) and not any(k in raw for k in ("price", "px", "size", "quantity")):
        for px, sz in raw.items():
            try:
                levels.append((float(px), float(sz)))
            except (TypeError, ValueError):
                continue
        return levels
    if isinstance(raw, list):
        for level in raw:
            px, sz = _level_price_size(level)
            if px is None or sz is None:
                continue
            levels.append((px, sz))
    return levels


def parse_book_depth(orderbook: Any) -> Dict[str, Any]:
    """
    Top-of-book + shallow depth from a Kalshi orderbook payload.

    Accepts {orderbook: {yes, no}} or a bare {yes, no} / yes_dollars map.
    Prices may be cents or dollars. Size is contracts.
    """
    empty = {
        "yes_bid_px": None,
        "yes_bid_sz": None,
        "no_bid_px": None,
        "no_bid_sz": None,
        "yes_depth": 0.0,
        "no_depth": 0.0,
        "has_size": False,
    }
    if not orderbook:
        return dict(empty)
    book = orderbook
    if isinstance(orderbook, dict) and isinstance(orderbook.get("orderbook"), dict):
        book = orderbook["orderbook"]
    if not isinstance(book, dict):
        return dict(empty)

    yes_raw = book.get("yes") if book.get("yes") is not None else book.get("yes_dollars")
    no_raw = book.get("no") if book.get("no") is not None else book.get("no_dollars")
    yes_levels = _levels_from_side(yes_raw)
    no_levels = _levels_from_side(no_raw)
    if not yes_levels and not no_levels:
        return dict(empty)

    def _top_and_depth(levels: list[tuple[float, float]]) -> tuple[Optional[float], Optional[float], float]:
        if not levels:
            return None, None, 0.0
        # Best bid = highest price on that side
        ordered = sorted(levels, key=lambda x: x[0], reverse=True)
        top_px, top_sz = ordered[0]
        depth = sum(sz for _, sz in ordered[:3])
        return top_px, top_sz, depth

    yes_px, yes_sz, yes_depth = _top_and_depth(yes_levels)
    no_px, no_sz, no_depth = _top_and_depth(no_levels)
    has_size = any(sz is not None and sz > 0 for sz in (yes_sz, no_sz))
    return {
        "yes_bid_px": yes_px,
        "yes_bid_sz": yes_sz,
        "no_bid_px": no_px,
        "no_bid_sz": no_sz,
        "yes_depth": yes_depth,
        "no_depth": no_depth,
        "has_size": has_size,
    }


def playable_yes_mid(yes_mid: Any, lo: float = 20.0, hi: float = 80.0) -> bool:
    """Only play hours where YES mid is roughly 20–80¢."""
    mid = odds_to_cents(yes_mid)
    if mid is None:
        return False
    return float(lo) <= mid <= float(hi)


def early_lock_blocked(
    mins_left: Any,
    window_minutes: Any = 60.0,
    no_lock_mins: float = 10.0,
) -> bool:
    """No lock in the first `no_lock_mins` of the official hour."""
    try:
        ml = float(mins_left)
        dur = float(window_minutes) if window_minutes else 60.0
    except (TypeError, ValueError):
        return False
    elapsed = dur - ml
    return elapsed < float(no_lock_mins)


def late_spot_decisive(
    spot: Any,
    strike: Any,
    mins_left: Any,
    hourly_vol_pct: float = 0.40,
    k: float = 1.0,
) -> bool:
    """
    Last-15 lock only if the 60s CFB (or ranked 60s) average vs strike
    already beats remaining vol. Pass the 60s average, not a last-tick wick.
    Missing spot/strike → not decisive (WAIT).
    """
    try:
        px = float(spot)
        k0 = float(strike)
        ml = float(mins_left)
    except (TypeError, ValueError):
        return False
    if px <= 0 or k0 <= 0 or ml < 0:
        return False
    remaining = max(1.0 / 60.0, min(1.0, ml / 60.0))
    expected = float(hourly_vol_pct) / 100.0 * (remaining ** 0.5)
    gap = abs(px - k0) / k0
    return gap >= float(k) * expected


def dead_book_reason(
    depth: Dict[str, Any] | None,
    side: str | None,
    yes_mid: Any = None,
    max_side: float = 80.0,
) -> Optional[str]:
    """
    Skip dead hours: chosen side ≥80¢, mid outside 20–80, or one-sided book
    (yes_depth 0 / NO at 99¢).
    """
    mid = odds_to_cents(yes_mid)
    if mid is not None and not playable_yes_mid(mid):
        return f"YES mid {mid:.0f}¢ outside 20–80¢"
    if side not in ("UP", "DOWN"):
        return None
    if mid is not None:
        side_mid = mid if side == "UP" else (100.0 - mid)
        if side_mid >= float(max_side):
            return f"{side} already {side_mid:.0f}¢"
    if not depth:
        return None
    yes_depth = float(depth.get("yes_depth") or 0.0)
    no_depth = float(depth.get("no_depth") or 0.0)
    yes_bid = odds_to_cents(depth.get("yes_bid_px"))
    no_bid = odds_to_cents(depth.get("no_bid_px"))
    if side == "UP" and yes_depth <= 0:
        return "one-sided book · yes_depth 0"
    if side == "DOWN" and no_depth <= 0:
        return "one-sided book · no_depth 0"
    if side == "UP" and no_bid is not None and no_bid >= 99.0:
        return "one-sided book · NO at 99¢"
    if side == "DOWN" and yes_bid is not None and yes_bid >= 99.0:
        return "one-sided book · YES at 99¢"
    if side == "UP" and yes_bid is not None and yes_bid <= 1.0:
        return "one-sided book · YES ≤1¢"
    return None


def never_lock_near_certain(
    yes_ask: Any = None,
    no_ask: Any = None,
    side_odds: Any = None,
) -> Optional[str]:
    """
    Hard stop: never lock ≥99¢ or a one-sided 100¢ book.
    Stays in force even if the 80¢ playable cap is later raised.
    """
    ya = odds_to_cents(yes_ask)
    na = odds_to_cents(no_ask)
    so = odds_to_cents(side_odds)
    if so is not None and so >= 99.0:
        return "never lock ≥99¢"
    if ya is not None and ya >= 99.0:
        return "never lock ≥99¢"
    if na is not None and na >= 99.0:
        return "never lock ≥99¢"
    if ya is not None and ya >= 100.0:
        return "never lock one-sided 100¢"
    if na is not None and na >= 100.0:
        return "never lock one-sided 100¢"
    if (ya is None and na is not None and na >= 99.0) or (
        na is None and ya is not None and ya >= 99.0
    ):
        return "never lock one-sided 100¢"
    return None


def zach_band_skips_preferred(yes_mid: Any, leftover: Any, min_leftover: float = 0.0) -> bool:
    """
    20–80¢ two-sided with leftover after vig is playable.
    Do not WAIT solely for sitting outside 40–65 / 45–55.
    """
    try:
        left = float(leftover)
    except (TypeError, ValueError):
        return False
    return playable_yes_mid(yes_mid) and left > float(min_leftover)


def zach_bar_reason(
    yes_ask: Any,
    no_ask: Any = None,
    p_finish: Any = None,
    spread_cents: float | None = None,
    fee_cents: float | None = None,
    min_leftover: float | None = None,
    yes_mid: Any = None,
    side_ask: Any = None,
) -> Optional[str]:
    """
    Zach’s bar: 20–80¢ two-sided + leftover at the ask after fee.
    Never a 45–55-only band. ≥99¢ / one-sided 100¢ never lock.
    """
    near = never_lock_near_certain(yes_ask, no_ask, side_odds=side_ask)
    if near:
        return near
    mid = yes_mid if yes_mid is not None else yes_ask
    mid_c = odds_to_cents(mid)
    if mid_c is not None and not playable_yes_mid(mid_c):
        return f"YES mid {mid_c:.0f}¢ outside 20–80¢"
    ask = odds_to_cents(side_ask if side_ask is not None else yes_ask)
    if ask is None or p_finish is None:
        return "no leftover at the ask after vig"
    if min_leftover is None:
        try:
            from backend.config import settings
            min_leftover = float(getattr(settings, "MIN_EV_CENTS", 3.0))
        except Exception:
            min_leftover = 3.0
    leftover = leftover_after_vig(float(p_finish), float(ask), spread_cents, fee_cents)
    if leftover < float(min_leftover):
        return "no leftover at the ask after vig"
    return None


def _open_row_id_ticker(row: Any) -> tuple:
    if isinstance(row, dict):
        return row.get("id"), row.get("ticker")
    return getattr(row, "id", None), getattr(row, "ticker", None)


def stuck_hours_open(open_rows: Any) -> bool:
    """True while 1062/1063 (or their official tickers) are still OPEN."""
    for row in open_rows or []:
        rid, ticker = _open_row_id_ticker(row)
        try:
            if int(rid) in KNOWN_OFFICIAL_BY_ID:
                return True
        except (TypeError, ValueError):
            pass
        if str(ticker or "").strip() in KNOWN_OFFICIAL_FINISH:
            return True
    return False


def lifetime_n_for_zach(settled_n: Any, open_rows: Any = None) -> int:
    """n=0 until 1062/1063 settle. Do not treat Chair conf as a lifetime."""
    if stuck_hours_open(open_rows or []):
        return 0
    try:
        return max(0, int(settled_n or 0))
    except (TypeError, ValueError):
        return 0


def eth_hour_still_open(open_rows: Any) -> bool:
    """True while the stuck ETH official hour (1063) is still OPEN."""
    for row in open_rows or []:
        rid, ticker = _open_row_id_ticker(row)
        try:
            if int(rid) == 1063:
                return True
        except (TypeError, ValueError):
            pass
        t = str(ticker or "").strip()
        if t == "KXETHD-26AUG1415-T1874.99":
            return True
        if t in KNOWN_OFFICIAL_FINISH and t.startswith("KXETHD"):
            return True
    return False


def eth_settled_n_for_zach(eth_settled_n: Any, open_rows: Any = None) -> int:
    """ETH reliability n is 0 while 1063 is OPEN."""
    if eth_hour_still_open(open_rows or []):
        return 0
    try:
        return max(0, int(eth_settled_n or 0))
    except (TypeError, ValueError):
        return 0


def eth_reliability_ready(eth_settled_n: Any, min_n: int | None = None) -> bool:
    """ETH paper lock needs a finish-graded reliability bin."""
    if min_n is None:
        try:
            from backend.config import settings
            min_n = int(
                getattr(
                    settings,
                    "ETH_RELIABILITY_MIN_N",
                    getattr(settings, "CALIB_BAND_MIN_N", 8),
                )
            )
        except Exception:
            min_n = 8
    try:
        n = int(eth_settled_n or 0)
    except (TypeError, ValueError):
        n = 0
    return n >= int(min_n)


def eth_paper_lock_blocked(
    asset: Any,
    eth_settled_n: Any,
    min_n: int | None = None,
) -> Optional[str]:
    """
    BTC-only paper locks until ETH has a settled reliability bin.
    ETH specialists may still vote / Chair may WAIT. ETH veto stays elsewhere.
    """
    a = str(asset or "").strip().upper()
    if a not in ("ETH", "ETHEREUM"):
        return None
    if eth_reliability_ready(eth_settled_n, min_n):
        return None
    return "ETH paper lock waits for a settled reliability bin"


def paper_stake_for_lock(
    direction: Any,
    lifetime_n: Any = 0,
    chair_conf: Any = None,
) -> float:
    """
    Flat paper stake. Chair conf is not P(finish) and must not size the ticket.
    Empty lifetime never sizes up.
    """
    _ = chair_conf
    try:
        n = int(lifetime_n or 0)
    except (TypeError, ValueError):
        n = 0
    d = str(direction or "").upper()
    hold = d in ("UP_HOLD", "DOWN_HOLD", "HOLD")
    try:
        from backend.config import settings
        hold_amt = float(getattr(settings, "PAPER_STAKE_HOLD", 10.0))
        full_amt = float(getattr(settings, "PAPER_STAKE_DEFAULT", 25.0))
    except Exception:
        hold_amt, full_amt = 10.0, 25.0
    if hold:
        return hold_amt
    if n <= 0:
        return full_amt
    return full_amt


def book_too_thin(
    depth: Dict[str, Any] | None,
    side: str | None,
    min_size: float,
) -> bool:
    """True when we know size and the chosen side is thinner than min_size."""
    if not depth or not depth.get("has_size"):
        return False
    if side not in ("UP", "DOWN"):
        return False
    top = depth.get("yes_bid_sz") if side == "UP" else depth.get("no_bid_sz")
    shallow = depth.get("yes_depth") if side == "UP" else depth.get("no_depth")
    try:
        top_v = float(top) if top is not None else 0.0
        depth_v = float(shallow) if shallow is not None else top_v
    except (TypeError, ValueError):
        return False
    return top_v < float(min_size) or depth_v < float(min_size)


def odds_band_key(side_odds: float | None) -> Optional[str]:
    if side_odds is None:
        return None
    try:
        x = float(side_odds)
    except (TypeError, ValueError):
        return None
    if x < 40:
        return "0-40"
    if x < 50:
        return "40-50"
    if x < 60:
        return "50-60"
    if x < 70:
        return "60-70"
    if x < 80:
        return "70-80"
    return "80-100"


def band_tighten(
    stats: Dict[str, Any] | None,
    min_n: int = 8,
    miss_gap: float = 0.08,
    p_add: float = 0.05,
    ev_add: float = 2.0,
) -> Dict[str, Any]:
    """
    Predicted P vs realized finish rate for one odds band.
    Tighten only when the band loses money or is over-confident.
    """
    out = {
        "p_add": 0.0,
        "ev_add": 0.0,
        "losing": False,
        "predicted": None,
        "realized": None,
        "tries": 0,
        "pnl_sum": 0.0,
    }
    if not stats:
        return out
    try:
        tries = int(stats.get("tries") or 0)
        hits = int(stats.get("hits") or 0)
        p_sum = float(stats.get("p_sum") or 0.0)
        pnl_sum = float(stats.get("pnl_sum") or 0.0)
    except (TypeError, ValueError):
        return out
    out["tries"] = tries
    out["pnl_sum"] = pnl_sum
    if tries < int(min_n):
        return out
    realized = hits / tries
    predicted = (p_sum / tries) if tries else None
    out["realized"] = round(realized, 4)
    out["predicted"] = round(predicted, 4) if predicted is not None else None
    overconfident = predicted is not None and realized < (predicted - float(miss_gap))
    losing_money = pnl_sum < 0.0
    if overconfident or losing_money:
        out["losing"] = True
        out["p_add"] = float(p_add)
        out["ev_add"] = float(ev_add)
    return out


def normalize_side(direction: Any) -> str:
    d = str(direction or "WAIT").upper()
    if d in ("UP", "UP_HOLD"):
        return "UP"
    if d in ("DOWN", "DOWN_HOLD"):
        return "DOWN"
    return "WAIT"


def hour_spot_delta_pct(
    candles: Any,
    price: Any,
    now: datetime | None = None,
) -> Optional[float]:
    """Hour-open → now, in percent. Missing open/price → None."""
    try:
        px = float(price)
    except (TypeError, ValueError):
        return None
    if px <= 0:
        return None
    stamp = now or datetime.now(timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    hour_ms = int(stamp.replace(minute=0, second=0, microsecond=0).timestamp() * 1000)
    open_px = None
    for c in candles or []:
        if not isinstance(c, dict):
            continue
        t = c.get("t") if c.get("t") is not None else c.get("open_time")
        o = c.get("o") if c.get("o") is not None else c.get("open")
        try:
            t_ms = int(t)
            o_px = float(o)
        except (TypeError, ValueError):
            continue
        if t_ms >= hour_ms and o_px > 0:
            open_px = o_px
            break
    if open_px is None or open_px <= 0:
        return None
    return (px - open_px) / open_px * 100.0


def build_btc_lead(
    direction: Any,
    locked: bool = False,
    candles: Any = None,
    price: Any = None,
    impulse_pct: float = 0.15,
    strong_pct: float = 0.25,
    now: datetime | None = None,
) -> Dict[str, Any]:
    """Satoshi snapshot for Vitalik: side, lock, hour spot delta, impulse."""
    side = normalize_side(direction)
    delta = hour_spot_delta_pct(candles, price, now=now)
    try:
        impulse_thr = float(impulse_pct)
        strong_thr = float(strong_pct)
    except (TypeError, ValueError):
        impulse_thr, strong_thr = 0.15, 0.25
    if side not in ("UP", "DOWN") and delta is not None:
        if delta >= impulse_thr:
            side = "UP"
        elif delta <= -impulse_thr:
            side = "DOWN"
    impulse = bool(
        side in ("UP", "DOWN")
        and (locked or (delta is not None and abs(delta) >= impulse_thr))
    )
    strong = bool(
        side in ("UP", "DOWN")
        and (locked or (delta is not None and abs(delta) >= strong_thr))
    )
    return {
        "direction": side,
        "locked": bool(locked),
        "spot_delta_pct": None if delta is None else round(float(delta), 4),
        "impulse": impulse,
        "strong": strong,
    }


def eth_fades_btc_impulse(lean: Any, btc_lead: Any) -> bool:
    """True when ETH would lock opposite a same-hour BTC impulse."""
    if not isinstance(btc_lead, dict) or not btc_lead.get("impulse"):
        return False
    bd = normalize_side(btc_lead.get("direction"))
    side = normalize_side(lean)
    if side not in ("UP", "DOWN") or bd not in ("UP", "DOWN"):
        return False
    return side != bd


def official_window_due(close_time: Any, now: datetime | None = None, ticker: Any = None) -> bool:
    """
    Grade only after the official Kalshi close.
    If close_time is missing, infer it from the contract ticker (never invent a clock).
    """
    ct = resolve_close_time(close_time, ticker)
    if ct is None:
        return False
    stamp = now or datetime.now(timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp >= ct


def pick_settle_spot(current: Any, last: Any = None) -> Optional[float]:
    """Prefer this cycle's spot; fall back to the last good print. Never use 0."""
    for cand in (current, last):
        try:
            px = float(cand)
        except (TypeError, ValueError):
            continue
        if px > 0:
            return px
    return None


def finish_outcome(spot: Any, strike: Any) -> Optional[str]:
    """UP if spot > exact strike, DOWN if spot < strike. Tie is unresolved."""
    try:
        px = float(spot)
        k = float(strike)
    except (TypeError, ValueError):
        return None
    if px > k:
        return "UP"
    if px < k:
        return "DOWN"
    return None
