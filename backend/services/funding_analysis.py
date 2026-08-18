"""
Funding rate analysis — crowding as a risk input, not a forecast.

Funding tells you what the crowd is paying to hold a position. Extreme
funding means the trade is crowded, which raises reversal risk; it rarely
justifies a directional call on its own. So this module is biased toward
caution: it mostly produces WAIT and REDUCE, and it feeds RAIJIN.

State ladder, on absolute 8h funding in percent:

    Normal    < 0.03      no opinion
    Elevated  0.03-0.08   crowded, trim conviction
    Extreme   >= 0.08     veto-grade crowding

Positive funding = longs paying shorts = crowded longs. That is a reason to
REDUCE or WAIT, never a reason to buy. The mirror holds for negative funding,
but the bias stays conservative: crowded shorts raise squeeze risk, which
argues for WAIT rather than a BUY ZONE.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.round_table import BUY_ZONE, REDUCE, WAIT

# Thresholds on |funding| as a percent per 8h window. Blunt on purpose.
ELEVATED_PCT = 0.03
EXTREME_PCT = 0.08
# Trend needs a real move, not float noise.
TREND_EPS_PCT = 0.005
# OI confirmation: crowding that is still building is worse than crowding
# that is already unwinding.
OI_BUILD_PCT = 3.0

NORMAL = "Normal"
ELEVATED = "Elevated"
EXTREME = "Extreme"

RISING = "rising"
FALLING = "falling"
FLAT = "flat"

# ── Persistence ───────────────────────────────────────────────────────
# One extreme print is a number; extreme funding that will not go away is a
# crowd that cannot get out. Counted in consecutive samples at Elevated or
# worse, so it survives a single normalising tick.
LOW = "low"
MEDIUM = "medium"
HIGH = "high"
PERSIST_MEDIUM = 3
PERSIST_HIGH = 8
PERSIST_MAX = 60

_persist: Dict[str, int] = {}
_persist_keys: Dict[str, Any] = {}


def reset_persistence() -> None:
    """Tests only."""
    _persist.clear()
    _persist_keys.clear()


def persistence_label(bars: int) -> str:
    if bars >= PERSIST_HIGH:
        return HIGH
    if bars >= PERSIST_MEDIUM:
        return MEDIUM
    return LOW


def _track_persistence(asset: str, state: str, raw_state: str, key: Any) -> int:
    """
    Consecutive samples at Elevated or worse. One sample per snapshot.

    Counting up follows the SMOOTHED state, so persistence and the state
    that drives decisions never disagree. Resetting follows the RAW print,
    because the funding filter is deliberately slow — a crowd that has
    actually paid its way out shows in the raw rate perhaps forty samples
    before the smoothed value crosses back, and calling that "persisting"
    would be reporting a filter artifact as a market condition.
    """
    if key is not None and _persist_keys.get(asset) == key:
        return _persist.get(asset, 0)
    if key is not None:
        _persist_keys[asset] = key
    if raw_state == NORMAL:
        _persist[asset] = 0
    elif state in (ELEVATED, EXTREME):
        _persist[asset] = min(PERSIST_MAX, _persist.get(asset, 0) + 1)
    else:
        _persist[asset] = 0
    return _persist[asset]
# backend.services.rolling reports up/down/flat; this module says rising/falling.
_ROLL_TO_TREND = {"up": RISING, "down": FALLING, "flat": FLAT}


def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if val == val else None


def _pick(src: Dict[str, Any], *keys: str) -> Optional[float]:
    for k in keys:
        val = _f(src.get(k))
        if val is not None:
            return val
    return None


def funding_state(rate_pct: Optional[float]) -> str:
    """Normal / Elevated / Extreme from the absolute rate."""
    if rate_pct is None:
        return NORMAL
    mag = abs(rate_pct)
    if mag >= EXTREME_PCT:
        return EXTREME
    if mag >= ELEVATED_PCT:
        return ELEVATED
    return NORMAL


def funding_trend(history: Optional[List[Any]], current: Optional[float] = None) -> str:
    """rising / falling / flat from recent prints. Flat when unknown."""
    vals: List[float] = []
    for row in history or []:
        if isinstance(row, dict):
            val = _pick(row, "funding_rate", "rate", "value", "c")
        else:
            val = _f(row)
        if val is not None:
            vals.append(val)
    if current is not None:
        vals.append(current)
    if len(vals) < 2:
        return FLAT
    # Compare the newest print against the mean of the prior few.
    recent = vals[-1]
    prior = vals[-4:-1] or vals[:-1]
    base = sum(prior) / len(prior)
    delta = recent - base
    if abs(delta) < TREND_EPS_PCT:
        return FLAT
    return RISING if delta > 0 else FALLING


def read_funding(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize whatever the feed gave us into one funding picture.

    Everything degrades to None / Normal when the data is absent, so a dark
    CoinGlass feed simply produces no funding opinion.
    """
    table = table if isinstance(table, dict) else {}
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}

    raw_rate = _pick(cg, "funding_rate", "funding")
    if raw_rate is None:
        raw_rate = _pick(market, "funding_rate")
    history = cg.get("funding_history") if isinstance(cg.get("funding_history"), list) else None
    oi_delta = _pick(cg, "oi_delta_1h", "oi_change_1h", "oi_delta")

    # Spike guard + Kalman. A single bad funding print must not trip an
    # extreme-funding veto, so state and trend read the smoothed value.
    # The raw print stays on the payload for comparison.
    rate = raw_rate
    smoothed = None
    filt = None
    if raw_rate is not None:
        try:
            from backend.services.filters import series_for

            asset = str(table.get("asset") or "btc").lower()
            filt = series_for(asset, "funding")
            # One sample per feed snapshot, not per reader.
            snap_key = (cg.get("t") or table.get("timestamp")
                        or market.get("close_time") or ("v", raw_rate))
            smoothed = filt.update(raw_rate, key=snap_key)
            if smoothed is not None:
                rate = smoothed
        except Exception:
            rate = raw_rate

    state = funding_state(rate)
    if filt is not None and filt.ready(3):
        trend = _ROLL_TO_TREND.get(filt.trend(TREND_EPS_PCT), FLAT)
    else:
        trend = funding_trend(history, rate)
    crowded = None
    if rate is not None and state != NORMAL:
        crowded = "longs" if rate > 0 else "shorts"

    snap = cg.get("t") or table.get("timestamp") or market.get("close_time")
    asset = str(table.get("asset") or "btc").lower()
    persist_bars = _track_persistence(
        asset, state, funding_state(raw_rate),
        snap if snap is not None else ("v", raw_rate),
    )
    persistence = persistence_label(persist_bars)

    return {
        "rate_pct": rate,
        "raw_rate_pct": raw_rate,
        "smoothed": smoothed is not None,
        "filter": filt.debug() if filt is not None else None,
        "state": state,
        "trend": trend,
        "crowded": crowded,
        "persistence": persistence,
        "persist_bars": persist_bars,
        # Funding is a carrying cost, not a forecast: this is roughly what a
        # position pays per day at the current rate (3 windows of 8h).
        "daily_cost_pct": round(rate * 3.0, 4) if rate is not None else None,
        "oi_delta_pct": oi_delta,
        "oi_building": bool(oi_delta is not None and oi_delta >= OI_BUILD_PCT),
        "available": rate is not None,
        "elevated_at": ELEVATED_PCT,
        "extreme_at": EXTREME_PCT,
    }


def funding_signal(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    RAIJIN's funding read: direction bias, confidence, one short reason.

    Direction uses the closed decision language. Funding almost never says
    BUY ZONE — it says WAIT or REDUCE.
    """
    read = read_funding(table)
    rate = read["rate_pct"]

    if not read["available"]:
        return {
            **read,
            "direction": WAIT,
            "confidence": 0,
            "reason": "No funding print — crowding unreadable.",
            "veto": False,
            "caution": False,
        }

    pct = f"{rate:+.3f}%"
    state = read["state"]
    building = read["oi_building"]

    if state == NORMAL:
        return {
            **read,
            "direction": WAIT,
            "confidence": 10,
            "reason": f"Funding normal ({pct}) — no crowding signal.",
            "veto": False,
            "caution": False,
        }

    if state == ELEVATED:
        if rate > 0:
            reason = f"Funding elevated ({pct}) — longs paying, crowd building."
            direction = REDUCE
        else:
            reason = f"Funding elevated ({pct}) — shorts paying, squeeze risk."
            direction = WAIT
        conf = 55 if not building else 65
        persist = read.get("persistence")
        if persist == HIGH:
            conf = min(75, conf + 10)
            reason = reason.rstrip(".") + f", persisting {read['persist_bars']} intervals."
        if building:
            reason += " OI still building."
        return {
            **read, "direction": direction, "confidence": conf, "reason": reason,
            "veto": False, "caution": persist == HIGH,
        }

    # Extreme — veto-grade.
    if rate > 0:
        reason = f"Funding extremely positive ({pct}) — crowded longs."
        direction = REDUCE
    else:
        reason = f"Funding extremely negative ({pct}) — crowded shorts, squeeze risk."
        # A crowded short is a squeeze setup, not a buy signal. Stay cautious.
        direction = WAIT
    conf = 80 if not building else 90
    persist = read.get("persistence")
    if persist == HIGH:
        conf = min(95, conf + 5)
        reason = reason.rstrip(".") + f", persisting {read['persist_bars']} intervals."
    elif persist == MEDIUM:
        reason = reason.rstrip(".") + ", persisting."
    if building:
        reason += " OI still building into it."
    if read["trend"] == RISING and rate > 0:
        reason += " Trend still rising."
    elif read["trend"] == FALLING and rate < 0:
        reason += " Trend still falling."
    return {
        **read, "direction": direction, "confidence": conf, "reason": reason,
        # A single extreme print is a caution. A veto needs persistence or
        # corroboration — see funding_veto().
        "veto": persist in (MEDIUM, HIGH),
        "caution": True,
    }


def _corroborated(table: Dict[str, Any]) -> Optional[str]:
    """
    Is something else agreeing that this crowd is stuck?

    Each check stands on its own data. An earlier version routed the
    price-stall test through read_oi_divergence(), whose availability flag
    requires the OI window as well — so a table with price but no open
    interest could never report a stall, even though the price series was
    sitting right there.
    """
    asset = str((table or {}).get("asset") or "btc").lower()

    # 1. Price going nowhere while the crowd pays to hold.
    try:
        from backend.services.filters import series_for

        px = series_for(asset, "price")
        if px.ready(4):
            move = px.smooth.change_pct()
            if move is not None and abs(move) <= 0.3:
                return "price stalling"
    except Exception:
        pass

    # 2. Open interest still building into it.
    try:
        from backend.services.oi_divergence import read_oi_divergence

        oi = read_oi_divergence(table)
        if oi.get("available") and (oi.get("oi_change_pct") or 0) >= 2.0:
            return "OI still building"
    except Exception:
        pass

    # 3. The carry structure disagreeing with itself.
    try:
        from backend.services.basis_funding import basis_funding_signal

        if basis_funding_signal(table).get("state") == "Strong":
            return "basis disagrees"
    except Exception:
        pass
    return None


def funding_veto(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    RAIJIN's protective veto: extreme funding that is PERSISTING.

    Extreme funding for one interval is a price. Extreme funding that keeps
    printing is a crowd that cannot get out, and that is the only case
    hard enough to force a stand-down on funding alone.

    Corroboration lives in funding_caution(), not here. It was previously
    a second veto trigger, which was unreachable: persistence reaches
    `medium` at three samples, while the price and OI windows need four
    before they can corroborate anything — so the branch could never fire.
    """
    sig = funding_signal(table)
    if sig.get("state") != EXTREME:
        return None
    if sig.get("persistence") not in (MEDIUM, HIGH):
        return None
    rate = sig.get("rate_pct")
    sign = "positive" if (rate or 0) > 0 else "negative"
    return {
        "leader": "raijin",
        "code": "extreme_funding",
        "reason": (
            f"extreme {sign} funding ({rate:+.3f}%), "
            f"persisting {sig.get('persist_bars')} intervals"
        ),
        "detail": sig["reason"],
    }


def funding_caution(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    RAIJIN's protective caution — the softer half of the funding read.

    Fires on extreme funding that has not yet earned a veto, and on elevated
    funding that will not go away. When price is stalling or OI / basis
    disagree, that corroboration is named in the reason and lifts the
    signal, matching "extreme funding + conflicting context → protective
    caution".
    """
    sig = funding_signal(table)
    state = sig.get("state")
    persist = sig.get("persistence")
    corroboration = _corroborated(table) if state == EXTREME else None

    qualifies = (
        (state == EXTREME)                      # extreme, veto or not
        or (state == ELEVATED and persist == HIGH)
    )
    if not qualifies:
        return None
    if funding_veto(table) is not None:
        return None  # the veto already says it, louder

    rate = sig.get("rate_pct")
    sign = "positive" if (rate or 0) > 0 else "negative"
    reason = f"{str(state).lower()} {sign} funding ({rate:+.3f}%)"
    if corroboration:
        reason += f" with {corroboration}"
    elif persist == HIGH:
        reason += f", persisting {sig.get('persist_bars')} intervals"
    return {
        "leader": "raijin",
        "code": "funding_pressure",
        "reason": reason,
        "detail": sig["reason"],
        "corroborated": corroboration,
    }


_STATE_SCORE = {NORMAL: 0.0, ELEVATED: 55.0, EXTREME: 100.0}


def funding_score(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Sub-score for the Microstructure Risk Score. One source of truth, so the
    composite and RAIJIN cannot drift apart.
    """
    read = read_funding(table)
    if not read.get("available"):
        return None
    score = _STATE_SCORE.get(read.get("state"), 0.0)
    persist = read.get("persistence")
    if score > 0 and persist == HIGH:
        score = min(100.0, score + 20.0)
    elif score > 0 and persist == MEDIUM:
        score = min(100.0, score + 10.0)
    # A crowd that is still growing is worse than one already unwinding.
    crowded = read.get("crowded")
    trend = read.get("trend")
    worsening = (crowded == "longs" and trend == RISING) or (crowded == "shorts" and trend == FALLING)
    if score > 0 and worsening:
        score = min(100.0, score + 10.0)
    return {
        "score": score,
        "state": read.get("state"),
        "detail": f"{read.get('trend')} / {persist}",
    }


def funding_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload for the market strip — rate, state, one word of trend."""
    read = read_funding(table)
    rate = read["rate_pct"]
    return {
        "available": read["available"],
        "rate_pct": rate,
        "label": f"{rate:+.3f}%" if rate is not None else "—",
        "state": read["state"],
        "trend": read["trend"],
        "crowded": read["crowded"],
        "tone": {"Normal": "ok", "Elevated": "warn", "Extreme": "hot"}[read["state"]],
    }
