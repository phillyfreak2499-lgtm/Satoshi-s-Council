"""
ORACLE — CRT chair. Paper only. Never talks to Follower.

Four seats feed the chair: SIBYL / PIT / VEIL / MARBLE.
Paper LOCK when they agree and the book is playable.
Sit when they split or the book is dead.
Same Satoshi gates: 20–80 after vig, EV at ask, dead-book sit.
Follower OFF. No live Kalshi orders.
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import (
    book_is_unknown,
    dead_book_reason,
    kalshi_taker_fee_cents,
    leftover_after_vig,
    never_lock_near_certain,
    odds_to_cents,
    paper_lock_day_ok,
    playable_yes_mid,
)
from backend.config import settings
from backend.data.kalshi import LADDER_P_FINISH, market_quotes, pick_hour_book

CT = ZoneInfo("America/Chicago")
_Fetch = Callable[[str, Dict[str, Any]], Any]

ORACLE_YES_LO = 20.0
ORACLE_YES_HI = 80.0
P_FINISH = float(LADDER_P_FINISH)
THIN_DEPTH = 20.0
BOARD_TTL_S = 20.0

SEATS: tuple[Dict[str, Any], ...] = (
    {
        "id": "SIBYL",
        "job": "THE READ. First hit of the static.",
        "mark": "/static/bots/sibyl.svg",
        "weight": 1.0,
    },
    {
        "id": "PIT",
        "job": "THE WELL. Drops what the glass will not say.",
        "mark": "/static/bots/ora-pit.svg",
        "weight": 1.0,
    },
    {
        "id": "VEIL",
        "job": "THE MASK. Cuts the fake signal.",
        "mark": "/static/bots/veil.svg",
        "weight": 1.0,
    },
    {
        "id": "MARBLE",
        "job": "THE SLAB. Cold cut. No heat.",
        "mark": "/static/bots/marble.svg",
        "weight": 1.0,
    },
)
CHAIR: Dict[str, str] = {
    "id": "ORACLE",
    "name": "ORACLE",
    "job": "CRT chair. Paper lock when the four agree. Follower OFF.",
    "mark": "/oracle-wait.jpg",
    "portrait": "/oracle-wait.jpg",
}

_board_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
_fills: List[Dict[str, Any]] = []
_fills_loaded = False
_data_override: Optional[Path] = None


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    global _fills, _fills_loaded, _board_cache, _data_override
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _data_override = data_dir
    try:
        from backend.services import desk_hunter

        desk_hunter.reset_for_tests()
    except Exception:
        pass


def _data_path(name: str) -> Path:
    root = _data_override or Path(getattr(settings, "DATA_DIR", None) or "./data")
    root.mkdir(parents=True, exist_ok=True)
    return root / name


def _load_fills() -> List[Dict[str, Any]]:
    global _fills, _fills_loaded
    if _fills_loaded:
        return _fills
    path = _data_path("oracle_table.json")
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            rows = data.get("fills") if isinstance(data, dict) else data
            if isinstance(rows, list):
                _fills = [r for r in rows if isinstance(r, dict)]
    except Exception:
        _fills = []
    _fills_loaded = True
    return _fills


def _save_fills() -> None:
    _data_path("oracle_table.json").write_text(
        json.dumps({"fills": _fills[-400:]}, indent=2), encoding="utf-8"
    )


def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _now_ct(now: Optional[datetime] = None) -> datetime:
    n = now or datetime.now(CT)
    if n.tzinfo is None:
        return n.replace(tzinfo=CT)
    return n.astimezone(CT)


def quotes_of(book: Optional[Dict[str, Any]]) -> Dict[str, Optional[float]]:
    row = book if isinstance(book, dict) else {}
    q = market_quotes(row)
    if q.get("yes_mid") is None:
        mid = odds_to_cents(row.get("yes_mid"))
        if mid is not None:
            q["yes_mid"] = mid
    return q


def depth_of(book: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    row = book if isinstance(book, dict) else {}
    raw = row.get("depth") if isinstance(row.get("depth"), dict) else row
    yes_d = _f(raw.get("yes_depth") if raw.get("yes_depth") is not None else raw.get("yes"))
    no_d = _f(raw.get("no_depth") if raw.get("no_depth") is not None else raw.get("no"))
    measured = bool(raw.get("measured") or raw.get("has_size") or raw.get("book_state") in ("dead", "ok", "one_sided"))
    if row.get("book_known") is False and not measured:
        return {"book_state": "unknown", "measured": False, "yes_depth": 0.0, "no_depth": 0.0}
    if yes_d is None and no_d is None and not measured:
        vol = _f(row.get("volume_fp") if row.get("volume_fp") is not None else row.get("volume"))
        oi = _f(row.get("open_interest_fp") if row.get("open_interest_fp") is not None else row.get("oi"))
        if vol is None and oi is None:
            return {"book_state": "unknown", "measured": False, "yes_depth": 0.0, "no_depth": 0.0}
        yes_d = max(0.0, (vol or 0.0) * 0.5)
        no_d = max(0.0, (vol or 0.0) * 0.5)
        measured = True
    q = quotes_of(row)
    state = "ok"
    if measured and (yes_d or 0) <= 0 and (no_d or 0) <= 0:
        state = "dead"
    elif measured and ((yes_d or 0) <= 0) != ((no_d or 0) <= 0):
        state = "one_sided"
    return {
        "yes_depth": yes_d or 0.0,
        "no_depth": no_d or 0.0,
        "yes_bid_px": q.get("yes_bid"),
        "no_bid_px": q.get("no_bid"),
        "measured": measured,
        "has_size": measured and ((yes_d or 0) > 0 or (no_d or 0) > 0),
        "book_state": state,
    }


def leftover_sides(book: Optional[Dict[str, Any]]) -> Dict[str, Optional[float]]:
    q = quotes_of(book)
    ya, na = q.get("yes_ask"), q.get("no_ask")
    yb = q.get("yes_bid")
    spread = None
    if yb is not None and ya is not None:
        spread = max(0.0, float(ya) - float(yb))
    left_up = None
    left_dn = None
    if ya is not None:
        left_up = leftover_after_vig(P_FINISH, float(ya), spread, kalshi_taker_fee_cents(ya))
    if na is not None:
        left_dn = leftover_after_vig(1.0 - P_FINISH, float(na), spread, kalshi_taker_fee_cents(na))
    return {"up": left_up, "down": left_dn, "spread": spread}


def leftover_lean(book: Optional[Dict[str, Any]]) -> str:
    sides = leftover_sides(book)
    up, dn = sides.get("up"), sides.get("down")
    if up is not None and up > 0 and (dn is None or up >= dn):
        return "UP"
    if dn is not None and dn > 0 and (up is None or dn > up):
        return "DOWN"
    return "WAIT"


def book_playable(book: Optional[Dict[str, Any]]) -> bool:
    if not book:
        return False
    q = quotes_of(book)
    mid = q.get("yes_mid")
    return playable_yes_mid(mid, lo=ORACLE_YES_LO, hi=ORACLE_YES_HI)


def book_dead(book: Optional[Dict[str, Any]], side: Optional[str] = None) -> Optional[str]:
    if not book:
        return "empty book we measured"
    q = quotes_of(book)
    depth = depth_of(book)
    if book_is_unknown(depth):
        return None
    lean = side if side in ("UP", "DOWN") else leftover_lean(book)
    if lean not in ("UP", "DOWN"):
        lean = "UP"
    return dead_book_reason(depth, lean, q.get("yes_mid"), max_side=ORACLE_YES_HI)


def chalk_reason(book: Optional[Dict[str, Any]]) -> Optional[str]:
    q = quotes_of(book or {})
    mid = q.get("yes_mid")
    if mid is not None and not playable_yes_mid(mid, lo=ORACLE_YES_LO, hi=ORACLE_YES_HI):
        return f"YES mid {mid:.0f}¢ outside 20–80"
    wall = never_lock_near_certain(q.get("yes_ask"), q.get("no_ask"))
    if wall:
        return wall
    depth = depth_of(book)
    if depth.get("book_state") == "one_sided":
        return "one-sided book"
    return None


def normalize_book(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    q = quotes_of(raw)
    depth = depth_of(raw)
    sides = leftover_sides(raw)
    lean = leftover_lean(raw)
    leftover = None
    if lean == "UP":
        leftover = sides.get("up")
    elif lean == "DOWN":
        leftover = sides.get("down")
    else:
        leftover = max([x for x in (sides.get("up"), sides.get("down")) if x is not None], default=None)
    return {
        "ticker": raw.get("ticker"),
        "title": raw.get("title") or raw.get("ticker") or "BTC 1H",
        "yes_bid": q.get("yes_bid"),
        "yes_ask": q.get("yes_ask"),
        "no_bid": q.get("no_bid"),
        "no_ask": q.get("no_ask"),
        "yes_mid": q.get("yes_mid"),
        "spread": sides.get("spread"),
        "leftover": None if leftover is None else round(float(leftover), 2),
        "leftover_up": None if sides.get("up") is None else round(float(sides["up"]), 2),
        "leftover_down": None if sides.get("down") is None else round(float(sides["down"]), 2),
        "lean": lean,
        "depth": depth,
        "book_known": not book_is_unknown(depth),
        "close_time": raw.get("close_time"),
        "floor_strike": raw.get("floor_strike") or raw.get("strike_price") or raw.get("strike"),
        "volume": raw.get("volume_fp") or raw.get("volume"),
        "prior_unknown": bool(raw.get("prior_unknown")),
        "source": raw.get("source"),
        "url": raw.get("url"),
    }


async def scan_open(fetch: Optional[_Fetch] = None) -> Optional[Dict[str, Any]]:
    markets: List[Dict[str, Any]] = []
    try:
        if fetch is not None:
            data = await fetch("/markets", {"series_ticker": "KXBTCD", "status": "open"})
            if isinstance(data, dict):
                if isinstance(data.get("book"), dict):
                    return normalize_book(data["book"])
                markets = data.get("markets") or []
            elif isinstance(data, list):
                markets = data
        else:
            from backend.data.kalshi import KalshiClient

            client = KalshiClient(series_ticker="KXBTCD")
            markets = await client.get_open_markets()
    except Exception:
        return None
    rows = [m for m in (markets or []) if isinstance(m, dict)]
    if not rows:
        return None
    picked = pick_hour_book(rows)
    return normalize_book(picked or rows[0])


def _seat_row(spec: Dict[str, Any], dir_: str, call: str, *, confidence: int = 50) -> Dict[str, Any]:
    return {
        "id": spec["id"],
        "job": spec["job"],
        "mark": spec["mark"],
        "dir": dir_,
        "call": call,
        "confidence": confidence,
        "n": 0,
        "wr": None,
        "rank": ["SIBYL", "PIT", "VEIL", "MARBLE"].index(spec["id"]) + 1,
        "weight": spec.get("weight", 1.0),
    }


def build_seats(book: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    lean = leftover_lean(book) if book else "WAIT"
    sides = leftover_sides(book) if book else {"up": None, "down": None}
    leftover = sides.get("up") if lean == "UP" else (sides.get("down") if lean == "DOWN" else None)
    depth = depth_of(book) if book else {"book_state": "unknown", "measured": False, "yes_depth": 0.0, "no_depth": 0.0}
    unknown = book_is_unknown(depth)
    thin = (not unknown) and ((depth.get("yes_depth") or 0) + (depth.get("no_depth") or 0) < THIN_DEPTH)
    dead = book_dead(book, lean if lean in ("UP", "DOWN") else None)
    chalk = chalk_reason(book)
    playable = book_playable(book)

    out: List[Dict[str, Any]] = []
    for spec in SEATS:
        sid = spec["id"]
        if sid == "SIBYL":
            if playable and lean in ("UP", "DOWN") and leftover is not None and leftover > 0:
                out.append(_seat_row(spec, lean, f"SIBYL · {lean} · THE READ", confidence=62))
            else:
                out.append(_seat_row(spec, "WAIT", "SIBYL · DARK · NO READ", confidence=20))
        elif sid == "PIT":
            if unknown or thin or dead:
                why = "UNKNOWN" if unknown else ("THIN" if thin else "DEAD")
                out.append(_seat_row(spec, "WAIT", f"PIT · SIT · {why} WELL", confidence=18))
            elif playable and lean in ("UP", "DOWN"):
                out.append(_seat_row(spec, lean, f"PIT · {lean} · THE WELL", confidence=58))
            else:
                out.append(_seat_row(spec, "WAIT", "PIT · SIT · THE WELL", confidence=22))
        elif sid == "VEIL":
            if chalk or dead or not playable:
                out.append(_seat_row(spec, "WAIT", "VEIL · SIT · FAKE CUT", confidence=24))
            elif lean in ("UP", "DOWN"):
                out.append(_seat_row(spec, lean, f"VEIL · {lean} · THE MASK", confidence=60))
            else:
                out.append(_seat_row(spec, "WAIT", "VEIL · SIT · THE MASK", confidence=22))
        else:
            if leftover is not None and leftover > 0 and playable and lean in ("UP", "DOWN"):
                out.append(_seat_row(spec, lean, f"MARBLE · {lean} · THE SLAB", confidence=64))
            else:
                out.append(_seat_row(spec, "WAIT", "MARBLE · SIT · NO EDGE", confidence=20))
    return out


def chair_decision(seats: List[Dict[str, Any]], book: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    ups = [s for s in seats if str(s.get("dir") or "").upper() == "UP"]
    downs = [s for s in seats if str(s.get("dir") or "").upper() == "DOWN"]
    names = {s["id"]: str(s.get("dir") or "WAIT").upper() for s in seats if s.get("id")}
    strip = " · ".join(f"{k} {v}" for k, v in names.items()) or "SIBYL DARK · PIT DARK · VEIL DARK · MARBLE DARK"
    lean = leftover_lean(book) if book else "WAIT"
    sides = leftover_sides(book) if book else {"up": None, "down": None}
    dead = book_dead(book, lean if lean in ("UP", "DOWN") else None)
    playable = book_playable(book)

    if dead:
        return {
            "direction": "WAIT",
            "confidence": 0,
            "summary": "WAIT · DEAD BOOK",
            "why": {"line": "WAIT · DEAD BOOK", "strip": strip},
            "watch": {"line": "CRT · WAIT · STATIC ON THE GLASS", "listed": False},
            "gate": "DEAD BOOK",
        }
    if not playable:
        return {
            "direction": "WAIT",
            "confidence": 0,
            "summary": "WAIT · BOOK NOT PLAYABLE",
            "why": {"line": "WAIT · 20–80 AFTER VIG", "strip": strip},
            "watch": {"line": "CRT · WAIT · STATIC ON THE GLASS", "listed": False},
            "gate": "20-80",
        }
    if book and book.get("prior_unknown"):
        title = str((book or {}).get("title") or (book or {}).get("ticker") or "THE BET")
        return {
            "direction": "WAIT",
            "confidence": 22,
            "summary": f"NO CONSENSUS · {title}",
            "why": {"line": f"NO CONSENSUS · SHOW THE BET · {title}", "strip": strip},
            "watch": {"line": "CRT · NO CONSENSUS · TICKET ON THE GLASS", "listed": True},
            "gate": "NO CONSENSUS",
        }
    if ups and downs:
        return {
            "direction": "WAIT",
            "confidence": 20,
            "summary": "NO CONSENSUS · SEATS SPLIT",
            "why": {"line": "NO CONSENSUS · SEATS SPLIT", "strip": strip},
            "watch": {"line": "CRT · NO CONSENSUS · TICKET ON THE GLASS", "listed": True},
            "gate": "SPLIT",
        }
    side = "UP" if len(ups) >= 3 and not downs else ("DOWN" if len(downs) >= 3 and not ups else None)
    if not side:
        return {
            "direction": "WAIT",
            "confidence": 18,
            "summary": "NO CONSENSUS · SEATS SPLIT",
            "why": {"line": "NO CONSENSUS · SEATS SPLIT", "strip": strip},
            "watch": {"line": "CRT · NO CONSENSUS · TICKET ON THE GLASS", "listed": True},
            "gate": "SPLIT",
        }
    leftover = sides.get("up") if side == "UP" else sides.get("down")
    if leftover is None or float(leftover) < 3.0:
        return {
            "direction": "WAIT",
            "confidence": 0,
            "summary": "NO CONSENSUS · EV < +3¢",
            "why": {"line": "NO CONSENSUS · EV < +3¢", "strip": strip},
            "watch": {"line": "CRT · NO CONSENSUS · TICKET ON THE GLASS", "listed": True},
            "gate": "NO EDGE",
        }
    voices = "+".join(s["id"] for s in seats if str(s.get("dir") or "").upper() == side)
    return {
        "direction": side,
        "confidence": 70,
        "summary": f"LOCK {side} · CRT · {voices}",
        "why": {"line": f"LOCK {side} · CRT · {voices}", "strip": strip},
        "watch": {"line": "CRT · LOCK · TICKET ON THE GLASS", "listed": True},
        "gate": None,
        "leftover": leftover,
    }


def locks_today(now: Optional[datetime] = None) -> int:
    day = _now_ct(now).date().isoformat()
    n = 0
    for r in _load_fills():
        if r.get("day") == day and str(r.get("side") or "").upper() in ("UP", "DOWN"):
            n += 1
    return n


def open_paper_ticket(now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    for r in reversed(_load_fills()):
        if str(r.get("result") or "").upper() in ("OPEN", "PENDING", "") and str(r.get("side") or "").upper() in ("UP", "DOWN"):
            return r
    return None


def paper_lock_if_clear(
    pick: Optional[Dict[str, Any]],
    decision: Optional[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """Paper only. Cap a few per day. Follower stays off. No live Kalshi."""
    if not pick or not decision:
        return None
    if pick.get("prior_unknown"):
        return None
    side = str(decision.get("direction") or "WAIT").upper()
    if side not in ("UP", "DOWN") or decision.get("gate"):
        return None
    leftover = decision.get("leftover")
    if leftover is None:
        leftover = pick.get("leftover")
    if leftover is None or float(leftover) < 3.0:
        decision["gate"] = "EV < +3¢"
        decision["direction"] = "WAIT"
        decision["summary"] = "NO CONSENSUS · EV < +3¢"
        return None
    n = _now_ct(now)
    if not paper_lock_day_ok(locks_today(n)):
        decision["gate"] = "DAY CAP"
        decision["direction"] = "WAIT"
        decision["summary"] = "WAIT · DAY CAP"
        decision["why"] = {"line": "WAIT · DAY CAP", "strip": (decision.get("why") or {}).get("strip") or ""}
        decision["watch"] = {"line": "CRT · WAIT · STATIC ON THE GLASS", "listed": False}
        return None
    held = open_paper_ticket(n)
    if held and held.get("ticker") == pick.get("ticker") and str(held.get("side") or "").upper() == side:
        return held
    if held and str(held.get("side") or "").upper() in ("UP", "DOWN"):
        return held
    row = {
        "id": f"ora-{int(time.time() * 1000)}",
        "ticker": pick.get("ticker"),
        "side": side,
        "mid": pick.get("yes_mid"),
        "leftover": leftover,
        "result": "OPEN",
        "settled": False,
        "paper": True,
        "follower": False,
        "live": False,
        "day": n.date().isoformat(),
        "at": n.isoformat(),
        "close_time": pick.get("close_time"),
        "title": pick.get("title"),
    }
    _fills.append(row)
    _save_fills()
    return row


def chair_accuracy() -> Dict[str, Any]:
    rows = [r for r in _load_fills() if str(r.get("side") or "").upper() in ("UP", "DOWN")]
    hits = [r for r in rows if str(r.get("result") or "").upper() == "HIT"]
    miss = [r for r in rows if str(r.get("result") or "").upper() == "MISS"]
    waits = [r for r in _load_fills() if str(r.get("side") or "").upper() == "WAIT"]
    total = len(hits) + len(miss)
    pct = round(100.0 * len(hits) / total, 1) if total else None
    return {
        "correct": len(hits),
        "wrong": len(miss),
        "total": total,
        "accuracy_pct": pct,
        "pending": len([r for r in rows if str(r.get("result") or "").upper() in ("OPEN", "PENDING")]),
        "wait_n": len(waits),
        "verdict": "COLLECTING" if total < 8 else ("HOT" if (pct or 0) >= 55 else "COLD"),
        "label": "ORACLE · CRT",
        "log": list(reversed(_load_fills()[-24:])),
        "recent": list(reversed(rows[-12:])),
    }


def lock_tape() -> List[Dict[str, Any]]:
    return list(reversed(_load_fills()[-16:]))


def build_clock(book: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, Any]:
    n = _now_ct(now)
    close = None
    raw = (book or {}).get("close_time")
    if raw:
        try:
            close = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except Exception:
            close = None
    secs = None
    if close is not None:
        if close.tzinfo is None:
            close = close.replace(tzinfo=CT)
        secs = (close.astimezone(CT) - n).total_seconds()
    return {
        "kind": "hour",
        "label": "CRT",
        "window_label": "CRT",
        "seconds_left": secs,
        "close_time": raw,
    }


def build_chair(decision: Dict[str, Any], lock: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    eye = str(decision.get("direction") or "WAIT").upper()
    locked = bool(lock and eye in ("UP", "DOWN"))
    return {
        **CHAIR,
        "eye": eye,
        "dir": eye,
        "call": decision.get("summary") or ("LOCK " + eye if locked else "WAIT · CRT"),
        "confidence": decision.get("confidence") or 0,
        "locked": locked,
        "why": decision.get("why") or {},
        "watch": decision.get("watch") or {},
        "paper_only": True,
        "follower": False,
        "live": False,
    }


async def build_board(
    fetch: Optional[_Fetch] = None,
    now: Optional[datetime] = None,
    force: bool = False,
    book: Optional[Dict[str, Any]] = None,
    seats: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    if not force and _board_cache.get("payload") and time.time() - float(_board_cache.get("at") or 0) < BOARD_TTL_S:
        return _board_cache["payload"]
    from backend.services import desk_hunter

    hunt: Dict[str, Any]
    if book is not None:
        pick = normalize_book(book)
        hunt = desk_hunter.feed_oracle_from_rows([book], now=now)
    elif fetch is not None:
        pick = await scan_open(fetch=fetch)
        hunt = desk_hunter.feed_oracle_from_rows([pick] if pick else [], now=now)
    else:
        hunt = await desk_hunter.feed_oracle(now=now, force=True)
        raw = hunt.get("featured_raw")
        pick = normalize_book(raw) if raw else None
    seat_rows = seats if seats is not None else build_seats(pick)
    decision = chair_decision(seat_rows, pick)
    lock = paper_lock_if_clear(pick, decision, now=now)
    if lock and decision.get("direction") in ("UP", "DOWN") and not decision.get("gate"):
        decision = dict(decision)
        decision["locked"] = True
    chair = build_chair(decision, lock)
    acc = chair_accuracy()
    clock = build_clock(pick, now=now)
    why = decision.get("why") or {"line": "WAIT · CRT", "strip": "SIBYL DARK · PIT DARK · VEIL DARK · MARBLE DARK"}
    watch = decision.get("watch") or {"line": "CRT · WAIT · STATIC ON THE GLASS", "listed": False}
    payload = {
        "chair": chair,
        "seats": seat_rows,
        "watch": watch,
        "why": why,
        "pick": None if not pick else {
            "ticker": pick.get("ticker"),
            "call": chair.get("eye"),
            "title": pick.get("title"),
            "mid": pick.get("yes_mid"),
            "leftover": pick.get("leftover"),
            "close_time": pick.get("close_time"),
            "floor_strike": pick.get("floor_strike"),
            "gate": decision.get("gate"),
        },
        "accuracy": acc,
        "tape": lock_tape(),
        "fills": lock_tape(),
        "clock": clock,
        "candidates": hunt.get("candidates") or [],
        "hunter": {
            "feeder": "HUNTER",
            "chair": False,
            "locker": False,
            "seat": False,
            "side": None,
            "sources": hunt.get("sources") or [],
            "paper_only": True,
            "follower": False,
            "live": False,
        },
        "paper_only": True,
        "follower": False,
        "live": False,
        "leader": "ORACLE",
        "asset": "oracle",
        "locked_call": {
            "locked": True,
            "direction": chair.get("eye"),
            "ticker": (pick or {}).get("ticker"),
            "confidence": chair.get("confidence"),
        } if lock and chair.get("eye") in ("UP", "DOWN") else None,
    }
    _board_cache["at"] = time.time()
    _board_cache["payload"] = payload
    return payload
