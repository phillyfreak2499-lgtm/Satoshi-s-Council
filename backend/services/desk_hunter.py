"""
HUNTER — rotating scout feeder. Not a Floor chair. Not a locker. Not a sixth seat.

Keeps Ares (sports) and Oracle (politics) showing 1–3 live candidates.
Hunter does not pick a side. Hunter does not lock. Hunter never places orders.
Chair still decides. Paper only. Follower OFF. Live OFF.

Dead air is the failure. No Consensus is valid and preferred.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import leftover_after_vig, odds_to_cents
from backend.config import settings

CT = ZoneInfo("America/Chicago")
_Fetch = Callable[[str, Dict[str, Any]], Any]

HUNTER_ID = "HUNTER"
MIN_SLATE = 1
MAX_SLATE = 3
BAND_LO = 20.0
BAND_HI = 80.0
MIN_EV_SIT = 3.0
ROTATE_S = 180.0
HUNT_TTL_S = 20.0
DEAD_SOURCE_S = 3600.0
OPTIONAL_TIMEOUT_S = 2.0
KALSHI_TIMEOUT_S = 8.0
MIN_DEPTH = 80.0

# Optional sportsbooks — probe, fail-soft, never pretend live.
OPTIONAL_BOOKS: Tuple[Tuple[str, str], ...] = (
    ("draftkings", "https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/88808?format=json"),
    ("fanduel", "https://api.sportsbook.fanduel.com/sbapi/content-managed-page?page=SPORT"),
    ("circa", "https://www.circasports.com/sportsbook/api/v1/events"),
)

POLYMARKET_EVENTS = "https://gamma-api.polymarket.com/events"
KALSHI_TRADE = "https://external-api.kalshi.com/trade-api/v2"

# Politics title filter — Kalshi "Politics" category also leaks golf / TV / hoops.
POLITICS_KEEP_RE = re.compile(
    r"\b(elect|senate|house|governor|president|congress|primary|nominee|"
    r"mayor|democrat|republican|impeach|cabinet|attorney general|parliament|"
    r"fed |fomc|tariff|trump|biden|harris|vance|midterm|ballot|referendum|"
    r"prime minister|parliament|control of)\b",
    re.I,
)
POLITICS_DROP_RE = re.compile(
    r"\b(basketball|football|golf|dota|league of legends|\blol\b|nba|nfl|"
    r"mlb|nhl|ncaaf|season 3|city champs|pro basketball)\b",
    re.I,
)

_source_dead: Dict[str, Dict[str, Any]] = {}
_slate_cache: Dict[str, Dict[str, Any]] = {
    "ares": {"at": 0.0, "payload": None},
    "oracle": {"at": 0.0, "payload": None},
}


def reset_for_tests() -> None:
    global _source_dead, _slate_cache
    _source_dead = {}
    _slate_cache = {
        "ares": {"at": 0.0, "payload": None},
        "oracle": {"at": 0.0, "payload": None},
    }


def _now_utc(now: Optional[datetime] = None) -> datetime:
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        return n.replace(tzinfo=timezone.utc)
    return n.astimezone(timezone.utc)


def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


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


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def mark_source(name: str, *, live: bool, why: str, status: Any = None) -> Dict[str, Any]:
    row = {
        "name": name,
        "live": bool(live),
        "why": why,
        "status": status,
        "at": _iso(_now_utc()),
    }
    if not live:
        _source_dead[name] = {"at": time.time(), "why": why, "status": status}
    elif name in _source_dead:
        _source_dead.pop(name, None)
    return row


def source_is_dead(name: str) -> bool:
    hit = _source_dead.get(name)
    if not hit:
        return False
    return time.time() - float(hit.get("at") or 0) < DEAD_SOURCE_S


def twitter_key_present() -> bool:
    """True only when a bearer/key already exists. Never invent. Never log the value."""
    try:
        from backend.data.secrets import load_secret_string

        for name in ("TWITTER_BEARER_TOKEN", "X_BEARER_TOKEN", "TWITTER_API_KEY"):
            val, _src = load_secret_string(name, name)
            if val:
                return True
    except Exception:
        return False
    return False


def in_band(mid: Any) -> bool:
    try:
        v = float(mid)
    except (TypeError, ValueError):
        return False
    return BAND_LO <= v <= BAND_HI


def candidate_expired(row: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    if not row:
        return True
    st = str(row.get("status") or "").lower().replace("-", "_")
    if st in ("closed", "settled", "finalized", "resolved", "expired", "inactive"):
        return True
    if row.get("resolved") or row.get("expired"):
        return True
    n = _now_utc(now)
    exp = _parse_iso(row.get("expires_at") or row.get("close_time"))
    if exp is not None and exp <= n:
        return True
    mins = row.get("mins_left")
    try:
        if mins is not None and float(mins) <= 0:
            return True
    except (TypeError, ValueError):
        pass
    return False


def replace_expired(
    active: List[Dict[str, Any]],
    pool: List[Dict[str, Any]],
    now: Optional[datetime] = None,
    n: int = MAX_SLATE,
) -> List[Dict[str, Any]]:
    """Drop expired/resolved rows and refill from the pool. Keep 1–3 when pool has liquid."""
    n = max(MIN_SLATE, min(int(n or MAX_SLATE), MAX_SLATE))
    live = [c for c in (active or []) if not candidate_expired(c, now)]
    used = {str(c.get("id") or "") for c in live}
    for p in pool or []:
        if len(live) >= n:
            break
        pid = str(p.get("id") or "")
        if not pid or pid in used:
            continue
        if candidate_expired(p, now):
            continue
        live.append(p)
        used.add(pid)
    return live[:n]


def time_bucket(mins_left: Any) -> int:
    """Smaller = more time-sensitive. Expired/unknown last."""
    try:
        m = float(mins_left)
    except (TypeError, ValueError):
        return 9
    if m <= 0:
        return 9
    if m <= 24 * 60:
        return 0
    if m <= 7 * 24 * 60:
        return 1
    if m <= 30 * 24 * 60:
        return 2
    return 3


def disagreement(row: Dict[str, Any]) -> bool:
    """Useful disagreement: mid near a coin flip, or leftover on both doors."""
    mid = row.get("mid")
    if mid is None:
        mid = row.get("yes_mid")
    try:
        if mid is not None and 42.0 <= float(mid) <= 58.0:
            return True
    except (TypeError, ValueError):
        pass
    yes_l = row.get("yes_leftover")
    no_l = row.get("no_leftover")
    try:
        if yes_l is not None and no_l is not None and float(yes_l) > 0 and float(no_l) > 0:
            return True
    except (TypeError, ValueError):
        pass
    return False


def priority_of(row: Dict[str, Any]) -> int:
    """1 liquid time-sensitive edge · 2 useful disagreement · 3 low-conviction noise."""
    liquid = bool(row.get("liquid"))
    mid = row.get("mid") if row.get("mid") is not None else row.get("yes_mid")
    band = in_band(mid)
    tb = time_bucket(row.get("mins_left"))
    if liquid and band and tb <= 1:
        return 1
    if disagreement(row) and liquid:
        return 2
    return 3


def rank_key(row: Dict[str, Any]) -> Tuple:
    vol = _f(row.get("volume")) or 0.0
    return (priority_of(row), time_bucket(row.get("mins_left")), -vol)


def select_slate(
    rows: List[Dict[str, Any]],
    now: Optional[datetime] = None,
    n: int = MAX_SLATE,
) -> List[Dict[str, Any]]:
    """Keep 1–3 live candidates. Expired out. Prefer time-sensitive liquid, then disagreement."""
    n = max(MIN_SLATE, min(int(n or MAX_SLATE), MAX_SLATE))
    live = [r for r in (rows or []) if r and not candidate_expired(r, now)]
    live.sort(key=rank_key)
    # one market per id
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for r in live:
        rid = str(r.get("id") or r.get("ticker") or "")
        if not rid or rid in seen:
            continue
        seen.add(rid)
        out.append(r)
        if len(out) >= n:
            break
    return out


def rotate_featured(
    candidates: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """Rotating scout. Hunter still does not pick a side — only which ticket is on the glass."""
    rows = [c for c in (candidates or []) if not candidate_expired(c, now)]
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    n = _now_utc(now)
    idx = int(n.timestamp() // ROTATE_S) % len(rows)
    return rows[idx]


def _clock_line(mins_left: Any, *, sports: bool) -> str:
    try:
        m = float(mins_left)
    except (TypeError, ValueError):
        return "CLOCK IS DARK"
    if m <= 0:
        return "THEY'RE OFF" if sports else "RESOLVED"
    if m >= 48 * 60:
        return f"{'KICK' if sports else 'CLOSE'} IN {int(m // (60 * 24))}D"
    if m >= 60:
        hrs = int(m // 60)
        mins = int(m % 60)
        return f"{'KICK' if sports else 'CLOSE'} IN {hrs}H {mins:02d}M"
    return f"{'KICK' if sports else 'CLOSE'} IN {int(m):02d}M"


def _both_sides(quotes: Dict[str, Any], *, yes_label: str, no_label: str) -> List[Dict[str, Any]]:
    """Always both doors. Hunter does not choose one."""
    return [
        {
            "label": yes_label,
            "kalshi_side": "YES",
            "bid": quotes.get("yes_bid"),
            "ask": quotes.get("yes_ask"),
            "mid": quotes.get("yes_mid"),
        },
        {
            "label": no_label,
            "kalshi_side": "NO",
            "bid": quotes.get("no_bid"),
            "ask": quotes.get("no_ask"),
            "mid": (None if quotes.get("yes_mid") is None else max(0.0, 100.0 - float(quotes["yes_mid"]))),
        },
    ]


def _why_edge(row: Dict[str, Any], quotes: Dict[str, Any]) -> str:
    bits: List[str] = []
    mid = quotes.get("yes_mid")
    if mid is not None:
        bits.append(f"{float(mid):.0f}¢ mid")
    if in_band(mid):
        bits.append("20–80")
    vol = _f(row.get("volume"))
    if vol and vol >= MIN_DEPTH:
        bits.append(f"vol {int(vol)}")
    yes_l = row.get("yes_leftover")
    no_l = row.get("no_leftover")
    try:
        if yes_l is not None and float(yes_l) >= MIN_EV_SIT:
            bits.append(f"YES leftover {float(yes_l):.1f}¢ is Chair math")
        elif no_l is not None and float(no_l) >= MIN_EV_SIT:
            bits.append(f"NO leftover {float(no_l):.1f}¢ is Chair math")
    except (TypeError, ValueError):
        pass
    if disagreement(row):
        bits.append("useful disagreement")
    core = bits[:4]
    core.append("Hunter does not pick a side")
    return " · ".join(core)


def as_candidate(
    row: Dict[str, Any],
    *,
    book: str,
    source: str,
    source_url: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Normalize a live market into a Hunter card. hunter_side is always None."""
    n = _now_utc(now)
    quotes = row.get("quotes") if isinstance(row.get("quotes"), dict) else {}
    if not quotes:
        quotes = {
            "yes_bid": odds_to_cents(row.get("yes_bid_dollars") if row.get("yes_bid_dollars") is not None else row.get("yes_bid")),
            "yes_ask": odds_to_cents(row.get("yes_ask_dollars") if row.get("yes_ask_dollars") is not None else row.get("yes_ask")),
            "no_bid": odds_to_cents(row.get("no_bid_dollars") if row.get("no_bid_dollars") is not None else row.get("no_bid")),
            "no_ask": odds_to_cents(row.get("no_ask_dollars") if row.get("no_ask_dollars") is not None else row.get("no_ask")),
            "yes_mid": odds_to_cents(row.get("yes_mid") if row.get("yes_mid") is not None else row.get("mid")),
        }
        if quotes.get("yes_mid") is None and quotes.get("yes_bid") is not None and quotes.get("yes_ask") is not None:
            quotes["yes_mid"] = (float(quotes["yes_bid"]) + float(quotes["yes_ask"])) / 2.0
    close = row.get("close_time") or row.get("expires_at") or row.get("endDate")
    close_dt = _parse_iso(close)
    mins_left = row.get("mins_left")
    if close_dt is not None:
        mins_left = (close_dt - n).total_seconds() / 60.0
    sports = book == "ares"
    yes_label = str(row.get("yes_label") or ("YES" if not sports else (row.get("call") if row.get("side") == "YES" else row.get("team") or "YES")))
    no_label = str(row.get("no_label") or "NO")
    if sports:
        from backend.services.desk_ats import sports_call

        kind = str(row.get("kind") or "ml")
        yes_label = sports_call(kind, "YES", row.get("team"), row.get("home"), row.get("away"))
        no_label = sports_call(kind, "NO", row.get("team"), row.get("home"), row.get("away"))
    vol = _f(row.get("volume"))
    oi = _f(row.get("open_interest") or row.get("oi"))
    liquid = bool(row.get("liquid"))
    if not liquid:
        liquid = bool((vol or 0) + (oi or 0) >= MIN_DEPTH) or bool(row.get("book_state") == "ok")
    mid = quotes.get("yes_mid")
    packed = {
        "id": str(row.get("ticker") or row.get("id") or ""),
        "book": book,
        "market": str(row.get("title") or row.get("number") or row.get("ticker") or ""),
        "ticker": row.get("ticker"),
        "kind": row.get("kind") or ("yesno" if not sports else None),
        "sport": row.get("sport"),
        "topic": row.get("topic") or row.get("category"),
        "number": row.get("number"),
        "game": row.get("game"),
        "home": row.get("home"),
        "away": row.get("away"),
        "mid": mid,
        "quotes": quotes,
        "sides": _both_sides(quotes, yes_label=yes_label, no_label=no_label),
        "hunter_side": None,
        "why_edge": _why_edge({**row, "mid": mid, "volume": vol}, quotes),
        "sources": [
            {
                "name": source,
                "url": source_url or row.get("url"),
                "at": _iso(n),
                "live": True,
            }
        ],
        "time_sensitivity": _clock_line(mins_left, sports=sports),
        "expires_at": _iso(close_dt) if close_dt else close,
        "close_time": close,
        "mins_left": mins_left,
        "priority": 3,
        "liquid": liquid,
        "in_band": in_band(mid),
        "disagreement": False,
        "consensus": "NO CONSENSUS",
        "volume": vol,
        "yes_leftover": row.get("yes_leftover"),
        "no_leftover": row.get("no_leftover"),
        "status": row.get("status") or "open",
        "prior_unknown": bool(row.get("prior_unknown")),
        "paper_only": True,
        "follower": False,
        "live": False,
        "raw": row,
    }
    packed["disagreement"] = disagreement(packed)
    packed["priority"] = priority_of(packed)
    return packed


def empty_slate(book: str, sources: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    return {
        "feeder": HUNTER_ID,
        "chair": False,
        "locker": False,
        "seat": False,
        "book": book,
        "candidates": [],
        "featured": None,
        "featured_raw": None,
        "hunter_side": None,
        "consensus": "NO CONSENSUS",
        "sources": sources or [],
        "paper_only": True,
        "follower": False,
        "live": False,
        "empty": True,
    }


def pack_slate(
    candidates: List[Dict[str, Any]],
    *,
    book: str,
    sources: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    live = select_slate(candidates, now=now)
    featured = rotate_featured(live, now=now)
    return {
        "feeder": HUNTER_ID,
        "chair": False,
        "locker": False,
        "seat": False,
        "book": book,
        "candidates": live,
        "featured": featured,
        "featured_raw": (featured or {}).get("raw") if featured else None,
        "hunter_side": None,
        "consensus": "NO CONSENSUS",
        "sources": sources,
        "paper_only": True,
        "follower": False,
        "live": False,
        "empty": not bool(live),
    }


def sports_rows_to_candidates(
    rows: List[Dict[str, Any]],
    now: Optional[datetime] = None,
    source: str = "kalshi",
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        tick = str(row.get("ticker") or "")
        if not tick:
            continue
        url = f"https://kalshi.com/markets/{tick}" if source == "kalshi" else row.get("url")
        scored = row
        if row.get("yes_leftover") is None and isinstance(row.get("quotes"), dict):
            q = row["quotes"]
            ya, na = q.get("yes_ask"), q.get("no_ask")
            p = None
            if ya is not None and na is not None and (float(ya) + float(na)) > 0:
                p = float(ya) / (float(ya) + float(na))
            spread = q.get("spread")
            if p is not None and ya is not None:
                from backend.agents.chair_gates import kalshi_taker_fee_cents

                scored = dict(row)
                scored["yes_leftover"] = leftover_after_vig(p, float(ya), spread, kalshi_taker_fee_cents(ya))
                scored["no_leftover"] = leftover_after_vig(1.0 - p, float(na), spread, kalshi_taker_fee_cents(na))
        out.append(as_candidate(scored, book="ares", source=source, source_url=url, now=now))
    return out


def politics_is_honest(title: Any, ticker: Any = "", category: Any = "") -> bool:
    blob = f"{title or ''} {ticker or ''} {category or ''}"
    if POLITICS_DROP_RE.search(blob):
        return False
    cat = str(category or "").lower()
    if cat in ("elections", "politics") and POLITICS_KEEP_RE.search(blob):
        return True
    return bool(POLITICS_KEEP_RE.search(blob))


def kalshi_market_to_politics_row(m: Dict[str, Any], event: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if not isinstance(m, dict):
        return None
    tick = str(m.get("ticker") or "")
    title = m.get("title") or (event or {}).get("title") or tick
    cat = (event or {}).get("category") or m.get("category") or "Politics"
    if not tick or not politics_is_honest(title, tick, cat):
        return None
    from backend.services.desk_ats import market_quotes, measured_depth

    quotes = market_quotes(m)
    if quotes.get("yes_mid") is None:
        return None
    depth = measured_depth(m)
    if depth.get("book_state") == "dead":
        return None
    close = m.get("close_time") or m.get("expiration_time")
    vol = _f(m.get("volume_fp") if m.get("volume_fp") is not None else m.get("volume"))
    return {
        "ticker": tick,
        "title": title,
        "quotes": quotes,
        "yes_mid": quotes.get("yes_mid"),
        "close_time": close,
        "volume": vol,
        "open_interest": _f(m.get("open_interest_fp") if m.get("open_interest_fp") is not None else m.get("open_interest")),
        "status": m.get("status") or "open",
        "source": "kalshi",
        "url": f"https://kalshi.com/markets/{tick}",
        "prior_unknown": True,
        "category": cat,
        "topic": "politics",
        "book_state": depth.get("book_state"),
        "liquid": (vol or 0) >= MIN_DEPTH or depth.get("book_state") == "ok",
        "yes_bid_dollars": m.get("yes_bid_dollars"),
        "yes_ask_dollars": m.get("yes_ask_dollars"),
        "no_bid_dollars": m.get("no_bid_dollars"),
        "no_ask_dollars": m.get("no_ask_dollars"),
        "yes_bid": m.get("yes_bid"),
        "yes_ask": m.get("yes_ask"),
        "no_bid": m.get("no_bid"),
        "no_ask": m.get("no_ask"),
        "floor_strike": m.get("floor_strike"),
    }


def polymarket_to_row(event: Dict[str, Any], market: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(market, dict):
        return None
    title = market.get("question") or event.get("title") or ""
    slug = str(event.get("slug") or market.get("slug") or "")
    if not politics_is_honest(title, slug, "politics"):
        return None
    prices = market.get("outcomePrices") or market.get("outcome_prices")
    if isinstance(prices, str):
        try:
            prices = json.loads(prices)
        except Exception:
            prices = None
    if not isinstance(prices, list) or not prices:
        return None
    try:
        yes = float(prices[0]) * 100.0
        no = float(prices[1]) * 100.0 if len(prices) > 1 else max(0.0, 100.0 - yes)
    except (TypeError, ValueError):
        return None
    if yes <= 0 and no <= 0:
        return None
    close = market.get("endDate") or event.get("endDate")
    vol = _f(market.get("volume24hr") or market.get("volume") or event.get("volume24hr") or event.get("volume"))
    tick = "poly:" + str(market.get("slug") or market.get("id") or slug)
    yes_d = max(0.0, min(1.0, yes / 100.0))
    no_d = max(0.0, min(1.0, no / 100.0))
    return {
        "ticker": tick,
        "title": title,
        "quotes": {
            "yes_bid": max(0.0, yes - 1.0),
            "yes_ask": yes,
            "no_bid": max(0.0, no - 1.0),
            "no_ask": no,
            "yes_mid": yes,
        },
        "yes_mid": yes,
        "yes_bid_dollars": max(0.0, yes_d - 0.01),
        "yes_ask_dollars": yes_d,
        "no_bid_dollars": max(0.0, no_d - 0.01),
        "no_ask_dollars": no_d,
        "close_time": close,
        "volume": vol,
        "status": "closed" if market.get("closed") or event.get("closed") else "open",
        "source": "polymarket",
        "url": f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com",
        "prior_unknown": True,
        "category": "politics",
        "topic": "politics",
        "liquid": (vol or 0) >= MIN_DEPTH,
        "book_state": "ok" if (vol or 0) > 0 else "unknown",
    }


async def _http_json(
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = KALSHI_TIMEOUT_S,
) -> Tuple[Any, int]:
    import httpx

    h = {"User-Agent": "SatoshiCouncil/1.0", "Accept": "application/json"}
    if headers:
        h.update(headers)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            r = await client.get(url, params=params, headers=h)
            if r.status_code >= 400:
                return None, r.status_code
            data = r.json()
            return data, r.status_code
    except Exception:
        return None, 0


async def probe_optional_books() -> List[Dict[str, Any]]:
    """DraftKings / FanDuel / Circa — fail-soft. Dead stays dead. Never invent a line."""
    out: List[Dict[str, Any]] = []
    for name, url in OPTIONAL_BOOKS:
        if source_is_dead(name):
            hit = _source_dead[name]
            out.append({
                "name": name,
                "live": False,
                "why": str(hit.get("why") or "dead"),
                "status": hit.get("status"),
                "at": _iso(_now_utc()),
            })
            continue
        _data, status = await _http_json(url, timeout=OPTIONAL_TIMEOUT_S)
        if status == 200 and _data:
            out.append(mark_source(name, live=True, why="public book reached", status=status))
        else:
            why = f"unreachable {status or 'timeout'}"
            out.append(mark_source(name, live=False, why=why, status=status or None))
    return out


def twitter_source() -> Dict[str, Any]:
    if twitter_key_present():
        return mark_source("x", live=True, why="key present")
    return {
        "name": "x",
        "live": False,
        "why": "no key",
        "status": None,
        "at": _iso(_now_utc()),
    }


async def scan_kalshi_politics(fetch: Optional[_Fetch] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        if fetch is not None:
            for cat in ("Elections", "Politics"):
                data = await fetch("/events", {"status": "open", "limit": 40, "with_nested_markets": True, "category": cat})
                events = (data or {}).get("events") if isinstance(data, dict) else []
                for ev in events or []:
                    if not isinstance(ev, dict):
                        continue
                    for m in ev.get("markets") or []:
                        got = kalshi_market_to_politics_row(m, ev)
                        if got:
                            rows.append(got)
        else:
            for cat in ("Elections", "Politics"):
                data, status = await _http_json(
                    f"{KALSHI_TRADE}/events",
                    params={"status": "open", "limit": 40, "with_nested_markets": True, "category": cat},
                )
                if status != 200 or not isinstance(data, dict):
                    if not rows:
                        return [], mark_source("kalshi-politics", live=False, why=f"events {status or 'fail'}", status=status)
                    continue
                for ev in data.get("events") or []:
                    if not isinstance(ev, dict):
                        continue
                    for m in ev.get("markets") or []:
                        got = kalshi_market_to_politics_row(m, ev)
                        if got:
                            rows.append(got)
        if rows:
            return rows, mark_source("kalshi-politics", live=True, why=f"{len(rows)} open books")
        return [], mark_source("kalshi-politics", live=False, why="no honest politics books")
    except Exception:
        return [], mark_source("kalshi-politics", live=False, why="fetch failed")


async def scan_polymarket_politics(fetch: Optional[_Fetch] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        if fetch is not None:
            data = await fetch("/polymarket", {"tag_slug": "politics", "closed": False, "limit": 20})
        else:
            data, status = await _http_json(
                POLYMARKET_EVENTS,
                params={
                    "tag_slug": "politics",
                    "closed": "false",
                    "limit": 20,
                    "order": "volume24hr",
                    "ascending": "false",
                },
            )
            if status != 200:
                return [], mark_source("polymarket", live=False, why=f"unreachable {status}", status=status)
        events = data if isinstance(data, list) else (data or {}).get("events") or (data or {}).get("data") or []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            markets = ev.get("markets") or [ev]
            for m in markets:
                got = polymarket_to_row(ev, m if isinstance(m, dict) else ev)
                if got:
                    rows.append(got)
        if rows:
            return rows, mark_source("polymarket", live=True, why=f"{len(rows)} open books")
        return [], mark_source("polymarket", live=False, why="no honest politics books")
    except Exception:
        return [], mark_source("polymarket", live=False, why="fetch failed")


def feed_ares_from_rows(
    rows: List[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    sources: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    cands = sports_rows_to_candidates(rows, now=now)
    src = sources or [mark_source("kalshi", live=bool(cands), why="sports series" if cands else "no liquid sports")]
    return pack_slate(cands, book="ares", sources=src, now=now)


async def feed_ares(
    *,
    rows: Optional[List[Dict[str, Any]]] = None,
    fetch: Optional[_Fetch] = None,
    now: Optional[datetime] = None,
    probe_books: bool = False,
    force: bool = False,
) -> Dict[str, Any]:
    """Sports feeder. Uses Kalshi sports rows already scanned by Ares. Optional books fail-soft."""
    if not force and _slate_cache["ares"]["payload"] and time.time() - float(_slate_cache["ares"]["at"] or 0) < HUNT_TTL_S:
        cached = _slate_cache["ares"]["payload"]
        if cached and cached.get("candidates"):
            return cached
    sources: List[Dict[str, Any]] = []
    pool = list(rows or [])
    if not pool and fetch is not None:
        from backend.services.desk_ats import scan_open

        pool = await scan_open(fetch=fetch)
    cands = sports_rows_to_candidates(pool, now=now)
    sources.append(mark_source("kalshi", live=bool(cands), why="sports series" if cands else "no liquid sports"))
    sources.append(mark_source("espn", live=True, why="header already wired on Ares"))
    if probe_books:
        sources.extend(await probe_optional_books())
    else:
        for name, _url in OPTIONAL_BOOKS:
            if source_is_dead(name):
                hit = _source_dead[name]
                sources.append({"name": name, "live": False, "why": hit.get("why"), "status": hit.get("status"), "at": _iso(_now_utc())})
            else:
                sources.append({"name": name, "live": False, "why": "not probed", "status": None, "at": _iso(_now_utc())})
    sources.append(twitter_source())
    slate = pack_slate(cands, book="ares", sources=sources, now=now)
    _slate_cache["ares"] = {"at": time.time(), "payload": slate}
    return slate


def feed_oracle_from_rows(
    rows: List[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    sources: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    cands = [
        as_candidate(r, book="oracle", source=str(r.get("source") or "kalshi"), source_url=r.get("url"), now=now)
        for r in (rows or [])
        if isinstance(r, dict) and (r.get("ticker") or r.get("title"))
    ]
    src = sources or [mark_source("kalshi-politics", live=bool(cands), why="injected")]
    return pack_slate(cands, book="oracle", sources=src, now=now)


async def feed_oracle(
    *,
    rows: Optional[List[Dict[str, Any]]] = None,
    fetch: Optional[_Fetch] = None,
    now: Optional[datetime] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Politics feeder. Kalshi + Polymarket public. Fail-soft. Hunter does not pick a side."""
    if rows is not None:
        return feed_oracle_from_rows(rows, now=now)
    if not force and _slate_cache["oracle"]["payload"] and time.time() - float(_slate_cache["oracle"]["at"] or 0) < HUNT_TTL_S:
        cached = _slate_cache["oracle"]["payload"]
        if cached and cached.get("candidates"):
            return cached
    sources: List[Dict[str, Any]] = []
    kalshi_rows, kalshi_src = await scan_kalshi_politics(fetch=fetch)
    sources.append(kalshi_src)
    poly_rows, poly_src = await scan_polymarket_politics(fetch=fetch)
    sources.append(poly_src)
    sources.append(twitter_source())
    pool = kalshi_rows + poly_rows
    cands = [
        as_candidate(r, book="oracle", source=str(r.get("source") or "kalshi"), source_url=r.get("url"), now=now)
        for r in pool
    ]
    slate = pack_slate(cands, book="oracle", sources=sources, now=now)
    _slate_cache["oracle"] = {"at": time.time(), "payload": slate}
    return slate


def hunter_never_locks(slate: Optional[Dict[str, Any]]) -> bool:
    if not slate:
        return True
    if slate.get("hunter_side") is not None:
        return False
    if slate.get("chair") or slate.get("locker") or slate.get("seat"):
        return False
    if slate.get("live") or slate.get("follower"):
        return False
    for c in slate.get("candidates") or []:
        if c.get("hunter_side") is not None:
            return False
        if c.get("live") or c.get("follower"):
            return False
    return True
