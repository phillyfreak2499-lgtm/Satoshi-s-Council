"""
Walk-forward backtest — is the desk's edge real, stable, and holding up?

The cleanest backtest a live desk has is its own forward record: every graded
call was a genuine out-of-sample prediction made in real time, with no
lookahead and real market friction. Replaying stored calls therefore beats a
reconstructed historical backtest on honesty — its only limit is how much
history has accumulated.

This module measures three things over the graded directional calls:

  Out-of-sample     Train on the older calls, test on the newer held-out
                    slice. If the desk is overfit or decaying, the newer slice
                    is materially worse. If edge is real, they agree.
  Walk-forward      Accuracy / Brier per chronological period, so drift shows
                    up as a trend rather than hiding in an average.
  Sufficiency       An honest read on whether there is enough history — and
                    enough time span — to trust any of the above yet.

Directional calls only (WAIT is not a forecast). Paper research only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.services.calibration import _conf, _correct, _is_directional

_OOS_FRACTION = 0.30       # newest 30% held out as the out-of-sample test
_DECAY_TOL = 6.0           # OOS accuracy this many pts below IS → flag decay
_MAX_PERIODS = 6


def _time_key(r: Dict[str, Any]) -> Tuple[str, int]:
    t = r.get("called_at") or r.get("settled_at") or ""
    return (str(t), int(r.get("id") or 0))


def _span_hours(rows: List[Dict[str, Any]]) -> Optional[float]:
    ts = []
    for r in rows:
        t = r.get("called_at") or r.get("settled_at")
        if not t:
            continue
        try:
            ts.append(datetime.fromisoformat(str(t).replace("Z", "+00:00")))
        except Exception:
            pass
    if len(ts) < 2:
        return None
    return max(0.0, (max(ts) - min(ts)).total_seconds() / 3600.0)


def _stats(pairs: List[Tuple[float, int]]) -> Optional[Dict[str, Any]]:
    n = len(pairs)
    if not n:
        return None
    mean_conf = sum(p for p, _ in pairs) / n
    hit = sum(h for _, h in pairs) / n
    brier = sum((p - h) ** 2 for p, h in pairs) / n
    return {
        "n": n,
        "accuracy_pct": round(100.0 * hit, 1),
        "mean_conf_pct": round(100.0 * mean_conf, 1),
        "gap_pts": round(100.0 * (mean_conf - hit), 1),
        "brier": round(brier, 4),
    }


def _sufficiency(n: int, span_h: Optional[float]) -> Dict[str, Any]:
    if n < 30:
        state = "insufficient"
    elif n < 100:
        state = "thin"
    elif n < 500:
        state = "usable"
    else:
        state = "robust"
    short_span = span_h is not None and span_h < 48.0
    days = (span_h / 24.0) if span_h else None
    if state == "insufficient":
        msg = f"Only {n} settled directional calls — not enough to trust a backtest yet."
    elif short_span:
        msg = (f"{n} calls over ~{span_h:.0f}h. Enough to gauge intraday stability, but this is "
               f"one stretch of market — not multiple regimes. Read it as recent-conditions only.")
    else:
        msg = f"{n} calls over ~{days:.0f} days — enough history for a meaningful walk-forward."
    return {"state": state, "n": n, "span_hours": round(span_h, 1) if span_h else None,
            "short_span": short_span, "text": msg}


def _periods(seq: List[Tuple[str, float, int]]) -> List[Dict[str, Any]]:
    n = len(seq)
    if n < 2:
        return []
    k = max(2, min(_MAX_PERIODS, n // 20))   # ~20+ calls per period
    out: List[Dict[str, Any]] = []
    size = n // k
    for i in range(k):
        lo = i * size
        hi = n if i == k - 1 else (i + 1) * size
        chunk = seq[lo:hi]
        st = _stats([(p, h) for (_, p, h) in chunk])
        if not st:
            continue
        st["idx"] = i + 1
        st["from"] = chunk[0][0][:16].replace("T", " ")
        st["to"] = chunk[-1][0][:16].replace("T", " ")
        out.append(st)
    return out


def _trend(periods: List[Dict[str, Any]]) -> Dict[str, Any]:
    pts = [p["accuracy_pct"] for p in periods]
    if len(pts) < 2:
        return {"state": "flat", "slope_pts": 0.0}
    # slope of accuracy across periods (simple least-squares over index)
    m = len(pts)
    xs = list(range(m))
    mx = sum(xs) / m
    my = sum(pts) / m
    num = sum((x - mx) * (y - my) for x, y in zip(xs, pts))
    den = sum((x - mx) ** 2 for x in xs) or 1.0
    slope = num / den                      # pts per period
    total = slope * (m - 1)
    if total > 4:
        state = "improving"
    elif total < -4:
        state = "declining"
    else:
        state = "stable"
    return {"state": state, "slope_pts": round(slope, 2), "total_pts": round(total, 1)}


def _verdict(oos: Optional[Dict[str, Any]], is_: Optional[Dict[str, Any]],
             suff: Dict[str, Any], trend: Dict[str, Any]) -> Dict[str, Any]:
    if suff["state"] == "insufficient" or not oos or not is_:
        return {"state": "gathering",
                "text": "Not enough settled calls to hold any slice out. Keep the desk running."}
    drop = is_["accuracy_pct"] - oos["accuracy_pct"]
    if drop > _DECAY_TOL:
        return {"state": "decay",
                "text": (f"Out-of-sample accuracy is {drop:.0f} pts below in-sample "
                         f"({is_['accuracy_pct']:.0f}% → {oos['accuracy_pct']:.0f}%). "
                         "The edge may be overfit to older conditions or decaying — treat live reads with caution.")}
    if oos["accuracy_pct"] >= is_["accuracy_pct"] - _DECAY_TOL and oos["accuracy_pct"] >= 52:
        base = ("Edge holds out-of-sample — newer calls match the older ones "
                f"({is_['accuracy_pct']:.0f}% vs {oos['accuracy_pct']:.0f}%).")
        if trend["state"] == "declining":
            base += " But the period trend is drifting down — watch it."
        return {"state": "holds", "text": base}
    return {"state": "weak",
            "text": (f"Out-of-sample accuracy is {oos['accuracy_pct']:.0f}% — near or below a coin flip. "
                     "No demonstrated directional edge yet on the held-out slice.")}


def build_backtest(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    usable = [r for r in (rows or [])
              if isinstance(r, dict) and _is_directional(r)
              and _conf(r) is not None and _correct(r) is not None]
    usable.sort(key=_time_key)
    n = len(usable)
    span_h = _span_hours(usable)
    suff = _sufficiency(n, span_h)

    seq: List[Tuple[str, float, int]] = [
        (str(r.get("called_at") or r.get("settled_at") or ""), _conf(r), _correct(r))
        for r in usable
    ]
    pairs = [(p, h) for (_, p, h) in seq]

    # Out-of-sample split (chronological).
    is_stats = oos_stats = None
    if n >= 30:
        cut = int(round(n * (1.0 - _OOS_FRACTION)))
        cut = max(1, min(n - 1, cut))
        is_stats = _stats(pairs[:cut])
        oos_stats = _stats(pairs[cut:])

    periods = _periods(seq)
    trend = _trend(periods)
    overall = _stats(pairs)

    return {
        "n": n,
        "sufficiency": suff,
        "overall": overall,
        "in_sample": is_stats,
        "out_of_sample": oos_stats,
        "oos_fraction": _OOS_FRACTION,
        "periods": periods,
        "trend": trend,
        "verdict": _verdict(oos_stats, is_stats, suff, trend),
        "paper": True,
        "note": ("Walk-forward over the desk's live forward record — a lookahead-free backtest. "
                 "A true across-regimes backtest needs historical replay. Paper research only."),
    }
