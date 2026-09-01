"""
Basis vs funding — is the carry structure telling one story or two?

Funding is what perp holders pay each other. Basis is what the futures curve
charges over spot. When both are rich, longs are crowded but at least the
market agrees with itself. When they point opposite ways the carry structure
is conflicted: one venue says crowded long, the other says the opposite, and
positioning built on either read is fragile.

Five readings:

    1. High funding + rich basis        crowded long, but consistent
    2. High funding + weak basis        CONFLICT — perps long, curve is not
    3. Negative funding + rich basis    CONFLICT — perps short, curve is not
    4. Negative funding + weak basis    crowded short, but consistent
    5. Both normalising                 carry unwinding, no signal

Conflict is the whole point: agreement at extremes is Mild, disagreement is
Strong. This is a secondary input — it raises caution and never argues for
Accumulate.

BASIS. Taken from the Binance premium index already on the feed: mark price
against index price. An explicit basis field or a futures/spot pair is used
if present. No basis data means None and silence.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.funding_analysis import ELEVATED_PCT, read_funding
from backend.services.round_table import REDUCE, WAIT

NONE = "None"
MILD = "Mild"
STRONG = "Strong"

# ── Thresholds, in percent ────────────────────────────────────────────
# Basis richer than this is a real premium; below the floor is a discount.
BASIS_RICH_PCT = 0.10
BASIS_WEAK_PCT = -0.03
# A wider premium than this is stretched on its own.
BASIS_STRETCHED_PCT = 0.35
# Movement that counts as a trend rather than noise.
BASIS_DRIFT_PCT = 0.02
# Samples before the trend reads are trustworthy.
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


def read_basis(table: Dict[str, Any]) -> Optional[float]:
    """
    Basis as a percent premium of futures over spot.

    Prefers an explicit field, then the premium index's mark-vs-index pair,
    then mark against the spot price. None when the feed carries none of it.
    """
    table = table if isinstance(table, dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    premium = market.get("premium") if isinstance(market.get("premium"), dict) else {}

    explicit = _pick(market, "basis_pct", "basis")
    if explicit is None:
        explicit = _pick(premium, "basis_pct", "basis")
    if explicit is not None:
        return explicit

    mark = _pick(premium, "mark_price", "markPrice") or _pick(market, "mark_price")
    index = _pick(premium, "index_price", "indexPrice") or _pick(market, "index_price")
    if index is None:
        index = _pick(market, "price", "spot", "last")
    if mark is not None and index:
        return (mark - index) / abs(index) * 100.0

    fut = _pick(market, "futures_price", "fut_price")
    spot = _pick(market, "spot_price", "spot", "price")
    if fut is not None and spot:
        return (fut - spot) / abs(spot) * 100.0
    return None


def read_carry(table: Dict[str, Any]) -> Dict[str, Any]:
    """Funding and basis together, with the trend of each."""
    table = table if isinstance(table, dict) else {}
    asset = str(table.get("asset") or "btc").lower()
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}

    funding = read_funding(table)
    rate = funding.get("rate_pct")
    basis = read_basis(table)

    basis_trend = "flat"
    basis_change = None
    if basis is not None:
        try:
            # Basis rides its own window, keyed to the snapshot so repeated
            # readers in one cycle do not stack samples.
            from backend.services.rolling import RollingWindow

            win = _basis_windows.setdefault(asset, RollingWindow(maxlen=60))
            key = cg.get("t") or table.get("timestamp") or market.get("close_time") or ("v", basis)
            if _basis_keys.get(asset) != key:
                _basis_keys[asset] = key
                win.add(basis)
            basis_change = win.change()
            if win.ready(MIN_SAMPLES):
                basis_trend = win.trend(BASIS_DRIFT_PCT)
        except Exception:
            pass

    return {
        "available": rate is not None and basis is not None,
        "asset": asset,
        "funding_pct": rate,
        "funding_state": funding.get("state"),
        "funding_trend": funding.get("trend"),
        "basis_pct": basis,
        "basis_trend": basis_trend,
        "basis_change": basis_change,
    }


# Basis history per asset. RollingWindow is __slots__-based, so the dedupe
# key lives beside it.
_basis_windows: Dict[str, Any] = {}
_basis_keys: Dict[str, Any] = {}


def reset_basis() -> None:
    """Tests only."""
    _basis_windows.clear()
    _basis_keys.clear()


def _classify(read: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Which of the five readings applies."""
    fund = read.get("funding_pct")
    basis = read.get("basis_pct")
    if fund is None or basis is None:
        return None

    high_funding = fund >= ELEVATED_PCT
    neg_funding = fund <= -ELEVATED_PCT
    rich_basis = basis >= BASIS_RICH_PCT
    weak_basis = basis <= BASIS_WEAK_PCT
    stretched = abs(basis) >= BASIS_STRETCHED_PCT
    weakening = read.get("basis_trend") == "down"
    firming = read.get("basis_trend") == "up"

    fpct = f"{fund:+.3f}%"
    bpct = f"{basis:+.3f}%"

    # 2. Perps crowded long while the curve refuses to confirm.
    if high_funding and weak_basis:
        return {"kind": "funding_long_basis_weak", "state": STRONG, "direction": REDUCE,
                "reason": f"funding elevated ({fpct}) while basis is weak ({bpct})"}
    # 3. Perps crowded short while the curve stays at a premium.
    if neg_funding and rich_basis:
        return {"kind": "funding_short_basis_rich", "state": STRONG, "direction": WAIT,
                "reason": f"funding negative ({fpct}) while basis stays rich ({bpct})"}
    # 2b. Softer version: funding high and the premium is actively bleeding.
    if high_funding and weakening and not rich_basis:
        return {"kind": "funding_long_basis_fading", "state": STRONG, "direction": REDUCE,
                "reason": f"funding elevated ({fpct}) while basis weakens ({bpct})"}
    # 1. Both rich — crowded, but the market agrees with itself.
    if high_funding and rich_basis:
        return {"kind": "both_rich", "state": STRONG if stretched else MILD, "direction": REDUCE,
                "reason": f"funding ({fpct}) and basis ({bpct}) both rich — crowded longs"}
    # 4. Both negative — consistent bearish carry.
    if neg_funding and weak_basis:
        return {"kind": "both_negative", "state": STRONG if stretched else MILD, "direction": WAIT,
                "reason": f"funding ({fpct}) and basis ({bpct}) both negative — crowded shorts"}
    # 5. Normalising, or one side elevated with the other neutral.
    if high_funding or neg_funding or rich_basis or weak_basis:
        return {"kind": "one_sided", "state": MILD, "direction": WAIT,
                "reason": f"carry uneven — funding {fpct}, basis {bpct}"}
    if firming or weakening:
        return {"kind": "normalising", "state": NONE, "direction": WAIT,
                "reason": f"carry normalising — funding {fpct}, basis {bpct}"}
    return None


def basis_funding_signal(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    RAIJIN's carry read: state, bias, one short reason.
    Never Accumulate — a conflicted carry structure is a reason to wait.
    """
    read = read_carry(table)
    if not read["available"]:
        return {**read, "state": NONE, "direction": WAIT, "confidence": 0,
                "reason": "No basis or funding print — carry structure unreadable.",
                "finding": None, "caution": False}

    found = _classify(read)
    if not found or found["state"] == NONE:
        return {**read, "state": NONE, "direction": WAIT, "confidence": 10,
                "reason": (found or {}).get("reason") or "Funding and basis agree — carry is clean.",
                "finding": found, "caution": False}

    strong = found["state"] == STRONG
    conflict = found["kind"].startswith("funding_")
    label = "carry conflict" if conflict else "carry stress"
    return {
        **read,
        "state": found["state"],
        "direction": found["direction"],
        "confidence": 75 if strong else 45,
        "reason": f"{found['state']} {label} — {found['reason']}.",
        "finding": found,
        "caution": strong,
    }


def basis_funding_caution(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """RAIJIN's caution when the carry structure is strongly conflicted."""
    sig = basis_funding_signal(table)
    if not sig.get("caution"):
        return None
    return {
        "leader": "raijin",
        "code": "carry_" + str((sig.get("finding") or {}).get("kind") or "conflict"),
        "reason": "basis/funding carry conflict",
        "detail": sig["reason"],
    }


_STATE_SCORE = {NONE: 0.0, MILD: 50.0, STRONG: 100.0}


def basis_funding_score(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Component contribution for the Microstructure Risk Score."""
    sig = basis_funding_signal(table)
    if not sig.get("available"):
        return None
    return {
        "score": _STATE_SCORE.get(sig["state"], 0.0),
        "state": sig["state"],
        "detail": (sig.get("finding") or {}).get("kind") or "clean",
    }


def basis_funding_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload for the risk panel."""
    sig = basis_funding_signal(table)
    basis = sig.get("basis_pct")
    return {
        "available": bool(sig.get("available")),
        "state": sig.get("state", NONE),
        "basis_pct": basis,
        "basis_label": f"{basis:+.3f}%" if basis is not None else "—",
        "basis_trend": sig.get("basis_trend"),
        "funding_pct": sig.get("funding_pct"),
        "kind": (sig.get("finding") or {}).get("kind"),
        "reason": sig.get("reason"),
        "tone": {NONE: "ok", MILD: "warn", STRONG: "hot"}[sig.get("state", NONE)],
    }
