"""
Side Table arcade: 15m up/down + hot strip. Manual taps only.

Paper by default. Never auto-bets. Never talks to Follower.
Does not place Chair 1H locks. Does not import follower_gate.
Live tickers come from Kalshi public markets — no stale contract codes.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from zoneinfo import ZoneInfo

from backend.agents.chair_gates import kalshi_taker_fee_cents, odds_to_cents, parse_book_depth
from backend.config import settings
from backend.services.desk_pack import book_flags

CT = ZoneInfo("America/Chicago")
CHAIR_1H_SERIES = ("KXBTCD", "KXETHD")
ARCADE_ASSETS = ("BTC", "ETH")
EXTRA_15M = ("SOL", "XRP")
LIQUID_MIN_VOL = 8000.0
LIQUID_MAX_SPREAD = 3.0
JUNK_SPREAD = 6.0
BOARD_TTL_S = 6.0
HOT_HOURS = 36.0

_Fetch = Callable[[str, Dict[str, Any]], Any]

_board_cache: Dict[str, Any] = {"at": 0.0, "payload": None}
_arm: Dict[str, Any] = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
_fills: List[Dict[str, Any]] = []
_fills_loaded = False
_data_override: Optional[Path] = None


def reset_for_tests(data_dir: Optional[Path] = None) -> None:
    """Clear in-memory Side Table state. Tests only."""
    global _fills, _fills_loaded, _board_cache, _arm, _data_override
    _fills = []
    _fills_loaded = True
    _board_cache = {"at": 0.0, "payload": None}
    _arm = {"phrase_ok": False, "armed_at": 0.0, "kill": False}
    _data_override = data_dir


def _data_path() -> Path:
    root = _data_override or Path(getattr(settings, "DATA_DIR", None) or "./data")
    root.mkdir(parents=True, exist_ok=True)
    return root / "side_table.json"


def _load_fills() -> List[Dict[str, Any]]:
    global _fills, _fills_loaded
    if _fills_loaded:
        return _fills
    path = _data_path()
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
    path = _data_path()
    path.write_text(json.dumps({"fills": _fills[-400:]}, indent=2), encoding="utf-8")


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return bool(default)


def live_allowed() -> bool:
    if _env_bool("SIDE_TABLE_KILL", bool(getattr(settings, "SIDE_TABLE_KILL", False))):
        return False
    if _arm.get("kill"):
        return False
    return _env_bool("SIDE_TABLE_LIVE", bool(getattr(settings, "SIDE_TABLE_LIVE", False)))


def is_killed() -> bool:
    return bool(_arm.get("kill")) or _env_bool(
        "SIDE_TABLE_KILL", bool(getattr(settings, "SIDE_TABLE_KILL", False))
    )


def is_armed(now: Optional[float] = None) -> bool:
    if not live_allowed() or not _arm.get("phrase_ok"):
        return False
    t = float(now if now is not None else time.time())
    armed_at = float(_arm.get("armed_at") or 0)
    return armed_at > 0 and t >= armed_at


def kill_live() -> Dict[str, Any]:
    _arm["kill"] = True
    _arm["phrase_ok"] = False
    _arm["armed_at"] = 0.0
    return arm_status()


def arm_live(phrase: str, now: Optional[float] = None) -> Dict[str, Any]:
    want = str(getattr(settings, "SIDE_TABLE_ARM_PHRASE", "LIVE SIDE TABLE") or "LIVE SIDE TABLE")
    got = " ".join(str(phrase or "").upper().split())
    if got != want:
        return {**arm_status(), "ok": False, "error": "typed confirm failed"}
    if is_killed() or not live_allowed():
        return {**arm_status(), "ok": False, "error": "live killed"}
    delay = float(getattr(settings, "SIDE_TABLE_ARM_DELAY_S", 8.0) or 8.0)
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
        "phrase": str(getattr(settings, "SIDE_TABLE_ARM_PHRASE", "LIVE SIDE TABLE")),
        "max_stake": float(getattr(settings, "SIDE_TABLE_MAX_STAKE", 25.0)),
        "hourly_loss_cap": float(getattr(settings, "SIDE_TABLE_HOURLY_LOSS_CAP", 75.0)),
        "cutoff_sec": float(getattr(settings, "SIDE_TABLE_CUTOFF_SEC", 60.0)),
        "follower": False,
        "auto_bets": False,
    }


def series_for(asset: str, minutes: int) -> str:
    return f"KX{str(asset).upper()}{int(minutes)}M"


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


def _secs_left(close_time: Any, now: Optional[datetime] = None) -> Optional[float]:
    close = _parse_iso(close_time)
    if close is None:
        return None
    n = now or datetime.now(timezone.utc)
    return (close - n).total_seconds()


def _dollars_to_cents(raw: Any) -> Optional[float]:
    v = odds_to_cents(raw)
    return v


def market_quotes(m: Dict[str, Any]) -> Dict[str, Optional[float]]:
    yb = _dollars_to_cents(m.get("yes_bid_dollars") if m.get("yes_bid_dollars") is not None else m.get("yes_bid"))
    ya = _dollars_to_cents(m.get("yes_ask_dollars") if m.get("yes_ask_dollars") is not None else m.get("yes_ask"))
    nb = _dollars_to_cents(m.get("no_bid_dollars") if m.get("no_bid_dollars") is not None else m.get("no_bid"))
    na = _dollars_to_cents(m.get("no_ask_dollars") if m.get("no_ask_dollars") is not None else m.get("no_ask"))
    if nb is None and ya is not None:
        nb = max(0.0, 100.0 - ya)
    if na is None and yb is not None:
        na = max(0.0, 100.0 - yb)
    return {"yes_bid": yb, "yes_ask": ya, "no_bid": nb, "no_ask": na}


def book_health(m: Dict[str, Any], orderbook: Any = None) -> Dict[str, Any]:
    q = market_quotes(m)
    if orderbook:
        depth = parse_book_depth(orderbook)
    else:
        ysz = _f(m.get("yes_bid_size_fp") if m.get("yes_bid_size_fp") is not None else m.get("yes_bid_size"))
        nsz = _f(
            m.get("no_bid_size_fp")
            if m.get("no_bid_size_fp") is not None
            else (m.get("no_bid_size") if m.get("no_bid_size") is not None else m.get("yes_ask_size_fp"))
        )
        have_quotes = q["yes_bid"] is not None or q["yes_ask"] is not None
        # Missing size ≠ empty. Only treat as empty when sizes are 0 or quotes are gone.
        depth = {
            "yes_bid_px": q["yes_bid"],
            "no_bid_px": q["no_bid"],
            "yes_depth": ysz if ysz is not None else (1.0 if have_quotes else 0.0),
            "no_depth": nsz if nsz is not None else (1.0 if have_quotes else 0.0),
            "has_size": bool(have_quotes or (ysz and ysz > 0) or (nsz and nsz > 0)),
            "yes_bid_sz": ysz,
            "no_bid_sz": nsz,
        }
    flags = book_flags(depth, yes_bid=q["yes_bid"], yes_ask=q["yes_ask"], no_bid=q["no_bid"], no_ask=q["no_ask"])
    spread = flags.get("spread")
    if spread is None and q["yes_bid"] is not None and q["yes_ask"] is not None:
        spread = round(abs(q["yes_ask"] - q["yes_bid"]), 1)
        flags["spread"] = spread
    junk = spread is not None and spread >= JUNK_SPREAD
    if junk and not flags.get("flag"):
        flags["flag"] = "junk spread"
    flags["dont_play"] = bool(flags.get("sick") or flags.get("empty") or flags.get("wall_99") or junk)
    flags["volume"] = _f(m.get("volume_fp") or m.get("volume"))
    flags["open_interest"] = _f(m.get("open_interest_fp") or m.get("open_interest"))
    return flags


def is_liquid(m: Dict[str, Any], flags: Dict[str, Any] | None = None) -> bool:
    flags = flags or book_health(m)
    vol = float(flags.get("volume") or 0.0)
    spread = flags.get("spread")
    if flags.get("dont_play"):
        return False
    if vol < LIQUID_MIN_VOL:
        return False
    if spread is not None and spread > LIQUID_MAX_SPREAD:
        return False
    return True


def is_chair_1h_series(series: str) -> bool:
    s = str(series or "").upper()
    return s in CHAIR_1H_SERIES or s.startswith("KXBTCD") or s.startswith("KXETHD")


async def _default_fetch(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    import httpx

    base = str(getattr(settings, "KALSHI_BASE", "https://external-api.kalshi.com/trade-api/v2")).rstrip("/")
    url = base + path
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) else {}


async def fetch_markets(
    series: str,
    status: str = "open",
    limit: int = 8,
    fetch: Optional[_Fetch] = None,
) -> List[Dict[str, Any]]:
    fn = fetch or _default_fetch
    try:
        data = await fn("/markets", {"series_ticker": series, "status": status, "limit": limit})
    except Exception:
        return []
    rows = (data or {}).get("markets") if isinstance(data, dict) else None
    return [m for m in (rows or []) if isinstance(m, dict)]


async def fetch_hot_markets(fetch: Optional[_Fetch] = None, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    fn = fetch or _default_fetch
    n = now or datetime.now(timezone.utc)
    params = {
        "status": "open",
        "limit": 80,
        "min_close_ts": int(n.timestamp()),
        "max_close_ts": int((n + timedelta(hours=HOT_HOURS)).timestamp()),
    }
    try:
        data = await fn("/markets", params)
    except Exception:
        return []
    rows = (data or {}).get("markets") if isinstance(data, dict) else None
    out = []
    for m in rows or []:
        if not isinstance(m, dict):
            continue
        series = str(m.get("series_ticker") or "").upper()
        ticker = str(m.get("ticker") or "")
        if is_chair_1h_series(series) or ticker.startswith("KXBTCD-") or ticker.startswith("KXETHD-"):
            continue
        if "15M" in ticker and any(ticker.startswith(f"KX{a}15M") for a in ARCADE_ASSETS):
            continue
        flags = book_health(m)
        if flags.get("dont_play") or not is_liquid(m, flags):
            continue
        out.append((float(flags.get("volume") or 0.0), m, flags))
    out.sort(key=lambda x: -x[0])
    return [x[1] for x in out[:8]]


def last_tape_from_settled(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tape = []
    for m in rows[:8]:
        res = str(m.get("result") or "").lower()
        if res not in ("yes", "no"):
            continue
        tape.append({
            "ticker": m.get("ticker"),
            "result": "HIT" if res == "yes" else "MISS",
            "side": "YES" if res == "yes" else "NO",
            "close_time": m.get("close_time"),
        })
    return tape


def why_line(flags: Dict[str, Any], secs_left: Optional[float], cutoff: float) -> Optional[str]:
    if flags.get("empty"):
        return "Don’t play · empty book"
    if flags.get("sick"):
        return "Don’t play · sick book"
    if flags.get("wall_99"):
        return "Don’t play · ≥99¢ wall"
    if flags.get("spread") is not None and flags["spread"] >= JUNK_SPREAD:
        return "Don’t play · junk spread"
    if secs_left is not None and secs_left <= cutoff:
        return "Don’t play · last-minute cutoff"
    return None


def card_from_market(
    m: Dict[str, Any],
    *,
    asset: str,
    minutes: int,
    tape: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    q = market_quotes(m)
    flags = book_health(m)
    secs = _secs_left(m.get("close_time"), now)
    cutoff = float(getattr(settings, "SIDE_TABLE_CUTOFF_SEC", 60.0))
    why = why_line(flags, secs, cutoff)
    return {
        "asset": asset.upper(),
        "minutes": minutes,
        "series": series_for(asset, minutes),
        "ticker": m.get("ticker"),
        "title": m.get("title") or f"{asset.upper()} {minutes}m",
        "strike": m.get("floor_strike") or m.get("cap_strike"),
        "yes_bid": q["yes_bid"],
        "yes_ask": q["yes_ask"],
        "no_bid": q["no_bid"],
        "no_ask": q["no_ask"],
        "spread": flags.get("spread"),
        "volume": flags.get("volume"),
        "close_time": m.get("close_time"),
        "secs_left": secs,
        "dont_play": bool(flags.get("dont_play") or (why and why.startswith("Don’t play"))),
        "flag": flags.get("flag") or ("Don’t play" if why else None),
        "why": why,
        "tape": tape,
        "next_arms": True,
    }


def paper_quote(side: str, yes_bid: Any, yes_ask: Any) -> Dict[str, Any]:
    """Fill at the real ask plus vig / half-spread. Paper only."""
    side_u = "YES" if str(side or "").upper() in ("YES", "UP") else "NO"
    yb = odds_to_cents(yes_bid)
    ya = odds_to_cents(yes_ask)
    if side_u == "YES":
        ask = ya
        bid = yb
    else:
        ask = (100.0 - yb) if yb is not None else None
        bid = (100.0 - ya) if ya is not None else None
    if ask is None:
        return {"ok": False, "error": "no ask"}
    spread = None
    if ask is not None and bid is not None:
        spread = abs(ask - bid)
    fee = kalshi_taker_fee_cents(ask)
    half = (spread or 0.0) / 2.0
    fill = float(ask) + float(fee) + float(half)
    return {
        "ok": True,
        "side": side_u,
        "ask": ask,
        "bid": bid,
        "spread": spread,
        "fee_cents": round(fee, 3),
        "half_spread": round(half, 3),
        "fill_cents": round(fill, 3),
    }


def hourly_loss(now: Optional[datetime] = None) -> float:
    n = now or datetime.now(timezone.utc)
    local = n.astimezone(CT)
    start = local.replace(minute=0, second=0, microsecond=0)
    loss = 0.0
    for row in _load_fills():
        ts = _parse_iso(row.get("at"))
        if ts is None:
            continue
        if ts.astimezone(CT) < start:
            continue
        pnl = _f(row.get("pnl"))
        if pnl is not None and pnl < 0:
            loss += abs(pnl)
    return loss


def clamp_stake(raw: Any) -> float:
    cap = float(getattr(settings, "SIDE_TABLE_MAX_STAKE", 25.0) or 25.0)
    try:
        stake = float(raw)
    except (TypeError, ValueError):
        stake = cap
    return max(1.0, min(cap, stake))


def apply_settle(row: Dict[str, Any], result: str) -> Dict[str, Any]:
    res = str(result or "").lower()
    side = str(row.get("side") or "").upper()
    won = (res == "yes" and side == "YES") or (res == "no" and side == "NO")
    stake = float(row.get("stake") or 0)
    fill = float(row.get("fill_cents") or 50)
    if won:
        contracts = stake / max(0.01, fill / 100.0)
        pnl = round(contracts * (1.0 - fill / 100.0), 2)
    else:
        pnl = round(-stake, 2)
    row["result"] = "HIT" if won else "MISS"
    row["pnl"] = pnl
    row["settled"] = True
    return row


async def grade_open_fills(fetch: Optional[_Fetch] = None) -> int:
    changed = 0
    by_ticker: Dict[str, List[Dict[str, Any]]] = {}
    for row in _load_fills():
        if row.get("settled"):
            continue
        tick = str(row.get("ticker") or "")
        if tick:
            by_ticker.setdefault(tick, []).append(row)
    if not by_ticker:
        return 0
    fn = fetch or _default_fetch
    for tick, rows in by_ticker.items():
        try:
            data = await fn("/markets/" + tick, {})
        except Exception:
            continue
        m = data.get("market") if isinstance(data, dict) and isinstance(data.get("market"), dict) else data
        if not isinstance(m, dict):
            continue
        res = str(m.get("result") or "").lower()
        if res not in ("yes", "no"):
            continue
        for row in rows:
            apply_settle(row, res)
            changed += 1
    if changed:
        _save_fills()
    return changed


async def build_board(fetch: Optional[_Fetch] = None, now: Optional[datetime] = None) -> Dict[str, Any]:
    if fetch is None and now is None:
        cached = _board_cache.get("payload")
        if cached and (time.time() - float(_board_cache.get("at") or 0)) < BOARD_TTL_S:
            out = dict(cached)
            out["status"] = arm_status()
            return out

    n = now or datetime.now(timezone.utc)
    arcade: List[Dict[str, Any]] = []
    pills_5m: List[str] = []

    for asset in ARCADE_ASSETS:
        series = series_for(asset, 15)
        open_m = await fetch_markets(series, "open", 4, fetch)
        settled = await fetch_markets(series, "settled", 8, fetch)
        tape = last_tape_from_settled(settled)
        if open_m:
            arcade.append(card_from_market(open_m[0], asset=asset, minutes=15, tape=tape, now=n))
        five = await fetch_markets(series_for(asset, 5), "open", 1, fetch)
        if five:
            pills_5m.append(asset)

    extras: List[Dict[str, Any]] = []
    for asset in EXTRA_15M:
        series = series_for(asset, 15)
        open_m = await fetch_markets(series, "open", 2, fetch)
        if not open_m:
            continue
        flags = book_health(open_m[0])
        if not is_liquid(open_m[0], flags):
            continue
        settled = await fetch_markets(series, "settled", 6, fetch)
        extras.append(card_from_market(open_m[0], asset=asset, minutes=15, tape=last_tape_from_settled(settled), now=n))

    hot_raw = await fetch_hot_markets(fetch, n)
    hot = []
    for m in hot_raw:
        q = market_quotes(m)
        flags = book_health(m)
        secs = _secs_left(m.get("close_time"), n)
        hot.append({
            "ticker": m.get("ticker"),
            "series": m.get("series_ticker"),
            "title": m.get("title") or m.get("yes_sub_title") or m.get("ticker"),
            "yes_bid": q["yes_bid"],
            "yes_ask": q["yes_ask"],
            "no_bid": q["no_bid"],
            "no_ask": q["no_ask"],
            "volume": flags.get("volume"),
            "secs_left": secs,
            "close_time": m.get("close_time"),
            "dont_play": flags.get("dont_play"),
            "flag": flags.get("flag"),
            "why": why_line(flags, secs, float(getattr(settings, "SIDE_TABLE_CUTOFF_SEC", 60.0))),
        })

    await grade_open_fills(fetch)
    payload = {
        "ok": True,
        "mode": "paper",
        "arcade": arcade,
        "extras": extras,
        "pills_5m": pills_5m,
        "hot": hot,
        "fills": list(reversed(_load_fills()[-12:])),
        "status": arm_status(),
        "product": "Satoshi’s Council",
        "follower": False,
    }
    _board_cache["at"] = time.time()
    _board_cache["payload"] = payload
    return payload


async def tap(
    *,
    ticker: str,
    side: str,
    stake: Any,
    live: bool = False,
    yes_bid: Any = None,
    yes_ask: Any = None,
    secs_left: Any = None,
    sick: bool = False,
    fetch: Optional[_Fetch] = None,
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
    cutoff = float(getattr(settings, "SIDE_TABLE_CUTOFF_SEC", 60.0))
    try:
        left = float(secs_left) if secs_left is not None else None
    except (TypeError, ValueError):
        left = None
    if left is not None and left <= cutoff:
        return {"ok": False, "error": "Don’t play · last-minute cutoff", "dont_play": True}

    q = paper_quote(side, yes_bid, yes_ask)
    if not q.get("ok"):
        if fetch:
            try:
                data = await fetch("/markets/" + tick, {})
                m = data.get("market") if isinstance(data, dict) else data
                if isinstance(m, dict):
                    quotes = market_quotes(m)
                    q = paper_quote(side, quotes.get("yes_bid"), quotes.get("yes_ask"))
            except Exception:
                pass
        if not q.get("ok"):
            return {"ok": False, "error": q.get("error") or "no quote"}

    dollars = clamp_stake(stake)
    cap = float(getattr(settings, "SIDE_TABLE_HOURLY_LOSS_CAP", 75.0))
    if hourly_loss(now) + dollars > cap + 1e-6:
        return {"ok": False, "error": "hourly loss cap", "dont_play": True}

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
        "spread": q.get("spread"),
        "live": bool(want_live and is_armed()),
        "paper": not (want_live and is_armed()),
        "at": (now or datetime.now(timezone.utc)).isoformat(),
        "settled": False,
        "result": "OPEN",
        "pnl": None,
        "follower": False,
    }
    _load_fills().append(row)
    _save_fills()
    return {"ok": True, "fill": row, "status": arm_status(), "live": bool(row["live"])}
