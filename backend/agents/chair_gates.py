"""
Paper-only Chair gates: P(finish), EV, book depth, official window, odds bands.

No live Kalshi orders. Helpers stay pure so the lock path and tests share one
definition of the math.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


def clamp_p_finish(conf: Any) -> float:
    """p_finish = clamp(Chair conf / 100, 0.01, 0.99)."""
    try:
        raw = float(conf) / 100.0
    except (TypeError, ValueError):
        raw = 0.01
    return max(0.01, min(0.99, raw))


def compute_ev_cents(
    p_finish: float,
    side_mid: float,
    spread_cents: float | None = None,
) -> float:
    """ev_cents = 100*p_finish − chosen-side mid − half_spread."""
    half = 0.0
    try:
        if spread_cents is not None:
            half = max(0.0, float(spread_cents) / 2.0)
    except (TypeError, ValueError):
        half = 0.0
    return float(100.0 * float(p_finish) - float(side_mid) - half)


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
