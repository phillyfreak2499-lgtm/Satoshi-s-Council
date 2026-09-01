"""
Liquidation heatmap — where the forced sellers and forced buyers sit.

Leverage stacks at round numbers and prior highs. When price walks into a
dense cluster, the fills that follow are not opinion — they are margin calls,
and they move faster than any read the table can make. So a wall nearby is a
reason to stand aside, not a reason to pick a side.

Geometry, which is the whole model:

    long liquidations sit BELOW price    longs blow out as price falls
    short liquidations sit ABOVE price   shorts blow out as price rises

    price nearing a big long wall  → cascade risk on a breakdown
    price nearing a big short wall → squeeze risk on a breakout

Risk state is Clear / Nearby / Dangerous. Dangerous raises a RAIJIN veto.

DATA: the current CoinGlass wiring returns aggregate liquidation totals, not
price-bucketed levels, so there is no live heatmap feed today. This module is
the interface waiting for one. Point a provider at `set_provider()`, or put
levels on the table snapshot under "liq_levels" in the documented shape:

    [{"price": 64000, "long_liq": 12.5, "short_liq": 4.2}, ...]

With no levels the whole module returns Clear and raises nothing, so nothing
downstream changes until a feed exists.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.services.rolling import RollingWindow
from backend.services.round_table import REDUCE, WAIT

# ── Risk states ───────────────────────────────────────────────────────
CLEAR = "Clear"
NEARBY = "Nearby"
DANGEROUS = "Dangerous"

# ── Thresholds ────────────────────────────────────────────────────────
# Distance from spot, as a percent of price.
DANGER_PCT = 0.5
NEAR_PCT = 1.5
# A cluster is "major" when it is this many times the median bucket AND
# holds at least this share of everything on the map.
MAJOR_MULT = 3.0
MAJOR_SHARE = 0.08
# Band used for the "dense overhead / underneath" check.
DENSE_BAND_PCT = 1.0
DENSE_SHARE = 0.30
# History depth for building-vs-clearing.
SNAPSHOTS = 20

_provider: Optional[Callable[[str], Any]] = None


def set_provider(fn: Optional[Callable[[str], Any]]) -> None:
    """
    Register a heatmap source. Called with the asset ("btc"/"eth") and
    expected to return levels in any shape `parse_levels` understands.
    Pass None to unregister.
    """
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


def parse_levels(raw: Any) -> List[Dict[str, float]]:
    """
    Normalize a provider payload into [{price, long_liq, short_liq}].

    Accepts the documented dict rows, the [price, long, short] triples some
    feeds emit, and a {price: size} map where the side is inferred from spot
    later. Anything unparseable is dropped rather than guessed at.
    """
    out: List[Dict[str, float]] = []
    if isinstance(raw, dict):
        raw = raw.get("levels") or raw.get("data") or raw.get("heatmap") or []
    if not isinstance(raw, list):
        return out
    for row in raw:
        price = long_liq = short_liq = None
        if isinstance(row, dict):
            price = _pick(row, "price", "p", "level", "strike")
            long_liq = _pick(row, "long_liq", "long", "long_usd", "longLiquidationUsd")
            short_liq = _pick(row, "short_liq", "short", "short_usd", "shortLiquidationUsd")
        elif isinstance(row, (list, tuple)) and len(row) >= 2:
            price = _f(row[0])
            long_liq = _f(row[1]) if len(row) > 1 else None
            short_liq = _f(row[2]) if len(row) > 2 else None
        if price is None:
            continue
        out.append({
            "price": price,
            "long_liq": max(0.0, long_liq or 0.0),
            "short_liq": max(0.0, short_liq or 0.0),
        })
    out.sort(key=lambda r: r["price"])
    return out


def read_levels(table: Dict[str, Any]) -> List[Dict[str, float]]:
    """Levels from a registered provider, else off the table snapshot."""
    table = table if isinstance(table, dict) else {}
    asset = str(table.get("asset") or "btc").lower()
    if _provider is not None:
        try:
            got = parse_levels(_provider(asset))
            if got:
                return got
        except Exception:
            pass
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    for src in (table.get("liq_levels"), cg.get("liq_levels"), cg.get("liquidation_levels")):
        got = parse_levels(src)
        if got:
            return got
    return []


def _spot(table: Dict[str, Any]) -> Optional[float]:
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    price = _pick(market, "price", "last", "spot", "mark")
    if price is not None:
        return price
    candles = market.get("candles")
    if isinstance(candles, list) and candles:
        last = candles[-1]
        return _pick(last, "close", "c") if isinstance(last, dict) else _f(last)
    return None


def _median(vals: List[float]) -> float:
    vals = sorted(v for v in vals if v > 0)
    if not vals:
        return 0.0
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def major_walls(
    levels: List[Dict[str, float]],
    spot: float,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    (long walls below spot, short walls above spot), each major and sorted
    nearest-first. Only the side that can actually liquidate is considered:
    longs below, shorts above.
    """
    sizes = [r["long_liq"] for r in levels] + [r["short_liq"] for r in levels]
    total = sum(sizes)
    med = _median(sizes)
    if total <= 0:
        return [], []

    def _major(size: float) -> bool:
        return size > 0 and (med <= 0 or size >= MAJOR_MULT * med) and (size / total) >= MAJOR_SHARE

    longs: List[Dict[str, Any]] = []
    shorts: List[Dict[str, Any]] = []
    for row in levels:
        price = row["price"]
        dist_pct = abs(price - spot) / spot * 100.0 if spot else None
        if price < spot and _major(row["long_liq"]):
            longs.append({"price": price, "size": row["long_liq"], "side": "long",
                          "distance_pct": dist_pct, "share": row["long_liq"] / total})
        elif price > spot and _major(row["short_liq"]):
            shorts.append({"price": price, "size": row["short_liq"], "side": "short",
                           "distance_pct": dist_pct, "share": row["short_liq"] / total})
    longs.sort(key=lambda r: r["distance_pct"] if r["distance_pct"] is not None else 1e9)
    shorts.sort(key=lambda r: r["distance_pct"] if r["distance_pct"] is not None else 1e9)
    return longs, shorts


def density(levels: List[Dict[str, float]], spot: float) -> Dict[str, Optional[float]]:
    """Share of all liquidation size sitting just above and just below spot."""
    total = sum(r["long_liq"] + r["short_liq"] for r in levels)
    if total <= 0 or not spot:
        return {"below_share": None, "above_share": None}
    band = spot * DENSE_BAND_PCT / 100.0
    below = sum(r["long_liq"] for r in levels if 0 < (spot - r["price"]) <= band)
    above = sum(r["short_liq"] for r in levels if 0 < (r["price"] - spot) <= band)
    return {"below_share": below / total, "above_share": above / total}


# Recent nearest-wall size per asset, so we can say building vs clearing.
# RollingWindow is __slots__-based, so the per-asset dedupe key lives here
# rather than being stapled onto the window instance.
_history: Dict[str, RollingWindow] = {}
_history_keys: Dict[str, Any] = {}


def _track(asset: str, size: float, key: Any) -> str:
    win = _history.setdefault(asset, RollingWindow(maxlen=SNAPSHOTS))
    # One sample per feed snapshot, however many readers call in.
    if key is not None and _history_keys.get(asset) == key:
        return win.trend()
    if key is not None:
        _history_keys[asset] = key
    win.add(size)
    return win.trend()


def reset_history() -> None:
    """Tests only."""
    _history.clear()
    _history_keys.clear()


def read_map(table: Dict[str, Any]) -> Dict[str, Any]:
    """The whole liquidation picture for one table."""
    table = table if isinstance(table, dict) else {}
    asset = str(table.get("asset") or "btc").lower()
    levels = read_levels(table)
    spot = _spot(table)

    if not levels or spot is None or spot <= 0:
        return {
            "asset": asset, "available": False, "spot": spot, "levels": 0,
            "state": CLEAR, "nearest_long": None, "nearest_short": None,
            "below_share": None, "above_share": None, "trend": "flat",
            "walls_long": [], "walls_short": [],
        }

    longs, shorts = major_walls(levels, spot)
    dens = density(levels, spot)
    nearest_long = longs[0] if longs else None
    nearest_short = shorts[0] if shorts else None

    nearest = min(
        [w for w in (nearest_long, nearest_short) if w],
        key=lambda w: w["distance_pct"],
        default=None,
    )
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    trend = _track(asset, nearest["size"] if nearest else 0.0,
                   cg.get("t") or table.get("timestamp"))

    state = CLEAR
    if nearest is not None:
        if nearest["distance_pct"] <= DANGER_PCT:
            state = DANGEROUS
        elif nearest["distance_pct"] <= NEAR_PCT:
            state = NEARBY
    # A dense stack right under or over price is dangerous even without one
    # single dominant wall.
    if state != DANGEROUS:
        for share in (dens["below_share"], dens["above_share"]):
            if share is not None and share >= DENSE_SHARE:
                state = DANGEROUS if state == NEARBY else NEARBY

    return {
        "asset": asset, "available": True, "spot": spot, "levels": len(levels),
        "state": state,
        "nearest_long": nearest_long,
        "nearest_short": nearest_short,
        "below_share": dens["below_share"],
        "above_share": dens["above_share"],
        "trend": trend,
        "walls_long": longs[:3],
        "walls_short": shorts[:3],
    }


def liq_signal(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    RAIJIN's liquidation read: direction bias, confidence, short reason.
    A wall is a reason to stand aside, never a reason to pick a side, so
    this returns WAIT or REDUCE and never BUY ZONE.
    """
    read = read_map(table)
    if not read["available"]:
        return {**read, "direction": WAIT, "confidence": 0,
                "reason": "No liquidation map — cluster risk unreadable.",
                "veto": False}

    nl, ns = read["nearest_long"], read["nearest_short"]
    if read["state"] == CLEAR:
        return {**read, "direction": WAIT, "confidence": 10,
                "reason": "No major liquidation cluster near price.", "veto": False}

    nearest = min([w for w in (nl, ns) if w], key=lambda w: w["distance_pct"], default=None)
    building = " Cluster still building." if read["trend"] == "up" else ""
    danger = read["state"] == DANGEROUS

    if nearest is None:
        side = "below" if (read["below_share"] or 0) >= (read["above_share"] or 0) else "above"
        return {**read, "direction": WAIT, "confidence": 70 if danger else 45,
                "reason": f"Dense liquidation stack {side} price." + building,
                "veto": danger}

    where = "below" if nearest["side"] == "long" else "above"
    if nearest["side"] == "long":
        reason = (f"Large long liquidation wall {where} at {nearest['price']:,.0f} "
                  f"({nearest['distance_pct']:.2f}% away) — cascade risk on a breakdown.")
        direction = REDUCE if danger else WAIT
    else:
        reason = (f"Large short liquidation wall {where} at {nearest['price']:,.0f} "
                  f"({nearest['distance_pct']:.2f}% away) — squeeze risk on a breakout.")
        direction = WAIT
    return {**read, "direction": direction, "confidence": 80 if danger else 50,
            "reason": reason + building, "veto": danger}


def liq_veto(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """RAIJIN's veto when a dangerous cluster sits next to price."""
    sig = liq_signal(table)
    if not sig.get("veto"):
        return None
    nl, ns = sig.get("nearest_long"), sig.get("nearest_short")
    nearest = min([w for w in (nl, ns) if w], key=lambda w: w["distance_pct"], default=None)
    if nearest is None:
        reason = "dense liquidation stack next to price"
    elif nearest["side"] == "long":
        reason = "large long liquidation wall just below"
    else:
        reason = "large short liquidation wall just above"
    return {
        "leader": "raijin",
        "code": "liq_wall_" + (nearest["side"] if nearest else "dense"),
        "reason": reason,
        "detail": sig["reason"],
    }


def liq_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compact payload: risk state plus the nearest wall each side. Enough to
    render a strip without shipping the whole map to the browser.
    """
    read = read_map(table)
    nl, ns = read["nearest_long"], read["nearest_short"]

    def _w(w):
        if not w:
            return None
        return {"price": round(w["price"], 2),
                "distance_pct": round(w["distance_pct"], 3),
                "share": round(w["share"], 4)}

    return {
        "available": read["available"],
        "state": read["state"],
        "spot": read["spot"],
        "nearest_long": _w(nl),
        "nearest_short": _w(ns),
        "below_share": round(read["below_share"], 4) if read["below_share"] is not None else None,
        "above_share": round(read["above_share"], 4) if read["above_share"] is not None else None,
        "trend": read["trend"],
        "tone": {CLEAR: "ok", NEARBY: "warn", DANGEROUS: "hot"}[read["state"]],
    }
