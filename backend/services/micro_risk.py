"""
Microstructure Risk Score — one number for how hostile the plumbing is.

Funding, open interest, divergence and liquidation walls each already speak
for themselves. Individually none of them may cross its own threshold while
the combination is plainly dangerous: funding elevated, OI building into the
move, and a liquidation wall half a percent away is a bad place to size up
even though no single check has tripped.

This is that combination, expressed as one 0-100 score with a state and a
sentence. It is a brake only. The score can raise caution or a veto; it can
never produce an Accumulate, because "the plumbing looks calm" is not a
reason to buy.

     0-39   Clear       no meaningful microstructure risk
    40-69   Elevated    RAIJIN favours Stand down / Reduce
    70-100  Dangerous   protective input to Satoshi

Scoring is a plain weighted average of 0-100 sub-scores. Every weight lives
in WEIGHTS below — the one place to tune. A missing feed does not score
zero: the input drops out and its weight is redistributed across whatever
remains, so the score always means "of what we can actually see".

`components` is the flat {name: 0-100} view for a glance; `breakdown` adds
the base weight, the weight actually applied after redistribution, and the
source state, so any number here can be taken apart by hand.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from backend.services.rolling import RollingWindow
from backend.services.round_table import REDUCE, WAIT

CLEAR = "Clear"
ELEVATED = "Elevated"
DANGEROUS = "Dangerous"

# State boundaries: 0-39 Clear, 40-69 Elevated, 70-100 Dangerous.
ELEVATED_AT = 40
DANGEROUS_AT = 70

# ── The only place to tune ────────────────────────────────────────────
# Base weights, out of 100. When a feed is missing that input drops out and
# the remaining weights are redistributed, so the score always means "of
# what we can actually see" rather than silently reading calm.
WEIGHTS: Dict[str, int] = {
    "funding": 17,                 # extreme / crowded side
    "oi_expansion": 16,            # how much OI is building
    "oi_divergence": 14,           # OI and price out of step
    "funding_divergence": 12,      # funding and price out of step
    "liquidation_proximity": 16,   # distance to a major resting wall
    "liquidation_flow": 11,        # forced flow happening now
    "basis_funding": 8,            # carry structure conflicted (secondary)
    "liquidity": 6,                # book stress, when the feed carries it
}

# Component sub-scores, 0-100.
_FUNDING_SCORE = {"Normal": 0.0, "Elevated": 55.0, "Extreme": 100.0}
_OI_SCORE = {"Normal": 0.0, "Building": 55.0, "Extreme": 100.0}
_DIVERGENCE_SCORE = {"None": 0.0, "Mild": 50.0, "Strong": 100.0}
_LIQ_SCORE = {"Clear": 0.0, "Nearby": 55.0, "Dangerous": 100.0}
# OI patterns that mean positioning is stacking into the move.
_HOT_OI_PATTERNS = ("cascade_risk", "longs_building", "shorts_building")


# ── Recent score history, for the heat strip ──────────────────────────
# One sample per feed snapshot per asset. RollingWindow is __slots__-based,
# so the dedupe key lives beside it rather than on it.
HISTORY_LEN = 60
_history: Dict[str, RollingWindow] = {}
_history_keys: Dict[str, Any] = {}


def _track(asset: str, score: float, key: Any) -> None:
    win = _history.setdefault(asset, RollingWindow(maxlen=HISTORY_LEN))
    if key is not None and _history_keys.get(asset) == key:
        return
    if key is not None:
        _history_keys[asset] = key
    win.add(score)


def history(asset: str = "btc") -> List[int]:
    """Recent scores, oldest first. Empty until the first cycle lands."""
    win = _history.get(str(asset or "btc").lower())
    return [int(round(v)) for v in win.values()] if win else []


def reset_history() -> None:
    """Tests only."""
    _history.clear()
    _history_keys.clear()


def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if val == val else None


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


def _liquidity_score(table: Dict[str, Any]) -> Optional[float]:
    """
    Optional book-stress component, only when the feed carries depth or a
    spread. Wide spread or thin top-of-book is its own kind of risk.
    """
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    spread = _f(market.get("spread_cents"))
    if spread is None:
        spread = _f(market.get("kalshi_spread"))
    depth = _f(market.get("book_size"))
    if depth is None:
        depth = _f(market.get("top_size"))
    if spread is None and depth is None:
        return None

    score = 0.0
    if spread is not None:
        # 0c is clean, 6c+ is stressed.
        score = max(score, _clamp(spread / 6.0 * 100.0))
    if depth is not None:
        # 5 contracts or fewer on top is thin.
        score = max(score, _clamp((5.0 - min(depth, 5.0)) / 5.0 * 100.0))
    return score


def read_components(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Each input's sub-score, its weight, and the state it came from.
    Anything the feed cannot answer is simply absent.
    """
    out: Dict[str, Dict[str, Any]] = {}

    try:
        from backend.services.funding_analysis import funding_score

        fs = funding_score(table)
        if fs:
            out["funding"] = fs
    except Exception:
        pass

    try:
        from backend.services.oi_analysis import oi_pattern, read_oi

        o = read_oi(table)
        if o.get("available"):
            score = _OI_SCORE.get(o.get("state"), 0.0)
            pattern = oi_pattern(o)
            if pattern in _HOT_OI_PATTERNS:
                score = _clamp(score + 20.0)
            # OI moving with price is the crowding signature.
            cm = _f(o.get("oi_vs_price"))
            if cm is not None and cm >= 0.4:
                score = _clamp(score + 10.0)
            out["oi_expansion"] = {"score": score, "state": o.get("state"), "detail": pattern}
    except Exception:
        pass

    try:
        from backend.services.divergence import divergence_signal

        d = divergence_signal(table, eth_table=eth_table)
        if d.get("ready"):
            out["funding_divergence"] = {
                "score": _DIVERGENCE_SCORE.get(d.get("state"), 0.0),
                "state": d.get("state"),
                "detail": ", ".join(x["kind"] for x in d.get("findings") or []) or "aligned",
            }
    except Exception:
        pass

    try:
        from backend.services.liquidation_map import liq_hud

        l = liq_hud(table)
        if l.get("available"):
            score = _LIQ_SCORE.get(l.get("state"), 0.0)
            near = l.get("nearest_long") or l.get("nearest_short")
            detail = "no wall near"
            if near:
                detail = f"wall {near.get('distance_pct')}% away"
            out["liquidation_proximity"] = {"score": score, "state": l.get("state"), "detail": detail}
    except Exception:
        pass

    try:
        from backend.services.oi_divergence import oi_divergence_score

        od = oi_divergence_score(table)
        if od:
            out["oi_divergence"] = od
    except Exception:
        pass

    try:
        from backend.services.basis_funding import basis_funding_score

        bf = basis_funding_score(table)
        if bf:
            out["basis_funding"] = bf
    except Exception:
        pass

    try:
        from backend.services.liquidation_flow import flow_score

        fl = flow_score(table)
        if fl:
            out["liquidation_flow"] = fl
    except Exception:
        pass

    liq_stress = _liquidity_score(table if isinstance(table, dict) else {})
    if liq_stress is not None:
        out["liquidity"] = {
            "score": liq_stress,
            "state": "stressed" if liq_stress >= 55 else "ok",
            "detail": "book depth / spread",
        }

    for name, row in out.items():
        row["weight"] = WEIGHTS.get(name, 0.0)
    return out


def state_for(score: Optional[float]) -> str:
    if score is None:
        return CLEAR
    if score >= DANGEROUS_AT:
        return DANGEROUS
    if score >= ELEVATED_AT:
        return ELEVATED
    return CLEAR


def _reason(ranked: List[tuple]) -> str:
    """
    A short, specific phrase naming the drivers — no state prefix, since
    state is returned separately.

        "OI expanding into liquidation wall with extreme funding"
    """
    phrases = {
        "funding": lambda r: (
            ("persistent " if str(r.get("detail") or "").endswith("high") else "")
            + ("extreme funding" if str(r.get("state")) == "Extreme" else "elevated funding")
        ),
        "oi_expansion": lambda r: (
            "OI expanding" if str(r.get("detail") or "") in
            ("cascade_risk", "longs_building", "shorts_building")
            else "open interest building"
        ),
        "funding_divergence": lambda r: f"{str(r.get('state','')).lower()} funding/price divergence",
        "oi_divergence": lambda r: (
            "OI rising without progress" if r.get("detail") == "exhaustion"
            else f"OI/price divergence ({str(r.get('detail') or '').replace('_', ' ')})"
        ),
        "liquidation_proximity": lambda r: (
            "liquidation wall close" if str(r.get("state")) == "Dangerous" else "liquidation wall nearby"
        ),
        "liquidation_flow": lambda r: (
            f"{r.get('detail') or 'forced'} liquidations cascading"
            if str(r.get("state")) == "Cascade risk"
            else f"active {r.get('detail') or ''} liquidations".replace("  ", " ").strip()
        ),
        "basis_funding": lambda r: (
            "carry conflict" if str(r.get("detail") or "").startswith("funding_")
            else "carry stress"
        ),
        "liquidity": lambda r: "thin book",
    }
    parts: List[str] = []
    for name, row in ranked:
        if row["score"] <= 0 or len(parts) >= 3:
            continue
        try:
            parts.append(phrases[name](row))
        except Exception:
            parts.append(name)
    if not parts:
        return "no meaningful microstructure risk"
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} with {parts[1]}"
    return f"{parts[0]} into {parts[1]} with {parts[2]}"


def micro_risk(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    The composite score, its state, a sentence, and the parts it came from.

    Direction is always WAIT or REDUCE. Microstructure never argues for
    Accumulate — a calm book is the absence of a reason to worry, not a
    reason to buy.
    """
    comps = read_components(table, eth_table=eth_table)
    if not comps:
        return {
            "score": None, "state": CLEAR, "direction": WAIT, "confidence": 0,
            "reason": "no microstructure feed",
            "components": {}, "breakdown": {}, "available": False,
            "weights": dict(WEIGHTS),
            "elevated_at": ELEVATED_AT, "dangerous_at": DANGEROUS_AT,
        }

    # Weighted average over available inputs only. Missing feeds are not
    # scored zero — their weight is redistributed across what remains.
    total_w = sum(r["weight"] for r in comps.values()) or 1.0
    score = int(round(_clamp(sum(r["score"] * r["weight"] for r in comps.values()) / total_w)))
    state = state_for(score)
    ranked = sorted(
        comps.items(), key=lambda kv: kv[1]["score"] * kv[1]["weight"], reverse=True
    )

    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    _track(
        str(table.get("asset") or "btc").lower(), score,
        cg.get("t") or table.get("timestamp") or market.get("close_time") or ("s", score),
    )

    if state == DANGEROUS:
        direction, confidence = REDUCE, 85
    elif state == ELEVATED:
        direction, confidence = WAIT, 60
    else:
        direction, confidence = WAIT, 10

    return {
        "score": score,
        "state": state,
        "direction": direction,
        "confidence": confidence,
        "reason": _reason(ranked),
        # Flat sub-scores — the debugging view at a glance.
        "components": {n: int(round(r["score"])) for n, r in comps.items()},
        # Full working: weight actually applied, source state, and detail.
        "breakdown": {
            n: {
                "score": int(round(r["score"])),
                "base_weight": WEIGHTS.get(n, 0),
                "applied_weight": round(r["weight"] / total_w, 4),
                "state": r.get("state"),
                "detail": r.get("detail"),
            }
            for n, r in comps.items()
        },
        "missing": [n for n in WEIGHTS if n not in comps],
        "ranked": [n for n, _ in ranked],
        "coverage_pct": int(round(total_w / sum(WEIGHTS.values()) * 100)),
        "available": True,
        "weights": dict(WEIGHTS),
        "elevated_at": ELEVATED_AT, "dangerous_at": DANGEROUS_AT,
    }


def micro_veto(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
    existing_codes: Optional[Iterable[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    RAIJIN's composite veto, raised only when the score is Dangerous.

    Skipped when a component has already vetoed on its own — that veto names
    the specific cause and is more useful than a summary. This one exists to
    catch the case no single check trips but the combination is hostile.
    """
    sig = micro_risk(table, eth_table=eth_table)
    if sig["state"] != DANGEROUS:
        return None
    codes = {str(c) for c in (existing_codes or [])}
    if any(c.startswith(("extreme_funding", "oi_", "liq_wall", "cascade")) for c in codes):
        return None
    return {
        "leader": "raijin",
        "code": "micro_risk",
        "reason": f"microstructure risk {sig['score']:.0f}/100",
        "detail": f"{sig['state']} — {sig['reason']}.",
    }


def micro_caution(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """RAIJIN's soft caution at Elevated. Raises the bar; never forces WAIT."""
    sig = micro_risk(table, eth_table=eth_table)
    if sig["state"] != ELEVATED:
        return None
    return {
        "leader": "raijin",
        "code": "micro_elevated",
        "reason": f"microstructure risk {sig['score']:.0f}/100",
        "detail": f"{sig['state']} — {sig['reason']}.",
    }


def micro_hud(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Compact payload — score, state, sentence, and the parts."""
    sig = micro_risk(table, eth_table=eth_table)
    return {
        "available": sig["available"],
        "score": sig["score"],
        "state": sig["state"],
        "reason": sig["reason"],
        "top": (sig.get("ranked") or [None])[0],
        "headline": f"{sig['state']} — {sig['reason']}",
        "components": dict(sig.get("components") or {}),
        "breakdown": dict(sig.get("breakdown") or {}),
        "missing": list(sig.get("missing") or []),
        "coverage_pct": sig.get("coverage_pct"),
        "history": history(str(table.get("asset") or "btc").lower()) if isinstance(table, dict) else [],
        "elevated_at": ELEVATED_AT,
        "dangerous_at": DANGEROUS_AT,
        "weights": dict(WEIGHTS),
        "tone": {CLEAR: "ok", ELEVATED: "warn", DANGEROUS: "hot"}[sig["state"]],
    }
