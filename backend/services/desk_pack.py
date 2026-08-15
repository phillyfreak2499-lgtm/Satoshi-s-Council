"""
Read-only desk pack: Chair tape, Kalshi book, huddle recap, hour news.

Display only. Does not lock, size, grade, or change Chair math.
Does not import follower, Kalshi trade keys, or secrets.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import (
    close_time_from_kalshi_ticker,
    is_eth_shadow_row,
    odds_to_cents,
    parse_book_depth,
    ticker_asset,
)
from backend.agents.roster import display_name

CT = ZoneInfo("America/Chicago")

TAPE_HOURS = 24
P_BUCKETS: Tuple[Tuple[str, float, float], ...] = (
    ("50–60%", 0.50, 0.60),
    ("60–70%", 0.60, 0.70),
    ("70–80%", 0.70, 0.80),
    ("80%+", 0.80, 1.01),
    ("under 50%", 0.0, 0.50),
)


def _parse_iso(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _in_last_hours(dt: Optional[datetime], hours: int, now: Optional[datetime] = None) -> bool:
    if dt is None:
        return False
    n = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (n - dt) <= timedelta(hours=int(hours))


def window_label_ct(ticker: Any = None, close_time: Any = None) -> str:
    """Hour window in America/Chicago, e.g. 'Aug 14 14:00–15:00 CT'."""
    close = _parse_iso(close_time) or close_time_from_kalshi_ticker(ticker)
    if close is None:
        tick = str(ticker or "")
        m = None
        try:
            import re
            m = re.search(r"(\d{2})(\d{2})(?!.*\d)", tick)
        except Exception:
            m = None
        if m:
            return f"{m.group(1)}:{m.group(2)} CT"
        return "1H"
    local = close.astimezone(CT)
    start = local - timedelta(hours=1)
    day = str(int(start.strftime("%d")))
    return f"{start.strftime('%b')} {day} {start.strftime('%H:%M')}–{local.strftime('%H:%M')} CT"


def _side_of(row: Dict[str, Any]) -> str:
    d = str(row.get("direction") or row.get("paper_side") or "").upper()
    if "UP" in d:
        return "UP"
    if "DOWN" in d:
        return "DOWN"
    return ""


def _p_finish_unit(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    try:
        p = float(raw)
    except (TypeError, ValueError):
        return None
    if p > 1.0:
        p = p / 100.0
    if p <= 0 or p >= 1.5:
        return None
    return max(0.01, min(0.99, p))


def tape_result(row: Dict[str, Any]) -> str:
    """
    OPEN unless official Kalshi finish is on the row.
    Never invent HIT/MISS from spot or a missing y_finish.
    """
    y = str(row.get("y_finish") or "").upper()
    reason = str(row.get("settle_reason") or "")
    official = y in ("UP", "DOWN") and reason in ("finish_match", "finish_miss")
    if not official:
        return "OPEN"
    if row.get("correct") is True or row.get("correct") == 1:
        return "HIT"
    if row.get("correct") is False or row.get("correct") == 0:
        return "MISS"
    return "OPEN"


def tape_row_from_call(row: Dict[str, Any]) -> Dict[str, Any]:
    result = tape_result(row)
    p = _p_finish_unit(row.get("p_finish"))
    odds = odds_to_cents(row.get("side_ask") if row.get("side_ask") is not None else row.get("open_price") or row.get("entry_side_pct"))
    ev = row.get("ev_cents")
    try:
        ev_f = float(ev) if ev is not None else None
    except (TypeError, ValueError):
        ev_f = None
    pnl = row.get("paper_pnl") if result != "OPEN" else None
    if result == "OPEN":
        pnl = None
    asset = (row.get("asset") or ticker_asset(row.get("ticker")) or "").lower()
    return {
        "window": window_label_ct(row.get("ticker"), row.get("close_time")),
        "asset": "eth" if asset == "eth" else "btc",
        "side": _side_of(row) or "—",
        "p_finish": round(p, 3) if p is not None else None,
        "ev_cents": round(ev_f, 2) if ev_f is not None else None,
        "odds": round(odds, 1) if odds is not None else None,
        "result": result,
        "pnl": round(float(pnl), 2) if pnl is not None else None,
        "ticker": row.get("ticker"),
        "called_at": row.get("called_at"),
        "close_time": row.get("close_time"),
        "status": "open" if result == "OPEN" else "settled",
        "kind": row.get("kind") or "chair",
    }


def calibration_strip(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Predicted P(finish) buckets vs realized hit rate. Settled official grades only."""
    buckets: Dict[str, Dict[str, float]] = {
        label: {"n": 0, "hits": 0, "p_sum": 0.0}
        for label, _, _ in P_BUCKETS
    }
    for row in rows:
        if tape_result(row) == "OPEN":
            continue
        p = _p_finish_unit(row.get("p_finish"))
        if p is None:
            continue
        hit = tape_result(row) == "HIT"
        for label, lo, hi in P_BUCKETS:
            if lo <= p < hi:
                buckets[label]["n"] += 1
                buckets[label]["p_sum"] += p
                if hit:
                    buckets[label]["hits"] += 1
                break
    out = []
    for label, _, _ in P_BUCKETS:
        b = buckets[label]
        n = int(b["n"])
        predicted = (b["p_sum"] / n) if n else None
        realized = (b["hits"] / n) if n else None
        out.append({
            "bucket": label,
            "n": n,
            "predicted": round(predicted, 3) if predicted is not None else None,
            "realized": round(realized, 3) if realized is not None else None,
            "gap": round(realized - predicted, 3) if predicted is not None and realized is not None else None,
        })
    return out


def chair_tape_payload(rows: List[Dict[str, Any]], hours: int = TAPE_HOURS) -> Dict[str, Any]:
    chair = [r for r in rows if (r.get("kind") or "chair") != "eth_shadow" and not r.get("shadow")]
    tape = [tape_row_from_call(r) for r in chair]
    tape.sort(key=lambda r: str(r.get("called_at") or r.get("close_time") or ""), reverse=True)
    return {
        "hours": int(hours),
        "timezone": "America/Chicago",
        "empty": not tape,
        "rows": tape,
        "calibration": calibration_strip(chair),
        "note": "Official Kalshi market.result only. Open hours stay OPEN.",
    }


def book_flags(
    depth: Dict[str, Any] | None,
    yes_bid: Any = None,
    yes_ask: Any = None,
    no_bid: Any = None,
    no_ask: Any = None,
) -> Dict[str, Any]:
    """Display flags only — does not change lock gates."""
    d = depth or {}
    yb = odds_to_cents(yes_bid if yes_bid is not None else d.get("yes_bid_px"))
    ya = odds_to_cents(yes_ask)
    nb = odds_to_cents(no_bid if no_bid is not None else d.get("no_bid_px"))
    na = odds_to_cents(no_ask)
    yes_depth = float(d.get("yes_depth") or 0.0)
    no_depth = float(d.get("no_depth") or 0.0)
    has_size = bool(d.get("has_size"))
    empty = (not d) or (yes_depth <= 0 and no_depth <= 0) or not has_size
    wall = any(px is not None and px >= 99.0 for px in (yb, ya, nb, na))
    sick = empty or (yes_depth <= 0) or (no_depth <= 0)
    flag = None
    if empty:
        flag = "empty book"
    elif wall:
        flag = "≥99¢ wall"
    elif sick:
        flag = "sick book"
    spread = None
    mid = None
    if yb is not None and ya is not None:
        spread = round(abs(ya - yb), 1)
        mid = round((ya + yb) / 2.0, 1)
    elif yb is not None:
        mid = yb
    return {
        "empty": empty,
        "sick": sick,
        "wall_99": wall,
        "flag": flag,
        "yes_bid": yb,
        "yes_ask": ya,
        "no_bid": nb,
        "no_ask": na,
        "yes_bid_sz": d.get("yes_bid_sz"),
        "no_bid_sz": d.get("no_bid_sz"),
        "yes_depth": yes_depth,
        "no_depth": no_depth,
        "spread": spread,
        "mid": mid,
        "has_size": has_size,
    }


def book_side_from_market(market: Dict[str, Any] | None, *, chair: str, asset: str) -> Dict[str, Any]:
    m = market if isinstance(market, dict) else {}
    raw_book = m.get("kalshi_orderbook") or m.get("orderbook")
    depth = parse_book_depth(raw_book)
    yb = m.get("kalshi_yes_bid") if m.get("kalshi_yes_bid") is not None else m.get("yes_bid")
    ya = m.get("kalshi_yes_ask") if m.get("kalshi_yes_ask") is not None else m.get("yes_ask")
    flags = book_flags(
        depth,
        yes_bid=yb,
        yes_ask=ya,
        no_bid=depth.get("no_bid_px"),
        no_ask=None,
    )
    ticker = m.get("kalshi_ticker") or m.get("ticker")
    return {
        "chair": chair,
        "asset": asset,
        "ticker": ticker,
        "window": window_label_ct(ticker, m.get("close_time")),
        **flags,
    }


def book_payload(btc_market: Dict[str, Any] | None, eth_market: Dict[str, Any] | None) -> Dict[str, Any]:
    satoshi = book_side_from_market(btc_market, chair="SATOSHI", asset="btc")
    vitalik = book_side_from_market(eth_market, chair="VITALIK", asset="eth")
    return {
        "satoshi": satoshi,
        "vitalik": vitalik,
        "note": "Live Kalshi depth. Flags explain WAIT — they do not lock.",
    }


_ADMIN_KNOB_KEYS = {
    "l20_bump", "law_bump", "cool_down", "confluence_bump", "rebuilt_windows",
    "housekeeping", "activity", "phase",
}


def _seat_public(row: Dict[str, Any], table: str) -> Dict[str, Any]:
    name = row.get("display_name") or display_name(str(row.get("agent") or row.get("name") or ""))
    return {
        "seat": name,
        "table": table,
        "rank": row.get("rank"),
        "win_rate": row.get("win_rate"),
    }


def brain_recap_from_report(
    report: Dict[str, Any] | None,
    hierarchy_btc: List[Dict[str, Any]] | None = None,
    hierarchy_eth: List[Dict[str, Any]] | None = None,
    scorecard: Dict[str, Any] | None = None,
    btc_acc: Dict[str, Any] | None = None,
    eth_acc: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Public huddle / weight-move recap. No admin knobs."""
    if not report or not report.get("complete"):
        return {
            "empty": True,
            "headline": "No huddle recap yet",
            "note": "The nightly 3:00 AM CT huddle has not written a report.",
            "louder": [],
            "faded": [],
            "satoshi": None,
            "vitalik": None,
            "went_well": [],
            "went_poor": [],
            "patterns": [],
        }
    louder: List[Dict[str, Any]] = []
    faded: List[Dict[str, Any]] = []
    for table, hier in (("satoshi", hierarchy_btc or []), ("vitalik", hierarchy_eth or [])):
        for r in hier:
            if r.get("faded") or r.get("hard_mute"):
                faded.append({**_seat_public(r, table), "note": "faded"})
            elif r.get("listen") is not None and float(r.get("listen") or 0) >= 0.85 and (r.get("rank") or 99) <= 5:
                louder.append({**_seat_public(r, table), "note": "louder"})
    notes = [str(x) for x in (report.get("consolidate_notes") or []) if x]
    for n in notes:
        low = n.lower()
        if "promote" in low or "dampen" in low:
            # Public one-liner only — no bump sizes
            if "dampen" in low:
                faded.append({"seat": "night pass", "table": "satoshi", "note": "seats damped"})
            if "promote" in low:
                louder.append({"seat": "night pass", "table": "satoshi", "note": "seats promoted"})
    for r in (report.get("top_ranks") or [])[:4]:
        louder.append({
            "seat": r.get("name") or r.get("display_name"),
            "table": "satoshi",
            "rank": r.get("rank"),
            "win_rate": r.get("win_rate"),
            "note": "top of the huddle",
        })
    # Dedupe seats
    def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = set()
        out = []
        for it in items:
            key = (it.get("seat"), it.get("table"), it.get("note"))
            if key in seen or not it.get("seat"):
                continue
            seen.add(key)
            out.append(it)
        return out[:8]

    def _table_card(label: str, acc: Dict[str, Any] | None) -> Dict[str, Any]:
        a = acc or {}
        n = int(a.get("total") or 0)
        pct = a.get("accuracy_pct")
        return {
            "chair": label,
            "n": n,
            "hit_rate": pct,
            "note": "still collecting" if n == 0 else f"{a.get('correct') or 0}/{n} finish-only",
        }

    date = report.get("date")
    return {
        "empty": False,
        "date": date,
        "timezone": "America/Chicago",
        "headline": f"Huddle {date}" if date else "Last huddle",
        "went_well": list(report.get("went_well") or [])[:6],
        "went_poor": list(report.get("went_poor") or [])[:6],
        "patterns": [p for p in (report.get("patterns") or []) if "n=" not in str(p).lower() or "phase" in str(p).lower()][:6],
        "louder": _dedupe(louder),
        "faded": _dedupe(faded),
        "satoshi": _table_card("SATOSHI", btc_acc),
        "vitalik": _table_card("VITALIK", eth_acc),
        "scorecard": {
            "btc": (scorecard or {}).get("btc"),
            "eth": (scorecard or {}).get("eth"),
            "lead": (scorecard or {}).get("lead"),
        } if scorecard else None,
        "note": "Public recap. Admin knobs stay in Settings.",
    }


def crawl_locks(rows: List[Dict[str, Any]], current: List[Dict[str, Any]] | None = None, limit: int = 5) -> List[str]:
    """Sports-crawl chips: 'BTC DOWN', 'ETH WAIT'."""
    chips: List[str] = []
    for c in current or []:
        pair = str(c.get("pair") or c.get("asset") or "").upper()
        if pair in ("BITCOIN", "BTC"):
            pair = "BTC"
        elif pair in ("ETHEREUM", "ETH"):
            pair = "ETH"
        side = str(c.get("side") or "WAIT").upper()
        if pair in ("BTC", "ETH") and side in ("UP", "DOWN", "WAIT"):
            chips.append(f"{pair} {side}")
    for r in rows:
        if len(chips) >= limit:
            break
        asset = (r.get("asset") or ticker_asset(r.get("ticker")) or "").lower()
        pair = "ETH" if asset == "eth" else "BTC"
        side = _side_of(r) or "WAIT"
        chip = f"{pair} {side}"
        if chip not in chips:
            chips.append(chip)
    return chips[:limit]


async def load_chair_tape_rows(store: Any, hours: int = TAPE_HOURS) -> List[Dict[str, Any]]:
    getter = getattr(store, "chair_tape_24h", None)
    if callable(getter):
        rows = await getter(hours=hours)
        return list(rows or [])
    # Fallback: stitch existing read APIs
    settled = []
    opens = []
    if hasattr(store, "recent_settled_calls"):
        settled = await store.recent_settled_calls(limit=200)
    if hasattr(store, "list_open_calls"):
        opens = await store.list_open_calls()
    now = datetime.now(timezone.utc)
    out = []
    for r in list(opens or []) + list(settled or []):
        if is_eth_shadow_row(r) or r.get("shadow") or r.get("kind") == "eth_shadow":
            continue
        when = _parse_iso(r.get("called_at") or r.get("close_time") or r.get("settled_at"))
        if r.get("actual_outcome") is None or r.get("y_finish") is None:
            out.append(r)
            continue
        if _in_last_hours(when, hours, now):
            out.append(r)
    return out


def why_line(
    decision: Dict[str, Any] | None = None,
    market: Dict[str, Any] | None = None,
    health: Dict[str, Any] | None = None,
    locked_call: Dict[str, Any] | None = None,
) -> str:
    """
    One live line under the Chair. This hour only. No paragraph, no debug dump.
    Reads existing summary/gates — does not lock or grade.
    """
    d = decision if isinstance(decision, dict) else {}
    m = market if isinstance(market, dict) else {}
    h = health if isinstance(health, dict) else {}
    lc = locked_call if isinstance(locked_call, dict) else (d.get("locked_call") or {})
    locked = bool(lc.get("locked") and str(lc.get("direction") or "").upper() in ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD"))
    raw_side = str((lc.get("direction") if locked else d.get("direction")) or "WAIT").upper()
    side = "UP" if "UP" in raw_side else ("DOWN" if "DOWN" in raw_side else "WAIT")
    flags = book_flags(
        parse_book_depth(m.get("kalshi_orderbook") or m.get("orderbook")),
        yes_bid=m.get("kalshi_yes_bid") if m.get("kalshi_yes_bid") is not None else m.get("yes_bid") or m.get("up_pct"),
        yes_ask=m.get("kalshi_yes_ask") if m.get("kalshi_yes_ask") is not None else m.get("yes_ask"),
        no_bid=None,
        no_ask=None,
    )

    def _desk_cents(raw: Any) -> Optional[float]:
        """Desk quotes are 0–100¢. Scale true fractions only; 1 stays 1¢."""
        if raw is None:
            return None
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return None
        if 0 < v < 1.0:
            v *= 100.0
        return v

    yb = _desk_cents(
        m.get("kalshi_yes_bid") if m.get("kalshi_yes_bid") is not None else m.get("yes_bid") or m.get("up_pct")
    )
    ya = _desk_cents(m.get("kalshi_yes_ask") if m.get("kalshi_yes_ask") is not None else m.get("yes_ask"))
    down_px = _desk_cents(m.get("down_pct") if m.get("down_pct") is not None else m.get("no_bid"))
    if down_px is None and yb is not None:
        down_px = round(100.0 - float(yb), 1)
    ev = lc.get("ev_cents") if lc.get("ev_cents") is not None else d.get("ev_cents")
    try:
        ev_f = float(ev) if ev is not None else None
    except (TypeError, ValueError):
        ev_f = None
    stale = bool(m.get("stale") or h.get("stale"))
    age = h.get("quote_age_s")
    try:
        if age is not None and float(age) > 20:
            stale = True
    except (TypeError, ValueError):
        pass
    empty = bool(flags.get("empty")) and yb is None and ya is None
    wall99 = (yb is not None and yb >= 99) or (down_px is not None and down_px >= 99) or (ya is not None and ya >= 99)

    def _ev_bit() -> str:
        if ev_f is None:
            return ""
        sign = "+" if ev_f >= 0 else ""
        return f"EV {sign}{ev_f:.0f}¢"

    if locked:
        extras = []
        if flags.get("has_size") and not flags.get("empty"):
            extras.append("book has size")
        evb = _ev_bit()
        if evb:
            extras.append(evb)
        if extras:
            return f"LOCK {side} · " + ", ".join(extras)
        return f"LOCK {side}"

    bits = ["WAIT"]
    if wall99 and down_px is not None and down_px >= 99:
        bits.append("DOWN is 99¢, no edge")
    elif wall99 and yb is not None and yb >= 99:
        bits.append("UP is 99¢, no edge")
    elif wall99:
        bits.append("≥99¢ wall, no edge")
    elif empty:
        bits.append("empty book")
    elif flags.get("sick"):
        bits.append("sick book")
    elif stale:
        bits.append("stale quote")
    elif ev_f is not None and ev_f <= 0:
        bits.append("no edge")
    else:
        summary = str(d.get("summary") or "")
        if "dead book" in summary.lower():
            bits.append("dead book")
        elif "fresh quote" in summary.lower() or "stale" in summary.lower():
            bits.append("stale quote")
        elif ev_f is not None:
            bits.append(_ev_bit())
        else:
            bits.append("no edge")
    return " · ".join(bits[:3])


def close_print(row: Dict[str, Any] | None, *, pair: str, lean: str = "WAIT") -> Dict[str, Any]:
    """Hour-close chip. OPEN unless official Kalshi finish is on the row."""
    if not row:
        side = lean if lean in ("UP", "DOWN", "WAIT") else "WAIT"
        return {"pair": pair, "side": side, "result": "OPEN" if side != "WAIT" else "WAIT", "pnl": None}
    result = tape_result(row)
    side = _side_of(row) or lean
    pnl = row.get("paper_pnl") if result != "OPEN" else None
    return {
        "pair": pair,
        "side": side or "WAIT",
        "result": result if side != "WAIT" else "WAIT",
        "pnl": round(float(pnl), 2) if pnl is not None and result != "OPEN" else None,
    }


def health_strip_from_health(payload: Dict[str, Any] | None) -> Dict[str, Any]:
    """Tiny strip shape that matches /health fields."""
    h = payload if isinstance(payload, dict) else {}
    age = h.get("quote_age_s")
    if age is None:
        age = h.get("state_age_s")
    try:
        age_s = float(age) if age is not None else None
    except (TypeError, ValueError):
        age_s = None
    kalshi = h.get("kalshi_ok")
    if kalshi is None:
        kalshi = bool(h.get("kalshi_btc_ok", True)) and (h.get("kalshi_eth_ok") is not False)
    return {
        "kalshi": bool(kalshi),
        "spot": bool(h.get("spot_ok")),
        "coinglass": bool(h.get("coinglass_ok")),
        "quote_age_s": round(age_s) if age_s is not None else None,
        "status": h.get("status") or "ok",
    }
