"""
Session & structure gates for the Chair.

Hard WAITs. Same class as chalk: no debate, no LLM.
Missing inputs fail-soft (do not invent a veto).
Already-open books are not killed by WAIT_TOO_LATE.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


STRUCTURE_WAIT_CODES = (
    "WAIT_CHOP",
    "WAIT_MIDRANGE",
    "WAIT_TAPE",
    "WAIT_NO_CUSHION",
    "WAIT_TOO_LATE",
    "WAIT_CHALK",
)

STRUCTURE_WHY_CODES = (
    "chop",
    "midrange",
    "tape",
    "no_cushion",
    "too_late",
    "chalk",
)

TOO_LATE_MINS = 2.0
CUSHION_AFTER_MINS = 8.0
CUSHION_ATR_MULT = 0.50
TAPE_UP = 0.58
TAPE_DOWN = 0.42
STAKE_BASE_PCT = 2.5
STAKE_MAX_PCT = 5.0


def _f(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _side(value: Any) -> Optional[str]:
    text = str(value or "").strip().upper()
    if text in ("UP", "UP_HOLD", "LONG_UP"):
        return "UP"
    if text in ("DOWN", "DOWN_HOLD", "LONG_DOWN"):
        return "DOWN"
    return None


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "chop", "range", "consolidation")
    return False


def is_chop_regime(regime: Any = None, chop: Any = None, regime_key: Any = None) -> bool:
    if chop is True:
        return True
    blob = " ".join(str(x or "") for x in (regime, regime_key, chop)).lower()
    return any(tok in blob for tok in ("chop", "range", "consolidat", "overlap", "no-trend", "no_trend"))


def tape_side_from_ratio(buy_ratio: Any) -> Optional[str]:
    r = _f(buy_ratio)
    if r is None:
        return None
    if r >= TAPE_UP:
        return "UP"
    if r <= TAPE_DOWN:
        return "DOWN"
    return None


def session_grade_caps_size(grade: Any) -> bool:
    g = str(grade or "").strip().lower()
    return g in ("worse", "off", "closed", "dead", "afternoon", "lunch")


def structure_stake_pct(
    *,
    completeness: Any = None,
    tape_agrees: bool = False,
    zone_agrees: bool = False,
    session_grade: Any = None,
) -> float:
    """2.5% base. 5% only when completeness >= 80 and tape + zone + session agree."""
    if session_grade_caps_size(session_grade):
        return STAKE_BASE_PCT
    try:
        comp = float(completeness)
    except (TypeError, ValueError):
        comp = 0.0
    if comp >= 80.0 and tape_agrees and zone_agrees:
        return STAKE_MAX_PCT
    return STAKE_BASE_PCT


def structure_wait_reason(
    *,
    mins_left: Any = None,
    already_locked: bool = False,
    spot: Any = None,
    strike: Any = None,
    atr: Any = None,
    atr_pct: Any = None,
    regime: Any = None,
    regime_key: Any = None,
    chop: Any = None,
    midrange: Any = None,
    tape_side: Any = None,
    buy_ratio: Any = None,
    lean: Any = None,
    chalk: bool = False,
) -> Optional[str]:
    if chalk:
        return "chalk book"

    ml = _f(mins_left)
    if ml is not None and ml <= TOO_LATE_MINS and not already_locked:
        return "too late — no new call"

    if is_chop_regime(regime=regime, chop=chop, regime_key=regime_key):
        return "chop — no family inside range"

    if _truthy(midrange):
        return "mid-range — no nearby liq"

    side = _side(lean)
    tape = _side(tape_side) or tape_side_from_ratio(buy_ratio)
    if side in ("UP", "DOWN") and tape in ("UP", "DOWN") and tape != side:
        return "tape disagrees with zone"

    if ml is not None and ml > CUSHION_AFTER_MINS and not already_locked:
        px = _f(spot)
        k0 = _f(strike)
        if px and k0 and px > 0 and k0 > 0:
            gap = abs(px - k0)
            atr_abs = _f(atr)
            if atr_abs is None:
                ap = _f(atr_pct)
                if ap is not None:
                    if ap >= 0.05:
                        atr_abs = px * (ap / 100.0)
                    else:
                        atr_abs = px * ap
            if atr_abs is not None and atr_abs > 0 and gap < (CUSHION_ATR_MULT * atr_abs):
                return "no cushion vs strike"

    return None


def structure_wait_code(why: Any) -> Optional[str]:
    text = str(why or "").strip().lower()
    if not text:
        return None
    if "chalk" in text:
        return "WAIT_CHALK"
    if "too late" in text or "too_late" in text:
        return "WAIT_TOO_LATE"
    if "chop" in text or "consolidat" in text:
        return "WAIT_CHOP"
    if "mid-range" in text or "midrange" in text:
        return "WAIT_MIDRANGE"
    if "tape" in text:
        return "WAIT_TAPE"
    if "cushion" in text:
        return "WAIT_NO_CUSHION"
    return None


def structure_from_regime(regime_features: Any = None) -> Dict[str, Any]:
    rf = regime_features if isinstance(regime_features, dict) else {}
    aggr = rf.get("aggr") if isinstance(rf.get("aggr"), dict) else {}
    buy_ratio = (
        rf.get("buy_ratio")
        or rf.get("aggr_buy_ratio")
        or aggr.get("buy_ratio")
        or aggr.get("buy_vol_ratio")
    )
    tape = rf.get("tape_side") or tape_side_from_ratio(buy_ratio)
    spot = (
        rf.get("spot_price")
        or rf.get("current_price")
        or rf.get("research_spot")
        or rf.get("spot")
        or rf.get("cfb_avg_60s")
    )
    strike = rf.get("floor_strike") or rf.get("cap_strike") or rf.get("strike_price")
    return {
        "mins_left": rf.get("mins_left"),
        "spot": spot,
        "strike": strike,
        "atr": rf.get("atr"),
        "atr_pct": rf.get("atr_pct") or rf.get("realized_vol"),
        "regime": rf.get("regime"),
        "regime_key": rf.get("regime_key"),
        "chop": rf.get("chop"),
        "midrange": rf.get("midrange"),
        "tape_side": tape,
        "buy_ratio": buy_ratio,
        "session_grade": rf.get("session_grade") or rf.get("session_quality"),
        "completeness": rf.get("completeness") or rf.get("pattern_completeness"),
    }
