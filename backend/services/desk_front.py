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

SEATS: Tuple[Dict[str, Any], ...] = (
    {"id": "GLASS", "job": "Official/NWS high for the station.", "mark": "/static/bots/glass.png", "weight": 1.0},
    {"id": "PIT", "job": "Kalshi implied vs that number, after vig.", "mark": "/static/bots/pit.png", "weight": 1.0},
    {"id": "FROST", "job": "Veto junk book / flip / SICK / thin n.", "mark": "/static/bots/frost.png", "weight": 1.0},
    {"id": "BONE", "job": "Seasonal base. Low weight.", "mark": "/static/bots/bone.png", "weight": 0.25},
)
CHAIR: Dict[str, str] = {
    "id": "RAIJIN",
    "job": "Weather chair. Hits count like Satoshi / Vitalik. Does not lock the 1H Chair.",
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


def parse_cli_high(text: Any, *, station: str = "KDFW", day: Optional[date] = None) -> Optional[float]:
    """Read MAXIMUM TEMPERATURE from an NWS CLI product. Never a forecast."""
    blob = str(text or "")
    if not blob.strip():
        return None
    up = blob.upper()
    if not any(tag in up for tag in ("DFW", "DALLAS", "FORT WORTH", "FT WORTH")):
        return None
    if day is not None:
        month = day.strftime("%B").upper()
        if month not in up or str(day.year) not in up:
            return None
        if not re.search(rf"{month}\s+0?{day.day}\b", up):
            return None
    m = re.search(r"MAXIMUM\s+TEMPERATURE[^\n]*\n\s*(\d{2,3})\b", blob, re.I)
    if not m:
        m = re.search(r"MAXIMUM\s+(\d{2,3})\b", blob, re.I)
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
) -> List[Dict[str, Any]]:
    p = forecast_p(forecast, m)
    q = market_quotes(m)
    implied = None if q.get("yes_ask") is None else q["yes_ask"] / 100.0
    climo_p = forecast_p(float(climo), m) if climo is not None else None
    glass = "WAIT" if p is None else ("YES" if p >= 0.5 else "NO")
    pit = "WAIT"
    if implied is not None and p is not None:
        pit = "YES" if p >= implied else "NO"
    elif implied is not None:
        pit = "YES" if implied < 0.5 else "NO"
    frost = "SKIP" if skip else "CLEAR"
    bone = "WAIT" if climo_p is None else ("YES" if climo_p >= 0.5 else "NO")
    return [
        {"id": "GLASS", "dir": glass, "call": None if forecast is None else f"{forecast:.0f}°F KDFW"},
        {"id": "PIT", "dir": pit, "call": None if implied is None else f"{int(round(implied * 100))}¢ after vig"},
        {"id": "FROST", "dir": frost, "call": skip or "clear"},
        {"id": "BONE", "dir": bone, "call": None if climo is None else f"{climo}°F season"},
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
    }


def seat_records() -> List[Dict[str, Any]]:
    tallies = {s["id"]: {"correct": 0, "wrong": 0} for s in SEATS}
    for row in _load_fills():
        if str(row.get("result") or "").upper() not in ("HIT", "MISS"):
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
    for r in ranked:
        r["rank"] = rank_of[r["id"]]
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
            "side": row.get("side"),
            "result": str(row.get("result") or "OPEN").upper(),
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
    hit = (side == "YES" and yes) or (side == "NO" and not yes)
    row["settled"] = True
    row["result"] = "HIT" if hit else "MISS"
    row["cli_high"] = float(high)
    row["settle_source"] = "nws_cli"
    row["settle_reason"] = "cli_match" if hit else "cli_miss"
    row["pnl"] = paper_pnl(row, hit)
    row["votes"] = grade_seat_votes(row, hit, yes)
    return True


async def fetch_cli_high(day: date, nws: Optional[_Nws] = None) -> Optional[float]:
    """Official KDFW CLI max for that ticker date. None until the next-morning print."""
    key = day.isoformat()
    if key in _cli_cache:
        return _cli_cache[key]
    fn = nws or _nws_get
    high: Optional[float] = None
    try:
        listing = await fn("https://api.weather.gov/products/types/CLI/locations/FWD")
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
            high = parse_cli_high(text, station="KDFW", day=day)
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
        high = None
        if cli_highs and day.isoformat() in cli_highs:
            high = cli_highs[day.isoformat()]
        else:
            high = await fetch_cli_high(day, nws)
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
        "votes": vote_seats(m, forecast=forecast, climo=climo, skip=skip),
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
    recs = {r["id"]: r for r in seat_records()}
    climo = (DALLAS.get("climo") or {}).get(day.month) if day else None
    glass_call = None if forecast is None else f"{forecast:.0f}°F KDFW"
    pit_call = None
    frost_call = "clear"
    bone_call = None if climo is None else f"{climo}°F season"
    if best:
        if best.get("yes_ask") is not None:
            pit_call = f"{int(round(best['yes_ask']))}¢ {best.get('bracket') or ''}".strip()
        frost_call = best.get("skip") or "clear"
        votes = {v["id"]: v for v in (best.get("votes") or []) if isinstance(v, dict)}
        if votes.get("GLASS", {}).get("call"):
            glass_call = votes["GLASS"]["call"]
        if votes.get("PIT", {}).get("call"):
            pit_call = votes["PIT"]["call"]
        if votes.get("FROST", {}).get("call"):
            frost_call = votes["FROST"]["call"]
        if votes.get("BONE", {}).get("call"):
            bone_call = votes["BONE"]["call"]
    rows = []
    calls = {"GLASS": glass_call, "PIT": pit_call, "FROST": frost_call, "BONE": bone_call}
    for seat in SEATS:
        rec = recs.get(seat["id"]) or {"n": 0, "wr": None, "rank": 0, "correct": 0, "wrong": 0}
        rows.append({
            "id": seat["id"],
            "job": seat["job"],
            "mark": seat["mark"],
            "call": calls.get(seat["id"]),
            "n": rec.get("n") or 0,
            "wr": rec.get("wr"),
            "rank": rec.get("rank") or 0,
            "correct": rec.get("correct") or 0,
            "wrong": rec.get("wrong") or 0,
            "letter": None,
        })
    return rows


def build_chair(best: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    acc = chair_accuracy()
    rec = seat_record(acc["total"], None if not acc["total"] else acc["correct"] / acc["total"])
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
    cli_highs: Optional[Dict[str, float]] = None,
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
            return out

    n = now or datetime.now(timezone.utc)
    await settle_open_fills(cli_highs=cli_highs, nws=nws)
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
        "accuracy": chair_accuracy(),
        "tape": lock_tape(),
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
    cached = _bracket_from_cache(tick) or {}
    snap_votes = votes if isinstance(votes, list) else cached.get("votes")
    if not isinstance(snap_votes, list):
        snap_votes = []
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
        "city": "DAL",
        "station": "KDFW",
        "day": None if day is None else day.isoformat(),
        "bracket": bracket or cached.get("bracket"),
        "best": bool(best or cached.get("best")),
        "strike_type": strike_type or cached.get("strike_type") or "between",
        "floor_strike": floor_strike if floor_strike is not None else cached.get("floor_strike"),
        "cap_strike": cap_strike if cap_strike is not None else cached.get("cap_strike"),
        "votes": [dict(v) for v in snap_votes if isinstance(v, dict)],
        "settle_reason": "pending_cli",
    }
    _load_fills().append(row)
    _save_fills()
    return {"ok": True, "fill": row, "status": arm_status(), "live": bool(row["live"])}
