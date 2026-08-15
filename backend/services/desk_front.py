"""
THE FRONT — Dallas DFW daily-high weather council.

Named seats (RAIJIN / GLASS / PIT / FROST / BONE), not a crypto Floor.
Dallas only: KXHIGHTDAL / KDFW. If that series 404s, drop it. Do not fake cities.

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
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import kalshi_taker_fee_cents
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

MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
TICK_DATE = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})(?:-|$)")

DALLAS: Dict[str, Any] = {
    "id": "DAL",
    "name": "DALLAS",
    "series": "KXHIGHTDAL",
    "station": "KDFW",
    "icao": "KDFW",
    "market": "DFW",
    "tz": "America/Chicago",
    "climo": {8: 96, 7: 97, 9: 90, 6: 94, 10: 81},
}

SEATS: Tuple[Dict[str, str], ...] = (
    {"id": "GLASS", "job": "Official high. Reads the NWS/CLI print for KDFW.", "mark": "/static/bots/glass.png"},
    {"id": "PIT", "job": "Market book. Implied cents after vig and spread.", "mark": "/static/bots/pit.png"},
    {"id": "FROST", "job": "Skip freeze. Sick book, flip, thin sample, junk spread.", "mark": "/static/bots/frost.png"},
    {"id": "BONE", "job": "Climo bones. Seasonal DFW high vs the live bracket.", "mark": "/static/bots/bone.png"},
)
CHAIR: Dict[str, str] = {
    "id": "RAIJIN",
    "job": "Weather chair. Ranks the DFW book. Does not lock the 1H Chair.",
    "mark": "/static/bots/raijin-chair.png",
}

WX_MODES = ("SUN", "HEAT", "CLOUD", "RAIN", "WIND", "STORM")
THIN_VOL = 200.0
FLIP_F = 2.0
BOARD_TTL_S = 20.0
WX_TTL_S = 180.0
NWS_UA = "SatoshiCouncil/1.0 (the-front; dallas-kdfw)"
HEAT_F = 95.0
WIND_KT = 20.0

_board_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
_arm: Dict[str, Any] = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
_fills: List[Dict[str, Any]] = []
_fills_loaded = False
_forecast_prev: Dict[str, float] = {}
_wx_hold: Dict[str, Any] = {"mode": None, "obs": None, "at": 0.0}
_data_override: Optional[Path] = None


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    global _fills, _fills_loaded, _board_cache, _arm, _forecast_prev, _wx_hold, _data_override
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _arm = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
    _forecast_prev = {}
    _wx_hold = {"mode": None, "obs": None, "at": 0.0}
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
        "max_stake": float(getattr(settings, "FRONT_MAX_STAKE", 25.0)),
        "daily_loss_cap": float(getattr(settings, "FRONT_DAILY_LOSS_CAP", 50.0)),
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


def skip_reason(flags: Dict[str, Any], forecast: Optional[float], flipped: bool, n: float) -> Optional[str]:
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
        data = await fn("https://api.weather.gov/stations/KDFW/observations/latest")
        parsed = parse_nws_obs(data if isinstance(data, dict) else {})
        if parsed:
            return parsed
    except Exception:
        pass
    if nws is not None:
        return None
    try:
        av = await _http_get(
            "https://aviationweather.gov/api/data/metar?ids=KDFW&format=json",
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
    forecast: Optional[float],
    flipped: bool,
    day: date,
) -> Dict[str, Any]:
    q = market_quotes(m)
    flags = book_health(m)
    vol = float(flags.get("volume") or 0)
    p = forecast_p(forecast, m)
    climo = (DALLAS.get("climo") or {}).get(day.month)
    climo_p = forecast_p(float(climo), m) if climo is not None else None
    skip = skip_reason(flags, forecast, flipped, vol)
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
        "city": DALLAS["id"],
        "name": DALLAS["name"],
        "station": DALLAS["station"],
        "series": DALLAS["series"],
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
        "best": False,
        "follower": False,
    }


def pick_best(scored: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not scored:
        return None
    playable = [b for b in scored if not b.get("dont_play")]
    pool = playable or scored
    pool.sort(key=lambda b: (-int(b.get("confidence") or 0), -(b.get("ev_cents") or -99)))
    return pool[0]


def build_seats(best: Optional[Dict[str, Any]], forecast: Optional[float], day: Optional[date]) -> List[Dict[str, Any]]:
    stats = seat_stats()
    climo = (DALLAS.get("climo") or {}).get(day.month) if day else None
    glass_call = None if forecast is None else f"{forecast:.0f}°F KDFW"
    pit_call = None
    frost_call = "clear"
    bone_call = None if climo is None else f"{climo}°F season"
    if best:
        if best.get("yes_ask") is not None:
            pit_call = f"{int(round(best['yes_ask']))}¢ {best.get('bracket') or ''}".strip()
        frost_call = best.get("skip") or "clear"
    rows = []
    calls = {"GLASS": glass_call, "PIT": pit_call, "FROST": frost_call, "BONE": bone_call}
    for seat in SEATS:
        rec = stats.get(seat["id"]) or seat_record(0, None)
        rows.append({
            "id": seat["id"],
            "job": seat["job"],
            "mark": seat["mark"],
            "call": calls.get(seat["id"]),
            "n": rec["n"],
            "wr": rec["wr"],
            "letter": None,
        })
    return rows


def build_chair(best: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    rec = seat_stats().get("RAIJIN") or seat_record(0, None)
    if not best:
        eye = "WAIT"
    elif best.get("dont_play"):
        eye = "DOWN"
    else:
        eye = "UP"
    marks = {
        "UP": "/static/bots/raijin-up.png",
        "DOWN": "/static/bots/raijin-down.png",
        "WAIT": "/static/bots/raijin-wait.png",
    }
    return {
        "id": CHAIR["id"],
        "job": CHAIR["job"],
        "mark": marks.get(eye) or CHAIR["mark"],
        "portrait": CHAIR["mark"],
        "eye": eye,
        "call": None if not best else (best.get("skip") or best.get("bracket")),
        "bracket": None if not best else best.get("bracket"),
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
) -> Dict[str, Any]:
    if fetch is None and nws is None and now is None and wx_obs is None:
        cached = _board_cache.get("payload")
        if cached and (time.time() - float(_board_cache.get("at") or 0)) < BOARD_TTL_S:
            out = dict(cached)
            out["status"] = arm_status()
            return out

    n = now or datetime.now(timezone.utc)
    dropped: List[str] = []
    brackets: List[Dict[str, Any]] = []
    forecast = None
    day = None

    rows, missing = await fetch_series(str(DALLAS["series"]), fetch)
    if missing or not rows:
        dropped.append(str(DALLAS["series"]))
    else:
        day = pick_event_day(rows, n, str(DALLAS["tz"]))
        if day is None:
            dropped.append(str(DALLAS["series"]))
        else:
            today = [m for m in rows if date_from_ticker(m.get("ticker")) == day]
            forecast = await nws_high(str(DALLAS["station"]), day, nws)
            flipped = note_forecast(str(DALLAS["station"]), day, forecast)
            brackets = [score_bracket(m, forecast=forecast, flipped=flipped, day=day) for m in today]
            brackets.sort(key=lambda b: (-int(b.get("confidence") or 0), -(b.get("ev_cents") or -99)))

    best = pick_best(brackets)
    if best:
        best["best"] = True

    if wx_obs is None:
        held = _load_wx_hold()
        age = time.time() - float(held.get("at") or 0)
        if held.get("mode") in WX_MODES and 0 < age < WX_TTL_S:
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

    payload = {
        "ok": True,
        "mode": "paper",
        "title": "THE FRONT",
        "city": {
            "id": DALLAS["id"],
            "name": DALLAS["name"],
            "station": DALLAS["station"],
            "icao": DALLAS["icao"],
            "market": DALLAS["market"],
            "series": DALLAS["series"],
            "day": None if day is None else day.isoformat(),
        },
        "weather": weather,
        "chair": build_chair(best),
        "seats": build_seats(best, forecast, day),
        "brackets": brackets,
        "best": None if best is None else best.get("ticker"),
        "dropped": dropped,
        "fills": list(reversed(_load_fills()[-12:])),
        "status": arm_status(),
        "product": "Satoshi’s Council",
        "follower": False,
        "auto_bets": False,
        "note": "Dallas DFW only. NWS CLI / KDFW. Date is in the ticker. Not the crypto Floor.",
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
) -> Dict[str, Any]:
    """Manual paper (default) or armed live tap. Never auto. Never Follower."""
    tick = str(ticker or "").strip()
    if not tick:
        return {"ok": False, "error": "no ticker"}
    if tick.startswith("KXBTCD-") or tick.startswith("KXETHD-"):
        return {"ok": False, "error": "Chair 1H stays on Floor"}
    if sick:
        return {"ok": False, "error": "Don’t play · sick book", "dont_play": True}
    q = paper_quote(side, yes_bid, yes_ask)
    if not q.get("ok"):
        return {"ok": False, "error": q.get("error") or "no quote"}
    dollars = min(float(getattr(settings, "FRONT_MAX_STAKE", 25.0)), clamp_stake(stake))
    cap = float(getattr(settings, "FRONT_DAILY_LOSS_CAP", 50.0))
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
    }
    _load_fills().append(row)
    _save_fills()
    return {"ok": True, "fill": row, "status": arm_status(), "live": bool(row["live"])}
