"""
THE FRONT — board v1. Dallas only.

KXHIGHTDAL, settle KDFW / DFW (not Love Field).
NYC later — do not ship KXHIGHNY in v1.
Chicago later — do not ship KXHIGHCHI in v1.

Named seats (RAIJIN / GLASS / PIT / FROST / BONE / MESH), not a crypto Floor.
If a series 404s, drop it. Do not fake cities. No city-card board.

Paper by default. Never auto-bets. Never talks to Follower.
Does not place Chair 1H locks. Settlement is NWS CLI for KDFW.
Date lives in the ticker. Read strike_type from the API every time.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import classify_wait_reason, kalshi_taker_fee_cents
from backend.config import settings
from backend.services.desk_side import (
    book_health,
    clamp_stake,
    market_quotes,
    paper_quote,
    why_line,
)

CT = ZoneInfo("America/Chicago")
_Fetch = Callable[[str, Dict[str, Any]], Any]
_Nws = Callable[[str], Any]
_Http = Callable[[str], Any]

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
TICK_DATE = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})(?:-|$)")

DALLAS: Dict[str, Any] = {
    "id": "DAL",
    "name": "DALLAS",
    "place": "DFW",
    "series": "KXHIGHTDAL",
    "station": "KDFW",
    "icao": "KDFW",
    "market": "DFW",
    "cli_office": "FWD",
    "tz": "America/Chicago",
    "order": 0,
    "climo": {8: 96, 7: 97, 9: 90, 6: 94, 10: 81},
}
CITIES: Tuple[Dict[str, Any], ...] = (DALLAS,)
BLOCKED_SERIES: Tuple[str, ...] = ("KXHIGHNY", "KXHIGHCHI", "KXHIGHTCHI")
LOVE_FIELD = ("LOVE FIELD", "KDAL", "DALLAS LOVE")

def city_by_id(cid: Any) -> Optional[Dict[str, Any]]:
    key = str(cid or "").upper()
    for c in CITIES:
        if c["id"] == key:
            return c
    return None


def city_for_series(series: Any) -> Optional[Dict[str, Any]]:
    key = str(series or "").upper()
    for c in CITIES:
        if c["series"] == key:
            return c
    return None


def city_for_ticker(ticker: Any) -> Optional[Dict[str, Any]]:
    tick = str(ticker or "").upper()
    if any(bad in tick for bad in BLOCKED_SERIES):
        return None
    for c in CITIES:
        if tick.startswith(str(c["series"])):
            return c
    return None


SEATS: Tuple[Dict[str, Any], ...] = (
    {"id": "GLASS", "job": "Official/NWS high for the station.", "mark": "/static/bots/glass.png", "weight": 1.0},
    {"id": "PIT", "job": "Kalshi implied vs that number, after vig.", "mark": "/static/bots/pit.png", "weight": 1.0},
    {"id": "FROST", "job": "Veto junk book / flip / SICK / thin n / mesh disagree.", "mark": "/static/bots/frost.png", "weight": 1.0},
    {"id": "BONE", "job": "This city’s history / climo. Seasonal base. Low weight.", "mark": "/static/bots/bone.png", "weight": 0.25},
    {"id": "MESH", "job": "Dallas high mesh — NWS grid, Open-Meteo, ensemble. Median vs the strike.", "mark": "/static/bots/mesh.png", "weight": 1.0},
)
SUBS: Tuple[Dict[str, Any], ...] = (
    {"id": "HEAT", "parent": "GLASS", "feeds": ("GLASS", "FROST"), "job": "Live KDFW METAR vs the high.", "mark": "/static/bots/heat.png"},
    {"id": "ECHO", "parent": "BONE", "feeds": ("BONE",), "job": "Yesterday’s official Dallas CLI. Persistence prior.", "mark": "/static/bots/wx-echo.png"},
    {"id": "CELL", "parent": "FROST", "feeds": ("FROST",), "job": "Storms that cap the high. FROST kill input.", "mark": "/static/bots/cell.png"},
)
CHAIR: Dict[str, str] = {
    "id": "RAIJIN",
    "name": "RAIJIN",
    "job": "Weather chair. Hits count like Satoshi / Vitalik. Does not lock the 1H Chair.",
    "mark": "/static/bots/raijin-chair.png",
}

WX_MODES = ("SUN", "HEAT", "CLOUD", "RAIN", "WIND", "STORM")
THIN_VOL = 200.0
FLIP_F = 2.0
MESH_WIDE_F = 4.0
MESH_MIN_LIVE = 2
KDFW_LAT = 32.89743
KDFW_LON = -97.02196
BOARD_TTL_S = 20.0
WX_TTL_S = 180.0
WX_REFRESH_S = 180.0  # live KDFW METAR/NWS every few minutes. Dead feed holds last mode.
CLI_HOUR_CT = 7  # NWS CLI for KDFW / FWD posts the next morning. Not a 1H close.
NWS_UA = "SatoshiCouncil/1.0 (the-front; dallas-kdfw)"
NWS_OBS_URL = "https://api.weather.gov/stations/KDFW/observations/latest"
METAR_URL = "https://aviationweather.gov/api/data/metar?ids=KDFW&format=json"
HEAT_F = 95.0
WIND_KT = 20.0

_board_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
_arm: Dict[str, Any] = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
_fills: List[Dict[str, Any]] = []
_fills_loaded = False
_forecast_prev: Dict[str, float] = {}
_wx_hold: Dict[str, Any] = {"mode": None, "obs": None, "at": 0.0}
_cli_cache: Dict[str, Optional[float]] = {}
_data_override: Optional[Path] = None


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    global _fills, _fills_loaded, _board_cache, _arm, _forecast_prev, _wx_hold, _cli_cache, _data_override
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _arm = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
    _forecast_prev = {}
    _wx_hold = {"mode": None, "obs": None, "at": 0.0}
    _cli_cache = {}
    _data_override = data_dir


def _data_path(name: str) -> Path:
    root = _data_override or Path(getattr(settings, "DATA_DIR", None) or "./data")
    root.mkdir(parents=True, exist_ok=True)
    return root / name


def _load_fills() -> List[Dict[str, Any]]:
    global _fills, _fills_loaded
    if _fills_loaded:
        return _fills
    path = _data_path("front_table.json")
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
    _data_path("front_table.json").write_text(json.dumps({"fills": _fills[-400:]}, indent=2), encoding="utf-8")


def _load_wx_hold() -> Dict[str, Any]:
    if _wx_hold.get("mode"):
        return _wx_hold
    path = _data_path("front_wx.json")
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("mode") in WX_MODES:
                _wx_hold.update({
                    "mode": data.get("mode"),
                    "obs": data.get("obs") if isinstance(data.get("obs"), dict) else None,
                    "at": float(data.get("at") or 0),
                })
    except Exception:
        pass
    return _wx_hold


def _save_wx_hold() -> None:
    if not _wx_hold.get("mode"):
        return
    _data_path("front_wx.json").write_text(
        json.dumps({"mode": _wx_hold.get("mode"), "obs": _wx_hold.get("obs"), "at": _wx_hold.get("at")}, indent=2),
        encoding="utf-8",
    )


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return bool(default)


def front_knobs() -> Dict[str, Any]:
    """Runtime Front knobs. Paper default. Never Follower. Dallas stays on."""
    try:
        from backend.services.runtime_settings import runtime_settings

        kn = runtime_settings.front()
        if isinstance(kn, dict):
            kn = dict(kn)
            kn["paper_only"] = True
            kn["dallas"] = True
            return kn
    except Exception:
        pass
    return {
        "show_tab": True,
        "show_floor_chair": True,
        "paper_only": True,
        "min_confidence": 50,
        "max_stake": float(getattr(settings, "FRONT_MAX_STAKE", 25.0)),
        "daily_loss_cap": float(getattr(settings, "FRONT_DAILY_LOSS_CAP", 50.0)),
        "no_lock_frost_sick": True,
        "sound_on_lock": True,
        "fade_underperformers": True,
        "fade_min_n": 20,
        "fade_wr_threshold": 0.42,
        "dallas": True,
    }


def front_max_stake() -> float:
    try:
        return max(1.0, min(500.0, float(front_knobs().get("max_stake") or getattr(settings, "FRONT_MAX_STAKE", 25.0))))
    except (TypeError, ValueError):
        return float(getattr(settings, "FRONT_MAX_STAKE", 25.0))


def front_daily_loss_cap() -> float:
    try:
        return max(1.0, min(500.0, float(front_knobs().get("daily_loss_cap") or getattr(settings, "FRONT_DAILY_LOSS_CAP", 50.0))))
    except (TypeError, ValueError):
        return float(getattr(settings, "FRONT_DAILY_LOSS_CAP", 50.0))


def live_allowed() -> bool:
    if _env_bool("FRONT_KILL", bool(getattr(settings, "FRONT_KILL", False))):
        return False
    if _arm.get("kill"):
        return False
    return _env_bool("FRONT_LIVE", bool(getattr(settings, "FRONT_LIVE", False)))


def is_killed() -> bool:
    return bool(_arm.get("kill")) or _env_bool("FRONT_KILL", bool(getattr(settings, "FRONT_KILL", False)))


def is_armed(now: Optional[float] = None) -> bool:
    if not live_allowed() or not _arm.get("phrase_ok"):
        return False
    t = float(now if now is not None else time.time())
    return float(_arm.get("armed_at") or 0) > 0 and t >= float(_arm.get("armed_at") or 0)


def kill_live() -> Dict[str, Any]:
    _arm["kill"] = True
    _arm["phrase_ok"] = False
    _arm["armed_at"] = 0.0
    return arm_status()


def arm_live(phrase: str, now: Optional[float] = None) -> Dict[str, Any]:
    want = str(getattr(settings, "FRONT_ARM_PHRASE", "LIVE THE FRONT") or "LIVE THE FRONT")
    got = " ".join(str(phrase or "").upper().split())
    if got != want:
        return {**arm_status(), "ok": False, "error": "typed confirm failed"}
    if is_killed() or not live_allowed():
        return {**arm_status(), "ok": False, "error": "live killed"}
    delay = float(getattr(settings, "FRONT_ARM_DELAY_S", 8.0) or 8.0)
    t = float(now if now is not None else time.time())
    _arm["phrase_ok"] = True
    _arm["armed_at"] = t + max(1.0, delay)
    return {**arm_status(now=t), "ok": True}


def arm_status(now: Optional[float] = None) -> Dict[str, Any]:
    t = float(now if now is not None else time.time())
    delay_left = max(0.0, float(_arm.get("armed_at") or 0) - t) if _arm.get("phrase_ok") else 0.0
    creds = False
    try:
        from backend.data.kalshi_trade import trade_creds_ready

        creds = bool(trade_creds_ready())
    except Exception:
        creds = False
    return {
        "paper_default": True,
        "live_allowed": live_allowed(),
        "killed": is_killed(),
        "armed": is_armed(t),
        "arming": bool(_arm.get("phrase_ok") and delay_left > 0 and live_allowed()),
        "arm_delay_s": delay_left,
        "creds_ready": creds,
        "phrase": str(getattr(settings, "FRONT_ARM_PHRASE", "LIVE THE FRONT")),
        "max_stake": front_max_stake(),
        "daily_loss_cap": front_daily_loss_cap(),
        "follower": False,
        "auto_bets": False,
    }


def date_from_ticker(ticker: Any) -> Optional[date]:
    m = TICK_DATE.search(str(ticker or "").upper())
    if not m:
        return None
    try:
        yy, mon, dd = int(m.group(1)), MONTHS.get(m.group(2)), int(m.group(3))
        if not mon:
            return None
        year = 2000 + yy if yy < 80 else 1900 + yy
        return date(year, mon, dd)
    except Exception:
        return None


def strike_label(m: Dict[str, Any]) -> str:
    kind = str(m.get("strike_type") or "").lower()
    lo = m.get("floor_strike")
    hi = m.get("cap_strike")
    if kind == "between" and lo is not None and hi is not None:
        return f"{int(float(lo))}–{int(float(hi))}°F"
    if kind in ("greater", "greater_or_equal") and lo is not None:
        return f">{int(float(lo))}°F"
    if kind in ("less", "less_or_equal") and hi is not None:
        return f"<{int(float(hi))}°F"
    return str(m.get("title") or m.get("ticker") or "—")


def cli_at_for(day: date) -> datetime:
    """NWS CLI for that station/day. Next morning 07:00 CT — not a 1H close_time."""
    return datetime(day.year, day.month, day.day, CLI_HOUR_CT, 0, tzinfo=CT) + timedelta(days=1)


def kalshi_high_f(best: Optional[Dict[str, Any]]) -> Optional[float]:
    if not best:
        return None
    kind = str(best.get("strike_type") or "").lower()
    lo, hi = best.get("floor_strike"), best.get("cap_strike")
    try:
        if kind == "between" and hi is not None:
            return float(hi)
        if kind in ("greater", "greater_or_equal") and lo is not None:
            return float(lo)
        if kind in ("less", "less_or_equal") and hi is not None:
            return float(hi)
        if lo is not None:
            return float(lo)
        if hi is not None:
            return float(hi)
    except (TypeError, ValueError):
        return None
    return None


def weather_dir(
    raw: Any,
    *,
    strike_type: Any = "",
    forecast: Optional[float] = None,
    floor_strike: Any = None,
    cap_strike: Any = None,
) -> str:
    """HUD word for Dallas daily high. Never UP / DOWN / YES / NO."""
    d = str(raw or "WAIT").upper()
    if d in ("ABOVE", "BELOW", "BETWEEN", "WAIT"):
        return d
    if d in ("WAIT", "CLEAR", "SKIP", ""):
        return "WAIT"
    kind = str(strike_type or "").lower()
    yes = d in ("YES", "UP", "UP_HOLD")
    no = d in ("NO", "DOWN", "DOWN_HOLD", "OUT")
    if not yes and not no:
        return "WAIT"
    if kind == "between":
        if yes:
            return "BETWEEN"
        if forecast is not None and cap_strike is not None:
            try:
                if float(forecast) > float(cap_strike):
                    return "ABOVE"
            except (TypeError, ValueError):
                pass
        if forecast is not None and floor_strike is not None:
            try:
                if float(forecast) < float(floor_strike):
                    return "BELOW"
            except (TypeError, ValueError):
                pass
        return "BELOW"
    if kind in ("less", "less_or_equal"):
        return "BELOW" if yes else "ABOVE"
    return "ABOVE" if yes else "BELOW"


def weather_eye(word: Any) -> str:
    """Portrait eyes only. Green / red / white — HUD still uses weather words."""
    w = str(word or "WAIT").upper()
    if w in ("ABOVE", "BETWEEN", "UP", "YES", "UP_HOLD"):
        return "UP"
    if w in ("BELOW", "DOWN", "NO", "DOWN_HOLD"):
        return "DOWN"
    return "WAIT"


def build_clock(
    day: Optional[date],
    best: Optional[Dict[str, Any]],
    now: datetime,
    forecast: Optional[float] = None,
) -> Dict[str, Any]:
    local = now.astimezone(CT) if now.tzinfo else now.replace(tzinfo=timezone.utc).astimezone(CT)
    cli_at = None if day is None else cli_at_for(day)
    secs = None if cli_at is None else max(0, int((cli_at - local).total_seconds()))
    span = None
    if day is not None and cli_at is not None:
        start = datetime(day.year, day.month, day.day, 0, 0, tzinfo=CT)
        span = max(1, int((cli_at - start).total_seconds()))
    kind = str((best or {}).get("strike_type") or "").lower()
    return {
        "kind": "cli",
        "label": "DFW HIGH",
        "sub": "to CLI" if secs else "CLI",
        "day": None if day is None else day.isoformat(),
        "strike_type": kind or None,
        "floor_strike": None if not best else best.get("floor_strike"),
        "cap_strike": None if not best else best.get("cap_strike"),
        "bracket": None if not best else best.get("bracket"),
        "kalshi_high": kalshi_high_f(best),
        "nws_high": forecast,
        "ticker": None if not best else best.get("ticker"),
        "cli_at": None if cli_at is None else cli_at.isoformat(),
        "seconds_to_cli": secs,
        "seconds_to_settle": secs,
        "cli_span_s": span,
    }


def official_yes(
    high: Optional[float],
    *,
    strike_type: Any = "",
    floor_strike: Any = None,
    cap_strike: Any = None,
    market: Optional[Dict[str, Any]] = None,
) -> Optional[bool]:
    """YES wins only against the NWS CLI high. Inclusive both ends on 2°F brackets."""
    if high is None:
        return None
    m = market or {}
    kind = str(strike_type or m.get("strike_type") or "").lower()
    lo = floor_strike if floor_strike is not None else m.get("floor_strike")
    hi = cap_strike if cap_strike is not None else m.get("cap_strike")
    f = float(high)
    if kind == "between" and lo is not None and hi is not None:
        return float(lo) <= f <= float(hi)
    if kind in ("greater", "greater_or_equal") and lo is not None:
        edge = float(lo)
        return f > edge or (kind.endswith("equal") and f >= edge)
    if kind in ("less", "less_or_equal") and hi is not None:
        edge = float(hi)
        return f < edge or (kind.endswith("equal") and f <= edge)
    return None


def _cli_section(up: str, station: str) -> Optional[str]:
    st = str(station or "KDFW").upper()
    if st == "KDFW":
        if any(tag in up for tag in LOVE_FIELD) and "DFW" not in up and "FORT WORTH" not in up and "FT WORTH" not in up:
            return None
        start = -1
        for tag in ("DALLAS-FORT WORTH", "DALLAS FT WORTH", "DFW AIRPORT", "FORT WORTH", " DFW "):
            i = up.find(tag)
            if i >= 0:
                start = i
                break
        if start < 0 and "DFW" in up:
            start = up.find("DFW")
        if start < 0:
            return None
        chunk = up[start:]
        love = chunk.find("LOVE FIELD")
        if love > 20:
            chunk = chunk[:love]
        return chunk
    return None


def parse_cli_high(text: Any, *, station: str = "KDFW", day: Optional[date] = None) -> Optional[float]:
    """Read MAXIMUM TEMPERATURE from the station's NWS CLI. Never Love Field for Dallas."""
    blob = str(text or "")
    if not blob.strip():
        return None
    up = blob.upper()
    section = _cli_section(up, station)
    if not section:
        return None
    if day is not None:
        month = day.strftime("%B").upper()
        hay = up
        if month not in hay or str(day.year) not in hay:
            return None
        if not re.search(rf"{month}\s+0?{day.day}\b", hay):
            return None
    m = re.search(r"MAXIMUM\s+TEMPERATURE[^\n]*\n\s*(\d{2,3})\b", section, re.I)
    if not m:
        m = re.search(r"MAXIMUM\s+(\d{2,3})\b", section, re.I)
    if not m:
        return None
    try:
        val = float(m.group(1))
    except (TypeError, ValueError):
        return None
    if val < 20 or val > 140:
        return None
    return val


def paper_pnl(row: Dict[str, Any], hit: bool) -> float:
    try:
        stake = float(row.get("stake") or 0)
        fill = float(row.get("fill_cents") or 50) / 100.0
    except (TypeError, ValueError):
        return 0.0
    if stake <= 0 or fill <= 0:
        return 0.0
    if hit:
        return round(stake / fill - stake, 2)
    return round(-stake, 2)


def vote_seats(
    m: Dict[str, Any],
    *,
    forecast: Optional[float],
    climo: Optional[float],
    skip: Optional[str],
    station: str = "KDFW",
    mesh: Optional[Dict[str, Any]] = None,
    echo: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    p = forecast_p(forecast, m)
    q = market_quotes(m)
    implied = None if q.get("yes_ask") is None else q["yes_ask"] / 100.0
    echo_high = echo.get("high") if isinstance(echo, dict) else None
    bone_src = echo_high if echo_high is not None else climo
    climo_p = forecast_p(float(bone_src), m) if bone_src is not None else None
    glass = "WAIT" if p is None else ("YES" if p >= 0.5 else "NO")
    pit = "WAIT"
    if implied is not None and p is not None:
        pit = "YES" if p >= implied else "NO"
    elif implied is not None:
        pit = "YES" if implied < 0.5 else "NO"
    frost = "SKIP" if skip else "CLEAR"
    bone = "WAIT" if climo_p is None else ("YES" if climo_p >= 0.5 else "NO")
    if echo_high is not None and climo is not None:
        bone_call = f"{climo}°F season · yday {float(echo_high):.0f}°"
    elif echo_high is not None:
        bone_call = f"yday {float(echo_high):.0f}°"
    elif climo is not None:
        bone_call = f"{climo}°F season"
    else:
        bone_call = "no climo"
    pack = mesh if isinstance(mesh, dict) else empty_mesh()
    median = pack.get("median")
    thin = bool(pack.get("thin") or median is None)
    wide = bool(pack.get("wide"))
    mesh_dir = "WAIT"
    if not thin and not wide:
        yes = official_yes(float(median), market=m)
        if yes is True:
            mesh_dir = "YES"
        elif yes is False:
            mesh_dir = "NO"
    mesh_conf = 12 if thin else (22 if wide else 64)
    return [
        {"id": "GLASS", "dir": glass, "call": None if forecast is None else f"{forecast:.0f}°F {station}"},
        {"id": "PIT", "dir": pit, "call": None if implied is None else f"{int(round(implied * 100))}¢ after vig"},
        {"id": "FROST", "dir": frost, "call": skip or "clear"},
        {"id": "BONE", "dir": bone, "call": bone_call},
        {
            "id": "MESH",
            "dir": mesh_dir,
            "call": mesh_call_line(pack),
            "median": median,
            "spread": pack.get("spread"),
            "n_sources": pack.get("n_live") or 0,
            "thin": thin,
            "wide": wide,
            "sources": list(pack.get("sources") or []),
            "confidence": mesh_conf,
        },
    ]


def grade_seat_votes(row: Dict[str, Any], chair_hit: bool, yes_won: bool) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for v in row.get("votes") or []:
        if not isinstance(v, dict):
            continue
        rec = dict(v)
        sid = str(rec.get("id") or "")
        d = str(rec.get("dir") or "").upper()
        hit: Optional[bool] = None
        if sid == "FROST":
            if d == "SKIP":
                hit = not chair_hit
            elif d == "CLEAR":
                hit = chair_hit
        elif d in ("YES", "NO"):
            hit = (d == "YES" and yes_won) or (d == "NO" and not yes_won)
        if hit is None:
            rec["result"] = None
        else:
            rec["result"] = "HIT" if hit else "MISS"
        out.append(rec)
    return out


def chair_accuracy() -> Dict[str, Any]:
    rows = _load_fills()
    settled = [r for r in rows if str(r.get("result") or "").upper() in ("HIT", "MISS")]
    waits = [
        r for r in rows
        if str(r.get("side") or "").upper() == "WAIT" and not r.get("superseded")
    ]
    pending = [r for r in rows if not r.get("settled") or str(r.get("result") or "").upper() in ("OPEN", "PENDING", "")]
    newest = list(reversed(settled))
    correct = sum(1 for r in settled if str(r.get("result") or "").upper() == "HIT")
    total = len(settled)
    wrong = total - correct
    pct = None if not total else round(100.0 * correct / total, 1)

    def window(xs: List[Dict[str, Any]]) -> Dict[str, Any]:
        n = len(xs)
        c = sum(1 for r in xs if str(r.get("result") or "").upper() == "HIT")
        return {"correct": c, "wrong": n - c, "total": n, "accuracy_pct": None if not n else round(100.0 * c / n, 1)}

    if total < 10:
        verdict, note = "COLLECTING", f"Need ~10 settled CLI grades ({total} so far)"
    elif pct is not None and pct >= 55:
        verdict, note = "HEALTHY", "Lifetime at or above 55% — edge looks alive"
    elif pct is not None and pct >= 48:
        verdict, note = "WATCH", "Near coin-flip — monitor last-20 vs lifetime"
    else:
        verdict, note = "NEEDS WORK", "Below 48% lifetime — review the DFW book"
    return {
        "leader": "RAIJIN",
        "correct": correct,
        "wrong": wrong,
        "total": total,
        "pending": len(pending),
        "accuracy_pct": pct,
        "last_20": window(newest[:20]),
        "last_50": window(newest[:50]),
        "verdict": verdict,
        "verdict_note": note,
        "label": f"{correct}/{total} · {pct}%" if pct is not None else f"{correct}/{total} · —",
        "source": "nws_cli",
        "pending_until": "NWS CLI",
        "wait_n": len(waits),
        "wait_rate": (
            round(len(waits) / (len(waits) + total), 3) if (len(waits) + total) else None
        ),
        "wait_reasons": _tally_wait_reasons(waits),
    }


def _tally_wait_reasons(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        key = str(r.get("wait_reason") or "other")
        out[key] = out.get(key, 0) + 1
    return out


def seat_records() -> List[Dict[str, Any]]:
    tallies = {s["id"]: {"correct": 0, "wrong": 0} for s in SEATS}
    for row in _load_fills():
        res = str(row.get("result") or "").upper()
        if res not in ("HIT", "MISS", "WAIT"):
            continue
        if res == "WAIT" and not any(
            isinstance(v, dict) and v.get("result") in ("HIT", "MISS")
            for v in (row.get("votes") or [])
        ):
            continue
        for v in row.get("votes") or []:
            if not isinstance(v, dict):
                continue
            sid = str(v.get("id") or "")
            if sid not in tallies:
                continue
            res = str(v.get("result") or "").upper()
            if res == "HIT":
                tallies[sid]["correct"] += 1
            elif res == "MISS":
                tallies[sid]["wrong"] += 1
    ranked: List[Dict[str, Any]] = []
    for s in SEATS:
        c = tallies[s["id"]]["correct"]
        w = tallies[s["id"]]["wrong"]
        n = c + w
        wr = None if n < 1 else round(c / n, 3)
        ranked.append({
            "id": s["id"],
            "job": s["job"],
            "mark": s["mark"],
            "weight": s.get("weight"),
            "n": n,
            "wr": wr,
            "correct": c,
            "wrong": w,
            "rank": 0,
        })
    order = sorted(ranked, key=lambda r: (-(r["wr"] if r["wr"] is not None else -1.0), -int(r["n"])))
    rank_of = {r["id"]: i + 1 for i, r in enumerate(order)}
    kn = front_knobs()
    fade_on = bool(kn.get("fade_underperformers", True))
    try:
        fade_n = int(kn.get("fade_min_n") or 20)
    except (TypeError, ValueError):
        fade_n = 20
    try:
        fade_wr = float(kn.get("fade_wr_threshold") or 0.42)
    except (TypeError, ValueError):
        fade_wr = 0.42
    for r in ranked:
        r["rank"] = rank_of[r["id"]]
        wr = r.get("wr")
        faded = bool(fade_on and int(r.get("n") or 0) >= fade_n and wr is not None and float(wr) < fade_wr)
        r["faded"] = faded
        r["invert"] = faded
    return ranked


def lock_tape() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in reversed(_load_fills()[-12:]):
        out.append({
            "leader": "RAIJIN",
            "city": row.get("city") or "DAL",
            "station": row.get("station") or "KDFW",
            "bracket": row.get("bracket") or "",
            "best": bool(row.get("best")),
            "side": row.get("side") or ("WAIT" if str(row.get("result") or "").upper() == "WAIT" else row.get("side")),
            "lean": weather_dir(
                row.get("side") or "WAIT",
                strike_type=row.get("strike_type"),
                floor_strike=row.get("floor_strike"),
                cap_strike=row.get("cap_strike"),
            ),
            "result": str(row.get("result") or "OPEN").upper(),
            "wait_reason": row.get("wait_reason"),
            "pnl": row.get("pnl"),
            "paper": bool(row.get("paper", True)),
            "ticker": row.get("ticker"),
            "cli_high": row.get("cli_high"),
        })
    return out


def _bracket_from_cache(ticker: str) -> Optional[Dict[str, Any]]:
    payload = _board_cache.get("payload") if isinstance(_board_cache, dict) else None
    if not isinstance(payload, dict):
        return None
    for b in payload.get("brackets") or []:
        if isinstance(b, dict) and str(b.get("ticker") or "") == ticker:
            return b
    return None


def apply_cli_settle(row: Dict[str, Any], high: float) -> bool:
    """Grade one OPEN lock from an NWS CLI high. Forecast must never call this."""
    yes = official_yes(
        high,
        strike_type=row.get("strike_type"),
        floor_strike=row.get("floor_strike"),
        cap_strike=row.get("cap_strike"),
    )
    if yes is None:
        return False
    side = str(row.get("side") or "").upper()
    if side == "WAIT":
        row["settled"] = True
        row["result"] = "WAIT"
        row["cli_high"] = float(high)
        row["settle_source"] = "nws_cli"
        row["settle_reason"] = "wait_cli"
        row["pnl"] = 0.0
        row["y_finish"] = "YES" if yes else "NO"
        row["votes"] = grade_seat_votes(row, False, yes)
        return True
    hit = (side == "YES" and yes) or (side == "NO" and not yes)
    row["settled"] = True
    row["result"] = "HIT" if hit else "MISS"
    row["cli_high"] = float(high)
    row["settle_source"] = "nws_cli"
    row["settle_reason"] = "cli_match" if hit else "cli_miss"
    row["pnl"] = paper_pnl(row, hit)
    row["votes"] = grade_seat_votes(row, hit, yes)
    return True


async def fetch_cli_high(
    day: date,
    nws: Optional[_Nws] = None,
    *,
    station: str = "KDFW",
    office: str = "FWD",
) -> Optional[float]:
    """Official CLI max for that station/date. None until the next-morning print."""
    key = f"{station}:{day.isoformat()}"
    if key in _cli_cache:
        return _cli_cache[key]
    fn = nws or _nws_get
    high: Optional[float] = None
    try:
        listing = await fn(f"https://api.weather.gov/products/types/CLI/locations/{office}")
        graph = []
        if isinstance(listing, dict):
            graph = listing.get("@graph") or listing.get("graph") or listing.get("products") or []
        if isinstance(listing, list):
            graph = listing
        for item in graph[:8]:
            if not isinstance(item, dict):
                continue
            url = item.get("@id") or item.get("id") or item.get("url")
            if not url:
                continue
            prod = await fn(str(url))
            text = ""
            if isinstance(prod, dict):
                text = str(prod.get("productText") or prod.get("text") or "")
            elif isinstance(prod, str):
                text = prod
            high = parse_cli_high(text, station=station, day=day)
            if high is not None:
                break
    except Exception:
        high = None
    _cli_cache[key] = high
    return high


async def settle_open_fills(
    *,
    cli_highs: Optional[Dict[str, float]] = None,
    nws: Optional[_Nws] = None,
) -> int:
    """Pending until NWS CLI posts. Do not mark a hit off a forecast."""
    changed = 0
    for row in _load_fills():
        if row.get("settled") or str(row.get("result") or "").upper() in ("HIT", "MISS"):
            continue
        day = date_from_ticker(row.get("ticker"))
        if day is None:
            continue
        city = city_for_ticker(row.get("ticker")) or city_by_id(row.get("city"))
        if city is None:
            continue
        station = str(row.get("station") or city["station"])
        office = str(city.get("cli_office") or "FWD")
        high = None
        if cli_highs:
            high = (
                cli_highs.get(f"{city['id']}:{day.isoformat()}")
                or cli_highs.get(f"{station}:{day.isoformat()}")
            )
            if high is None and city["id"] == "DAL":
                high = cli_highs.get(day.isoformat())
        if high is None:
            high = await fetch_cli_high(day, nws, station=station, office=office)
        if high is None:
            row["result"] = "OPEN"
            row["settle_reason"] = "pending_cli"
            continue
        if apply_cli_settle(row, float(high)):
            changed += 1
    if changed:
        _save_fills()
    return changed


def forecast_p(forecast: Optional[float], m: Dict[str, Any]) -> Optional[float]:
    """P(yes) from the official high. 2°F between-brackets are inclusive both ends."""
    if forecast is None:
        return None
    kind = str(m.get("strike_type") or "").lower()
    lo = m.get("floor_strike")
    hi = m.get("cap_strike")
    f = float(forecast)
    if kind == "between" and lo is not None and hi is not None:
        a, b = float(lo), float(hi)
        if a <= f <= b:
            mid = (a + b) / 2.0
            half = max(0.5, (b - a) / 2.0)
            return min(0.78, 0.54 + 0.22 * (1.0 - abs(f - mid) / half))
        gap = a - f if f < a else f - b
        return max(0.04, 0.22 - 0.07 * gap)
    if kind in ("greater", "greater_or_equal") and lo is not None:
        edge = float(lo)
        if f > edge or (kind.endswith("equal") and f >= edge):
            return min(0.82, 0.56 + 0.08 * (f - edge))
        return max(0.04, 0.28 - 0.10 * (edge - f))
    if kind in ("less", "less_or_equal") and hi is not None:
        edge = float(hi)
        if f < edge or (kind.endswith("equal") and f <= edge):
            return min(0.82, 0.56 + 0.08 * (edge - f))
        return max(0.04, 0.28 - 0.10 * (f - edge))
    return None


def day_has_lock(day: date) -> bool:
    key = day.isoformat()
    for row in _load_fills():
        if str(row.get("day") or "") != key:
            continue
        if str(row.get("side") or "").upper() in ("YES", "NO"):
            return True
    return False


def classify_front_wait_reason(skip: Optional[str], flags: Optional[Dict[str, Any]] = None) -> str:
    mapped = classify_wait_reason(skip, {"summary": skip}, {"skip": skip})
    if mapped != "other":
        return mapped
    text = str(skip or "").lower()
    flags = flags or {}
    if flags.get("empty") or "empty" in text:
        return "dead_book"
    if flags.get("sick") or "sick" in text:
        return "dead_book"
    if "99" in text:
        return "odds_outside_20_80"
    if "thin" in text:
        return "no_depth"
    if "official" in text:
        return "no_official_high"
    if "flip" in text or "disagree" in text or "mesh" in text or "cell" in text or "cooked" in text:
        return "forecast_flip"
    return "other"


def record_wait_sample(
    *,
    day: date,
    ticker: Optional[str] = None,
    reason: Optional[str] = None,
    skip: Optional[str] = None,
    votes: Any = None,
    book_depth: Any = None,
    would_lock_if_strict: bool = False,
    bracket: Any = None,
    strike_type: Any = None,
    floor_strike: Any = None,
    cap_strike: Any = None,
    city: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """One WAIT row per Dallas day when Raijin does not lock. Paper P&L $0."""
    if day_has_lock(day):
        return None
    city = city or DALLAS
    key = day.isoformat()
    existing = None
    for row in _load_fills():
        if str(row.get("day") or "") == key and str(row.get("side") or "").upper() == "WAIT":
            existing = row
            break
    why = reason or classify_front_wait_reason(skip)
    snap_votes = [dict(v) for v in votes if isinstance(v, dict)] if isinstance(votes, list) else []
    if existing is not None:
        existing["wait_reason"] = why
        existing["skip"] = skip
        existing["would_lock_if_strict"] = bool(would_lock_if_strict)
        if ticker:
            existing["ticker"] = ticker
        if snap_votes:
            existing["votes"] = snap_votes
        if book_depth is not None:
            existing["book_depth"] = book_depth
        if bracket:
            existing["bracket"] = bracket
        if strike_type:
            existing["strike_type"] = strike_type
        if floor_strike is not None:
            existing["floor_strike"] = floor_strike
        if cap_strike is not None:
            existing["cap_strike"] = cap_strike
        existing["pnl"] = 0.0
        _save_fills()
        return existing
    row = {
        "id": str(uuid.uuid4())[:12],
        "ticker": ticker or f"KXHIGHTDAL-{day.strftime('%y%b%d').upper()}",
        "side": "WAIT",
        "stake": 0.0,
        "fill_cents": None,
        "fee_cents": 0.0,
        "live": False,
        "paper": True,
        "at": (now or datetime.now(timezone.utc)).isoformat(),
        "settled": False,
        "result": "OPEN",
        "pnl": 0.0,
        "follower": False,
        "desk": "front",
        "leader": "RAIJIN",
        "city": city["id"],
        "station": city["station"],
        "place": city.get("place"),
        "day": key,
        "bracket": bracket,
        "best": False,
        "strike_type": strike_type or "between",
        "floor_strike": floor_strike,
        "cap_strike": cap_strike,
        "votes": snap_votes,
        "wait_reason": why,
        "skip": skip,
        "book_depth": book_depth,
        "would_lock_if_strict": bool(would_lock_if_strict),
        "settle_reason": "pending_cli",
    }
    _load_fills().append(row)
    _save_fills()
    return row


def skip_reason(
    flags: Dict[str, Any],
    forecast: Optional[float],
    flipped: bool,
    n: float,
    mesh: Optional[Dict[str, Any]] = None,
    heat: Optional[Dict[str, Any]] = None,
    cell: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    if flags.get("empty"):
        return "Don’t play · empty book"
    if flags.get("sick"):
        return "Don’t play · sick book"
    if flags.get("wall_99"):
        return "Don’t play · ≥99¢ wall"
    if flags.get("spread") is not None and flags["spread"] >= 6:
        return "Don’t play · junk spread"
    if flipped:
        return "Don’t play · forecast just flipped"
    if cell and cell.get("kill"):
        return "Don’t play · cell cap"
    if heat and heat.get("blew_bracket"):
        return "Don’t play · heat cooked"
    if mesh and mesh.get("wide"):
        return "Don’t play · mesh disagree"
    if n < THIN_VOL:
        return "Don’t play · sample too thin"
    if forecast is None:
        return "Don’t play · no official high"
    return why_line(flags, None, 0)


def classify_weather(obs: Optional[Dict[str, Any]]) -> Optional[str]:
    """Map a live KDFW observation to a CRT backdrop mode. None = hold last, do not invent sun."""
    if not isinstance(obs, dict):
        return None
    text = str(obs.get("text") or obs.get("textDescription") or "").lower()
    raw = str(obs.get("raw") or obs.get("rawMessage") or "").upper()
    tokens = re.findall(r"[A-Z+]+", raw)
    temp = obs.get("temp_f")
    wind = obs.get("wind_kt")
    try:
        temp_f = float(temp) if temp is not None else None
    except (TypeError, ValueError):
        temp_f = None
    try:
        wind_kt = float(wind) if wind is not None else None
    except (TypeError, ValueError):
        wind_kt = None

    if not text and not raw and temp_f is None and wind_kt is None:
        return None

    storm_txt = ("thunder", "tstm", "lightning", "funnel", "tornado")
    storm_tok = {"TS", "VCTS", "SQ", "FC", "TSRA", "+TSRA", "-TSRA"}
    if any(w in text for w in storm_txt) or any(t in storm_tok for t in tokens) or "+RA" in tokens:
        return "STORM"
    if "heavy" in text and any(w in text for w in ("rain", "shower", "precip")):
        return "STORM"

    rain_txt = ("rain", "shower", "drizzle", "precip")
    if any(w in text for w in rain_txt) or any(t.endswith("RA") or t.endswith("DZ") or t == "SHRA" for t in tokens):
        return "RAIN"

    if wind_kt is not None and wind_kt >= WIND_KT:
        return "WIND"

    cloudy = any(w in text for w in ("cloud", "overcast", "broken", "obscur", "fog", "mist", "bkn", "ovc"))
    clear = any(w in text for w in ("clear", "fair", "sunny", "few")) or any(t in tokens for t in ("SKC", "CLR", "CAVOK", "FEW"))
    if temp_f is not None and temp_f >= HEAT_F and not cloudy:
        return "HEAT"
    if cloudy and not clear:
        return "CLOUD"
    if clear:
        return "SUN"
    if temp_f is not None and temp_f >= HEAT_F:
        return "HEAT"
    if text or raw:
        return "CLOUD"
    return None


def _c_to_f(val: Any) -> Optional[float]:
    try:
        return float(val) * 9.0 / 5.0 + 32.0
    except (TypeError, ValueError):
        return None


def _kmh_to_kt(val: Any) -> Optional[float]:
    try:
        return float(val) / 1.852
    except (TypeError, ValueError):
        return None


def parse_nws_obs(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    props = data.get("properties") if isinstance(data, dict) else None
    if not isinstance(props, dict):
        if isinstance(data, dict) and (data.get("rawMessage") or data.get("textDescription")):
            props = data
        else:
            return None
    temp_c = ((props.get("temperature") or {}) if isinstance(props.get("temperature"), dict) else {}).get("value")
    if temp_c is None:
        temp_c = props.get("temp")
    wind = ((props.get("windSpeed") or {}) if isinstance(props.get("windSpeed"), dict) else {}).get("value")
    if wind is None:
        wind = props.get("wspd")
        wind_kt = None if wind is None else float(wind)
    else:
        wind_kt = _kmh_to_kt(wind)
    temp_f = _c_to_f(temp_c)
    text = props.get("textDescription") or props.get("wxString") or ""
    raw = props.get("rawMessage") or props.get("rawOb") or ""
    if temp_f is None and not text and not raw:
        return None
    return {
        "station": "KDFW",
        "text": str(text or ""),
        "raw": str(raw or ""),
        "temp_f": None if temp_f is None else round(temp_f, 1),
        "wind_kt": None if wind_kt is None else round(float(wind_kt), 1),
    }


async def _http_get(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    import httpx

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(url, headers=headers or {})
        r.raise_for_status()
        return r.json()


async def _nws_get(url: str) -> Dict[str, Any]:
    data = await _http_get(url, {"User-Agent": NWS_UA, "Accept": "application/geo+json"})
    return data if isinstance(data, dict) else {}


async def fetch_kdfw_obs(nws: Optional[_Nws] = None) -> Optional[Dict[str, Any]]:
    fn = nws or _nws_get
    try:
        data = await fn(NWS_OBS_URL)
        parsed = parse_nws_obs(data if isinstance(data, dict) else {})
        if parsed:
            return parsed
    except Exception:
        pass
    if nws is not None:
        return None
    try:
        av = await _http_get(
            METAR_URL,
            {"User-Agent": NWS_UA, "Accept": "application/json"},
        )
        row: Dict[str, Any] = {}
        if isinstance(av, list) and av and isinstance(av[0], dict):
            row = av[0]
        elif isinstance(av, dict):
            row = av
        return parse_nws_obs(row)
    except Exception:
        return None


def remember_weather(obs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Live mode from KDFW. Dead feed holds last mode — never invents sun."""
    held = _load_wx_hold()
    mode = classify_weather(obs)
    if mode in WX_MODES and obs:
        _wx_hold["mode"] = mode
        _wx_hold["obs"] = obs
        _wx_hold["at"] = time.time()
        _save_wx_hold()
        return {
            "mode": mode,
            "held": False,
            "live": True,
            "station": "KDFW",
            "obs": obs,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    last = held.get("mode") if held.get("mode") in WX_MODES else None
    return {
        "mode": last,
        "held": True,
        "live": False,
        "station": "KDFW",
        "obs": held.get("obs"),
        "at": datetime.now(timezone.utc).isoformat(),
    }


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
    fn = fetch or _kalshi_fetch
    try:
        data = await fn("/markets", {"series_ticker": series, "status": "open", "limit": 40})
    except Exception:
        return [], True
    if not isinstance(data, dict) or data.get("missing"):
        return [], True
    rows = data.get("markets") or []
    return [m for m in rows if isinstance(m, dict)], False


def pick_event_day(markets: List[Dict[str, Any]], now: datetime, tz_name: str) -> Optional[date]:
    dates = sorted({d for d in (date_from_ticker(m.get("ticker")) for m in markets) if d})
    if not dates:
        return None
    try:
        local = now.astimezone(ZoneInfo(tz_name)).date()
    except Exception:
        local = now.date()
    for d in dates:
        if d >= local:
            return d
    return dates[-1]


async def nws_high(station: str, day: date, nws: Optional[_Nws] = None) -> Optional[float]:
    """Official/NWS daytime high for that station/day. None if the feed misses — never fake."""
    fn = nws or _nws_get
    try:
        st = await fn(f"https://api.weather.gov/stations/{station}")
        coords = ((st or {}).get("geometry") or {}).get("coordinates")
        if not isinstance(coords, list) or len(coords) < 2:
            return None
        lon, lat = float(coords[0]), float(coords[1])
        pts = await fn(f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}")
        forecast_url = ((pts or {}).get("properties") or {}).get("forecast")
        if not forecast_url:
            return None
        fc = await fn(str(forecast_url))
        for period in ((fc or {}).get("properties") or {}).get("periods") or []:
            if not isinstance(period, dict) or not period.get("isDaytime"):
                continue
            start = str(period.get("startTime") or "")[:10]
            if start != day.isoformat():
                continue
            raw = period.get("temperature")
            unit = str(period.get("temperatureUnit") or "F").upper()
            if raw is None:
                return None
            val = float(raw)
            if unit == "C":
                val = val * 9.0 / 5.0 + 32.0
            return val
    except Exception:
        return None
    return None


def empty_mesh() -> Dict[str, Any]:
    return {
        "median": None,
        "spread": None,
        "n_live": 0,
        "thin": True,
        "wide": False,
        "sources": [],
        "station": "KDFW",
        "place": "DFW",
    }


def mesh_call_line(pack: Optional[Dict[str, Any]]) -> str:
    pack = pack if isinstance(pack, dict) else empty_mesh()
    misses = [
        f"{s.get('id') or 'src'} {s.get('miss') or 'miss'}"
        for s in (pack.get("sources") or [])
        if isinstance(s, dict) and not s.get("ok")
    ]
    miss_bit = (" · " + ", ".join(misses)) if misses else ""
    n = int(pack.get("n_live") or 0)
    if pack.get("thin") or pack.get("median") is None:
        return f"thin{miss_bit}" if miss_bit else "thin"
    src = "1 source" if n == 1 else f"{n} sources"
    wide = " · wide" if pack.get("wide") else ""
    try:
        med = f"{float(pack['median']):.0f}°F"
    except (TypeError, ValueError):
        return f"thin{miss_bit}" if miss_bit else "thin"
    return f"{med} · {src}{wide}{miss_bit}"


def _median_f(xs: List[float]) -> Optional[float]:
    ys = sorted(float(x) for x in xs)
    if not ys:
        return None
    n = len(ys)
    if n % 2:
        return ys[n // 2]
    return (ys[n // 2 - 1] + ys[n // 2]) / 2.0


def _valid_ct_day(vt: Any) -> Optional[date]:
    start = str(vt or "").split("/")[0]
    try:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(CT).date()
    except Exception:
        if len(start) >= 10:
            try:
                return date.fromisoformat(start[:10])
            except Exception:
                return None
    return None


def _grid_to_f(val: Any, uom: Any = "") -> Optional[float]:
    try:
        v = float(val)
    except (TypeError, ValueError):
        return None
    u = str(uom or "").lower()
    if "degc" in u or u.endswith(":c") or u == "c":
        v = v * 9.0 / 5.0 + 32.0
    elif "degf" in u or u.endswith(":f") or u == "f":
        pass
    elif v <= 55:
        v = v * 9.0 / 5.0 + 32.0
    if v < 20 or v > 140:
        return None
    return v


def parse_gridpoint_max(data: Any, day: date) -> Optional[float]:
    props = data.get("properties") if isinstance(data, dict) else None
    if not isinstance(props, dict):
        return None
    series = props.get("maxTemperature")
    if not isinstance(series, dict):
        return None
    return _series_high_for_day(series, day)


def parse_nbm_max(data: Any, day: date) -> Optional[float]:
    """Use NBM only when the gridpoint payload already carries a distinct NBM max."""
    props = data.get("properties") if isinstance(data, dict) else None
    if not isinstance(props, dict):
        return None
    for key, series in props.items():
        lk = str(key or "").lower()
        if not isinstance(series, dict):
            continue
        if lk == "maxtemperature":
            continue
        if "nbm" in lk and "max" in lk and "temp" in lk:
            high = _series_high_for_day(series, day)
            if high is not None:
                return high
    return None


def _series_high_for_day(series: Dict[str, Any], day: date) -> Optional[float]:
    uom = series.get("uom") or series.get("unit") or ""
    for row in series.get("values") or []:
        if not isinstance(row, dict) or row.get("value") is None:
            continue
        if _valid_ct_day(row.get("validTime")) != day:
            continue
        return _grid_to_f(row.get("value"), uom)
    return None


def parse_open_meteo_daily_max(data: Any, day: date) -> Optional[float]:
    daily = data.get("daily") if isinstance(data, dict) else None
    if not isinstance(daily, dict):
        return None
    times = daily.get("time") or []
    highs = daily.get("temperature_2m_max") or []
    want = day.isoformat()
    for t, h in zip(times, highs):
        if str(t)[:10] != want or h is None:
            continue
        try:
            val = float(h)
        except (TypeError, ValueError):
            return None
        if val < 20 or val > 140:
            return None
        return val
    return None


def parse_open_meteo_ensemble_mean(data: Any, day: date) -> Optional[float]:
    daily = data.get("daily") if isinstance(data, dict) else None
    if not isinstance(daily, dict):
        return None
    times = daily.get("time") or []
    want = day.isoformat()
    idx = None
    for i, t in enumerate(times):
        if str(t)[:10] == want:
            idx = i
            break
    if idx is None:
        return None
    member_keys = [
        k for k in daily
        if str(k).startswith("temperature_2m_max_member") or str(k).startswith("temperature_2m_max_")
    ]
    keys = member_keys or (["temperature_2m_max"] if "temperature_2m_max" in daily else [])
    vals: List[float] = []
    for k in keys:
        arr = daily.get(k)
        if not isinstance(arr, list) or idx >= len(arr) or arr[idx] is None:
            continue
        try:
            val = float(arr[idx])
        except (TypeError, ValueError):
            continue
        if 20 <= val <= 140:
            vals.append(val)
    if not vals:
        return None
    return sum(vals) / len(vals)


def finish_mesh(sources: List[Dict[str, Any]]) -> Dict[str, Any]:
    live = [s for s in sources if isinstance(s, dict) and s.get("ok") and s.get("high") is not None]
    highs = [float(s["high"]) for s in live]
    median = _median_f(highs)
    spread = None if len(highs) < 2 else round(max(highs) - min(highs), 1)
    n_live = len(live)
    thin = n_live < MESH_MIN_LIVE or median is None
    wide = (not thin) and spread is not None and spread >= MESH_WIDE_F
    return {
        "median": None if median is None else round(float(median), 1),
        "spread": spread,
        "n_live": n_live,
        "thin": thin,
        "wide": wide,
        "sources": sources,
        "station": "KDFW",
        "place": "DFW",
    }


def _mesh_miss(sid: str, why: str) -> Dict[str, Any]:
    return {"id": sid, "ok": False, "miss": why, "high": None}


def _mesh_hit(sid: str, high: float) -> Dict[str, Any]:
    return {"id": sid, "ok": True, "miss": None, "high": round(float(high), 1)}


def _miss_why(exc: BaseException) -> str:
    text = str(exc or "").lower()
    name = type(exc).__name__.lower()
    if "404" in text:
        return "404"
    if "timeout" in text or "timeout" in name:
        return "timeout"
    return "miss"


async def _mesh_get(
    url: str,
    *,
    nws: Optional[_Nws],
    http: Optional[_Http],
) -> Any:
    if "weather.gov" in url:
        fn = nws or _nws_get
        return await fn(url)
    if nws is not None and http is None:
        return await nws(url)
    fn = http or _http_get
    return await fn(url)


async def fetch_mesh_highs(
    day: date,
    *,
    nws: Optional[_Nws] = None,
    http: Optional[_Http] = None,
    lat: float = KDFW_LAT,
    lon: float = KDFW_LON,
) -> Dict[str, Any]:
    """Dallas / KDFW daily high from public APIs. Drop 404/timeout. Never invent a high."""
    sources: List[Dict[str, Any]] = []
    grid_data: Any = None
    use_lat, use_lon = float(lat), float(lon)

    try:
        st = await _mesh_get(f"https://api.weather.gov/stations/KDFW", nws=nws, http=http)
        coords = ((st or {}).get("geometry") or {}).get("coordinates") if isinstance(st, dict) else None
        if isinstance(coords, list) and len(coords) >= 2:
            use_lon, use_lat = float(coords[0]), float(coords[1])
        pts = await _mesh_get(f"https://api.weather.gov/points/{use_lat:.4f},{use_lon:.4f}", nws=nws, http=http)
        props = ((pts or {}).get("properties") or {}) if isinstance(pts, dict) else {}
        grid_url = props.get("forecastGridData")
        if not grid_url:
            gid = props.get("gridId") or props.get("cwa")
            gx, gy = props.get("gridX"), props.get("gridY")
            if gid is not None and gx is not None and gy is not None:
                grid_url = f"https://api.weather.gov/gridpoints/{gid}/{int(gx)},{int(gy)}"
        if not grid_url:
            sources.append(_mesh_miss("nws", "404"))
        else:
            grid_data = await _mesh_get(str(grid_url), nws=nws, http=http)
            high = parse_gridpoint_max(grid_data, day)
            if high is None:
                sources.append(_mesh_miss("nws", "no high" if grid_data else "empty"))
            else:
                sources.append(_mesh_hit("nws", high))
    except Exception as exc:
        sources.append(_mesh_miss("nws", _miss_why(exc)))
        grid_data = None

    nbm = parse_nbm_max(grid_data, day) if isinstance(grid_data, dict) else None
    if nbm is not None:
        sources.append(_mesh_hit("nbm", nbm))

    om_url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={use_lat:.4f}&longitude={use_lon:.4f}"
        "&daily=temperature_2m_max&temperature_unit=fahrenheit"
        "&timezone=America%2FChicago&forecast_days=3"
    )
    try:
        om = await _mesh_get(om_url, nws=nws, http=http)
        high = parse_open_meteo_daily_max(om, day)
        if high is None:
            sources.append(_mesh_miss("open-meteo", "no high" if om else "empty"))
        else:
            sources.append(_mesh_hit("open-meteo", high))
    except Exception as exc:
        sources.append(_mesh_miss("open-meteo", _miss_why(exc)))

    ens_url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={use_lat:.4f}&longitude={use_lon:.4f}"
        "&daily=temperature_2m_max&temperature_unit=fahrenheit"
        "&timezone=America%2FChicago&forecast_days=3"
    )
    try:
        ens = await _mesh_get(ens_url, nws=nws, http=http)
        high = parse_open_meteo_ensemble_mean(ens, day)
        if high is None:
            sources.append(_mesh_miss("ensemble", "no high" if ens else "empty"))
        else:
            sources.append(_mesh_hit("ensemble", high))
    except Exception as exc:
        sources.append(_mesh_miss("ensemble", _miss_why(exc)))

    return finish_mesh(sources)


def _sub_meta(sid: str) -> Dict[str, Any]:
    for s in SUBS:
        if s["id"] == sid:
            return dict(s)
    return {"id": sid, "parent": None, "feeds": (), "job": "", "mark": ""}


def build_heat(
    *,
    now_f: Optional[float],
    nws_high: Optional[float] = None,
    kalshi_high: Optional[float] = None,
    stale: bool = False,
    strike_type: Any = "",
    floor_strike: Any = None,
    cap_strike: Any = None,
    market: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Live KDFW METAR vs the high. Honest miss if the temp is gone."""
    m = market or {}
    kind = str(strike_type or m.get("strike_type") or "").lower()
    lo = floor_strike if floor_strike is not None else m.get("floor_strike")
    hi = cap_strike if cap_strike is not None else m.get("cap_strike")
    target = nws_high if nws_high is not None else kalshi_high
    meta = _sub_meta("HEAT")
    blew = False
    if now_f is not None and hi is not None:
        try:
            blew = float(now_f) > float(hi)
        except (TypeError, ValueError):
            blew = False
    cooked = False
    if now_f is not None and target is not None:
        try:
            cooked = float(now_f) >= float(target)
        except (TypeError, ValueError):
            cooked = False
    if now_f is None:
        line = "METAR STALE" if stale else "METAR DEAD"
        tone = "miss"
        ok = False
    elif cooked or blew:
        line = "DAY IS COOKED" + (" · STALE" if stale else "")
        tone = "cooked"
        ok = True
    elif target is not None:
        line = f"CAN WE STILL HIT {int(round(float(target)))}°" + (" · STALE" if stale else "")
        tone = "live"
        ok = True
    else:
        line = f"KDFW {int(round(float(now_f)))}° · NO TARGET"
        tone = "live"
        ok = True
    return {
        **meta,
        "line": line,
        "tone": tone,
        "ok": ok,
        "cooked": bool(cooked or blew),
        "blew_bracket": bool(blew and kind == "between"),
        "now_f": None if now_f is None else round(float(now_f), 1),
        "target_f": None if target is None else round(float(target), 1),
        "stale": bool(stale),
        "vote": False,
        "chair": False,
    }


def build_echo(yday_high: Optional[float], yday: Optional[date] = None) -> Dict[str, Any]:
    """Yesterday’s official Dallas CLI. Never invent a prior."""
    meta = _sub_meta("ECHO")
    if yday_high is None:
        return {
            **meta,
            "line": "NO YDAY CLI",
            "tone": "miss",
            "ok": False,
            "high": None,
            "day": None if yday is None else yday.isoformat(),
            "vote": False,
            "chair": False,
        }
    return {
        **meta,
        "line": f"YDAY {int(round(float(yday_high)))}°",
        "tone": "live",
        "ok": True,
        "high": round(float(yday_high), 1),
        "day": None if yday is None else yday.isoformat(),
        "vote": False,
        "chair": False,
    }


def parse_alert_event(data: Any) -> Optional[str]:
    feats = []
    if isinstance(data, dict):
        feats = data.get("features") or []
    elif isinstance(data, list):
        feats = data
    for feat in feats:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") if isinstance(feat.get("properties"), dict) else feat
        ev = str(props.get("event") or props.get("headline") or "").lower()
        if any(tag in ev for tag in ("thunderstorm", "tornado", "funnel", "severe thunderstorm")):
            return str(props.get("event") or "STORMS")
    return None


def build_cell(
    obs: Optional[Dict[str, Any]],
    *,
    alerts_ok: bool,
    alert_event: Optional[str] = None,
) -> Dict[str, Any]:
    """Storms / precip that cap the high. Miss if both feeds are dead — never invent a cell."""
    meta = _sub_meta("CELL")
    raw = str((obs or {}).get("raw") or "").upper()
    text = str((obs or {}).get("text") or "").lower()
    tokens = re.findall(r"[A-Z+]+", raw)
    metar_ok = bool(raw or text)
    storm_tok = {"TS", "VCTS", "SQ", "FC", "TSRA", "+TSRA", "-TSRA"}
    metar_storm = any(t in storm_tok for t in tokens) or any(w in text for w in ("thunder", "tstm", "lightning"))
    heavy_rain = "+RA" in tokens or ("heavy" in text and "rain" in text)
    kill = bool(alert_event or metar_storm or heavy_rain)
    if kill:
        return {
            **meta,
            "line": "CELL UP · HIGH CAPPED",
            "tone": "kill",
            "ok": True,
            "kill": True,
            "event": alert_event or "STORMS",
            "vote": False,
            "chair": False,
        }
    if alerts_ok or metar_ok:
        return {
            **meta,
            "line": "SKY CLEAR · NO CELL",
            "tone": "clear",
            "ok": True,
            "kill": False,
            "event": None,
            "vote": False,
            "chair": False,
        }
    return {
        **meta,
        "line": "NO CELL FEED",
        "tone": "miss",
        "ok": False,
        "kill": False,
        "event": None,
        "vote": False,
        "chair": False,
    }


def build_subs(
    heat: Optional[Dict[str, Any]] = None,
    echo: Optional[Dict[str, Any]] = None,
    cell: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    rows = [heat or build_heat(now_f=None), echo or build_echo(None), cell or build_cell(None, alerts_ok=False)]
    return rows


async def fetch_kdfw_alerts(
    nws: Optional[_Nws] = None,
    *,
    lat: float = KDFW_LAT,
    lon: float = KDFW_LON,
) -> Dict[str, Any]:
    url = f"https://api.weather.gov/alerts/active?point={lat:.4f},{lon:.4f}"
    try:
        data = await (nws or _nws_get)(url)
        if not isinstance(data, dict):
            return {"ok": False, "miss": "empty", "event": None}
        return {"ok": True, "miss": None, "event": parse_alert_event(data), "data": data}
    except Exception as exc:
        return {"ok": False, "miss": _miss_why(exc), "event": None}


def note_forecast(station: str, day: date, high: Optional[float]) -> bool:
    if high is None:
        return False
    key = f"{station}:{day.isoformat()}"
    prev = _forecast_prev.get(key)
    _forecast_prev[key] = float(high)
    return prev is not None and abs(float(high) - float(prev)) >= FLIP_F


def seat_record(n: int, wr: Optional[float]) -> Dict[str, Any]:
    return {"n": int(n), "wr": None if wr is None else round(float(wr), 3)}


def seat_stats() -> Dict[str, Dict[str, Any]]:
    rows = [r for r in _load_fills() if r.get("settled") and r.get("result") in ("HIT", "MISS", "yes", "no")]
    n = len(rows)
    hits = 0
    for r in rows:
        res = str(r.get("result") or "").upper()
        if res in ("HIT", "YES"):
            hits += 1
    wr = None if n < 1 else hits / n
    rec = seat_record(n, wr)
    out = {s["id"]: dict(rec) for s in SEATS}
    out["RAIJIN"] = dict(rec)
    return out


def score_bracket(
    m: Dict[str, Any],
    *,
    city: Dict[str, Any],
    forecast: Optional[float],
    flipped: bool,
    day: date,
    mesh: Optional[Dict[str, Any]] = None,
    heat: Optional[Dict[str, Any]] = None,
    echo: Optional[Dict[str, Any]] = None,
    cell: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    q = market_quotes(m)
    flags = book_health(m)
    vol = float(flags.get("volume") or 0)
    p = forecast_p(forecast, m)
    climo = (city.get("climo") or {}).get(day.month)
    echo_high = echo.get("high") if isinstance(echo, dict) else None
    bone_src = echo_high if echo_high is not None else climo
    climo_p = forecast_p(float(bone_src), m) if bone_src is not None else None
    skip = skip_reason(flags, forecast, flipped, vol, mesh=mesh, heat=heat, cell=cell)
    implied = (q.get("yes_ask") or 50) / 100.0
    fee = kalshi_taker_fee_cents(q.get("yes_ask"))
    half = (float(flags.get("spread") or 0) / 2.0)
    fill = float(q.get("yes_ask") or 50) + fee + half
    ev = None
    if p is not None:
        ev = round(100.0 * p - fill, 1)
    if skip:
        conf = min(22, max(4, int(round(12 + 8 * (p or 0)))))
    else:
        edge = (p or 0.5) - implied
        climo_align = 0.0
        if climo_p is not None and p is not None:
            climo_align = 1.0 - min(1.0, abs(climo_p - p))
        conf = int(round(50 + 28 * ((p or 0.5) - 0.5) + 18 * edge + 4 * climo_align))
        conf = max(0, min(99, conf))
    return {
        "city": city["id"],
        "name": city["name"],
        "place": city.get("place"),
        "station": city["station"],
        "series": city["series"],
        "ticker": m.get("ticker"),
        "day": day.isoformat(),
        "strike_type": str(m.get("strike_type") or ""),
        "floor_strike": m.get("floor_strike"),
        "cap_strike": m.get("cap_strike"),
        "bracket": strike_label(m),
        "forecast": forecast,
        "climo": climo,
        "yes_bid": q.get("yes_bid"),
        "yes_ask": q.get("yes_ask"),
        "no_bid": q.get("no_bid"),
        "no_ask": q.get("no_ask"),
        "spread": flags.get("spread"),
        "volume": vol,
        "sample_n": int(vol),
        "p_forecast": None if p is None else round(p, 3),
        "ev_cents": ev,
        "confidence": conf,
        "dont_play": bool(skip),
        "skip": skip,
        "votes": vote_seats(m, forecast=forecast, climo=climo, skip=skip, station=str(city["station"]), mesh=mesh, echo=echo),
        "best": False,
        "follower": False,
    }


def pick_best(scored: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not scored:
        return None
    playable = [b for b in scored if not b.get("dont_play")]
    pool = playable or scored
    pool.sort(key=lambda b: (
        0 if b.get("city") == "DAL" else 1,
        -int(b.get("confidence") or 0),
        -(b.get("ev_cents") or -99),
    ))
    return pool[0]


def build_seats(
    best: Optional[Dict[str, Any]],
    forecast: Optional[float],
    day: Optional[date],
    mesh: Optional[Dict[str, Any]] = None,
    subs: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    recs = {r["id"]: r for r in seat_records()}
    climo = (DALLAS.get("climo") or {}).get(day.month) if day else None
    pack = mesh if isinstance(mesh, dict) else empty_mesh()
    sub_rows = [s for s in (subs or []) if isinstance(s, dict)]
    defaults = {
        "GLASS": None if forecast is None else f"{forecast:.0f}°F KDFW",
        "PIT": None,
        "FROST": "clear",
        "BONE": None if climo is None else f"{climo}°F season",
        "MESH": mesh_call_line(pack),
    }
    votes: Dict[str, Any] = {}
    if best:
        if best.get("yes_ask") is not None:
            defaults["PIT"] = f"{int(round(best['yes_ask']))}¢ {best.get('bracket') or ''}".strip()
        defaults["FROST"] = best.get("skip") or "clear"
        votes = {v["id"]: v for v in (best.get("votes") or []) if isinstance(v, dict) and v.get("id")}
        for sid, row in votes.items():
            if row.get("call"):
                defaults[sid] = row["call"]
    rows = []
    for seat in SEATS:
        rec = recs.get(seat["id"]) or {"n": 0, "wr": None, "rank": 0, "correct": 0, "wrong": 0}
        vote = votes.get(seat["id"]) or {}
        raw = str(vote.get("dir") or "WAIT").upper()
        fc = forecast
        if seat["id"] == "MESH" and vote.get("median") is not None:
            fc = vote.get("median")
        elif seat["id"] == "MESH" and pack.get("median") is not None:
            fc = pack.get("median")
        lean = weather_dir(
            raw,
            strike_type=None if not best else best.get("strike_type"),
            forecast=fc,
            floor_strike=None if not best else best.get("floor_strike"),
            cap_strike=None if not best else best.get("cap_strike"),
        )
        row = {
            "id": seat["id"],
            "job": seat["job"],
            "mark": seat["mark"],
            "call": defaults.get(seat["id"]),
            "dir": lean,
            "eye": weather_eye(lean),
            "vote": raw,
            "n": rec.get("n") or 0,
            "wr": rec.get("wr"),
            "rank": rec.get("rank") or 0,
            "correct": rec.get("correct") or 0,
            "wrong": rec.get("wrong") or 0,
            "faded": bool(rec.get("faded")),
            "invert": bool(rec.get("invert")),
            "letter": None,
        }
        if seat["id"] == "MESH":
            row["median"] = vote.get("median") if vote.get("median") is not None else pack.get("median")
            row["spread"] = vote.get("spread") if vote.get("spread") is not None else pack.get("spread")
            row["n_sources"] = vote.get("n_sources") if vote.get("n_sources") is not None else pack.get("n_live")
            row["thin"] = bool(vote.get("thin") if "thin" in vote else pack.get("thin"))
            row["wide"] = bool(vote.get("wide") if "wide" in vote else pack.get("wide"))
            row["sources"] = list(vote.get("sources") or pack.get("sources") or [])
            row["confidence"] = vote.get("confidence") if vote.get("confidence") is not None else (12 if row["thin"] else (22 if row["wide"] else 64))
        kids = [
            s for s in sub_rows
            if str(s.get("parent") or "") == seat["id"]
            or seat["id"] in {str(x) for x in (s.get("feeds") or ())}
        ]
        row["subs"] = kids
        rows.append(row)
    return rows


def front_would_lock_if_strict(best: Optional[Dict[str, Any]], min_c: int) -> bool:
    """
    Shadow lock bar with skip/dont_play gates off.

    Live play still sits WAIT on a gate. True only when the underlying
    forecast vs book would have cleared min_c — the only reason we sat
    was a gate, not a missing edge.
    """
    if not best:
        return False
    try:
        pf = float(best["p_forecast"]) if best.get("p_forecast") is not None else 0.5
    except (TypeError, ValueError):
        pf = 0.5
    try:
        ask = float(best["yes_ask"]) if best.get("yes_ask") is not None else 50.0
    except (TypeError, ValueError):
        ask = 50.0
    implied = ask / 100.0 if ask > 1.5 else ask
    climo_p = None
    try:
        if best.get("climo") is not None:
            climo_p = forecast_p(float(best["climo"]), {
                "strike_type": best.get("strike_type"),
                "floor_strike": best.get("floor_strike"),
                "cap_strike": best.get("cap_strike"),
            })
    except (TypeError, ValueError):
        climo_p = None
    climo_align = 0.0
    if climo_p is not None:
        climo_align = 1.0 - min(1.0, abs(float(climo_p) - pf))
    edge = pf - implied
    conf = int(round(50 + 28 * (pf - 0.5) + 18 * edge + 4 * climo_align))
    conf = max(0, min(99, conf))
    try:
        bar = int(min_c)
    except (TypeError, ValueError):
        bar = 50
    return conf >= bar


def build_chair(best: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    acc = chair_accuracy()
    rec = seat_record(acc["total"], None if not acc["total"] else acc["correct"] / acc["total"])
    # Skip / dont_play is a WAIT, not a BELOW lock. Portraits still use UP/WAIT eyes.
    if not best or best.get("dont_play"):
        lean = "WAIT"
        eye = "WAIT"
    else:
        lean = weather_dir(
            "YES",
            strike_type=best.get("strike_type"),
            forecast=best.get("forecast"),
            floor_strike=best.get("floor_strike"),
            cap_strike=best.get("cap_strike"),
        )
        eye = weather_eye(lean)
    # v1 wait portrait is the approved Chair face. Up/down reuse the same file.
    marks = {
        "UP": "/static/bots/raijin-up.png",
        "DOWN": "/static/bots/raijin-down.png",
        "WAIT": "/static/bots/raijin-wait.png",
    }
    return {
        "id": CHAIR["id"],
        "name": CHAIR["name"],
        "job": CHAIR["job"],
        "mark": marks.get(eye) or CHAIR["mark"],
        "portrait": CHAIR["mark"],
        "eye": eye,
        "lean": lean,
        "call": None if not best else (best.get("skip") or best.get("bracket")),
        "bracket": None if not best else best.get("bracket"),
        "strike_type": None if not best else best.get("strike_type"),
        "kalshi_high": None if not best else kalshi_high_f(best),
        "ticker": None if not best else best.get("ticker"),
        "confidence": None if not best else best.get("confidence"),
        "dont_play": bool(best.get("dont_play")) if best else True,
        "n": rec["n"],
        "wr": rec["wr"],
    }


async def build_board(
    fetch: Optional[_Fetch] = None,
    nws: Optional[_Nws] = None,
    now: Optional[datetime] = None,
    wx_obs: Optional[Dict[str, Any]] = None,
    cli_highs: Optional[Dict[str, float]] = None,
    http: Optional[_Http] = None,
    mesh: Optional[Dict[str, Any]] = None,
    echo: Optional[Dict[str, Any]] = None,
    cell: Optional[Dict[str, Any]] = None,
    heat: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if fetch is None and nws is None and now is None and wx_obs is None and cli_highs is None:
        cached = _board_cache.get("payload")
        if cached and (time.time() - float(_board_cache.get("at") or 0)) < BOARD_TTL_S:
            await settle_open_fills()
            out = dict(cached)
            out["status"] = arm_status()
            out["accuracy"] = chair_accuracy()
            out["tape"] = lock_tape()
            out["fills"] = list(reversed(_load_fills()[-12:]))
            try:
                day_s = ((out.get("city") or {}).get("day"))
                day_d = date.fromisoformat(str(day_s)) if day_s else None
                best_row = None
                for b in out.get("brackets") or []:
                    if isinstance(b, dict) and b.get("best"):
                        best_row = b
                        break
                fc = None
                if best_row and best_row.get("forecast") is not None:
                    fc = best_row.get("forecast")
                clock = build_clock(day_d, best_row, datetime.now(timezone.utc), fc)
                wx = out.get("weather") if isinstance(out.get("weather"), dict) else {}
                obs = wx.get("obs") if isinstance(wx.get("obs"), dict) else {}
                clock["now_f"] = obs.get("temp_f")
                clock["temp_stale"] = bool(wx.get("held"))
                out["clock"] = clock
            except Exception:
                pass
            recs = {r["id"]: r for r in seat_records()}
            seats = []
            for s in out.get("seats") or []:
                rec = recs.get(s.get("id")) or {}
                row = dict(s)
                for k in ("n", "wr", "rank", "correct", "wrong"):
                    if k in rec:
                        row[k] = rec[k]
                seats.append(row)
            out["seats"] = seats
            if isinstance(out.get("chair"), dict):
                acc = out["accuracy"]
                chair = dict(out["chair"])
                chair["n"] = acc.get("total") or 0
                chair["wr"] = None if not acc.get("total") else (acc.get("correct") or 0) / acc["total"]
                out["chair"] = chair
            held = _load_wx_hold()
            hold_age = time.time() - float(held.get("at") or 0)
            if held.get("mode") in WX_MODES and 0 < hold_age < WX_REFRESH_S:
                out["weather"] = {
                    "mode": held.get("mode"),
                    "held": False,
                    "live": True,
                    "station": "KDFW",
                    "obs": held.get("obs"),
                    "at": datetime.now(timezone.utc).isoformat(),
                }
            else:
                out["weather"] = remember_weather(await fetch_kdfw_obs())
            return out

    n = now or datetime.now(timezone.utc)
    await settle_open_fills(cli_highs=cli_highs, nws=nws)
    dropped: List[str] = []
    brackets: List[Dict[str, Any]] = []
    forecast = None
    day = None
    mesh_pack = mesh if isinstance(mesh, dict) else empty_mesh()
    if wx_obs is None:
        held = _load_wx_hold()
        age = time.time() - float(held.get("at") or 0)
        if held.get("mode") in WX_MODES and 0 < age < WX_REFRESH_S:
            weather = {
                "mode": held.get("mode"),
                "held": False,
                "live": True,
                "station": "KDFW",
                "obs": held.get("obs"),
                "at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            weather = remember_weather(await fetch_kdfw_obs(nws))
    else:
        weather = remember_weather(wx_obs)
    obs = weather.get("obs") if isinstance(weather.get("obs"), dict) else None
    now_f = None if not obs else obs.get("temp_f")
    echo_pack = echo if isinstance(echo, dict) else None
    cell_pack = cell if isinstance(cell, dict) else None
    if cell_pack is None:
        alerts = await fetch_kdfw_alerts(nws)
        cell_pack = build_cell(obs, alerts_ok=bool(alerts.get("ok")), alert_event=alerts.get("event"))

    for city in CITIES:
        rows, missing = await fetch_series(str(city["series"]), fetch)
        if missing or not rows:
            dropped.append(str(city["series"]))
            continue
        event_day = pick_event_day(rows, n, str(city["tz"]))
        if event_day is None:
            dropped.append(str(city["series"]))
            continue
        today = [m for m in rows if date_from_ticker(m.get("ticker")) == event_day]
        if not today:
            dropped.append(str(city["series"]))
            continue
        city_fc = await nws_high(str(city["station"]), event_day, nws)
        if city["id"] == "DAL":
            forecast = city_fc
            day = event_day
            if mesh is None:
                mesh_pack = await fetch_mesh_highs(event_day, nws=nws, http=http)
            if echo_pack is None:
                yday = event_day - timedelta(days=1)
                yhigh = None
                if cli_highs:
                    yhigh = (
                        cli_highs.get(f"DAL:{yday.isoformat()}")
                        or cli_highs.get(f"KDFW:{yday.isoformat()}")
                        or cli_highs.get(yday.isoformat())
                    )
                if yhigh is None:
                    yhigh = await fetch_cli_high(yday, nws, station="KDFW", office="FWD")
                echo_pack = build_echo(yhigh, yday)
        flipped = note_forecast(str(city["station"]), event_day, city_fc)
        scored = [
            score_bracket(
                m,
                city=city,
                forecast=city_fc,
                flipped=flipped,
                day=event_day,
                mesh=mesh_pack if city["id"] == "DAL" else None,
                heat=build_heat(
                    now_f=now_f,
                    nws_high=city_fc,
                    kalshi_high=kalshi_high_f(m),
                    stale=bool(weather.get("held")),
                    market=m,
                ) if heat is None else heat,
                echo=echo_pack if city["id"] == "DAL" else None,
                cell=cell_pack if city["id"] == "DAL" else None,
            )
            for m in today
        ]
        scored.sort(key=lambda b: (-int(b.get("confidence") or 0), -(b.get("ev_cents") or -99)))
        brackets.extend(scored)

    if mesh is None and (not mesh_pack.get("sources")):
        try:
            mesh_day = day or n.astimezone(CT).date()
        except Exception:
            mesh_day = day or n.date()
        mesh_pack = await fetch_mesh_highs(mesh_day, nws=nws, http=http)

    best = pick_best(brackets)
    if best:
        best["best"] = True
    try:
        min_c = int(front_knobs().get("min_confidence") or 50)
    except (TypeError, ValueError):
        min_c = 50
    chair_best = best
    if best and not best.get("dont_play") and int(best.get("confidence") or 0) < min_c:
        chair_best = None
    sit_out = chair_best is None or bool(best and best.get("dont_play"))
    if day is not None and sit_out:
        skip = (best or {}).get("skip") if best else "Don’t play · empty book"
        would = front_would_lock_if_strict(best, min_c)
        try:
            record_wait_sample(
                day=day,
                ticker=None if not best else best.get("ticker"),
                skip=skip,
                votes=None if not best else best.get("votes"),
                book_depth={
                    "volume": None if not best else best.get("volume"),
                    "spread": None if not best else best.get("spread"),
                    "yes_ask": None if not best else best.get("yes_ask"),
                    "yes_bid": None if not best else best.get("yes_bid"),
                },
                would_lock_if_strict=would,
                bracket=None if not best else best.get("bracket"),
                strike_type=None if not best else best.get("strike_type"),
                floor_strike=None if not best else best.get("floor_strike"),
                cap_strike=None if not best else best.get("cap_strike"),
                city=DALLAS,
                now=n,
            )
        except Exception:
            pass

    if echo_pack is None:
        try:
            echo_day = (day or n.astimezone(CT).date()) - timedelta(days=1)
        except Exception:
            echo_day = (day or n.date()) - timedelta(days=1)
        echo_pack = build_echo(await fetch_cli_high(echo_day, nws, station="KDFW", office="FWD"), echo_day)
    heat_pack = heat if isinstance(heat, dict) else build_heat(
        now_f=now_f,
        nws_high=forecast,
        kalshi_high=None if not best else kalshi_high_f(best),
        stale=bool(weather.get("held")),
        market=best,
    )
    sub_rows = build_subs(heat_pack, echo_pack, cell_pack)
    clock = build_clock(day, best, n, forecast)
    clock["now_f"] = None if now_f is None else now_f
    clock["temp_stale"] = bool(weather.get("held"))

    payload = {
        "ok": True,
        "mode": "paper",
        "title": "THE FRONT",
        "home": "DAL",
        "city": {
            "id": DALLAS["id"],
            "name": DALLAS["name"],
            "place": DALLAS["place"],
            "station": DALLAS["station"],
            "icao": DALLAS["icao"],
            "market": DALLAS["market"],
            "series": DALLAS["series"],
            "day": None if day is None else day.isoformat(),
        },
        "cities": [
            {
                "id": c["id"],
                "name": c["name"],
                "place": c["place"],
                "station": c["station"],
                "series": c["series"],
                "order": c["order"],
            }
            for c in CITIES
        ],
        "weather": weather,
        "clock": clock,
        "chair": build_chair(chair_best),
        "seats": build_seats(best, forecast, day, mesh=mesh_pack, subs=sub_rows),
        "mesh": mesh_pack,
        "subs": sub_rows,
        "brackets": brackets,
        "best": None if best is None else best.get("ticker"),
        "dropped": dropped,
        "accuracy": chair_accuracy(),
        "tape": lock_tape(),
        "fills": list(reversed(_load_fills()[-12:])),
        "status": arm_status(),
        "product": "Satoshi’s Council",
        "follower": False,
        "auto_bets": False,
        "knobs": front_knobs(),
        "note": "Board v1. Dallas DFW only (KXHIGHTDAL / KDFW). Not Love Field. NYC and Chicago later.",
    }
    _board_cache["at"] = time.time()
    _board_cache["payload"] = payload
    return payload


def daily_loss(now: Optional[datetime] = None) -> float:
    n = now or datetime.now(timezone.utc)
    local = n.astimezone(CT).date()
    loss = 0.0
    for row in _load_fills():
        ts = row.get("at")
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except Exception:
            continue
        if dt.astimezone(CT).date() != local:
            continue
        pnl = row.get("pnl")
        try:
            if pnl is not None and float(pnl) < 0:
                loss += abs(float(pnl))
        except (TypeError, ValueError):
            continue
    return loss


async def tap(
    *,
    ticker: str,
    side: str = "YES",
    stake: Any = 5,
    live: bool = False,
    yes_bid: Any = None,
    yes_ask: Any = None,
    sick: bool = False,
    now: Optional[datetime] = None,
    votes: Any = None,
    bracket: Any = None,
    best: bool = False,
    strike_type: Any = None,
    floor_strike: Any = None,
    cap_strike: Any = None,
) -> Dict[str, Any]:
    """Manual paper (default) or armed live tap. Never auto. Never Follower."""
    tick = str(ticker or "").strip()
    if not tick:
        return {"ok": False, "error": "no ticker"}
    if tick.startswith("KXBTCD-") or tick.startswith("KXETHD-"):
        return {"ok": False, "error": "Chair 1H stays on Floor"}
    if any(bad in tick for bad in BLOCKED_SERIES):
        return {"ok": False, "error": "later · not v1"}
    city = city_for_ticker(tick)
    if city is None:
        return {"ok": False, "error": "not a v1 Front book"}
    kn = front_knobs()
    if sick:
        return {"ok": False, "error": "Don’t play · sick book", "dont_play": True}
    q = paper_quote(side, yes_bid, yes_ask)
    if not q.get("ok"):
        return {"ok": False, "error": q.get("error") or "no quote"}
    dollars = min(front_max_stake(), clamp_stake(stake))
    cap = front_daily_loss_cap()
    if daily_loss(now) + dollars > cap + 1e-6:
        return {"ok": False, "error": "daily WX loss cap", "dont_play": True}
    want_live = bool(live)
    if want_live:
        if is_killed() or not live_allowed() or not is_armed():
            return {"ok": False, "error": "live off · paper only", "paper_default": True}
        try:
            from backend.data.kalshi_trade import KalshiTradeClient

            client = KalshiTradeClient.from_settings()
            routed = await client.create_order(
                ticker=tick,
                direction="UP" if q["side"] == "YES" else "DOWN",
                contracts=max(1, int(round(dollars / max(0.01, q["fill_cents"] / 100.0)))),
                yes_price=q["ask"] if q["side"] == "YES" else (100.0 - (q["ask"] or 50)),
            )
            if not routed.get("ok"):
                return {"ok": False, "error": "live refused", "refuse": routed.get("refuse"), "live": False}
        except Exception:
            return {"ok": False, "error": "live refused", "live": False}
    cached = _bracket_from_cache(tick) or {}
    snap_votes = votes if isinstance(votes, list) else cached.get("votes")
    if not isinstance(snap_votes, list):
        snap_votes = []
    if kn.get("no_lock_frost_sick", True):
        for v in snap_votes:
            if isinstance(v, dict) and str(v.get("id") or "").upper() == "FROST" and str(v.get("dir") or "").upper() == "SKIP":
                return {"ok": False, "error": "FROST veto · no lock", "dont_play": True}
    try:
        min_c = int(kn.get("min_confidence") or 50)
    except (TypeError, ValueError):
        min_c = 50
    conf = cached.get("confidence")
    if conf is not None:
        try:
            if int(conf) < min_c:
                return {"ok": False, "error": "below min confidence", "dont_play": True}
        except (TypeError, ValueError):
            pass
    day = date_from_ticker(tick)
    row = {
        "id": str(uuid.uuid4())[:12],
        "ticker": tick,
        "side": q["side"],
        "stake": dollars,
        "fill_cents": q["fill_cents"],
        "fee_cents": q["fee_cents"],
        "live": bool(want_live and is_armed()),
        "paper": not (want_live and is_armed()),
        "at": (now or datetime.now(timezone.utc)).isoformat(),
        "settled": False,
        "result": "OPEN",
        "pnl": None,
        "follower": False,
        "desk": "front",
        "leader": "RAIJIN",
        "city": city["id"],
        "station": city["station"],
        "place": city.get("place"),
        "day": None if day is None else day.isoformat(),
        "bracket": bracket or cached.get("bracket"),
        "best": bool(best or cached.get("best")),
        "strike_type": strike_type or cached.get("strike_type") or "between",
        "floor_strike": floor_strike if floor_strike is not None else cached.get("floor_strike"),
        "cap_strike": cap_strike if cap_strike is not None else cached.get("cap_strike"),
        "votes": [dict(v) for v in snap_votes if isinstance(v, dict)],
        "settle_reason": "pending_cli",
    }
    if day is not None:
        key = day.isoformat()
        for old in _load_fills():
            if str(old.get("day") or "") == key and str(old.get("side") or "").upper() == "WAIT":
                old["superseded"] = True
    _load_fills().append(row)
    _save_fills()
    return {"ok": True, "fill": row, "status": arm_status(), "live": bool(row["live"])}
