"""
ARES — sports Chair. Paper only. Never talks to Follower.

One game. You do not pick the slate.
Scan open Kalshi sports markets (verified series only).
Keep 20–80 with measured depth. 10–90 is for the crypto Chairs only.
v1: moneyline, spread (ATS), total. No player props.
Rank nearer kick first, then calendar sport, then leftover after vig / half-spread.
A fat leftover a month out does not beat a nearer NFL/CFB book.
Sport follows the calendar among similarly-near games (CFB Sat, NFL Sun).
ICE: 99¢ chalk, empty book, stale, too early, no depth.
empty/unknown-null is UNKNOWN not DEAD.
Paper lock only. Cap a few per day. Follower OFF. No Live.

ARES GATES (Watcher / Zach — not chairs, not a sixth seat):
1) ONE TICKET — one open Kalshi sports book, one side, then sit. No spraying the slate. Same one-call discipline as Satoshi. ML / spread / total only. No player props.
2) KEY NUMBERS — football refuses to buy a 3 when the line is already 3, or a 7 when it is already 7, unless EV still clears after the juice. This is a GATE, not a sixth Chair. NBA/MLB can no-op.
3) SIT AFTER KICK — hard clock. Once the game is live (or the Kalshi window is in-play), Ares WAITs. Late injury news also sits. ICE veto stays. Not a vibe.
4) SPORT BRAINS — separate weights for NFL / NBA / MLB (and whatever Kalshi actually has open). Tuesday NBA is not Sunday NFL. Do not share Satoshi/Vitalik crypto weights.
5) PUBLIC TUG — floor visual only: public money vs the line as a rope. FADE one way, STEAM the other. Does not override Chair gates.
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
    "job": "Sports chair. One ticket. Paper only. Does not talk to Follower.",
    "mark": "/static/ares-chair.png",
    "portrait": "/static/ares-chair.png",
}

# Five Watcher-greenlit gates. Not chairs. Subs still feed parents only.
ARES_GATES: Tuple[str, ...] = (
    "ONE TICKET",
    "KEY NUMBERS",
    "SIT AFTER KICK",
    "SPORT BRAINS",
    "PUBLIC TUG",
)
ARES_YES_LO = 20.0
ARES_YES_HI = 80.0
FOOTBALL_SPORTS = frozenset({"NFL", "CFB"})
# ~30 days. September CFB does not lock when a nearer NFL/CFB book is live.
MONTH_KICK_MINS = 30 * 24 * 60.0
KEY_NUMBERS = frozenset({3.0, 7.0})
KEY_NUMBER_MIN_LEFTOVER = 3.0
LATE_HURT_MINS = 15.0
IN_PLAY_STATUSES = frozenset({
    "in_play", "inplay", "live", "open_in_play", "active_in_play",
})
# Tuesday NBA is not Sunday NFL. Do not share Satoshi/Vitalik crypto weights.
SPORT_BRAINS: Dict[str, Dict[str, float]] = {
    "NFL": {"LINE": 1.00, "STEAM": 1.05, "FADE": 1.20, "HURT": 0.90, "ICE": 1.00},
    "CFB": {"LINE": 1.00, "STEAM": 1.00, "FADE": 1.15, "HURT": 0.85, "ICE": 1.00},
    "NBA": {"LINE": 1.00, "STEAM": 1.25, "FADE": 0.80, "HURT": 0.55, "ICE": 1.00},
    "MLB": {"LINE": 1.00, "STEAM": 0.85, "FADE": 0.70, "HURT": 0.45, "ICE": 1.00},
    "NHL": {"LINE": 1.00, "STEAM": 1.00, "FADE": 0.75, "HURT": 0.60, "ICE": 1.00},
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
_watch_cache: Dict[str, Dict[str, Any]] = {}
_summary_cache: Dict[str, Dict[str, Any]] = {}

# ESPN scoreboard header — public JSON ESPN.com uses for the scores strip.
# site.api.espn.com 403s from some egress; this header endpoint does not.
# Kalshi event metadata has no broadcast field (probed 2026-08-15).
ESPN_HEADER = "https://site.web.api.espn.com/apis/v2/scoreboard/header"
ESPN_LEAGUES: Dict[str, Tuple[str, str]] = {
    "NFL": ("football", "nfl"),
    "CFB": ("football", "college-football"),
    "MLB": ("baseball", "mlb"),
    "NBA": ("basketball", "nba"),
    "NHL": ("hockey", "nhl"),
}
WATCH_TTL_S = 900.0
WATCH_ALIASES: Dict[str, str] = {
    "WAS": "WSH", "WSH": "WSH",
    "JAC": "JAX", "JAX": "JAX",
    "BAMA": "ALA", "ALA": "ALA",
    "OKLA": "OU", "OU": "OU",
    "MIZZ": "MIZ", "MIZ": "MIZ",
    "NCAAST": "NCST", "NCST": "NCST",
}


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    global _fills, _fills_loaded, _board_cache, _dead_series, _mids, _data_override, _watch_cache, _summary_cache
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _dead_series = {}
    _mids = {}
    _watch_cache = {}
    _summary_cache = {}
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


def ares_playable_mid(yes_mid: Any) -> bool:
    """Sports band stays 20–80. Do not use the crypto 10–90 Chair band."""
    return playable_yes_mid(yes_mid, ARES_YES_LO, ARES_YES_HI)


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
    if mid is not None and not ares_playable_mid(mid):
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


def build_game_clock(pick: Optional[Dict[str, Any]] = None, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Countdown to the game they bet on — pick close / kickoff. Not the crypto 1H hour."""
    pick = pick or {}
    close = _parse_iso(pick.get("close_time"))
    n = now or datetime.now(timezone.utc)
    secs = None if close is None else int((close - n).total_seconds())
    return {
        "kind": "game",
        "label": "KICK",
        "close_time": pick.get("close_time"),
        "seconds_to_kick": secs,
        "line": clock_line(pick.get("close_time"), now=n),
        "game": pick.get("game"),
        "number": pick.get("number"),
        "sport": pick.get("sport"),
        "title": pick.get("title"),
        "kind_bet": pick.get("kind"),
    }


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
            return f"HURT · SIT · {note}"
        return "HURT · SIT · DARK"
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
        return f"FORM · {rec}" if rec else "FORM · SIT · NO CARD"
    if s == "WX":
        wx = kw.get("wx")
        return f"WX · {wx}" if wx else "WX · DARK"
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
    brains = sport_brain(pick.get("sport"))
    line_dir = pick.get("call") if not ice and not pick.get("gate") else "WAIT"
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
        out.append({
            **s,
            "dir": d or "WAIT",
            "call": call,
            "confidence": 62 if d and d != "WAIT" else 44,
            "weight": float(brains.get(s["id"], s.get("weight") or 1.0)),
        })
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
    gate = pick.get("gate")
    call = "WAIT" if ice or gate else (pick.get("call") or "WAIT")
    eyes = eye_from_pick(call, pick.get("kind"), pick.get("team"), pick.get("home"), pick.get("away"))
    if ice:
        summary = f"WAIT · {ice}"
    elif gate:
        summary = f"WAIT · {gate}"
    elif call == "WAIT":
        summary = "WAIT · NO EDGE AFTER VIG"
    else:
        num = pick.get("number") or pick.get("title") or ""
        leftover = pick.get("leftover")
        ev = f" · LEFTOVER {leftover:.1f}¢" if leftover is not None else ""
        summary = f"LOCKED {call} · {num}{ev} · PAPER · ONE TICKET"
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
    if mid is not None and not ares_playable_mid(mid) and not ice:
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
        "status": str(m.get("status") or "active"),
        "floor_strike": floor,
        "gate": None,
        "in_play": str(m.get("status") or "").lower().replace("-", "_") in IN_PLAY_STATUSES,
    }


def sport_brain(sport: Any) -> Dict[str, float]:
    """Per-sport seat weights. Not Satoshi/Vitalik crypto weights."""
    key = str(sport or "").upper()
    hit = SPORT_BRAINS.get(key)
    if hit:
        return dict(hit)
    return {"LINE": 1.0, "STEAM": 1.0, "FADE": 1.0, "HURT": 0.7, "ICE": 1.0}


def brain_score(row: Dict[str, Any]) -> float:
    """Leftover scaled by the sport brain. Does not share crypto adaptive weights."""
    try:
        left = float(row.get("leftover") or 0.0)
    except (TypeError, ValueError):
        left = 0.0
    w = sport_brain(row.get("sport"))
    pub = row.get("public")
    call = row.get("call")
    if pub and call and str(pub).upper() != str(call).upper():
        left *= float(w.get("FADE") or 1.0)
    steam = row.get("steam")
    if steam is not None:
        try:
            if abs(float(steam)) >= 1.5:
                left *= float(w.get("STEAM") or 1.0)
        except (TypeError, ValueError):
            pass
    return left


def spread_abs(pick: Dict[str, Any]) -> Optional[float]:
    """Absolute spread from floor_strike, ticker tail, or the printed number."""
    floor = pick.get("floor_strike")
    if floor is not None:
        try:
            return abs(float(floor))
        except (TypeError, ValueError):
            pass
    tick = str(pick.get("ticker") or "")
    tail = tick.rsplit("-", 1)[-1] if tick else ""
    m = re.match(r"^[A-Z]{2,4}(\d+(?:\.\d+)?)$", tail)
    if m:
        try:
            return abs(float(m.group(1)))
        except (TypeError, ValueError):
            pass
    num = str(pick.get("number") or "")
    hit = re.search(r"(-?\d+(?:\.\d+)?)", num)
    if hit and ("O/U" not in num.upper()):
        try:
            return abs(float(hit.group(1)))
        except (TypeError, ValueError):
            return None
    return None


def buying_the_key(pick: Dict[str, Any]) -> bool:
    """YES / COVER on a minus number is buying the key. Getting +3/+7 is not."""
    side = str(pick.get("side") or "").upper()
    call = str(pick.get("call") or "").upper()
    if side == "YES" or call == "COVER":
        return True
    return False


def key_number_gate(pick: Dict[str, Any]) -> Optional[str]:
    """Football only. Refuse to buy 3 or 7 unless leftover still clears juice."""
    if str(pick.get("sport") or "").upper() not in FOOTBALL_SPORTS:
        return None
    if str(pick.get("kind") or "").lower() != "spread":
        return None
    n = spread_abs(pick)
    if n not in KEY_NUMBERS:
        return None
    if not buying_the_key(pick):
        return None
    leftover = pick.get("leftover")
    quotes = pick.get("quotes") if isinstance(pick.get("quotes"), dict) else {}
    ask = quotes.get("yes_ask") if str(pick.get("side") or "").upper() != "NO" else quotes.get("no_ask")
    juice = kalshi_taker_fee_cents(ask)
    try:
        left = float(leftover) if leftover is not None else None
    except (TypeError, ValueError):
        left = None
    if left is not None and left > max(float(juice), KEY_NUMBER_MIN_LEFTOVER):
        return None
    return f"KEY NUMBER · {int(n)} · JUICE EATS IT"


def event_is_live(ev: Any) -> bool:
    """ESPN header / summary status. pre = not live. Never invent a kick."""
    if not isinstance(ev, dict) or not ev:
        return False
    st = ev.get("status")
    if isinstance(st, dict):
        state = str(st.get("state") or st.get("type") or st.get("name") or "").lower()
        if st.get("inProgress") or state in ("in", "inprogress", "live"):
            return True
    elif isinstance(st, str) and st.lower() in ("in", "inprogress", "live"):
        return True
    typ = ev.get("statusType") if isinstance(ev.get("statusType"), dict) else {}
    if typ.get("inProgress") or str(typ.get("state") or "").lower() in ("in", "live", "inprogress"):
        return True
    return False


def sit_after_kick(
    pick: Dict[str, Any],
    watch: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> Optional[str]:
    """Hard clock. Live game or in-play Kalshi window → WAIT."""
    st = str(pick.get("status") or "").lower().replace("-", "_")
    if pick.get("in_play") or st in IN_PLAY_STATUSES:
        return "SIT AFTER KICK · IN PLAY"
    mins = pick.get("mins_left")
    close = _parse_iso(pick.get("close_time"))
    if close is not None:
        n = now or datetime.now(timezone.utc)
        if n.tzinfo is None:
            n = n.replace(tzinfo=timezone.utc)
        mins = (close - n).total_seconds() / 60.0
    if mins is not None:
        try:
            if float(mins) <= 0:
                return "SIT AFTER KICK · THEY'RE OFF"
        except (TypeError, ValueError):
            pass
    if watch and (watch.get("live") or event_is_live(watch.get("event") or {})):
        return "SIT AFTER KICK · LIVE"
    return None


def late_hurt_gate(pick: Dict[str, Any], now: Optional[datetime] = None) -> Optional[str]:
    """Late injury news sits. Not a lock-flip in the last minutes."""
    if not pick.get("hurt"):
        return None
    mins = pick.get("mins_left")
    close = _parse_iso(pick.get("close_time"))
    if close is not None:
        n = now or datetime.now(timezone.utc)
        if n.tzinfo is None:
            n = n.replace(tzinfo=timezone.utc)
        mins = (close - n).total_seconds() / 60.0
    if mins is None:
        return None
    try:
        m = float(mins)
    except (TypeError, ValueError):
        return None
    if 0 < m <= LATE_HURT_MINS:
        return "LATE HURT · SIT"
    return None


def open_paper_ticket() -> Optional[Dict[str, Any]]:
    """The one open paper ticket, if any. ONE TICKET sits after this."""
    for r in _load_fills():
        if str(r.get("side") or "").upper() == "WAIT":
            continue
        if str(r.get("result") or "").upper() in ("OPEN", "PENDING", ""):
            return r
    return None


def one_ticket_gate(pick: Dict[str, Any], held: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Already sat on one book / one side. Do not spray the slate."""
    ticket = held if held is not None else open_paper_ticket()
    if not ticket:
        return None
    if pick.get("ticker") and ticket.get("ticker") and pick.get("ticker") == ticket.get("ticker"):
        return None
    if pick.get("game") and ticket.get("game") and pick.get("game") == ticket.get("game"):
        return None
    return "ONE TICKET · ALREADY SAT"


def apply_ares_gates(
    pick: Optional[Dict[str, Any]],
    watch: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
    held: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Run the five gates. ICE veto stays. PUBLIC TUG is visual-only and is not a gate here."""
    if not pick:
        return None
    if pick.get("ice"):
        return str(pick.get("ice"))
    reason = sit_after_kick(pick, watch, now)
    if not reason:
        reason = late_hurt_gate(pick, now)
    if not reason:
        reason = key_number_gate(pick)
    if not reason:
        reason = one_ticket_gate(pick, held)
    if reason:
        pick["gate"] = reason
        pick["call"] = "WAIT"
    return reason


def public_tug(pick: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Floor rope only. FADE one way, STEAM the other. Does not override gates."""
    if not pick:
        return {
            "fade": "SIT",
            "steam": "SIT",
            "lean": 0.0,
            "line": "TUG · DARK",
            "visual_only": True,
        }
    pub = pick.get("public")
    call = pick.get("call")
    steam_run = pick.get("steam")
    fade_side = str(pub).upper() if pub else "SIT"
    steam_side = "SIT"
    if steam_run is not None:
        try:
            if abs(float(steam_run)) >= 1.5 and call and str(call).upper() != "WAIT":
                steam_side = str(call).upper()
        except (TypeError, ValueError):
            pass
    if steam_side == "SIT" and call and pub and str(call).upper() != str(pub).upper() and str(call).upper() != "WAIT":
        steam_side = str(call).upper()
    lean = 0.0
    mid = pick.get("mid")
    if mid is not None:
        try:
            lean = max(-1.0, min(1.0, (float(mid) - 50.0) / 30.0))
        except (TypeError, ValueError):
            lean = 0.0
    return {
        "fade": fade_side,
        "steam": steam_side,
        "lean": round(lean, 3),
        "line": f"TUG · PUBLIC {fade_side} · STEAM {steam_side}",
        "visual_only": True,
    }


def kick_mins_left(row: Dict[str, Any], now: Optional[datetime] = None) -> Optional[float]:
    """Minutes to close. Prefer close_time against `now` so ranking stays honest."""
    close = _parse_iso(row.get("close_time"))
    if close is not None:
        n = now or datetime.now(timezone.utc)
        if n.tzinfo is None:
            n = n.replace(tzinfo=timezone.utc)
        return (close - n).total_seconds() / 60.0
    mins = row.get("mins_left")
    if mins is None:
        return None
    try:
        return float(mins)
    except (TypeError, ValueError):
        return None


def kick_horizon(row: Dict[str, Any], now: Optional[datetime] = None) -> int:
    """Coarse kick bucket. Smaller = nearer. A month-out leftover sits last."""
    mins = kick_mins_left(row, now)
    if mins is None:
        return 5
    try:
        m = float(mins)
    except (TypeError, ValueError):
        return 5
    if m <= 0:
        return 99
    if m < 2 * 24 * 60:
        return 0
    if m < 7 * 24 * 60:
        return 1
    if m < 14 * 24 * 60:
        return 2
    if m < MONTH_KICK_MINS:
        return 3
    return 4


def month_out_kick(row: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    mins = kick_mins_left(row, now)
    if mins is None:
        return False
    try:
        return float(mins) >= MONTH_KICK_MINS
    except (TypeError, ValueError):
        return False


def nearer_football_playable(rows: List[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    """A nearer NFL/CFB book is on the table — do not lock a 30-day-out slate."""
    for r in rows:
        if r.get("ice"):
            continue
        if str(r.get("sport") or "").upper() not in FOOTBALL_SPORTS:
            continue
        mins = kick_mins_left(r, now)
        if mins is None:
            continue
        try:
            m = float(mins)
        except (TypeError, ValueError):
            continue
        if 0 < m < MONTH_KICK_MINS:
            return True
    return False


def rank_key(row: Dict[str, Any], priority: List[str], now: Optional[datetime] = None) -> Tuple:
    sport = str(row.get("sport") or "")
    try:
        pri = priority.index(sport)
    except ValueError:
        pri = 99
    left = brain_score(row)
    ice_pen = 40.0 if row.get("ice") else 0.0
    unk_pen = 2.0 if row.get("unknown_book") else 0.0
    return (ice_pen, kick_horizon(row, now), pri, -left, unk_pen)


def pick_one_game(rows: List[Dict[str, Any]], now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """ONE TICKET: nearer kick first. Calendar sport breaks ties among similarly-near books."""
    if not rows:
        return None
    pri = sport_priority(now)
    playable = [r for r in rows if r.get("leftover") is not None]
    if not playable:
        return None
    clear = [r for r in playable if not r.get("ice")]
    pack = clear or playable
    if nearer_football_playable(pack, now):
        near = [r for r in pack if not month_out_kick(r, now)]
        if near:
            pack = near
    pack.sort(key=lambda r: rank_key(r, pri, now))
    best = pack[0]
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
    """Paper only. Cap a few per day. Follower stays off. ONE TICKET sits after the first open fill."""
    if not pick or pick.get("ice") or pick.get("gate") or pick.get("call") in (None, "WAIT"):
        return None
    held = open_paper_ticket()
    if held and held.get("ticker") != pick.get("ticker"):
        pick["gate"] = "ONE TICKET · ALREADY SAT"
        pick["call"] = "WAIT"
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


def team_watch_keys(code: Any) -> set:
    c = str(code or "").upper().strip()
    if not c:
        return set()
    keys = {c}
    if c in WATCH_ALIASES:
        keys.add(WATCH_ALIASES[c])
    for src, dst in WATCH_ALIASES.items():
        if dst == c:
            keys.add(src)
    return keys


def dark_watch(why: str = "NO LISTING", *, down: bool = False, source: str = "espn-header") -> Dict[str, Any]:
    line = "WATCH · DARK · FEED QUIET" if down else (
        "WATCH · DARK · NO GAME ON THE TABLE" if why == "NO GAME" else "WATCH · DARK · NO LISTING"
    )
    return {
        "line": line,
        "network": None,
        "networks": [],
        "market": None,
        "listed": False,
        "source": source,
        "why": why,
        "down": down,
        "live": False,
    }


def watch_copy(names: List[str], market: Optional[str]) -> str:
    """One CRT line. Never invent a channel — names come from the listing."""
    shown = " / ".join([n for n in names if n][:2])
    if not shown:
        return "WATCH · DARK · NO LISTING"
    if market == "national":
        return f"WATCH · {shown} · NATIONAL"
    if market == "stream":
        return f"WATCH · {shown} · STREAM"
    if market == "local":
        return f"WATCH · {shown} · LOCAL"
    return f"WATCH · {shown}"


def event_team_keys(ev: Dict[str, Any]) -> set:
    out: set = set()
    for c in ev.get("competitors") or []:
        if not isinstance(c, dict):
            continue
        out |= team_watch_keys(c.get("abbreviation"))
    if not out:
        short = str(ev.get("shortName") or ev.get("name") or "").upper()
        for tok in re.findall(r"[A-Z]{2,4}", short):
            out |= team_watch_keys(tok)
    return out


def match_watch_event(events: List[Dict[str, Any]], home: Any, away: Any) -> Optional[Dict[str, Any]]:
    """Both sides must hit. One team is not a listing."""
    h, a = team_watch_keys(home), team_watch_keys(away)
    if not h or not a:
        return None
    hits = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        have = event_team_keys(ev)
        if (h & have) and (a & have):
            hits.append(ev)
    return hits[0] if hits else None


def listing_from_event(ev: Dict[str, Any]) -> Dict[str, Any]:
    rows = [b for b in (ev.get("broadcasts") or []) if isinstance(b, dict)]
    def _name(b: Dict[str, Any]) -> str:
        return str(b.get("shortName") or b.get("callLetters") or b.get("station") or b.get("name") or "").strip()

    nat_tv = [b for b in rows if b.get("isNational") and str(b.get("type") or "").upper() == "TV"]
    nat_st = [b for b in rows if b.get("isNational") and str(b.get("type") or "").upper() != "TV"]
    loc_tv = [b for b in rows if (not b.get("isNational")) and str(b.get("type") or "").upper() == "TV"]
    if nat_tv:
        chosen, market = nat_tv, "national"
    elif nat_st:
        chosen, market = nat_st, "stream"
    elif loc_tv:
        chosen, market = loc_tv, "local"
    else:
        chosen, market = [], None
    names: List[str] = []
    for b in chosen[:2]:
        n = _name(b)
        if n and n not in names:
            names.append(n)
    if not names:
        raw = str(ev.get("broadcast") or "").strip()
        if raw:
            names.append(raw)
            market = market or "national"
    if not names:
        dark = dark_watch("NO LISTING")
        dark["live"] = event_is_live(ev)
        dark["event"] = ev
        return dark
    game = str(ev.get("shortName") or ev.get("name") or "").strip() or None
    return {
        "line": watch_copy(names, market),
        "network": names[0],
        "networks": names,
        "market": market,
        "listed": True,
        "source": "espn-header",
        "game": game,
        "event_id": ev.get("id"),
        "why": None,
        "down": False,
        "live": event_is_live(ev),
        "event": ev,
    }


def parse_espn_header(data: Any) -> List[Dict[str, Any]]:
    if not isinstance(data, dict):
        return []
    out: List[Dict[str, Any]] = []
    for sport in data.get("sports") or []:
        if not isinstance(sport, dict):
            continue
        for lg in sport.get("leagues") or []:
            if not isinstance(lg, dict):
                continue
            for ev in lg.get("events") or []:
                if isinstance(ev, dict):
                    out.append(ev)
    return out


async def _espn_header_fetch(sport: str, league: str) -> Dict[str, Any]:
    import httpx

    url = f"{ESPN_HEADER}?sport={sport}&league={league}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SatoshiCouncil/1.0)",
        "Accept": "application/json",
        "Referer": "https://www.espn.com/",
    }
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}


async def load_watch_events(sport: str, fetch: Optional[_Fetch] = None) -> Tuple[List[Dict[str, Any]], bool]:
    """Cached ESPN header events. down=True when the feed failed."""
    pair = ESPN_LEAGUES.get(str(sport or "").upper())
    if not pair:
        return [], False
    key = f"{pair[0]}/{pair[1]}"
    hit = _watch_cache.get(key)
    if hit and time.time() - float(hit.get("at") or 0) < WATCH_TTL_S:
        return list(hit.get("events") or []), bool(hit.get("down"))
    if _data_override is not None and fetch is None:
        return [], False
    try:
        if fetch:
            data = await fetch("/watch", {"sport": pair[0], "league": pair[1]})
        else:
            data = await _espn_header_fetch(pair[0], pair[1])
        events = parse_espn_header(data) if isinstance(data, dict) else []
        _watch_cache[key] = {"at": time.time(), "events": events, "down": False}
        return events, False
    except Exception:
        _watch_cache[key] = {"at": time.time(), "events": [], "down": True}
        return [], True


async def attach_watch(
    pick: Optional[Dict[str, Any]],
    fetch: Optional[_Fetch] = None,
    events: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Where you can watch the picked game. Never invent a channel."""
    if not pick:
        return dark_watch("NO GAME")
    if events is None:
        events, down = await load_watch_events(str(pick.get("sport") or ""), fetch=fetch)
        if down:
            return dark_watch("FEED QUIET", down=True)
    ev = match_watch_event(events or [], pick.get("home"), pick.get("away"))
    if not ev:
        return dark_watch("NO LISTING")
    return listing_from_event(ev)


HURT_STATUSES = ("out", "doubtful", "injured reserve")
ESPN_SITE = "https://site.web.api.espn.com/apis/site/v2/sports"


def parse_hurt(summary: Dict[str, Any]) -> Optional[str]:
    """Out / doubtful only. Never invent a name."""
    bits: List[str] = []
    for block in summary.get("injuries") or []:
        if not isinstance(block, dict):
            continue
        ab = str((block.get("team") or {}).get("abbreviation") or "").upper()
        for it in block.get("injuries") or []:
            if not isinstance(it, dict):
                continue
            st = str(it.get("status") or "").lower()
            typ = it.get("type") if isinstance(it.get("type"), dict) else {}
            desc = str(typ.get("description") or typ.get("abbreviation") or "").lower()
            if st not in HURT_STATUSES and desc not in ("out", "doubtful", "o", "d"):
                continue
            ath = it.get("athlete") if isinstance(it.get("athlete"), dict) else {}
            name = str(ath.get("shortName") or ath.get("displayName") or "").strip()
            if not name:
                continue
            label = "DOUBTFUL" if ("doubt" in st or desc in ("doubtful", "d")) else "OUT"
            bits.append(f"{ab} {label} {name}" if ab else f"{label} {name}")
            if len(bits) >= 2:
                return " · ".join(bits)
    return " · ".join(bits) if bits else None


def parse_form(summary: Dict[str, Any]) -> Optional[str]:
    """Last-five W/L and ATS only when ESPN actually printed a record."""
    bits: List[str] = []
    for row in summary.get("lastFiveGames") or []:
        if not isinstance(row, dict):
            continue
        ab = str((row.get("team") or {}).get("abbreviation") or "").upper()
        evs = row.get("events") or []
        if not ab or not isinstance(evs, list):
            continue
        w = sum(1 for e in evs if isinstance(e, dict) and str(e.get("gameResult") or "").upper() == "W")
        l = sum(1 for e in evs if isinstance(e, dict) and str(e.get("gameResult") or "").upper() == "L")
        if (w + l) > 0:
            bits.append(f"{ab} L5 {w}-{l}")
    for row in summary.get("againstTheSpread") or []:
        if not isinstance(row, dict):
            continue
        ab = str((row.get("team") or {}).get("abbreviation") or "").upper()
        for rec in row.get("records") or []:
            if not isinstance(rec, dict):
                continue
            summ = str(rec.get("summary") or rec.get("displayValue") or "").strip()
            if ab and summ and summ not in ("0-0", "0-0-0"):
                bits.append(f"{ab} ATS {summ}")
    return " · ".join(bits[:2]) if bits else None


def parse_wx(summary: Dict[str, Any]) -> Tuple[Optional[str], bool]:
    """Weather only if ESPN printed it. 'mattered' = rain/wind/extreme temp."""
    w = ((summary.get("gameInfo") or {}).get("weather") or {})
    if not isinstance(w, dict) or not w:
        return None, False
    parts: List[str] = []
    temp = w.get("temperature")
    cond = w.get("conditionId")
    precip = w.get("precipitation")
    gust = w.get("gust")
    try:
        if temp is not None:
            parts.append(f"{int(float(temp))}°")
    except (TypeError, ValueError):
        pass
    if cond:
        parts.append(str(cond).upper())
    mattered = False
    try:
        if precip is not None and float(precip) >= 40:
            parts.append(f"{int(float(precip))}% RAIN")
            mattered = True
        if gust is not None and float(gust) >= 15:
            parts.append(f"GUST {int(float(gust))}")
            mattered = True
        if temp is not None and (float(temp) <= 32 or float(temp) >= 90):
            mattered = True
        if cond and any(x in str(cond).lower() for x in ("rain", "snow", "storm", "wind")):
            mattered = True
    except (TypeError, ValueError):
        pass
    return (" ".join(parts) if parts else None), mattered


def apply_espn_facts(pick: Dict[str, Any], summary: Optional[Dict[str, Any]]) -> None:
    if not pick or not isinstance(summary, dict):
        return
    hurt = parse_hurt(summary)
    form = parse_form(summary)
    wx, mattered = parse_wx(summary)
    if hurt:
        pick["hurt"] = hurt
    if form:
        pick["form"] = form
    if wx:
        pick["wx"] = wx
        pick["wx_mattered"] = mattered


async def _espn_summary_fetch(sport: str, league: str, event_id: str) -> Dict[str, Any]:
    import httpx

    url = f"{ESPN_SITE}/{sport}/{league}/summary?event={event_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SatoshiCouncil/1.0)",
        "Accept": "application/json",
        "Referer": "https://www.espn.com/",
    }
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}


async def load_espn_summary(sport: str, event_id: Any, fetch: Optional[_Fetch] = None) -> Optional[Dict[str, Any]]:
    eid = str(event_id or "").strip()
    pair = ESPN_LEAGUES.get(str(sport or "").upper())
    if not eid or not pair:
        return None
    hit = _summary_cache.get(eid)
    if hit and time.time() - float(hit.get("at") or 0) < WATCH_TTL_S:
        return hit.get("payload")
    if _data_override is not None and fetch is None:
        return None
    try:
        if fetch:
            data = await fetch("/summary", {"sport": pair[0], "league": pair[1], "event": eid})
        else:
            data = await _espn_summary_fetch(pair[0], pair[1], eid)
        payload = data if isinstance(data, dict) else None
        _summary_cache[eid] = {"at": time.time(), "payload": payload}
        return payload
    except Exception:
        _summary_cache[eid] = {"at": time.time(), "payload": None}
        return None


def _why_chip(sid: str, vote: str, fact: str, fed: bool, pick: Dict[str, Any]) -> Optional[str]:
    """Short fight-strip token. Real fact if we have one; SIT / DARK otherwise."""
    sid = sid.upper()
    if sid == "LINE":
        num = str(pick.get("number") or "").strip()
        mid = pick.get("mid")
        if vote != "WAIT":
            if mid is not None:
                try:
                    return f"LINE {vote} {int(round(float(mid)))}¢"
                except (TypeError, ValueError):
                    return f"LINE {vote}"
            return f"LINE {vote}" + (f" {num}" if num else "")
        return "LINE SIT"
    if sid == "STEAM":
        run = pick.get("steam")
        if run is None:
            return "STEAM DARK"
        try:
            mag = abs(float(run))
        except (TypeError, ValueError):
            return "STEAM SIT"
        if mag >= 1.5:
            way = "UP" if float(run) > 0 else "DOWN"
            return f"STEAM {way} {mag:.0f}¢"
        return "STEAM SIT"
    if sid == "FADE":
        if vote != "WAIT":
            return f"FADE {vote}"
        return "FADE SIT" if pick.get("public") else "FADE DARK"
    if sid == "HURT":
        note = str(pick.get("hurt") or "").strip()
        return f"HURT {note}" if note else "HURT DARK"
    if sid == "ICE":
        ice = str(pick.get("ice") or "").strip()
        if ice:
            return f"ICE {ice}"
        return "ICE SIT"
    if sid == "CLOCK":
        if not fed or "DARK" in fact.upper():
            return None
        return f"CLOCK {fact}" if fact and not fact.upper().startswith("CLOCK") else (fact or "CLOCK")
    if sid == "FORM":
        rec = str(pick.get("form") or "").strip()
        return f"FORM {rec}" if rec else None
    if sid == "WX":
        wx = str(pick.get("wx") or "").strip()
        if wx and pick.get("wx_mattered"):
            return f"WX {wx}"
        return None
    if fed and vote != "WAIT":
        return f"{sid} {vote}"
    if "DARK" in fact.upper():
        return f"{sid} DARK"
    return f"{sid} SIT"


def build_why(
    pick: Optional[Dict[str, Any]],
    seats: List[Dict[str, Any]],
    subs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Punchy WHY strip. SIT / DARK when a seat did not vote or had no fact."""
    by = {str(s.get("id")): s for s in (seats or [])}
    sub_by = {str(s.get("id")): s for s in (subs or [])}

    def row(sid: str, vote: Any, fact: str, fed: bool) -> Dict[str, Any]:
        v = str(vote or "WAIT").upper()
        return {"id": sid, "vote": v, "fact": fact, "fed": bool(fed)}

    rows: List[Dict[str, Any]] = []
    if not pick:
        for sid in ("LINE", "STEAM", "FADE", "HURT", "ICE"):
            rows.append(row(sid, "WAIT", f"{sid} · SIT · DARK", False))
        return {
            "line": "WHY · DARK · NO GAME ON THE TABLE",
            "strip": "LINE SIT · STEAM SIT · FADE SIT · HURT DARK · ICE DARK",
            "seats": rows,
            "source": None,
        }

    line = by.get("LINE") or {}
    steam = by.get("STEAM") or {}
    fade = by.get("FADE") or {}
    hurt = by.get("HURT") or {}
    ice = by.get("ICE") or {}
    steam_run = pick.get("steam")
    if steam_run is None:
        steam_fact = "STEAM · SIT · DARK"
    elif abs(float(steam_run)) < 1.5:
        steam_fact = "STEAM · SIT · THE NUMBER HOLDS"
    else:
        steam_fact = steam.get("call") or one_liner("STEAM", run=steam_run)
    hurt_note = pick.get("hurt")
    hurt_fact = hurt.get("call") or (f"HURT · SIT · {hurt_note}" if hurt_note else "HURT · SIT · DARK")
    ice_on = bool(pick.get("ice"))
    rows.append(row("LINE", line.get("dir"), line.get("call") or one_liner("LINE", number=pick.get("number"), mid=pick.get("mid")), not ice_on))
    rows.append(row("STEAM", steam.get("dir"), steam_fact, steam.get("dir") not in (None, "WAIT")))
    rows.append(row("FADE", fade.get("dir"), fade.get("call") or one_liner("FADE", public=pick.get("public")), fade.get("dir") not in (None, "WAIT")))
    rows.append(row("HURT", "WAIT", hurt_fact, bool(hurt_note)))
    rows.append(row("ICE", "WAIT" if ice_on else (ice.get("dir") or "WAIT"), ice.get("call") or one_liner("ICE", ice=pick.get("ice"), unknown=pick.get("unknown_book")), ice_on))

    clock = sub_by.get("CLOCK") or {}
    form = sub_by.get("FORM") or {}
    wx = sub_by.get("WX") or {}
    clock_fact = clock.get("call") or clock_line(pick.get("close_time"))
    clock_live = bool(clock_fact and "DARK" not in str(clock_fact).upper() and "THEY'RE OFF" not in str(clock_fact).upper())
    if clock_live:
        rows.append(row("CLOCK", "WAIT", clock_fact, True))
    if pick.get("form"):
        rows.append(row("FORM", "WAIT", form.get("call") or f"FORM · {pick.get('form')}", True))
    else:
        rows.append(row("FORM", "WAIT", "FORM · SIT · NO CARD", False))
    if pick.get("wx"):
        rows.append(row("WX", "WAIT", wx.get("call") or f"WX · {pick.get('wx')}", bool(pick.get("wx_mattered"))))
    else:
        rows.append(row("WX", "WAIT", "WX · DARK", False))

    call = str(pick.get("call") or "WAIT").upper()
    if ice_on:
        head = f"WHY · ICE SAT · {pick.get('ice')}"
    elif pick.get("gate"):
        head = f"WHY · {pick.get('gate')}"
    elif call == "WAIT":
        head = "WHY · DARK · NO EDGE AFTER VIG"
    else:
        bits = [f"WHY · {call}"]
        pub = pick.get("public")
        if pub and str(pub).upper() != call:
            bits.append(f"FADE {pub}")
        leftover = pick.get("leftover")
        if leftover is not None and float(leftover) > 0:
            bits.append(f"LEFTOVER {float(leftover):.1f}¢")
        if pick.get("number"):
            bits.append(str(pick.get("number")))
        if hurt_note:
            bits.append(str(hurt_note))
        elif pick.get("wx_mattered") and pick.get("wx"):
            bits.append(str(pick.get("wx")))
        head = " · ".join(bits[:5])

    chips = []
    order = ("LINE", "STEAM", "FADE", "HURT", "ICE", "WX", "FORM", "CLOCK")
    by_id = {r["id"]: r for r in rows}
    for sid in order:
        r = by_id.get(sid)
        if not r:
            continue
        token = _why_chip(r["id"], r["vote"], r["fact"], r["fed"], pick)
        if token:
            chips.append(token)
    return {
        "line": head,
        "strip": " · ".join(chips[:7]),
        "seats": rows,
        "source": "kalshi+espn-summary",
    }


async def build_board(fetch: Optional[_Fetch] = None, now: Optional[datetime] = None, force: bool = False, watch_fetch: Optional[_Fetch] = None, watch_events: Optional[List[Dict[str, Any]]] = None, espn_summary: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    ttl = BOARD_TTL_S
    if not force and _board_cache.get("payload") and time.time() - float(_board_cache.get("at") or 0) < ttl:
        return _board_cache["payload"]
    rows = await scan_open(fetch=fetch)
    pick = pick_one_game(rows, now=now)
    held = open_paper_ticket()
    if held and pick:
        pinned = next((r for r in rows if r.get("ticker") == held.get("ticker")), None)
        if pinned is None:
            pinned = next((r for r in rows if r.get("game") == held.get("game")), None)
        if pinned:
            pick = dict(pinned)
            pick["siblings"] = (pick.get("siblings") or [])
            pick["locked"] = True
            if held.get("side") and str(held.get("side")).upper() != "WAIT":
                pick["call"] = held.get("side")
        elif pick.get("ticker") != held.get("ticker"):
            pick = dict(pick)
            pick["gate"] = "ONE TICKET · ALREADY SAT"
            pick["call"] = "WAIT"
    watch = await attach_watch(pick, fetch=watch_fetch, events=watch_events)
    if pick:
        pick = dict(pick)
        summary = espn_summary
        if summary is None and watch.get("event_id"):
            summary = await load_espn_summary(pick.get("sport"), watch.get("event_id"), fetch=watch_fetch)
        apply_espn_facts(pick, summary)
        if not pick.get("locked"):
            apply_ares_gates(pick, watch=watch, now=now, held=held)
    lock = paper_lock_if_clear(pick, now=now) if pick else None
    if lock and pick and not pick.get("ice") and not pick.get("gate"):
        pick["locked"] = True
    tug = public_tug(pick)
    brains = sport_brain((pick or {}).get("sport"))
    chair = build_chair(pick)
    seats = build_seats(pick)
    subs = build_subs(pick)
    why = build_why(pick, seats, subs)
    chair["watch"] = watch
    chair["why"] = why
    chair["tug"] = tug
    chair["brains"] = brains
    acc = chair_accuracy()
    payload = {
        "chair": chair,
        "seats": seats,
        "subs": subs,
        "watch": watch,
        "why": why,
        "tug": tug,
        "brains": brains,
        "gates": list(ARES_GATES),
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
            "watch": watch,
            "why": why,
            "hurt": pick.get("hurt"),
            "form": pick.get("form"),
            "wx": pick.get("wx"),
            "gate": pick.get("gate"),
            "tug": tug,
            "brains": brains,
            "status": pick.get("status"),
        },
        "accuracy": acc,
        "tape": lock_tape(),
        "fills": lock_tape(),
        "scanned": len(rows),
        "series": [s for _sp, s, _k in V1_SERIES if s not in _dead_series],
        "dead_series": sorted(_dead_series.keys()),
        "clock": build_game_clock(pick),
        "paper_only": True,
        "follower": False,
        "live": False,
        "leader": "ARES",
        "asset": "ats",
    }
    _board_cache["at"] = time.time()
    _board_cache["payload"] = payload
    return payload
