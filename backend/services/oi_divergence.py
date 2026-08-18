"""
Open-interest divergence — positioning and price out of step.

oi_analysis already names the four positioning *patterns* from a single
snapshot. This module asks a different question over a rolling window: are
open interest and price actually agreeing, and for how long? Contracts piling
up while price refuses to move is exhaustion, and it does not show up in any
one print.

Five checks:

    1. OI up   + price down     shorts building into weakness
    2. OI up   + price up       longs building into strength
    3. OI down + large move     covering / liquidation, not new risk
    4. OI rising, funding disagrees   positioning and carry out of sync
    5. OI expanding, no progress      crowded and exhausted

Output is None / Mild / Strong plus a bias that is only ever Stand down or
Reduce. Contracts stacking up is never a reason to Accumulate.

Both series read through the shared spike-guard + Kalman windows, so one bad
print cannot manufacture a divergence. With no OI feed the whole module
returns None and raises nothing.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.funding_analysis import ELEVATED_PCT, read_funding
from backend.services.round_table import REDUCE, WAIT

NONE = "None"
MILD = "Mild"
STRONG = "Strong"

# ── Thresholds ────────────────────────────────────────────────────────
# OI change over the window that counts as building, in percent.
OI_BUILDING_PCT = 2.0
OI_STRONG_PCT = 5.0
# Price move that counts as going somewhere.
PRICE_MOVE_PCT = 0.5
PRICE_BIG_PCT = 1.5
# Price move small enough to be "no progress".
PRICE_STALL_PCT = 0.3
# How long OI must keep expanding with no progress before it is exhaustion.
STALL_BARS = 6
# Samples before any of this is trustworthy.
MIN_SAMPLES = 4


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


def _price_of(table: Dict[str, Any]) -> Optional[float]:
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    price = _pick(market, "price", "last", "spot", "mark")
    if price is not None:
        return price
    candles = market.get("candles")
    if isinstance(candles, list) and candles:
        last = candles[-1]
        return _pick(last, "close", "c") if isinstance(last, dict) else _f(last)
    return None


def read_oi_divergence(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    OI and price change over the shared rolling windows, plus the funding
    rate for the carry check.

    Updates both series itself (idempotent per snapshot) so it works whether
    or not oi_analysis and divergence have already run this cycle.
    """
    table = table if isinstance(table, dict) else {}
    asset = str(table.get("asset") or "btc").lower()
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}

    level = _pick(cg, "open_interest", "oi")
    price = _price_of(table)
    snap = cg.get("t") or table.get("timestamp") or market.get("close_time")

    try:
        from backend.services.filters import series_for
    except ImportError:
        return {"available": False, "asset": asset}

    oi_series = series_for(asset, "open_interest")
    px_series = series_for(asset, "price")
    if level is not None:
        oi_series.update(level, key=snap or ("v", level))
    if price is not None:
        px_series.update(price, key=snap or ("v", price))

    oi_change = oi_series.smooth.change_pct()
    price_change = px_series.smooth.change_pct()
    funding = read_funding(table).get("rate_pct")

    # Exhaustion needs a run, not a snapshot: OI up across the window while
    # price has gone nowhere for several samples.
    stall_bars = 0
    if px_series.ready(MIN_SAMPLES):
        vals = px_series.smooth.values()
        base = vals[0] if vals else None
        if base:
            for v in reversed(vals):
                if abs((v - base) / abs(base) * 100.0) <= PRICE_STALL_PCT:
                    stall_bars += 1
                else:
                    break

    ready = oi_series.ready(MIN_SAMPLES) and px_series.ready(MIN_SAMPLES)
    return {
        "available": ready,
        "asset": asset,
        "oi_change_pct": oi_change,
        "price_change_pct": price_change,
        "funding_pct": funding,
        "stall_bars": stall_bars,
        "samples": min(len(oi_series.smooth), len(px_series.smooth)),
    }


def _findings(read: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every divergence type currently in play, strongest first."""
    oi = read.get("oi_change_pct")
    px = read.get("price_change_pct")
    fund = read.get("funding_pct")
    out: List[Dict[str, Any]] = []
    if oi is None or px is None:
        return out

    building = oi >= OI_BUILDING_PCT
    strong_build = oi >= OI_STRONG_PCT
    falling_oi = oi <= -OI_BUILDING_PCT

    # 5. OI expanding with no progress — exhaustion. Checked first because
    #    it is the one a single snapshot cannot see.
    if building and abs(px) <= PRICE_STALL_PCT and read.get("stall_bars", 0) >= STALL_BARS:
        out.append({
            "kind": "exhaustion",
            "state": STRONG if strong_build else MILD,
            "direction": REDUCE,
            "reason": f"OI rising {oi:+.1f}% while price fails to advance ({px:+.2f}%)",
        })

    # 1. OI up, price down — shorts building into weakness.
    if building and px <= -PRICE_MOVE_PCT:
        out.append({
            "kind": "shorts_building",
            "state": STRONG if (strong_build and abs(px) >= PRICE_BIG_PCT) else MILD,
            "direction": WAIT,
            "reason": f"OI {oi:+.1f}% as price falls {px:+.2f}% — shorts building into weakness",
        })

    # 2. OI up, price up — longs building into strength.
    if building and px >= PRICE_MOVE_PCT:
        out.append({
            "kind": "longs_building",
            "state": STRONG if (strong_build and px >= PRICE_BIG_PCT) else MILD,
            "direction": REDUCE,
            "reason": f"OI {oi:+.1f}% as price rises {px:+.2f}% — longs building into strength",
        })

    # 3. OI down into a large move — positions leaving, not arriving.
    if falling_oi and abs(px) >= PRICE_BIG_PCT:
        out.append({
            "kind": "unwinding",
            "state": MILD,
            "direction": WAIT,
            "reason": f"OI {oi:+.1f}% into a {px:+.2f}% move — covering, not new risk",
        })

    # 4. OI rising while funding disagrees — positioning and carry out of sync.
    if building and fund is not None and abs(fund) >= ELEVATED_PCT:
        crowded_longs = fund > 0
        disagrees = (crowded_longs and px <= -PRICE_MOVE_PCT) or (
            not crowded_longs and px >= PRICE_MOVE_PCT
        )
        if disagrees:
            out.append({
                "kind": "carry_mismatch",
                "state": STRONG if strong_build else MILD,
                "direction": REDUCE if crowded_longs else WAIT,
                "reason": (
                    f"OI {oi:+.1f}% with funding {fund:+.3f}% against a {px:+.2f}% move "
                    "— positioning and carry out of sync"
                ),
            })

    out.sort(key=lambda f: 0 if f["state"] == STRONG else 1)
    return out


def oi_divergence_signal(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    RAIJIN's OI-divergence read: state, bias, one short reason.
    Never returns Accumulate — contracts stacking up is not a buy signal.
    """
    read = read_oi_divergence(table)
    if not read.get("available"):
        return {
            **read, "state": NONE, "direction": WAIT, "confidence": 0,
            "reason": "Not enough OI/price history to judge divergence.",
            "findings": [], "caution": False,
        }

    findings = _findings(read)
    if not findings:
        return {
            **read, "state": NONE, "direction": WAIT, "confidence": 10,
            "reason": "OI and price agree — no divergence.",
            "findings": [], "caution": False,
        }

    strong = [f for f in findings if f["state"] == STRONG]
    lead = findings[0]
    state = STRONG if strong else MILD
    direction = REDUCE if any(f["direction"] == REDUCE for f in (strong or findings)) else WAIT

    return {
        **read,
        "state": state,
        "direction": direction,
        "confidence": 75 if state == STRONG else 45,
        "reason": f"{state} OI divergence — {lead['reason']}.",
        "findings": findings,
        "caution": state == STRONG,
    }


def oi_divergence_caution(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """RAIJIN's caution on a strong OI divergence. Never a hard veto."""
    sig = oi_divergence_signal(table)
    if not sig.get("caution"):
        return None
    lead = (sig.get("findings") or [{}])[0]
    return {
        "leader": "raijin",
        "code": "oi_divergence_" + str(lead.get("kind") or "generic"),
        "reason": "OI/price divergence",
        "detail": sig["reason"],
    }


_STATE_SCORE = {NONE: 0.0, MILD: 50.0, STRONG: 100.0}


def oi_divergence_score(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Component contribution for the Microstructure Risk Score."""
    sig = oi_divergence_signal(table)
    if not sig.get("available"):
        return None
    lead = (sig.get("findings") or [{}])
    return {
        "score": _STATE_SCORE.get(sig["state"], 0.0),
        "state": sig["state"],
        "detail": lead[0].get("kind") if lead and lead[0] else "aligned",
    }


def oi_divergence_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload for the risk panel."""
    sig = oi_divergence_signal(table)
    return {
        "available": bool(sig.get("available")),
        "state": sig.get("state", NONE),
        "reason": sig.get("reason"),
        "kinds": [f["kind"] for f in sig.get("findings") or []],
        "oi_change_pct": sig.get("oi_change_pct"),
        "price_change_pct": sig.get("price_change_pct"),
        "stall_bars": sig.get("stall_bars"),
        "tone": {NONE: "ok", MILD: "warn", STRONG: "hot"}[sig.get("state", NONE)],
    }
