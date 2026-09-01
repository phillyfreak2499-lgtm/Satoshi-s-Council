"""
Calibration — is the desk honest about how sure it is?

A confidence number only means something if it verifies. When the desk says
70%, BTC should finish the called way about 70% of the time. This module
scores that from the settled directional calls already in the store — no new
data, no new bots.

  Reliability curve   Calls binned by stated confidence; each bin's mean
                      confidence vs the share that actually hit. On a perfect
                      desk every point sits on the diagonal.
  Brier score         Mean squared error of the probability forecasts. Lower
                      is better: 0 is perfect, 0.25 is a coin flip.
  Brier skill         Brier vs always predicting the base rate. Positive means
                      the confidence numbers add information over the base rate.
  ECE                 Expected Calibration Error — the average gap between
                      stated confidence and observed hit rate, weighted by how
                      many calls land in each bin.
  Verdict             Overconfident / underconfident / well-calibrated, in
                      plain words, with the size of the gap.

Directional calls only — WAIT is not a probabilistic forecast, so it is
excluded, not scored as a miss. Paper history only.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Confidence bands, in percent. Empty bands are dropped from the output.
_BINS: Tuple[Tuple[int, int], ...] = (
    (0, 50), (50, 60), (60, 70), (70, 80), (80, 90), (90, 101),
)
_MIN_FOR_VERDICT = 20      # below this, say "gathering", don't judge
_MIN_PER_REGIME = 5        # regimes thinner than this are folded into "other"
_GAP_TOL = 5.0             # within this many points of the diagonal = calibrated

_DIRECTIONAL = ("UP", "DOWN", "UP_HOLD", "DOWN_HOLD", "LONG_UP", "LONG_DOWN")


def _conf(row: Dict[str, Any]) -> Optional[float]:
    """Stated confidence as a probability in [0, 1], or None if unusable."""
    raw = row.get("confidence")
    try:
        c = float(raw)
    except (TypeError, ValueError):
        return None
    if c != c:                      # NaN
        return None
    if c > 1.0:                     # stored as a percent
        c /= 100.0
    if c <= 0.0 or c > 1.0:
        return None
    return c


def _is_directional(row: Dict[str, Any]) -> bool:
    return str(row.get("direction") or "").upper() in _DIRECTIONAL


def _correct(row: Dict[str, Any]) -> Optional[int]:
    """1 if the called side hit, 0 if it missed, None if not settled."""
    c = row.get("correct")
    if c in (0, 1, True, False):
        return int(bool(c))
    # Fall back to comparing the called direction against the settled outcome.
    d = str(row.get("direction") or "").upper()
    o = str(row.get("outcome") or row.get("actual_outcome") or "").upper()
    if o not in ("UP", "DOWN"):
        return None
    up = d in ("UP", "UP_HOLD", "LONG_UP")
    down = d in ("DOWN", "DOWN_HOLD", "LONG_DOWN")
    if not (up or down):
        return None
    return int((up and o == "UP") or (down and o == "DOWN"))


def _pairs(rows: List[Dict[str, Any]]) -> List[Tuple[float, int, Optional[str]]]:
    """(predicted probability, hit 0/1, regime) for each usable directional call."""
    out: List[Tuple[float, int, Optional[str]]] = []
    for r in rows or []:
        if not isinstance(r, dict) or not _is_directional(r):
            continue
        p = _conf(r)
        hit = _correct(r)
        if p is None or hit is None:
            continue
        reg = r.get("regime") or r.get("regime_key")
        out.append((p, hit, str(reg) if reg else None))
    return out


def _reliability(pairs: List[Tuple[float, int, Optional[str]]]) -> List[Dict[str, Any]]:
    curve: List[Dict[str, Any]] = []
    for lo, hi in _BINS:
        lo_p, hi_p = lo / 100.0, hi / 100.0
        sub = [(p, h) for (p, h, _) in pairs if lo_p <= p < hi_p]
        if not sub:
            continue
        n = len(sub)
        mean_conf = sum(p for p, _ in sub) / n
        hit_rate = sum(h for _, h in sub) / n
        curve.append({
            "band": f"{lo}–{min(hi, 100)}%",
            "lo": lo,
            "hi": min(hi, 100),
            "n": n,
            "mean_conf_pct": round(100.0 * mean_conf, 1),
            "hit_rate_pct": round(100.0 * hit_rate, 1),
            "gap_pts": round(100.0 * (mean_conf - hit_rate), 1),
        })
    return curve


def _regime_table(pairs: List[Tuple[float, int, Optional[str]]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, List[Tuple[float, int]]] = {}
    for p, h, reg in pairs:
        key = reg or "unlabelled"
        buckets.setdefault(key, []).append((p, h))
    rows: List[Dict[str, Any]] = []
    other: List[Tuple[float, int]] = []
    for key, sub in buckets.items():
        if len(sub) < _MIN_PER_REGIME:
            other.extend(sub)
            continue
        rows.append(_regime_row(key, sub))
    if other:
        rows.append(_regime_row("other / thin", other))
    rows.sort(key=lambda r: r["n"], reverse=True)
    return rows


def _regime_row(name: str, sub: List[Tuple[float, int]]) -> Dict[str, Any]:
    n = len(sub)
    mean_conf = sum(p for p, _ in sub) / n
    hit_rate = sum(h for _, h in sub) / n
    return {
        "regime": name,
        "n": n,
        "mean_conf_pct": round(100.0 * mean_conf, 1),
        "hit_rate_pct": round(100.0 * hit_rate, 1),
        "gap_pts": round(100.0 * (mean_conf - hit_rate), 1),
        "brier": round(sum((p - h) ** 2 for p, h in sub) / n, 4),
    }


def _isotonic(curve: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Pool-adjacent-violators: force the reliability points to be non-decreasing
    in confidence, weighted by sample count. This is the honest fix for sparse
    high bins reading below low ones (e.g. a 4-sample 90% bin at 25%) — those
    get pooled with their neighbours rather than taken at face value.
    Returns anchor points {conf, calibrated} for interpolation.
    """
    blocks: List[Dict[str, float]] = []
    for b in curve:
        blocks.append({"conf": float(b["mean_conf_pct"]),
                       "val": float(b["hit_rate_pct"]),
                       "n": float(max(1, b["n"]))})
        while len(blocks) >= 2 and blocks[-2]["val"] > blocks[-1]["val"]:
            b2 = blocks.pop()
            b1 = blocks.pop()
            tot = b1["n"] + b2["n"]
            blocks.append({
                "conf": (b1["conf"] * b1["n"] + b2["conf"] * b2["n"]) / tot,
                "val": (b1["val"] * b1["n"] + b2["val"] * b2["n"]) / tot,
                "n": tot,
            })
    return [{"conf": round(b["conf"], 1), "calibrated": round(b["val"], 1)} for b in blocks]


def calibrate(raw_pct: float, model: List[Dict[str, Any]]) -> Optional[float]:
    """Map a stated confidence to what it has historically delivered."""
    if not model:
        return None
    try:
        x = float(raw_pct)
    except (TypeError, ValueError):
        return None
    if x <= model[0]["conf"]:
        return model[0]["calibrated"]
    if x >= model[-1]["conf"]:
        return model[-1]["calibrated"]
    for i in range(1, len(model)):
        a, b = model[i - 1], model[i]
        if a["conf"] <= x <= b["conf"]:
            span = b["conf"] - a["conf"]
            t = 0.0 if span <= 0 else (x - a["conf"]) / span
            return round(a["calibrated"] + t * (b["calibrated"] - a["calibrated"]), 1)
    return model[-1]["calibrated"]


def _translator(model: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """"When the desk says X, it has delivered Y" for reference confidences."""
    if not model:
        return []
    out = []
    for says in (60, 70, 75, 80, 85, 90):
        delivers = calibrate(says, model)
        if delivers is None:
            continue
        out.append({"says": says, "delivers": delivers,
                    "gap": round(says - delivers, 1)})
    return out


def _verdict(n: int, mean_conf: float, hit_rate: float) -> Dict[str, Any]:
    gap = 100.0 * (mean_conf - hit_rate)   # + = says more than it delivers
    if n < _MIN_FOR_VERDICT:
        return {
            "state": "gathering",
            "text": f"Only {n} settled directional call{'s' if n != 1 else ''} — "
                    f"need {_MIN_FOR_VERDICT} before the desk can be judged.",
        }
    if gap > _GAP_TOL:
        return {
            "state": "overconfident",
            "text": f"Overconfident by {gap:.0f} pts — it wins less than it claims. "
                    f"Reads of ~{100*mean_conf:.0f}% actually hit ~{100*hit_rate:.0f}%.",
        }
    if gap < -_GAP_TOL:
        return {
            "state": "underconfident",
            "text": f"Underconfident by {abs(gap):.0f} pts — it wins more than it claims. "
                    f"Reads of ~{100*mean_conf:.0f}% actually hit ~{100*hit_rate:.0f}%.",
        }
    return {
        "state": "calibrated",
        "text": f"Well calibrated — stated confidence tracks reality within {abs(gap):.0f} pts.",
    }


def build_calibration(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Score how well the desk's confidence matches its settled results."""
    pairs = _pairs(rows)
    n = len(pairs)
    if not n:
        return {
            "n": 0,
            "curve": [],
            "regimes": [],
            "verdict": {"state": "gathering", "text": "No settled directional calls yet."},
            "brier": None,
            "brier_skill": None,
            "ece_pts": None,
            "hit_rate_pct": None,
            "mean_conf_pct": None,
            "paper": True,
            "note": "Calibration scores the settled directional calls in the store. "
                    "Paper research only.",
        }

    mean_conf = sum(p for p, _, _ in pairs) / n
    hit_rate = sum(h for _, h, _ in pairs) / n
    brier = sum((p - h) ** 2 for p, h, _ in pairs) / n
    # Reference: always predict the base rate. Skill > 0 beats that.
    brier_ref = hit_rate * (1.0 - hit_rate)
    brier_skill = (1.0 - brier / brier_ref) if brier_ref > 1e-9 else None

    curve = _reliability(pairs)
    ece = 0.0
    for b in curve:
        ece += (b["n"] / n) * abs(b["mean_conf_pct"] - b["hit_rate_pct"])
    # Build the model from bands with enough samples to be real — a lone
    # noisy call shouldn't anchor the "true read".
    model = _isotonic([b for b in curve if b["n"] >= 3])

    return {
        "n": n,
        "curve": curve,
        "model": model,
        "translator": _translator(model),
        "regimes": _regime_table(pairs),
        "verdict": _verdict(n, mean_conf, hit_rate),
        "brier": round(brier, 4),
        "brier_skill": round(brier_skill, 3) if brier_skill is not None else None,
        "ece_pts": round(ece, 1),
        "hit_rate_pct": round(100.0 * hit_rate, 1),
        "mean_conf_pct": round(100.0 * mean_conf, 1),
        "paper": True,
        "note": "Calibration scores the settled directional calls in the store. "
                "Paper research only.",
    }
