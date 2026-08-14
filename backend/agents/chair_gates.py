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


def estimate_p_finish(conf: Any, settled_n: int = 0) -> float:
    """
    Shrink Chair confidence toward a coin-flip until enough finish-graded hours.
    91% Chair on a cold book is the lesson — that is not P(finish).
    """
    raw = clamp_p_finish(conf)
    try:
        n = int(settled_n or 0)
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
    Last-15 lock only if spot vs strike already beats remaining vol.
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


def official_window_due(close_time: Any, now: datetime | None = None) -> bool:
    """
    Grade only after the official Kalshi close.
    Missing or unparseable close_time → not due (never invent a close).
    """
    ct = parse_iso_utc(close_time)
    if ct is None:
        return False
    stamp = now or datetime.now(timezone.utc)
    if ct.tzinfo is None:
        ct = ct.replace(tzinfo=timezone.utc)
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
