"""
Open interest analysis — positioning build-up and cascade risk.

OI on its own says little. OI *with* price direction says who is getting
crowded, and OI *with* funding says how much they are paying to stay there.
This module reads those combinations with plain thresholds and feeds RAIJIN.

The four patterns that matter:

    OI up   + price up     longs building      crowded long risk
    OI up   + price down   shorts building     crowded short risk
    OI down + big move     positions unwinding  liquidation / short covering
    OI up hard, fast       cascade risk         stacked leverage

Like funding, this is a brake, not a forecast. It mostly produces WAIT and
REDUCE, and it can raise a protective veto.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.funding_analysis import read_funding
from backend.services.round_table import REDUCE, WAIT

# OI change thresholds, percent over the measured window (1h by default).
BUILDING_PCT = 3.0
EXTREME_PCT = 6.0
# Velocity: percent per hour that counts as a fast stack.
FAST_VELOCITY_PCT_H = 5.0
# Price move that makes an OI reading meaningful.
PRICE_MOVE_PCT = 0.8
BIG_MOVE_PCT = 1.5
# Co-movement scoring
CORR_EPS = 0.25

NORMAL = "Normal"
BUILDING = "Building"
EXTREME = "Extreme"

LONGS_BUILDING = "longs_building"
SHORTS_BUILDING = "shorts_building"
UNWINDING = "unwinding"
CASCADE = "cascade_risk"
QUIET = "quiet"


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


def oi_state(change_pct: Optional[float]) -> str:
    """Normal / Building / Extreme from absolute OI change."""
    if change_pct is None:
        return NORMAL
    mag = abs(change_pct)
    if mag >= EXTREME_PCT:
        return EXTREME
    if mag >= BUILDING_PCT:
        return BUILDING
    return NORMAL


def comovement(a: Optional[float], b: Optional[float]) -> Optional[float]:
    """
    Co-movement score in [-1, 1] for two changes. +1 = same direction and
    comparable size, -1 = opposite. None when either side is unknown.

    Deliberately not a rolling Pearson correlation — with the handful of
    samples available per window that would be noise with a decimal point.
    """
    if a is None or b is None:
        return None
    if a == 0 and b == 0:
        return 0.0
    sign = 1.0 if (a >= 0) == (b >= 0) else -1.0
    mag_a, mag_b = abs(a), abs(b)
    ratio = min(mag_a, mag_b) / max(mag_a, mag_b) if max(mag_a, mag_b) > 0 else 0.0
    return round(sign * ratio, 3)


def read_oi(table: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize OI level, change, velocity and its price/funding pairing."""
    table = table if isinstance(table, dict) else {}
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}

    level = _pick(cg, "open_interest", "oi")
    change = _pick(cg, "oi_delta_1h", "oi_change_1h", "oi_delta")
    window_h = _pick(cg, "oi_window_h") or 1.0
    price_chg = _pick(market, "price_change_pct_1h", "change_pct_1h", "pct_1h", "price_change_pct")

    history = cg.get("oi_history") if isinstance(cg.get("oi_history"), list) else None
    if change is None and history:
        vals: List[float] = []
        for row in history:
            val = _pick(row, "open_interest", "oi", "value", "c") if isinstance(row, dict) else _f(row)
            if val is not None:
                vals.append(val)
        if len(vals) >= 2 and vals[0] > 0:
            change = (vals[-1] - vals[0]) / vals[0] * 100.0

    # Spike guard + Kalman on the OI level, then derive velocity from the
    # smoothed series so one bad print cannot manufacture a cascade veto.
    raw_change = change
    smoothed_level = None
    filt = None
    try:
        from backend.services.filters import series_for

        asset = str(table.get("asset") or "btc").lower()
        filt = series_for(asset, "open_interest")
        if level is not None:
            snap_key = (cg.get("t") or table.get("timestamp")
                        or market.get("close_time") or ("v", level))
            smoothed_level = filt.update(level, key=snap_key)
    except Exception:
        filt = None

    velocity = (change / window_h) if (change is not None and window_h) else None
    if filt is not None and filt.ready(3):
        # Percent-per-hour from the smoothed level, when we have enough of it.
        base = filt.smooth.first()
        vel_abs = filt.velocity()
        if base and vel_abs is not None and base != 0:
            velocity = vel_abs / abs(base) * 100.0
    funding = read_funding(table)

    return {
        "level": level,
        "smoothed_level": smoothed_level,
        "raw_change_pct": raw_change,
        "filter": filt.debug() if filt is not None else None,
        "change_pct": change,
        "velocity_pct_h": round(velocity, 3) if velocity is not None else None,
        "price_change_pct": price_chg,
        "funding_pct": funding.get("rate_pct"),
        "state": oi_state(change),
        "oi_vs_price": comovement(change, price_chg),
        "oi_vs_funding": comovement(change, funding.get("rate_pct")),
        "available": change is not None,
    }


def oi_pattern(read: Dict[str, Any]) -> str:
    """Which of the four positioning patterns is in play."""
    change = read.get("change_pct")
    move = read.get("price_change_pct")
    if change is None:
        return QUIET
    vel = read.get("velocity_pct_h")
    if change >= EXTREME_PCT and vel is not None and vel >= FAST_VELOCITY_PCT_H:
        return CASCADE
    if change <= -BUILDING_PCT and move is not None and abs(move) >= BIG_MOVE_PCT:
        return UNWINDING
    if change >= BUILDING_PCT and move is not None and move >= PRICE_MOVE_PCT:
        return LONGS_BUILDING
    if change >= BUILDING_PCT and move is not None and move <= -PRICE_MOVE_PCT:
        return SHORTS_BUILDING
    return QUIET


def oi_signal(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    RAIJIN's OI read: direction bias, confidence, one short reason.
    Cautious by construction — OI crowding argues for WAIT or REDUCE.
    """
    read = read_oi(table)
    if not read["available"]:
        return {
            **read,
            "pattern": QUIET,
            "direction": WAIT,
            "confidence": 0,
            "reason": "No open-interest print — positioning unreadable.",
            "veto": False,
        }

    pattern = oi_pattern(read)
    chg = read["change_pct"]
    move = read["price_change_pct"]
    chg_s = f"{chg:+.1f}%"
    move_s = f"{move:+.1f}%" if move is not None else "flat price"
    funding_note = ""
    fund = read["funding_pct"]
    if fund is not None and abs(fund) >= 0.03:
        funding_note = f" Funding {fund:+.3f}% agrees." if (read["oi_vs_funding"] or 0) > CORR_EPS else ""

    if pattern == CASCADE:
        return {
            **read, "pattern": pattern, "direction": WAIT, "confidence": 90,
            "reason": f"OI expanding fast ({chg_s} at {read['velocity_pct_h']:+.1f}%/h) — cascade risk." + funding_note,
            "veto": True,
        }
    if pattern == LONGS_BUILDING:
        extreme = read["state"] == EXTREME
        return {
            **read, "pattern": pattern, "direction": REDUCE,
            "confidence": 80 if extreme else 60,
            "reason": f"OI rising with price ({chg_s} into {move_s}) — crowded longs." + funding_note,
            "veto": extreme,
        }
    if pattern == SHORTS_BUILDING:
        extreme = read["state"] == EXTREME
        return {
            **read, "pattern": pattern, "direction": WAIT,
            "confidence": 75 if extreme else 55,
            "reason": f"OI rising as price falls ({chg_s} into {move_s}) — crowded shorts, squeeze risk." + funding_note,
            "veto": extreme,
        }
    if pattern == UNWINDING:
        return {
            **read, "pattern": pattern, "direction": WAIT, "confidence": 50,
            "reason": f"OI falling into a {move_s} move ({chg_s}) — positions unwinding, not building.",
            "veto": False,
        }
    return {
        **read, "pattern": pattern, "direction": WAIT, "confidence": 10,
        "reason": f"OI steady ({chg_s}) — no crowding signal.",
        "veto": False,
    }


_VETO_REASON = {
    CASCADE: "OI expanding fast (cascade risk)",
    LONGS_BUILDING: "OI expanding with price (crowded longs)",
    SHORTS_BUILDING: "OI expanding against price (crowded shorts)",
}


def oi_veto(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """RAIJIN's OI veto entry, or None. Shape matches protective_vetoes."""
    sig = oi_signal(table)
    if not sig.get("veto"):
        return None
    return {
        "leader": "raijin",
        "code": "oi_" + str(sig.get("pattern") or "risk"),
        "reason": _VETO_REASON.get(sig.get("pattern"), "extreme OI expansion"),
        "detail": sig["reason"],
    }


def oi_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload for the market strip."""
    read = read_oi(table)
    chg = read["change_pct"]
    return {
        "available": read["available"],
        "change_pct": chg,
        "label": f"{chg:+.1f}%" if chg is not None else "—",
        "state": read["state"],
        "pattern": oi_pattern(read),
        "oi_vs_price": read["oi_vs_price"],
        "tone": {"Normal": "ok", "Building": "warn", "Extreme": "hot"}[read["state"]],
    }
