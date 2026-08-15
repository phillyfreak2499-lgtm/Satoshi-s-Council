"""
ARES — sports Chair. Paper only. Never talks to Follower.

One game. You do not pick the slate.
Scan open Kalshi sports markets (verified series only).
Keep 20–80 with measured depth.
v1: moneyline, spread (ATS), total. No player props.
Rank by leftover after vig / half-spread. Best one is the table.
Sport follows the calendar (CFB Sat, NFL Sun, whatever is liquid).
ICE: 99¢ chalk, empty book, stale, too early, no depth.
empty/unknown-null is UNKNOWN not DEAD.
Paper lock only. Cap a few per day.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import (
    book_is_unknown,
    kalshi_taker_fee_cents,
    leftover_after_vig,
    never_lock_near_certain,
    odds_to_cents,
    paper_lock_day_ok,
    playable_yes_mid,
)
from backend.config import settings

CT = ZoneInfo("America/Chicago")
_Fetch = Callable[[str, Dict[str, Any]], Any]

# Verified live Kalshi series (probed 2026-08-15). If a series 404s, drop it.
# Championship / futures tickers (KXNBA, KXMLB, KXNCAAF, KXNHL) are not game books.
V1_SERIES: Tuple[Tuple[str, str, str], ...] = (
    ("NFL", "KXNFLGAME", "ml"),
    ("NFL", "KXNFLSPREAD", "spread"),
    ("NFL", "KXNFLTOTAL", "total"),
    ("CFB", "KXNCAAFGAME", "ml"),
    ("CFB", "KXNCAAFSPREAD", "spread"),
    ("CFB", "KXNCAAFTOTAL", "total"),
    ("NBA", "KXNBAGAME", "ml"),
    ("NBA", "KXNBASPREAD", "spread"),
    ("NBA", "KXNBATOTAL", "total"),
    ("MLB", "KXMLBGAME", "ml"),
    ("MLB", "KXMLBSPREAD", "spread"),
    ("MLB", "KXMLBTOTAL", "total"),
    ("NHL", "KXNHLGAME", "ml"),
    ("NHL", "KXNHLSPREAD", "spread"),
    ("NHL", "KXNHLTOTAL", "total"),
)
BLOCKED_SERIES: Tuple[str, ...] = (
    "KXBTCD", "KXETHD", "KXBTC15M", "KXETH15M",
    "KXHIGHTDAL", "KXHIGHNY", "KXHIGHCHI",
)
PROP_HINTS = ("PROP", "PLAYER", "YDS", "TDS", "REB", "AST", "PTS-", "STRIKEOUT", "HR-")

SEATS: Tuple[Dict[str, Any], ...] = (
    {"id": "LINE", "job": "The Kalshi book / the number.", "mark": "/static/bots/line.png", "weight": 1.0},
    {"id": "STEAM", "job": "Line movement. When the number runs, say so.", "mark": "/static/bots/steam.png", "weight": 1.0},
    {"id": "FADE", "job": "Public vs sharp. Fade the loud side.", "mark": "/static/bots/fade.png", "weight": 1.0},
    {"id": "HURT", "job": "Injuries / out. A body on the grass changes the number.", "mark": "/static/bots/hurt.png", "weight": 0.7},
    {"id": "ICE", "job": "Veto. 99¢ chalk, empty book, stale, too early, no depth.", "mark": "/static/bots/ice.png", "weight": 1.0},
)
SUBS: Tuple[Dict[str, Any], ...] = (
    {"id": "CLOCK", "parent": "LINE", "job": "Time to kick / tip / first pitch.", "mark": "/static/bots/line.png"},
    {"id": "FORM", "parent": "FADE", "job": "ATS / record. Who covers when it matters.", "mark": "/static/bots/fade.png"},
    {"id": "WX", "parent": "ICE", "job": "Outdoor weather that moves a total or spread.", "mark": "/static/bots/ice.png"},
)
CHAIR: Dict[str, str] = {
    "id": "ARES",
    "name": "ARES",
    "job": "Sports chair. One game. Paper only. Does not talk to Follower.",
    "mark": "/static/ares-chair.png",
    "portrait": "/static/ares-chair.png",
}

# NFL + major CFB. Unknown team → gold vs cyan.
TEAM_COLORS: Dict[str, Tuple[str, str]] = {
    # NFL
    "ARI": ("#97233F", "#FFB612"), "ATL": ("#A71930", "#000000"),
    "BAL": ("#241773", "#9E7C0C"), "BUF": ("#00338D", "#C60C30"),
    "CAR": ("#0085CA", "#101820"), "CHI": ("#0B162A", "#C83803"),
    "CIN": ("#FB4F14", "#000000"), "CLE": ("#311D00", "#FF3C00"),
    "DAL": ("#003594", "#869397"), "DEN": ("#FB4F14", "#002244"),
    "DET": ("#0076B6", "#B0B7BC"), "GB": ("#203731", "#FFB612"),
    "HOU": ("#03202F", "#A71930"), "IND": ("#002C5F", "#A2AAAD"),
    "JAX": ("#006778", "#9F792C"), "KC": ("#E31837", "#FFB81C"),
    "LAC": ("#0080C6", "#FFC20E"), "LAR": ("#003594", "#FFA300"),
    "LV": ("#000000", "#A5ACAF"), "MIA": ("#008E97", "#FC4C02"),
    "MIN": ("#4F2683", "#FFC62F"), "NE": ("#002244", "#C60C30"),
    "NO": ("#D3BC8D", "#101820"), "NYG": ("#0B2265", "#A71930"),
    "NYJ": ("#125740", "#000000"), "PHI": ("#004C54", "#A5ACAF"),
    "PIT": ("#FFB612", "#101820"), "SEA": ("#002244", "#69BE28"),
    "SF": ("#AA0000", "#B3995D"), "TB": ("#D50A0A", "#34302B"),
    "TEN": ("#0C2340", "#4B92DB"), "WAS": ("#5A1414", "#FFB612"),
    "WSH": ("#5A1414", "#FFB612"),
    # Major CFB
    "ALA": ("#9E1B32", "#828A8F"), "AUB": ("#0C2340", "#E87722"),
    "UGA": ("#BA0C2F", "#000000"), "FLA": ("#0021A5", "#FA4616"),
    "LSU": ("#461D7C", "#FDD023"), "TENN": ("#FF8200", "#FFFFFF"),
    "TEX": ("#BF5700", "#333F48"), "OU": ("#841617", "#FDF2D9"),
    "OKLA": ("#841617", "#FDF2D9"), "OSU": ("#BB0000", "#666666"),
    "MICH": ("#00274C", "#FFCB05"), "MSU": ("#18453B", "#FFFFFF"),
    "PSU": ("#041E42", "#FFFFFF"), "ORE": ("#154733", "#FEE123"),
    "WASH": ("#4B2E83", "#B7A57A"), "USC": ("#990000", "#FFC72C"),
    "ND": ("#0C2340", "#C99700"), "CLEM": ("#F56600", "#522D80"),
    "FSU": ("#782F40", "#CEB888"), "MIA": ("#F47321", "#005030"),
    "UNC": ("#7BAFD4", "#13294B"), "DUKE": ("#003366", "#FFFFFF"),
    "BAMA": ("#9E1B32", "#828A8F"), "UCLA": ("#2D68C4", "#F2A900"),
    "STAN": ("#8C1515", "#FFFFFF"), "WIS": ("#C5050C", "#FFFFFF"),
    "IOWA": ("#FFCD00", "#000000"), "TTU": ("#CC0000", "#000000"),
    "BAY": ("#003015", "#FECB00"), "TCU": ("#4D1979", "#A3A9AC"),
    "KSU": ("#512888", "#FFFFFF"), "KU": ("#0051BA", "#E8000D"),
    "ARK": ("#9D2235", "#FFFFFF"), "MIZZ": ("#F1B82D", "#000000"),
    "SCAR": ("#73000A", "#000000"), "UK": ("#0033A0", "#FFFFFF"),
    "VANDY": ("#866D4B", "#000000"), "MISS": ("#CE1126", "#14213D"),
    "MSST": ("#660000", "#FFFFFF"), "TAMU": ("#500000", "#FFFFFF"),
    "GT": ("#B3A369", "#003057"), "VT": ("#630031", "#CF4420"),
    "UVA": ("#232D4B", "#F84C1E"), "LOU": ("#AD0000", "#000000"),
    "PITT": ("#003594", "#FFB81C"), "SYR": ("#F76900", "#000E54"),
    "BC": ("#8B1003", "#B29D6C"), "WAKE": ("#9E7E38", "#000000"),
    "NCST": ("#CC0000", "#FFFFFF"), "MEM": ("#003087", "#8A8D8F"),
    "UNLV": ("#B10202", "#666666"), "BAMA": ("#9E1B32", "#828A8F"),
}
GOLD = "#F0C14A"
CYAN = "#00E8FF"
HEAT = "#FF6A1A"
ICE_CYAN = "#3DE0FF"
AMBER = "#F5B942"
BOARD_TTL_S = 20.0
MIN_DEPTH_VOL = 80.0
EARLY_NO_LOCK_MINS = 8.0
GAME_RE = re.compile(
    r"^(?P<series>KX[A-Z]+)-(?P<yy>\d{2})(?P<mon>[A-Z]{3})(?P<dd>\d{2})(?:\d{4})?(?P<teams>[A-Z]{4,12})$"
)
MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

_board_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
_fills: List[Dict[str, Any]] = []
_fills_loaded = False
_dead_series: Dict[str, float] = {}
_mids: Dict[str, List[Tuple[float, float]]] = {}
_data_override: Optional[Path] = None


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    global _fills, _fills_loaded, _board_cache, _dead_series, _mids, _data_override
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _dead_series = {}
    _mids = {}
    _data_override = data_dir


def _data_path(name: str) -> Path:
    root = _data_override or Path(getattr(settings, "DATA_DIR", None) or "./data")
    root.mkdir(parents=True, exist_ok=True)
    return root / name


def _load_fills() -> List[Dict[str, Any]]:
    global _fills, _fills_loaded
    if _fills_loaded:
        return _fills
    path = _data_path("ats_table.json")
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
    _data_path("ats_table.json").write_text(
        json.dumps({"fills": _fills[-400:]}, indent=2), encoding="utf-8"
    )


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


def team_colors(code: Any) -> Tuple[str, str]:
    key = str(code or "").upper().strip()
    if key in TEAM_COLORS:
        return TEAM_COLORS[key]
    return (GOLD, CYAN)


def eye_from_pick(
    call: Any,
    kind: Any = None,
    team: Any = None,
    home: Any = None,
    away: Any = None,
) -> Dict[str, Any]:
    """One portrait. Recolor eyes from the pick — never bake 32 faces."""
    c = str(call or "WAIT").upper()
    k = str(kind or "").lower()
    if c in ("", "WAIT"):
        return {"mode": "wait", "primary": AMBER, "secondary": AMBER, "label": "WAIT"}
    if k == "total" or c in ("OVER", "UNDER"):
        if c == "OVER":
            return {"mode": "over", "primary": HEAT, "secondary": "#FFC14A", "label": "OVER"}
        return {"mode": "under", "primary": ICE_CYAN, "secondary": CYAN, "label": "UNDER"}
    side = team or ""
    if c in ("HOME",) and home:
        side = home
    if c in ("AWAY",) and away:
        side = away
    if c not in ("COVER", "NO-COVER", "HOME", "AWAY", "OVER", "UNDER", "WAIT"):
        side = c
    prim, sec = team_colors(side)
    return {"mode": "team", "primary": prim, "secondary": sec, "label": c, "team": str(side or "").upper()}


def sport_priority(now: Optional[datetime] = None) -> List[str]:
    """Calendar first. Liquid book still wins if the slate is empty."""
    n = now or datetime.now(CT)
    if n.tzinfo is None:
        n = n.replace(tzinfo=CT)
    else:
        n = n.astimezone(CT)
    wd = n.weekday()
    if wd == 5:
        return ["CFB", "NFL", "MLB", "NBA", "NHL"]
    if wd == 6:
        return ["NFL", "CFB", "MLB", "NBA", "NHL"]
    return ["MLB", "NBA", "NHL", "NFL", "CFB"]


def series_kind(series: Any) -> Optional[str]:
    key = str(series or "").upper()
    for _sport, tick, kind in V1_SERIES:
        if tick == key:
            return kind
    return None


def series_sport(series: Any) -> Optional[str]:
    key = str(series or "").upper()
    for sport, tick, _kind in V1_SERIES:
        if tick == key:
            return sport
    return None


def is_prop_ticker(ticker: Any) -> bool:
    tick = str(ticker or "").upper()
    return any(h in tick for h in PROP_HINTS)


def is_blocked_series(series: Any) -> bool:
    key = str(series or "").upper()
    return any(key.startswith(b) for b in BLOCKED_SERIES)


def parse_event_teams(event_ticker: Any) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """KXNFLGAME-26AUG15DALSEA → (DALSEA, DAL, SEA)."""
    raw = str(event_ticker or "").upper()
    m = GAME_RE.match(raw)
    if not m:
        # MLB sometimes embeds HHMM: KXMLBGAME-26AUG172040LADCOL
        tail = raw.rsplit("-", 1)[-1]
        letters = re.sub(r"[^A-Z]", "", tail)
        if len(letters) >= 6:
            # last 6 as two 3-letter codes, else split in half
            if len(letters) == 6:
                return letters, letters[:3], letters[3:]
            mid = len(letters) // 2
            return letters, letters[:mid], letters[mid:]
        return None, None, None
    blob = m.group("teams")
    if len(blob) == 6:
        return blob, blob[:3], blob[3:]
    if len(blob) == 4:
        return blob, blob[:2], blob[2:]
    mid = len(blob) // 2
    return blob, blob[:mid], blob[mid:]


def ticker_side_code(ticker: Any) -> Optional[str]:
    """KXNFLGAME-26AUG15DALSEA-SEA → SEA. KXNFLSPREAD-…-SEA7 → SEA."""
    tick = str(ticker or "").upper()
    if "-" not in tick:
        return None
    tail = tick.rsplit("-", 1)[-1]
    m = re.match(r"^([A-Z]{2,4})(\d+(?:\.\d+)?)?$", tail)
    if m:
        return m.group(1)
    if tail.replace(".", "", 1).isdigit():
        return None
    return tail if tail.isalpha() and 2 <= len(tail) <= 4 else None


def market_quotes(m: Dict[str, Any]) -> Dict[str, Optional[float]]:
    yb = odds_to_cents(m.get("yes_bid_dollars") if m.get("yes_bid_dollars") is not None else m.get("yes_bid"))
    ya = odds_to_cents(m.get("yes_ask_dollars") if m.get("yes_ask_dollars") is not None else m.get("yes_ask"))
    nb = odds_to_cents(m.get("no_bid_dollars") if m.get("no_bid_dollars") is not None else m.get("no_bid"))
    na = odds_to_cents(m.get("no_ask_dollars") if m.get("no_ask_dollars") is not None else m.get("no_ask"))
    if nb is None and ya is not None:
        nb = max(0.0, 100.0 - ya)
    if na is None and yb is not None:
        na = max(0.0, 100.0 - yb)
    mid = None
    if yb is not None and ya is not None:
        mid = (yb + ya) / 2.0
    elif ya is not None:
        mid = ya
    elif yb is not None:
        mid = yb
    spread = None
    if yb is not None and ya is not None:
        spread = abs(ya - yb)
    return {"yes_bid": yb, "yes_ask": ya, "no_bid": nb, "no_ask": na, "yes_mid": mid, "spread": spread}


def measured_depth(m: Dict[str, Any], orderbook: Any = None) -> Dict[str, Any]:
    """
    Real measured depth. Missing/null size is UNKNOWN, not DEAD.
    volume_fp / OI count as a measurement when present.
    """
    vol = _f(m.get("volume_fp") if m.get("volume_fp") is not None else m.get("volume"))
    oi = _f(m.get("open_interest_fp") if m.get("open_interest_fp") is not None else m.get("open_interest"))
    ysz = _f(m.get("yes_bid_size_fp") if m.get("yes_bid_size_fp") is not None else m.get("yes_bid_size"))
    nsz = _f(m.get("no_bid_size_fp") if m.get("no_bid_size_fp") is not None else m.get("no_bid_size"))
    have_vol = vol is not None or oi is not None
    have_sz = ysz is not None or nsz is not None
    if orderbook and isinstance(orderbook, dict):
        from backend.agents.chair_gates import parse_book_depth
        parsed = parse_book_depth(orderbook)
        if parsed:
            parsed = dict(parsed)
            parsed["volume"] = vol
            parsed["open_interest"] = oi
            return parsed
    if not have_vol and not have_sz:
        return {
            "yes_depth": None,
            "no_depth": None,
            "has_size": False,
            "measured": False,
            "book_state": "unknown",
            "volume": vol,
            "open_interest": oi,
        }
    depth_n = float(vol or 0.0) + float(oi or 0.0)
    empty = have_vol and float(vol or 0.0) <= 0 and float(oi or 0.0) <= 0
    thin = have_vol and not empty and depth_n < MIN_DEPTH_VOL
    return {
        "yes_depth": ysz if ysz is not None else (depth_n if have_vol else None),
        "no_depth": nsz if nsz is not None else (depth_n if have_vol else None),
        "has_size": (not empty) and (depth_n > 0 or bool(ysz) or bool(nsz)),
        "measured": True,
        "book_state": "dead" if empty else ("thin" if thin else "ok"),
        "volume": vol,
        "open_interest": oi,
    }


def ice_reason(
    quotes: Dict[str, Any],
    depth: Dict[str, Any],
    *,
    stale: bool = False,
    mins_left: Optional[float] = None,
    window_minutes: Optional[float] = None,
) -> Optional[str]:
    """ICE veto copy. UNKNOWN book is not DEAD."""
    if stale:
        return "STALE TAPE · ICE ON"
    near = never_lock_near_certain(quotes.get("yes_ask"), quotes.get("no_ask"), side_odds=quotes.get("yes_mid"))
    if near:
        return "99¢ CHALK · ICE ON"
    mid = quotes.get("yes_mid")
    if mid is not None and not playable_yes_mid(mid):
        return f"{mid:.0f}¢ OUTSIDE 20–80 · ICE ON"
    if book_is_unknown(depth):
        return None
    state = str(depth.get("book_state") or "")
    if state == "dead":
        return "EMPTY BOOK WE MEASURED · ICE ON"
    if state == "thin" or (
        depth.get("measured")
        and depth.get("has_size")
        and float(depth.get("volume") or 0) < MIN_DEPTH_VOL
        and float(depth.get("open_interest") or 0) < MIN_DEPTH_VOL
    ):
        return "NO DEPTH · ICE ON"
    if mins_left is not None and window_minutes:
        try:
            elapsed = float(window_minutes) - float(mins_left)
            if 0 <= elapsed < EARLY_NO_LOCK_MINS:
                return "FIRST MINUTES · ICE ON"
        except (TypeError, ValueError):
            pass
    return None


def no_vig_p(quotes: Dict[str, Any]) -> Optional[float]:
    ya = quotes.get("yes_ask")
    na = quotes.get("no_ask")
    if ya is None or na is None:
        mid = quotes.get("yes_mid")
        return None if mid is None else max(0.01, min(0.99, float(mid) / 100.0))
    yes_p = float(ya) / 100.0
    no_p = float(na) / 100.0
    tot = yes_p + no_p
    if tot <= 0:
        return None
    return max(0.01, min(0.99, yes_p / tot))


def score_market(m: Dict[str, Any], depth: Dict[str, Any], quotes: Dict[str, Any]) -> Dict[str, Any]:
    """Honest leftover after vig / half-spread. Best leftover is the table."""
    p = no_vig_p(quotes)
    ya = quotes.get("yes_ask")
    na = quotes.get("no_ask")
    spread = quotes.get("spread")
    yes_left = None
    no_left = None
    if p is not None and ya is not None:
        yes_left = leftover_after_vig(p, float(ya), spread, kalshi_taker_fee_cents(ya))
    if p is not None and na is not None:
        no_left = leftover_after_vig(1.0 - p, float(na), spread, kalshi_taker_fee_cents(na))
    side = "YES"
    leftover = yes_left
    if no_left is not None and (leftover is None or no_left > leftover):
        side = "NO"
        leftover = no_left
    # Fade the public favorite. Book-implied leftover is usually negative after
    # vig + fee; a 52¢ dog prior is the honest v1 edge when the crowd is loud.
    mid = quotes.get("yes_mid")
    if mid is not None and mid >= 58 and na is not None:
        fade_left = leftover_after_vig(0.52, float(na), spread, kalshi_taker_fee_cents(na))
        if leftover is None or fade_left > leftover:
            side = "NO"
            leftover = fade_left
            p = 0.52
    elif mid is not None and mid <= 42 and ya is not None:
        fade_left = leftover_after_vig(0.52, float(ya), spread, kalshi_taker_fee_cents(ya))
        if leftover is None or fade_left > leftover:
            side = "YES"
            leftover = fade_left
            p = 0.52
    return {
        "p_finish": p,
        "yes_leftover": yes_left,
        "no_leftover": no_left,
        "leftover": leftover,
        "side": side,
    }


def sports_call(kind: str, side: str, team: Optional[str], home: Optional[str], away: Optional[str]) -> str:
    """COVER / NO-COVER · HOME / AWAY or team · OVER / UNDER. Never UP / DOWN / YES / NO."""
    k = str(kind or "").lower()
    s = str(side or "").upper()
    if s in ("", "WAIT"):
        return "WAIT"
    if k == "total":
        return "OVER" if s == "YES" else "UNDER"
    if k == "spread":
        return "COVER" if s == "YES" else "NO-COVER"
    # moneyline — team name if we have it, else HOME / AWAY
    if s == "YES" and team:
        return str(team).upper()
    if s == "NO" and team:
        other = home if team == away else away
        return str(other or ("HOME" if team == away else "AWAY")).upper()
    if team and home and team == home:
        return str(home).upper()
    if team and away and team == away:
        return str(away).upper()
    return "HOME" if s == "YES" else "AWAY"


def note_mid(ticker: str, mid: Optional[float], now: Optional[float] = None) -> Optional[float]:
    """Steam: cents the mid ran since we last saw this ticker."""
    if mid is None or not ticker:
        return None
    t = float(now if now is not None else time.time())
    hist = _mids.setdefault(ticker, [])
    hist.append((t, float(mid)))
    _mids[ticker] = [h for h in hist if t - h[0] <= 3600.0][-12:]
    old = [h for h in _mids[ticker] if t - h[0] >= 90.0]
    if not old:
        return 0.0
    return float(mid) - float(old[0][1])


def clock_line(close_time: Any, now: Optional[datetime] = None) -> str:
    close = _parse_iso(close_time)
    if close is None:
        return "CLOCK IS DARK"
    n = now or datetime.now(timezone.utc)
    secs = (close - n).total_seconds()
    if secs <= 0:
        return "THEY'RE OFF"
    hrs = int(secs // 3600)
    mins = int((secs % 3600) // 60)
    if hrs >= 48:
        return f"KICK IN {hrs // 24}D"
    if hrs >= 1:
        return f"KICK IN {hrs}H {mins:02d}M"
    return f"KICK IN {mins:02d}M"


def one_liner(seat: str, **kw: Any) -> str:
    """CRT one-liners. No spreadsheet voice."""
    s = seat.upper()
    if s == "LINE":
        num = kw.get("number") or kw.get("title") or "THE BOOK"
        mid = kw.get("mid")
        mid_s = f" · {mid:.0f}¢" if mid is not None else ""
        return f"THE NUMBER · {num}{mid_s}"
    if s == "STEAM":
        run = kw.get("run")
        if run is None:
            return "STEAM IS QUIET"
        if abs(float(run)) < 1.0:
            return "THE NUMBER HOLDS"
        way = "HOTTER" if float(run) > 0 else "COLDER"
        return f"STEAM IS LIVE · THE LINE RAN {abs(float(run)):.0f}¢ {way}"
    if s == "FADE":
        pub = kw.get("public")
        if not pub:
            return "NO CROWD TO FADE"
        return f"PUBLIC ON {pub} · SHARP TAKES THE OTHER DOOR"
    if s == "HURT":
        note = kw.get("hurt")
        if note:
            return f"HURT · {note}"
        return "NO CUTS ON THE SHEET"
    if s == "ICE":
        why = kw.get("ice")
        if why:
            return why
        if kw.get("unknown"):
            return "BOOK IS UNKNOWN · NOT DEAD"
        return "ICE IS CLEAR"
    if s == "CLOCK":
        return str(kw.get("clock") or "CLOCK IS DARK")
    if s == "FORM":
        rec = kw.get("form")
        return f"FORM · {rec}" if rec else "NO CARD YET"
    if s == "WX":
        wx = kw.get("wx")
        return f"WX · {wx}" if wx else "WX IS A GHOST"
    return "—"


def locks_today(now: Optional[datetime] = None) -> int:
    n = now or datetime.now(CT)
    if n.tzinfo is None:
        n = n.replace(tzinfo=CT)
    else:
        n = n.astimezone(CT)
    day = n.date().isoformat()
    c = 0
    for r in _load_fills():
        if str(r.get("side") or "").upper() == "WAIT":
            continue
        at = str(r.get("day") or r.get("at") or "")
        if at.startswith(day):
            c += 1
    return c


def build_seats(pick: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not pick:
        rows = []
        for s in SEATS:
            unknown = s["id"] == "ICE"
            rows.append({
                **s,
                "dir": "WAIT",
                "call": one_liner(s["id"], unknown=unknown, ice=None),
                "confidence": 40,
            })
        return rows
    ice = pick.get("ice")
    unknown = bool(pick.get("unknown_book"))
    line_dir = pick.get("call") if not ice else "WAIT"
    steam_run = pick.get("steam")
    steam_dir = "WAIT"
    if steam_run is not None and abs(float(steam_run)) >= 1.5:
        steam_dir = pick.get("call") or "WAIT"
    fade_dir = "WAIT"
    pub = pick.get("public")
    if pub and pick.get("call") and str(pub).upper() != str(pick.get("call")).upper():
        fade_dir = pick.get("call")
    elif pub and pick.get("call") and str(pub).upper() == str(pick.get("call")).upper():
        fade_dir = "WAIT"
    hurt_dir = "WAIT"
    ice_dir = "WAIT" if ice or unknown else pick.get("call") or "WAIT"
    packed = {
        "LINE": (line_dir, one_liner("LINE", number=pick.get("number"), mid=pick.get("mid"), title=pick.get("title"))),
        "STEAM": (steam_dir, one_liner("STEAM", run=steam_run)),
        "FADE": (fade_dir, one_liner("FADE", public=pub)),
        "HURT": (hurt_dir, one_liner("HURT", hurt=pick.get("hurt"))),
        "ICE": (ice_dir if not ice else "WAIT", one_liner("ICE", ice=ice, unknown=unknown)),
    }
    out = []
    for s in SEATS:
        d, call = packed[s["id"]]
        out.append({**s, "dir": d or "WAIT", "call": call, "confidence": 62 if d and d != "WAIT" else 44})
    return out


def build_subs(pick: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    clock = one_liner("CLOCK", clock=clock_line((pick or {}).get("close_time")))
    form = one_liner("FORM", form=(pick or {}).get("form"))
    wx = one_liner("WX", wx=(pick or {}).get("wx"))
    lines = {"CLOCK": clock, "FORM": form, "WX": wx}
    return [{**s, "dir": "WAIT", "call": lines[s["id"]], "confidence": 30} for s in SUBS]


def build_chair(pick: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not pick:
        return {
            **CHAIR,
            "eye": "WAIT",
            "call": "WAIT · NO GAME ON THE TABLE",
            "confidence": 40,
            "ticker": None,
            "kind": None,
            "eyes": eye_from_pick("WAIT"),
            "paper_only": True,
            "follower": False,
        }
    ice = pick.get("ice")
    call = "WAIT" if ice else (pick.get("call") or "WAIT")
    eyes = eye_from_pick(call, pick.get("kind"), pick.get("team"), pick.get("home"), pick.get("away"))
    if ice:
        summary = f"WAIT · {ice}"
    elif call == "WAIT":
        summary = "WAIT · NO EDGE AFTER VIG"
    else:
        num = pick.get("number") or pick.get("title") or ""
        leftover = pick.get("leftover")
        ev = f" · LEFTOVER {leftover:.1f}¢" if leftover is not None else ""
        summary = f"LOCKED {call} · {num}{ev} · PAPER · ONE GAME"
    return {
        **CHAIR,
        "eye": call,
        "call": summary,
        "confidence": 0 if ice or call == "WAIT" else int(min(88, 52 + abs(float(pick.get("leftover") or 0)) * 4)),
        "ticker": pick.get("ticker"),
        "kind": pick.get("kind"),
        "eyes": eyes,
        "paper_only": True,
        "follower": False,
    }


def _normalize_market(m: Dict[str, Any], series: str, kind: str, sport: str) -> Optional[Dict[str, Any]]:
    tick = str(m.get("ticker") or "")
    if not tick or is_prop_ticker(tick) or is_blocked_series(m.get("series_ticker") or series):
        return None
    event = str(m.get("event_ticker") or "")
    blob, away, home = parse_event_teams(event or tick.rsplit("-", 1)[0])
    team = ticker_side_code(tick)
    quotes = market_quotes(m)
    depth = measured_depth(m)
    mid = quotes.get("yes_mid")
    if mid is None:
        return None
    if book_is_unknown(depth):
        # keep as candidate but mark unknown — ICE will not call it DEAD
        pass
    elif depth.get("book_state") == "dead":
        return None
    elif not depth.get("has_size"):
        return None
    elif float(depth.get("volume") or 0) + float(depth.get("open_interest") or 0) < MIN_DEPTH_VOL and depth.get("measured"):
        return None
    scored = score_market(m, depth, quotes)
    close = m.get("close_time") or m.get("expiration_time")
    close_dt = _parse_iso(close)
    mins_left = None
    if close_dt:
        mins_left = (close_dt - datetime.now(timezone.utc)).total_seconds() / 60.0
    number = None
    floor = m.get("floor_strike")
    if kind == "spread" and team and floor is not None:
        number = f"{team} -{float(floor):g}"
    elif kind == "total" and floor is not None:
        number = f"O/U {float(floor):g}"
    elif kind == "ml" and team:
        number = f"{away or '?'} @ {home or '?'}" if away and home else team
    else:
        number = str(m.get("title") or tick)
    ice = ice_reason(quotes, depth, stale=False, mins_left=mins_left, window_minutes=180.0 if mins_left and mins_left > 60 else 60.0)
    if mid is not None and not playable_yes_mid(mid) and not ice:
        ice = f"{mid:.0f}¢ OUTSIDE 20–80 · ICE ON"
    unknown = book_is_unknown(depth)
    call = sports_call(kind, scored["side"], team, home, away)
    steam = note_mid(tick, mid)
    public = None
    vol = depth.get("volume")
    if mid is not None and vol and float(vol) >= MIN_DEPTH_VOL:
        if mid >= 58:
            public = sports_call(kind, "YES", team, home, away)
        elif mid <= 42:
            public = sports_call(kind, "NO", team, home, away)
    return {
        "ticker": tick,
        "event": event,
        "series": series,
        "sport": sport,
        "kind": kind,
        "title": m.get("title") or tick,
        "number": number,
        "team": team,
        "home": home,
        "away": away,
        "game": blob or event,
        "quotes": quotes,
        "depth": depth,
        "mid": mid,
        "leftover": scored["leftover"],
        "p_finish": scored["p_finish"],
        "side": scored["side"],
        "call": call,
        "ice": ice,
        "unknown_book": unknown,
        "close_time": close,
        "mins_left": mins_left,
        "steam": steam,
        "public": public,
        "volume": vol,
        "hurt": None,
        "form": None,
        "wx": None,
    }


def rank_key(row: Dict[str, Any], priority: List[str]) -> Tuple:
    sport = str(row.get("sport") or "")
    try:
        pri = priority.index(sport)
    except ValueError:
        pri = 99
    left = float(row.get("leftover") or -999)
    ice_pen = 40.0 if row.get("ice") else 0.0
    unk_pen = 2.0 if row.get("unknown_book") else 0.0
    return (ice_pen, -left, pri, unk_pen)


def pick_one_game(rows: List[Dict[str, Any]], now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Best leftover on one game. Calendar sport is a tie-break, not a lock."""
    if not rows:
        return None
    pri = sport_priority(now)
    playable = [r for r in rows if r.get("leftover") is not None]
    if not playable:
        return None
    # Prefer the calendar sport when it actually has leftover.
    for sport in pri:
        pack = [r for r in playable if r.get("sport") == sport and not r.get("ice")]
        if pack:
            pack.sort(key=lambda r: float(r.get("leftover") or -999), reverse=True)
            best = pack[0]
            break
    else:
        playable.sort(key=lambda r: rank_key(r, pri))
        best = playable[0]
    game = best.get("game")
    siblings = [r for r in rows if r.get("game") == game]
    best["siblings"] = [
        {"ticker": s["ticker"], "kind": s["kind"], "call": s["call"], "leftover": s.get("leftover")}
        for s in siblings
        if s.get("kind") in ("ml", "spread", "total")
    ]
    return best


async def _kalshi_fetch(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    import httpx

    base = str(getattr(settings, "KALSHI_BASE", "https://external-api.kalshi.com/trade-api/v2")).rstrip("/")
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(base + path, params=params)
        if r.status_code == 404:
            return {"markets": [], "missing": True}
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}


async def fetch_series(series: str, fetch: Optional[_Fetch] = None) -> Tuple[List[Dict[str, Any]], bool]:
    if series in _dead_series and time.time() - _dead_series[series] < 3600:
        return [], True
    fn = fetch or _kalshi_fetch
    try:
        data = await fn("/markets", {"series_ticker": series, "status": "open", "limit": 200})
    except Exception:
        return [], True
    if not isinstance(data, dict) or data.get("missing"):
        _dead_series[series] = time.time()
        return [], True
    rows = data.get("markets") or []
    return [m for m in rows if isinstance(m, dict)], False


async def scan_open(fetch: Optional[_Fetch] = None) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for sport, series, kind in V1_SERIES:
        rows, missing = await fetch_series(series, fetch=fetch)
        if missing:
            continue
        for m in rows:
            m = dict(m)
            m.setdefault("series_ticker", series)
            got = _normalize_market(m, series, kind, sport)
            if got:
                out.append(got)
    return out


def paper_lock_if_clear(pick: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Paper only. Cap a few per day. Follower stays off."""
    if not pick or pick.get("ice") or pick.get("call") in (None, "WAIT"):
        return None
    leftover = pick.get("leftover")
    if leftover is None or float(leftover) <= 0:
        return None
    n = now or datetime.now(CT)
    if n.tzinfo is None:
        n = n.replace(tzinfo=CT)
    else:
        n = n.astimezone(CT)
    if not paper_lock_day_ok(locks_today(n)):
        pick["ice"] = "DAY CAP · A FEW PER DAY"
        pick["call"] = "WAIT"
        return None
    day = n.date().isoformat()
    # one open lock per game
    for r in _load_fills():
        if r.get("game") == pick.get("game") and str(r.get("result") or "").upper() in ("OPEN", "PENDING", ""):
            if str(r.get("side") or "").upper() != "WAIT":
                return r
    row = {
        "id": f"ats-{int(time.time() * 1000)}",
        "ticker": pick.get("ticker"),
        "game": pick.get("game"),
        "sport": pick.get("sport"),
        "kind": pick.get("kind"),
        "side": pick.get("call"),
        "yes_no": pick.get("side"),
        "mid": pick.get("mid"),
        "leftover": pick.get("leftover"),
        "result": "OPEN",
        "settled": False,
        "paper": True,
        "follower": False,
        "live": False,
        "day": day,
        "at": n.isoformat(),
        "close_time": pick.get("close_time"),
        "title": pick.get("title"),
        "number": pick.get("number"),
    }
    _fills.append(row)
    _save_fills()
    return row


def chair_accuracy() -> Dict[str, Any]:
    rows = [r for r in _load_fills() if str(r.get("side") or "").upper() != "WAIT"]
    hits = [r for r in rows if str(r.get("result") or "").upper() == "HIT"]
    miss = [r for r in rows if str(r.get("result") or "").upper() == "MISS"]
    waits = [r for r in _load_fills() if str(r.get("side") or "").upper() == "WAIT" or str(r.get("result") or "").upper() == "WAIT"]
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
        "label": "ARES · ATS",
        "log": list(reversed(_load_fills()[-24:])),
        "recent": list(reversed(rows[-12:])),
    }


def lock_tape() -> List[Dict[str, Any]]:
    return list(reversed(_load_fills()[-16:]))


async def build_board(fetch: Optional[_Fetch] = None, now: Optional[datetime] = None, force: bool = False) -> Dict[str, Any]:
    ttl = BOARD_TTL_S
    if not force and _board_cache.get("payload") and time.time() - float(_board_cache.get("at") or 0) < ttl:
        return _board_cache["payload"]
    rows = await scan_open(fetch=fetch)
    pick = pick_one_game(rows, now=now)
    lock = paper_lock_if_clear(pick, now=now) if pick else None
    if lock and pick and not pick.get("ice"):
        pick = dict(pick)
        pick["locked"] = True
    chair = build_chair(pick)
    seats = build_seats(pick)
    subs = build_subs(pick)
    acc = chair_accuracy()
    payload = {
        "chair": chair,
        "seats": seats,
        "subs": subs,
        "pick": None if not pick else {
            "ticker": pick.get("ticker"),
            "game": pick.get("game"),
            "sport": pick.get("sport"),
            "kind": pick.get("kind"),
            "call": chair.get("eye"),
            "number": pick.get("number"),
            "title": pick.get("title"),
            "home": pick.get("home"),
            "away": pick.get("away"),
            "team": pick.get("team"),
            "mid": pick.get("mid"),
            "leftover": pick.get("leftover"),
            "ice": pick.get("ice"),
            "unknown_book": pick.get("unknown_book"),
            "close_time": pick.get("close_time"),
            "siblings": pick.get("siblings") or [],
            "eyes": chair.get("eyes"),
        },
        "accuracy": acc,
        "tape": lock_tape(),
        "fills": lock_tape(),
        "scanned": len(rows),
        "series": [s for _sp, s, _k in V1_SERIES if s not in _dead_series],
        "dead_series": sorted(_dead_series.keys()),
        "paper_only": True,
        "follower": False,
        "live": False,
        "leader": "ARES",
        "asset": "ats",
    }
    _board_cache["at"] = time.time()
    _board_cache["payload"] = payload
    return payload
