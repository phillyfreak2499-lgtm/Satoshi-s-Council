"""
THE FRONT — daily high-temp city cards. Weather page, not a crypto Floor.

Four seats only: FORECAST, MARKET, SKIP, CLIMO.
Required cities: CHI Midway, NYC Central Park, DAL DFW.
Optional extras only if that series is open and liquid. 404 → drop. Do not fake.

Paper by default. Never auto-bets. Never talks to Follower.
Does not place Chair 1H locks. Settlement is NWS CLI for the station.
Date lives in the ticker. Read strike_type from the API every time.
2°F between-brackets are inclusive both ends.
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

CITIES: Tuple[Dict[str, Any], ...] = (
    {"id": "CHI", "name": "CHICAGO", "place": "Midway", "series": "KXHIGHCHI", "station": "KMDW", "tz": "America/Chicago", "required": True, "climo": {8: 83, 7: 84, 9: 76, 6: 81, 10: 64}},
    {"id": "NYC", "name": "NEW YORK", "place": "Central Park", "series": "KXHIGHNY", "station": "KNYC", "tz": "America/New_York", "required": True, "climo": {8: 84, 7: 85, 9: 77, 6: 80, 10: 66}},
    {"id": "DAL", "name": "DALLAS", "place": "DFW", "series": "KXHIGHTDAL", "station": "KDFW", "tz": "America/Chicago", "required": True, "climo": {8: 96, 7: 97, 9: 90, 6: 94, 10: 81}},
    {"id": "MIA", "name": "MIAMI", "place": "MIA", "series": "KXHIGHMIA", "station": "KMIA", "tz": "America/New_York", "required": False, "climo": {8: 90, 7: 91, 9: 88, 6: 89, 10: 86}},
    {"id": "AUS", "name": "AUSTIN", "place": "AUS", "series": "KXHIGHAUS", "station": "KAUS", "tz": "America/Chicago", "required": False, "climo": {8: 97, 7: 98, 9: 91, 6: 94, 10: 83}},
    {"id": "PHX", "name": "PHOENIX", "place": "PHX", "series": "KXHIGHTPHX", "station": "KPHX", "tz": "America/Phoenix", "required": False, "climo": {8: 105, 7: 106, 9: 100, 6: 104, 10: 90}},
)

SEATS: Tuple[Dict[str, Any], ...] = (
    {"id": "FORECAST", "job": "NWS/NBM official high for the station.", "mark": "/static/bots/glass.png", "weight": 1.0},
    {"id": "MARKET", "job": "Kalshi implied vs that high, after vig.", "mark": "/static/bots/pit.png", "weight": 1.0},
    {"id": "SKIP", "job": "Junk book / flip / SICK / thin n.", "mark": "/static/bots/frost.png", "weight": 1.0},
    {"id": "CLIMO", "job": "Seasonal base. Low weight.", "mark": "/static/bots/bone.png", "weight": 0.25},
)

CITY_LIQUID_VOL = 2000.0
CITY_LIQUID_SPREAD = 4.0
THIN_VOL = 200.0
FLIP_F = 2.0
BOARD_TTL_S = 20.0
NWS_UA = "SatoshiCouncil/1.0 (the-front)"

_board_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
_arm: Dict[str, Any] = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
_fills: List[Dict[str, Any]] = []
_fills_loaded = False
_forecast_prev: Dict[str, float] = {}
_data_override: Optional[Path] = None


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    global _fills, _fills_loaded, _board_cache, _arm, _forecast_prev, _data_override
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _arm = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
    _forecast_prev = {}
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


def city_is_liquid(markets: List[Dict[str, Any]]) -> bool:
    for m in markets:
        flags = book_health(m)
        vol = float(flags.get("volume") or 0)
        spread = flags.get("spread")
        if str(m.get("strike_type") or "").lower() != "between":
            continue
        if vol >= CITY_LIQUID_VOL and (spread is None or spread <= CITY_LIQUID_SPREAD):
            return True
    return False


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


async def _nws_get(url: str) -> Dict[str, Any]:
    import httpx

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(url, headers={"User-Agent": NWS_UA, "Accept": "application/geo+json"})
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


def seat_votes(
    *,
    forecast: Optional[float],
    climo: Optional[float],
    p: Optional[float],
    climo_p: Optional[float],
    implied: Optional[float],
    skip: Optional[str],
    city: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """FORECAST / MARKET / SKIP / CLIMO vote on this city's bracket."""
    stats = _seat_stats()
    forecast_dir = "WAIT" if forecast is None else ("YES" if (p or 0) >= 0.5 else "NO")
    market_dir = "WAIT"
    if implied is not None and p is not None:
        market_dir = "YES" if p >= implied else "NO"
    elif implied is not None:
        market_dir = "YES" if implied < 0.5 else "NO"
    skip_dir = "SKIP" if skip else "CLEAR"
    climo_dir = "WAIT" if climo_p is None else ("YES" if climo_p >= 0.5 else "NO")
    rows = [
        {
            "id": "FORECAST",
            "job": SEATS[0]["job"],
            "mark": SEATS[0]["mark"],
            "dir": forecast_dir,
            "call": None if forecast is None else f"{forecast:.0f}°F {city['station']}",
            "weight": 1.0,
            **stats["FORECAST"],
        },
        {
            "id": "MARKET",
            "job": SEATS[1]["job"],
            "mark": SEATS[1]["mark"],
            "dir": market_dir,
            "call": None if implied is None else f"{int(round(implied * 100))}¢ after vig",
            "weight": 1.0,
            **stats["MARKET"],
        },
        {
            "id": "SKIP",
            "job": SEATS[2]["job"],
            "mark": SEATS[2]["mark"],
            "dir": skip_dir,
            "call": skip or "clear",
            "weight": 1.0,
            **stats["SKIP"],
        },
        {
            "id": "CLIMO",
            "job": SEATS[3]["job"],
            "mark": SEATS[3]["mark"],
            "dir": climo_dir,
            "call": None if climo is None else f"{climo}°F season",
            "weight": 0.25,
            **stats["CLIMO"],
        },
    ]
    return rows


def _seat_stats() -> Dict[str, Dict[str, Any]]:
    rows = [r for r in _load_fills() if r.get("settled") and r.get("result") in ("HIT", "MISS", "yes", "no")]
    n = len(rows)
    hits = sum(1 for r in rows if str(r.get("result") or "").upper() in ("HIT", "YES"))
    wr = None if n < 1 else hits / n
    rec = {"n": n, "wr": None if wr is None else round(wr, 3)}
    return {s["id"]: dict(rec) for s in SEATS}


def score_bet(
    m: Dict[str, Any],
    *,
    city: Dict[str, Any],
    forecast: Optional[float],
    flipped: bool,
    day: date,
) -> Dict[str, Any]:
    q = market_quotes(m)
    flags = book_health(m)
    vol = float(flags.get("volume") or 0)
    p = forecast_p(forecast, m)
    climo = (city.get("climo") or {}).get(day.month)
    climo_p = forecast_p(float(climo), m) if climo is not None else None
    skip = skip_reason(flags, forecast, flipped, vol)
    implied = None if q.get("yes_ask") is None else q["yes_ask"] / 100.0
    fee = kalshi_taker_fee_cents(q.get("yes_ask"))
    half = (float(flags.get("spread") or 0) / 2.0)
    fill = float(q.get("yes_ask") or 50) + fee + half
    ev = None
    if p is not None:
        ev = round(100.0 * p - fill, 1)
    votes = seat_votes(
        forecast=forecast,
        climo=climo,
        p=p,
        climo_p=climo_p,
        implied=implied,
        skip=skip,
        city=city,
    )
    if skip:
        conf = min(22, max(4, int(round(12 + 8 * (p or 0)))))
    else:
        edge = (p or 0.5) - (implied or 0.5)
        climo_align = 0.0
        if climo_p is not None and p is not None:
            climo_align = 1.0 - min(1.0, abs(climo_p - p))
        yes_w = 0.0
        no_w = 0.0
        for v in votes:
            w = float(v.get("weight") or 0)
            if v["id"] == "SKIP":
                continue
            if v.get("dir") == "YES":
                yes_w += w
            elif v.get("dir") == "NO":
                no_w += w
        vote_edge = (yes_w - no_w) / max(1.0, yes_w + no_w)
        conf = int(round(50 + 24 * ((p or 0.5) - 0.5) + 16 * edge + 4 * climo_align + 8 * vote_edge))
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
        "fee_cents": fee,
        "confidence": conf,
        "dont_play": bool(skip),
        "skip": skip,
        "votes": votes,
        "honesty": {
            "ev_cents": ev,
            "sample_n": int(vol),
            "dont_play": skip or "",
        },
        "best": False,
        "follower": False,
    }


def pick_city_bet(scored: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not scored:
        return None
    playable = [b for b in scored if not b.get("dont_play")]
    pool = playable or scored
    pool.sort(key=lambda b: (-int(b.get("confidence") or 0), -(b.get("ev_cents") or -99)))
    return pool[0]


async def build_board(
    fetch: Optional[_Fetch] = None,
    nws: Optional[_Nws] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    if fetch is None and nws is None and now is None:
        cached = _board_cache.get("payload")
        if cached and (time.time() - float(_board_cache.get("at") or 0)) < BOARD_TTL_S:
            out = dict(cached)
            out["status"] = arm_status()
            return out

    n = now or datetime.now(timezone.utc)
    cards: List[Dict[str, Any]] = []
    dropped: List[str] = []

    for city in CITIES:
        rows, missing = await fetch_series(str(city["series"]), fetch)
        if missing or not rows:
            dropped.append(str(city["series"]))
            continue
        day = pick_event_day(rows, n, str(city["tz"]))
        if day is None:
            dropped.append(str(city["series"]))
            continue
        today = [m for m in rows if date_from_ticker(m.get("ticker")) == day]
        if not today:
            continue
        if not city["required"] and not city_is_liquid(today):
            continue
        forecast = await nws_high(str(city["station"]), day, nws)
        flipped = note_forecast(str(city["station"]), day, forecast)
        scored = [score_bet(m, city=city, forecast=forecast, flipped=flipped, day=day) for m in today]
        bet = pick_city_bet(scored)
        if bet:
            cards.append(bet)

    cards.sort(key=lambda b: (-int(b.get("confidence") or 0), -(b.get("ev_cents") or -99)))
    best = next((c for c in cards if not c.get("dont_play")), None)
    if best is None and cards:
        best = cards[0]
    if best:
        best["best"] = True

    payload = {
        "ok": True,
        "mode": "paper",
        "title": "THE FRONT",
        "seats": [{"id": s["id"], "job": s["job"], "mark": s["mark"], "weight": s["weight"]} for s in SEATS],
        "cards": cards,
        "best": None if best is None else best.get("ticker"),
        "dropped": dropped,
        "fills": list(reversed(_load_fills()[-12:])),
        "status": arm_status(),
        "product": "Satoshi’s Council",
        "follower": False,
        "auto_bets": False,
        "note": "Daily highs. NWS CLI station. Date is in the ticker. Not the crypto Floor.",
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
