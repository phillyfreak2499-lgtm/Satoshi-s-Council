"""
Higher-timeframe structure and the regime layer.

Two questions, asked before Satoshi is allowed to get aggressive:

  1. What is the higher-timeframe doing?  Uptrend, downtrend or range, and
     is that structure clean or messy.
  2. What regime are we in?  Risk-On, Risk-Off or Transition.

Neither produces a call. Both set the *posture* — how strong a call the
table is permitted to make, and how much alignment it needs first. In
Risk-Off or on weak structure the bar goes up and the default hardens
toward WAIT. Satoshi remains the only seat that decides.

DATA: the live feed is 1-minute candles capped at 90 bars — 90 minutes, not
4h or daily. So this module aggregates what it has, reports the timeframe it
actually achieved, and says so honestly rather than pretending a 90-minute
read is a daily bias. When history is too thin the structure is `unknown`,
which never loosens the bar; it only ever holds it or tightens it.

For a real 4h/daily read, register a provider:

    set_provider(lambda asset, tf: fetch_candles(asset, tf))
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

# ── Structure ─────────────────────────────────────────────────────────
UPTREND = "uptrend"
DOWNTREND = "downtrend"
RANGE = "range"
UNKNOWN = "unknown"

STRONG = "strong"
WEAK = "weak"

# ── Regime ────────────────────────────────────────────────────────────
RISK_ON = "Risk-On"
RISK_OFF = "Risk-Off"
TRANSITION = "Transition"

# Minimum aggregated bars before a structure read is trustworthy.
MIN_BARS = 6
# Swing lookback within the aggregated series (used for level detection).
SWING_WINDOW = 2
# Segments compared for higher-highs / higher-lows.
SEGMENTS = 3
# Range tolerance: highs/lows within this percent count as "equal".
EQUAL_PCT = 0.15
# Volatility that reads as hostile, percent range over the window.
HOT_VOL_PCT = 1.6
CALM_VOL_PCT = 0.6

_provider: Optional[Callable[[str, str], Any]] = None


def set_provider(fn: Optional[Callable[[str, str], Any]]) -> None:
    """Register a higher-timeframe candle source. None unregisters."""
    global _provider
    _provider = fn


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


def normalize_candles(raw: Any) -> List[Dict[str, float]]:
    """OHLC rows from whatever shape the feed used."""
    out: List[Dict[str, float]] = []
    if not isinstance(raw, list):
        return out
    for row in raw:
        if isinstance(row, dict):
            o = _pick(row, "open", "o")
            h = _pick(row, "high", "h")
            l = _pick(row, "low", "l")
            c = _pick(row, "close", "c")
        elif isinstance(row, (list, tuple)) and len(row) >= 5:
            o, h, l, c = _f(row[1]), _f(row[2]), _f(row[3]), _f(row[4])
        else:
            continue
        if None in (o, h, l, c):
            continue
        out.append({"open": o, "high": h, "low": l, "close": c})
    return out


def aggregate(candles: List[Dict[str, float]], factor: int) -> List[Dict[str, float]]:
    """Resample OHLC by an integer factor. Drops any trailing partial bar."""
    factor = max(1, int(factor))
    if factor == 1:
        return list(candles)
    out: List[Dict[str, float]] = []
    for i in range(0, len(candles) - factor + 1, factor):
        chunk = candles[i:i + factor]
        out.append({
            "open": chunk[0]["open"],
            "high": max(c["high"] for c in chunk),
            "low": min(c["low"] for c in chunk),
            "close": chunk[-1]["close"],
        })
    return out


def _segments(candles: List[Dict[str, float]], n: int) -> List[List[Dict[str, float]]]:
    """Split into n contiguous segments of near-equal length."""
    n = max(2, min(int(n), len(candles)))
    size = len(candles) / n
    out: List[List[Dict[str, float]]] = []
    for i in range(n):
        chunk = candles[int(round(i * size)):int(round((i + 1) * size))]
        if chunk:
            out.append(chunk)
    return out or [candles]


def _swings(candles: List[Dict[str, float]]) -> Dict[str, List[float]]:
    """Local swing highs and lows within the aggregated series."""
    highs: List[float] = []
    lows: List[float] = []
    w = SWING_WINDOW
    for i in range(w, len(candles) - w):
        window = candles[i - w:i + w + 1]
        c = candles[i]
        if c["high"] >= max(x["high"] for x in window):
            highs.append(c["high"])
        if c["low"] <= min(x["low"] for x in window):
            lows.append(c["low"])
    return {"highs": highs, "lows": lows}


def structure(candles: List[Dict[str, float]], *, timeframe: str = "aggregated") -> Dict[str, Any]:
    """
    Higher-timeframe bias from swing structure.

    Higher highs and higher lows is an uptrend; the mirror is a downtrend;
    anything else is a range. Quality is `strong` only when both the highs
    and the lows agree.
    """
    bars = len(candles)
    if bars < MIN_BARS:
        return {
            "available": False, "bias": UNKNOWN, "quality": WEAK,
            "timeframe": timeframe, "bars": bars,
            "swing_high": None, "swing_low": None, "levels": [],
            "range_pct": None,
            "note": f"only {bars} bars — not enough for a structure read",
        }

    # Bias comes from segment extremes, not local swing pivots. A clean
    # monotonic trend has no local pivots at all — every bar is beaten by the
    # next — so a pivot-only reading calls a textbook uptrend a "range".
    # Comparing the high and low of consecutive segments is what "higher
    # highs and higher lows" actually means, and it handles ranges too.
    segs = _segments(candles, SEGMENTS)
    highs = [max(c["high"] for c in seg) for seg in segs]
    lows = [min(c["low"] for c in seg) for seg in segs]
    hi = max(c["high"] for c in candles)
    lo = min(c["low"] for c in candles)
    last = candles[-1]["close"]
    range_pct = ((hi - lo) / lo * 100.0) if lo else None

    def _rising(vals: List[float]) -> Optional[bool]:
        if len(vals) < 2:
            return None
        first, final = vals[0], vals[-1]
        if first == 0:
            return None
        delta_pct = (final - first) / abs(first) * 100.0
        if abs(delta_pct) < EQUAL_PCT:
            return None       # equal highs / lows — no slope
        return delta_pct > 0

    hh = _rising(highs)
    hl = _rising(lows)

    if hh is True and hl is True:
        bias, quality = UPTREND, STRONG
    elif hh is False and hl is False:
        bias, quality = DOWNTREND, STRONG
    elif hh is True or hl is True:
        bias, quality = UPTREND, WEAK
    elif hh is False or hl is False:
        bias, quality = DOWNTREND, WEAK
    else:
        bias, quality = RANGE, WEAK

    return {
        "available": True,
        "bias": bias,
        "quality": quality,
        "timeframe": timeframe,
        "bars": bars,
        "swing_high": hi,
        "swing_low": lo,
        "last": last,
        "range_pct": round(range_pct, 3) if range_pct is not None else None,
        # Key levels the table should respect: the extremes of the window.
        "levels": [
            {"price": lo, "kind": "support"},
            {"price": hi, "kind": "resistance"},
        ],
        "note": "",
    }


def read_structure(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    Best available higher-timeframe read.

    A registered provider wins. Otherwise the 1m feed is aggregated as far
    as the bar count allows, and the achieved timeframe is reported so a
    90-minute read is never mislabelled as daily.
    """
    table = table if isinstance(table, dict) else {}
    asset = str(table.get("asset") or "btc").lower()

    if _provider is not None:
        for tf in ("1d", "4h"):
            try:
                rows = normalize_candles(_provider(asset, tf))
            except Exception:
                rows = []
            if len(rows) >= MIN_BARS:
                return structure(rows, timeframe=tf)

    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    raw = normalize_candles(market.get("candles"))
    if not raw:
        return structure([], timeframe="unavailable")

    # 1m bars. Aggregate to the largest timeframe that still leaves enough
    # bars to read structure from.
    for factor, label in ((60, "1h"), (30, "30m"), (15, "15m"), (5, "5m"), (1, "1m")):
        agg = aggregate(raw, factor)
        if len(agg) >= MIN_BARS:
            return structure(agg, timeframe=label)
    return structure(raw, timeframe="1m")


# ── Regime ────────────────────────────────────────────────────────────
def classify_regime(table: Dict[str, Any], struct: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Risk-On / Risk-Off / Transition from structure, volatility and the
    positioning reads RAIJIN already owns.

    Scored rather than branched, so no single input can flip the regime on
    its own. Negative score is risk-off.
    """
    table = table if isinstance(table, dict) else {}
    struct = struct or read_structure(table)
    market = table.get("market") if isinstance(table.get("market"), dict) else {}

    score = 0.0
    reasons: List[str] = []

    bias, quality = struct.get("bias"), struct.get("quality")
    if bias == UPTREND:
        score += 2.0 if quality == STRONG else 1.0
        reasons.append(f"{struct.get('timeframe')} {bias}")
    elif bias == DOWNTREND:
        score -= 2.0 if quality == STRONG else 1.0
        reasons.append(f"{struct.get('timeframe')} {bias}")
    elif bias == RANGE:
        reasons.append(f"{struct.get('timeframe')} range")

    vol = _pick(market, "vol_pct", "realized_vol_pct", "atr_pct")
    if vol is None:
        vol = struct.get("range_pct")
    if vol is not None:
        if vol >= HOT_VOL_PCT:
            score -= 1.5
            reasons.append(f"volatility hot ({vol:.2f}%)")
        elif vol <= CALM_VOL_PCT:
            score += 0.5
            reasons.append("volatility calm")

    # Positioning: reuse RAIJIN's existing reads rather than re-deriving.
    try:
        from backend.services.funding_analysis import EXTREME, read_funding

        fund = read_funding(table)
        if fund.get("state") == EXTREME:
            score -= 1.5
            reasons.append("funding extreme")
        elif fund.get("state") == "Elevated":
            score -= 0.5
            reasons.append("funding elevated")
    except Exception:
        pass
    try:
        from backend.services.oi_analysis import EXTREME as OI_EXTREME, read_oi

        oi = read_oi(table)
        if oi.get("state") == OI_EXTREME:
            score -= 1.0
            reasons.append("OI expansion extreme")
    except Exception:
        pass
    try:
        from backend.services.liquidation_map import DANGEROUS, liq_hud

        if liq_hud(table).get("state") == DANGEROUS:
            score -= 1.5
            reasons.append("liquidation wall next to price")
    except Exception:
        pass

    if score >= 1.5:
        state = RISK_ON
    elif score <= -1.5:
        state = RISK_OFF
    else:
        state = TRANSITION

    return {
        "state": state,
        "score": round(score, 2),
        "reasons": reasons,
        "structure": struct,
        "summary": f"{state} — " + ("; ".join(reasons) if reasons else "no strong signals"),
    }


# ── Posture ───────────────────────────────────────────────────────────
def posture(regime: Dict[str, Any], *, base_alignment: int = 3) -> Dict[str, Any]:
    """
    How aggressive Satoshi is allowed to be.

    Never produces a call and never loosens below the base rule — it only
    holds the bar or raises it. Risk-Off and weak structure both harden the
    default toward WAIT; a long-side call is capped before a short-side one,
    because buying into a hostile regime is the worse mistake.
    """
    state = regime.get("state") or TRANSITION
    struct = regime.get("structure") or {}
    bias = struct.get("bias")
    quality = struct.get("quality")
    weak_structure = (not struct.get("available")) or quality == WEAK or bias == UNKNOWN

    min_alignment = int(base_alignment)
    cap_long = False
    cap_short = False
    notes: List[str] = []

    if state == RISK_OFF:
        min_alignment = 4
        cap_long = True
        notes.append("Risk-Off — long side capped, unanimity required")
    elif state == TRANSITION:
        if weak_structure:
            min_alignment = 4
            notes.append("Transition on unclear structure — unanimity required")
        else:
            cap_long = bias == DOWNTREND
            if cap_long:
                notes.append("Transition against a downtrend — long side capped")
    else:  # Risk-On
        if weak_structure:
            notes.append("Risk-On but structure unclear — full-strength call withheld")
            cap_long = True
            cap_short = True

    # Structure that flatly opposes a side caps it regardless of regime.
    if bias == DOWNTREND and quality == STRONG:
        cap_long = True
        notes.append("HTF downtrend — no full long")
    if bias == UPTREND and quality == STRONG:
        cap_short = True
        notes.append("HTF uptrend — no full short")

    return {
        "regime": state,
        "bias": bias,
        "quality": quality,
        "timeframe": struct.get("timeframe"),
        "min_alignment": min_alignment,
        "cap_long": cap_long,
        "cap_short": cap_short,
        "reason": "; ".join(notes),
        "tightened": min_alignment > base_alignment or cap_long or cap_short,
    }


def htf_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload — regime, bias, timeframe and the posture it sets."""
    reg = classify_regime(table)
    pos = posture(reg)
    struct = reg["structure"]
    return {
        "available": bool(struct.get("available")),
        "regime": reg["state"],
        "score": reg["score"],
        "bias": struct.get("bias"),
        "quality": struct.get("quality"),
        "timeframe": struct.get("timeframe"),
        "bars": struct.get("bars"),
        "support": struct.get("swing_low"),
        "resistance": struct.get("swing_high"),
        "min_alignment": pos["min_alignment"],
        "cap_long": pos["cap_long"],
        "cap_short": pos["cap_short"],
        "reason": pos["reason"] or reg["summary"],
        "note": struct.get("note") or "",
        "tone": {RISK_ON: "ok", TRANSITION: "warn", RISK_OFF: "hot"}[reg["state"]],
    }
