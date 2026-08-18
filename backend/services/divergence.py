"""
Funding / price divergence — positioning and price disagreeing.

When price and funding point the same way, the move has leverage behind it.
When they split, someone is wrong: either the crowd is paying to hold a
position price is not rewarding, or price is moving without the leverage
that usually drives it. Both are reasons to stop chasing.

Four checks, in priority order:

  1. Funding vs price   price up while funding falls (or is deeply negative),
                        or price down while funding rises (or is deeply
                        positive)
  2. Exhaustion         funding stays elevated but price stops progressing —
                        the crowd is paying and getting nothing
  3. Cross-exchange     one venue's funding far from the others
  4. BTC vs ETH         one asset crowded while the other is not

Output is a state — None / Mild / Strong — and a short reason. Divergence
is a CAUTION, never a hard veto: it raises Satoshi's bar toward WAIT and
softens a full-strength call, but it cannot by itself force the table to sit
or produce a directional call.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.services.funding_analysis import ELEVATED_PCT, EXTREME_PCT, read_funding
from backend.services.rolling import DOWN, FLAT, UP
from backend.services.round_table import REDUCE, WAIT

# ── States ────────────────────────────────────────────────────────────
NONE = "None"
MILD = "Mild"
STRONG = "Strong"

# ── Thresholds (blunt on purpose) ─────────────────────────────────────
# Price move over the divergence window that counts as "going somewhere".
PRICE_MOVE_PCT = 0.5
PRICE_STRONG_PCT = 1.2
# Price move small enough to count as "no progress" for exhaustion.
PRICE_STALL_PCT = 0.25
# Funding drift that counts as a real trend, not float noise.
FUNDING_DRIFT = 0.004
FUNDING_STRONG_DRIFT = 0.012
# Cross-exchange spread between the widest venues.
XEX_MILD = 0.02
XEX_STRONG = 0.05
# BTC vs ETH funding gap.
CROSS_ASSET_GAP = 0.05

# How many samples before the rolling reads are trustworthy.
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
        if isinstance(last, dict):
            return _pick(last, "close", "c")
        return _f(last)
    return None


def exchange_funding(table: Dict[str, Any]) -> Dict[str, float]:
    """
    Per-venue funding, when the feed carries it. Tolerates the shapes
    CoinGlass-style providers tend to use; returns {} when absent so the
    cross-exchange check simply does not fire.
    """
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    raw = cg.get("funding_by_exchange") or cg.get("exchange_funding") or cg.get("funding_exchanges")
    out: Dict[str, float] = {}
    if isinstance(raw, dict):
        for name, val in raw.items():
            num = _f(val) if not isinstance(val, dict) else _pick(val, "funding_rate", "rate", "value")
            if num is not None:
                out[str(name)] = num
    elif isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = row.get("exchange") or row.get("name")
            num = _pick(row, "funding_rate", "rate", "value")
            if name and num is not None:
                out[str(name)] = num
    return out


def _series(asset: str, kind: str):
    from backend.services.filters import series_for

    return series_for(asset, kind)


def read_divergence(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Track funding and price together and report any disagreement.

    Both series run through the shared spike-guard + Kalman filters, so a
    single bad print cannot manufacture a divergence.
    """
    table = table if isinstance(table, dict) else {}
    asset = str(table.get("asset") or "btc").lower()
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}

    funding = read_funding(table)
    rate = funding.get("rate_pct")

    # Price rides the same filter stack, keyed to the feed snapshot so many
    # readers in one cycle do not push the same sample repeatedly.
    price = _price_of(table)
    snap_key = (cg.get("t") or table.get("timestamp")
                or market.get("close_time") or ("v", price))
    price_series = _series(asset, "price")
    if price is not None:
        price_series.update(price, key=snap_key)
    funding_series = _series(asset, "funding")

    price_change_pct = price_series.smooth.change_pct()
    price_trend = price_series.trend()
    funding_change = funding_series.smooth.change()
    funding_trend = funding_series.trend(FUNDING_DRIFT)

    ready = price_series.ready(MIN_SAMPLES) and funding_series.ready(MIN_SAMPLES)

    return {
        "asset": asset,
        "funding_pct": rate,
        "funding_trend": funding_trend,
        "funding_change": funding_change,
        "price": price,
        "price_change_pct": price_change_pct,
        "price_trend": price_trend,
        "exchanges": exchange_funding(table),
        "eth_funding_pct": read_funding(eth_table).get("rate_pct") if isinstance(eth_table, dict) else None,
        "samples": min(len(price_series.smooth), len(funding_series.smooth)),
        "ready": ready,
    }


def _funding_vs_price(read: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Price and funding pointing opposite ways."""
    move = read.get("price_change_pct")
    rate = read.get("funding_pct")
    drift = read.get("funding_change")
    if move is None or rate is None or drift is None:
        return None
    if abs(move) < PRICE_MOVE_PCT:
        return None

    rising_price = move >= PRICE_MOVE_PCT
    falling_price = move <= -PRICE_MOVE_PCT
    funding_falling = drift <= -FUNDING_DRIFT
    funding_rising = drift >= FUNDING_DRIFT

    strong_move = abs(move) >= PRICE_STRONG_PCT
    strong_drift = abs(drift) >= FUNDING_STRONG_DRIFT

    if rising_price and (funding_falling or rate <= -ELEVATED_PCT):
        deep = rate <= -ELEVATED_PCT
        return {
            "kind": "funding_vs_price",
            "state": STRONG if (strong_move and (strong_drift or deep)) else MILD,
            "direction": WAIT,
            "reason": (
                f"price rising {move:+.2f}% while funding "
                + (f"is deeply negative ({rate:+.3f}%)" if deep else f"falls ({drift:+.4f})")
            ),
        }
    if falling_price and (funding_rising or rate >= ELEVATED_PCT):
        deep = rate >= ELEVATED_PCT
        return {
            "kind": "funding_vs_price",
            # Longs still paying into a falling price is the more dangerous
            # of the two, so this one can argue REDUCE rather than just WAIT.
            "state": STRONG if (strong_move and (strong_drift or deep)) else MILD,
            "direction": REDUCE if deep else WAIT,
            "reason": (
                f"price falling {move:+.2f}% while funding "
                + (f"stays deeply positive ({rate:+.3f}%)" if deep else f"rises ({drift:+.4f})")
            ),
        }
    return None


def _exhaustion(read: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Funding elevated but price has stopped making progress."""
    move = read.get("price_change_pct")
    rate = read.get("funding_pct")
    if move is None or rate is None:
        return None
    if abs(rate) < ELEVATED_PCT or abs(move) > PRICE_STALL_PCT:
        return None
    side = "longs" if rate > 0 else "shorts"
    return {
        "kind": "exhaustion",
        "state": STRONG if abs(rate) >= EXTREME_PCT else MILD,
        "direction": REDUCE if rate > 0 else WAIT,
        "reason": (
            f"funding {rate:+.3f}% with price stalled ({move:+.2f}%) — "
            f"{side} paying for no progress"
        ),
    }


def _cross_exchange(read: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One venue's funding far from the rest."""
    ex = read.get("exchanges") or {}
    if len(ex) < 2:
        return None
    hi_name, hi = max(ex.items(), key=lambda kv: kv[1])
    lo_name, lo = min(ex.items(), key=lambda kv: kv[1])
    gap = hi - lo
    if gap < XEX_MILD:
        return None
    return {
        "kind": "cross_exchange",
        "state": STRONG if gap >= XEX_STRONG else MILD,
        "direction": WAIT,
        "reason": f"funding split across venues — {hi_name} {hi:+.3f}% vs {lo_name} {lo:+.3f}%",
    }


def _cross_asset(read: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One of BTC / ETH crowded while the other is not."""
    btc = read.get("funding_pct")
    eth = read.get("eth_funding_pct")
    if btc is None or eth is None:
        return None
    gap = abs(btc - eth)
    if gap < CROSS_ASSET_GAP:
        return None
    crowded = "BTC" if abs(btc) > abs(eth) else "ETH"
    return {
        "kind": "cross_asset",
        "state": MILD,  # informative, never on its own a strong signal
        "direction": WAIT,
        "reason": f"{crowded} crowded while the other is not (BTC {btc:+.3f}% vs ETH {eth:+.3f}%)",
    }


def divergence_signal(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    RAIJIN's divergence read: state, direction bias, one short reason.

    Strong divergence prefers WAIT or REDUCE. It never produces a BUY ZONE —
    disagreement between price and positioning is not a reason to buy.
    """
    read = read_divergence(table, eth_table=eth_table)
    if not read["ready"]:
        return {
            **read,
            "state": NONE,
            "direction": WAIT,
            "confidence": 0,
            "reason": "Not enough funding/price history to judge divergence.",
            "findings": [],
            "caution": False,
        }

    findings = [
        f for f in (
            _funding_vs_price(read),
            _exhaustion(read),
            _cross_exchange(read),
            _cross_asset(read),
        ) if f
    ]
    if not findings:
        return {
            **read,
            "state": NONE,
            "direction": WAIT,
            "confidence": 10,
            "reason": "Funding and price agree — no divergence.",
            "findings": [],
            "caution": False,
        }

    strong = [f for f in findings if f["state"] == STRONG]
    lead = strong[0] if strong else findings[0]
    state = STRONG if strong else MILD
    # REDUCE only when a finding actually argues for it; otherwise WAIT.
    direction = REDUCE if any(f["direction"] == REDUCE for f in (strong or findings)) else WAIT

    return {
        **read,
        "state": state,
        "direction": direction,
        "confidence": 75 if state == STRONG else 45,
        "reason": f"{state} divergence — {lead['reason']}.",
        "findings": findings,
        # Only a Strong divergence raises a caution at Satoshi's table.
        "caution": state == STRONG,
    }


def divergence_caution(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    RAIJIN's protective caution, or None. Shape mirrors a veto entry but is
    handled as a soft signal: it raises Satoshi's bar, it does not force WAIT.
    """
    sig = divergence_signal(table, eth_table=eth_table)
    if not sig.get("caution"):
        return None
    lead = (sig.get("findings") or [{}])[0]
    return {
        "leader": "raijin",
        "code": "divergence_" + str(lead.get("kind") or "funding_price"),
        "reason": "funding/price divergence",
        "detail": sig["reason"],
    }


def divergence_hud(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Compact payload — state and one line, for the market strip."""
    sig = divergence_signal(table, eth_table=eth_table)
    return {
        "state": sig["state"],
        "available": bool(sig.get("ready")),
        "direction": sig["direction"],
        "reason": sig["reason"],
        "kinds": [f["kind"] for f in sig.get("findings") or []],
        "tone": {NONE: "ok", MILD: "warn", STRONG: "hot"}[sig["state"]],
    }
