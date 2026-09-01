"""
Liquidation flow — who is actually being forced out, and how fast.

This is the companion to liquidation_map. The map is where leverage *rests*;
this is where it is *dying*. A wall two percent away is a hazard; longs
liquidating in size right now, accelerating, with price walking toward the
next cluster, is a cascade in progress.

Derived signals:

    1. Recent long liquidation pressure     forced selling
    2. Recent short liquidation pressure    forced buying
    3. Acceleration                         latest bar vs the window mean
    4. Price moving into a dense region     flow + map together
    5. Stress state                         Quiet / Active / Cascade risk

Aggregates are preferred over tick-by-tick prints: a single large print is
noise, a rising run of them is information. Everything reads through the
rolling windows, so one absurd bar cannot manufacture a cascade.

DATA. Three shapes are accepted, in order of preference:

    provider        set_provider(lambda symbol: ...)  — events or bars
    table snapshot  coinglass.liq_history  (the live wiring today)
    aggregates      coinglass.liq_long_usd / liq_short_usd

Events look like {"ts":…, "side":"long", "notional":…, "price":…,
"symbol":"BTC", "exchange":…} and are bucketed into bars internally. BTC
first; other symbols pass through untouched. A dark feed produces Quiet and
raises nothing.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from backend.services.rolling import RollingWindow

QUIET = "Quiet"
ACTIVE = "Active"
CASCADE = "Cascade risk"

# ── Thresholds ────────────────────────────────────────────────────────
# Notional in the recent window that counts as busy / violent, in USD.
ACTIVE_USD = 2_000_000.0
CASCADE_USD = 10_000_000.0
# Latest bar vs the window mean that counts as accelerating.
ACCEL_RATIO = 2.0
# One side holding this share of the flow is a one-way liquidation run.
LOPSIDED = 0.70
# Bars kept for the flow window.
WINDOW_BARS = 24

_provider: Optional[Callable[[str], Any]] = None
_bars: Dict[str, RollingWindow] = {}
_bar_keys: Dict[str, Any] = {}


def set_provider(fn: Optional[Callable[[str], Any]]) -> None:
    """Register an events/bars source. Called with the symbol. None clears."""
    global _provider
    _provider = fn


def reset_flow() -> None:
    """Tests only."""
    _bars.clear()
    _bar_keys.clear()


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


def parse_events(raw: Any) -> List[Dict[str, Any]]:
    """
    Normalize liquidation events into
    {ts, side, notional, price, symbol, exchange}.

    Rows without a usable side or size are dropped rather than guessed at.
    """
    out: List[Dict[str, Any]] = []
    if isinstance(raw, dict):
        raw = raw.get("events") or raw.get("data") or raw.get("liquidations") or []
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        side = str(row.get("side") or row.get("direction") or "").strip().lower()
        if side in ("buy", "short", "shorts"):
            side = "short"
        elif side in ("sell", "long", "longs"):
            side = "long"
        else:
            continue
        notional = _pick(row, "notional", "size", "usd", "amount", "qty_usd", "turnover")
        if notional is None or notional <= 0:
            continue
        out.append({
            "ts": _pick(row, "ts", "time", "timestamp", "t"),
            "side": side,
            "notional": float(notional),
            "price": _pick(row, "price", "p"),
            "symbol": str(row.get("symbol") or row.get("pair") or "BTC").upper(),
            "exchange": row.get("exchange") or row.get("source"),
        })
    return out


def events_to_bar(events: List[Dict[str, Any]]) -> Dict[str, float]:
    """Collapse a batch of events into one long/short notional bar."""
    long_usd = sum(e["notional"] for e in events if e["side"] == "long")
    short_usd = sum(e["notional"] for e in events if e["side"] == "short")
    return {"long_usd": long_usd, "short_usd": short_usd}


def parse_bars(raw: Any) -> List[Dict[str, float]]:
    """Aggregate bars, in the shape backend.data.coinglass already emits."""
    out: List[Dict[str, float]] = []
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        lng = _pick(row, "long_usd", "long_liquidation_usd", "longLiquidationUsd", "long")
        sht = _pick(row, "short_usd", "short_liquidation_usd", "shortLiquidationUsd", "short")
        if lng is None and sht is None:
            continue
        out.append({
            "t": _pick(row, "t", "ts", "time"),
            "long_usd": float(lng or 0.0),
            "short_usd": float(sht or 0.0),
        })
    return out


def _series(symbol: str, side: str) -> RollingWindow:
    key = f"{symbol}:{side}"
    if key not in _bars:
        _bars[key] = RollingWindow(maxlen=WINDOW_BARS)
    return _bars[key]


def _track(symbol: str, long_usd: float, short_usd: float, key: Any) -> None:
    """One sample per feed snapshot, however many readers call in."""
    if key is not None and _bar_keys.get(symbol) == key:
        return
    if key is not None:
        _bar_keys[symbol] = key
    _series(symbol, "long").add(max(0.0, long_usd))
    _series(symbol, "short").add(max(0.0, short_usd))


def read_flow(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recent liquidation pressure by side, plus acceleration.

    Reads a registered provider first, then the table's own liq history,
    then the plain aggregates. Everything degrades to unavailable.
    """
    table = table if isinstance(table, dict) else {}
    symbol = str(table.get("asset") or "btc").upper()
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}

    latest: Optional[Dict[str, float]] = None
    source = ""

    if _provider is not None:
        try:
            raw = _provider(symbol)
        except Exception:
            raw = None
        events = parse_events(raw)
        if events:
            latest = events_to_bar(events)
            source = "events"
        else:
            bars = parse_bars(raw)
            if bars:
                latest = bars[-1]
                source = "provider_bars"

    if latest is None:
        bars = parse_bars(cg.get("liq_history"))
        if bars:
            latest = bars[-1]
            source = "liq_history"

    if latest is None:
        lng = _pick(cg, "liq_long_usd")
        sht = _pick(cg, "liq_short_usd")
        if lng is not None or sht is not None:
            latest = {"long_usd": float(lng or 0.0), "short_usd": float(sht or 0.0)}
            source = "aggregate"

    if latest is None:
        return {
            "available": False, "symbol": symbol, "source": "",
            "long_usd": None, "short_usd": None, "total_usd": None,
            "dominant": None, "share": None, "accelerating": False,
            "accel_ratio": None, "bars": 0,
        }

    snap_key = cg.get("t") or table.get("timestamp") or market.get("close_time") or (
        "v", latest.get("long_usd"), latest.get("short_usd")
    )
    _track(symbol, latest.get("long_usd", 0.0), latest.get("short_usd", 0.0), snap_key)

    longs = _series(symbol, "long")
    shorts = _series(symbol, "short")
    long_usd = longs.current() or 0.0
    short_usd = shorts.current() or 0.0
    total = long_usd + short_usd

    # Acceleration: latest bar against the mean of the window. Needs a few
    # bars before it means anything.
    accel_ratio = None
    accelerating = False
    combined_mean = None
    if longs.ready(3):
        means = [(longs.mean() or 0.0) + (shorts.mean() or 0.0)]
        combined_mean = means[0]
        if combined_mean and combined_mean > 0:
            accel_ratio = round(total / combined_mean, 2)
            accelerating = accel_ratio >= ACCEL_RATIO

    dominant = None
    share = None
    if total > 0:
        dominant = "long" if long_usd >= short_usd else "short"
        share = round(max(long_usd, short_usd) / total, 3)

    return {
        "available": True,
        "symbol": symbol,
        "source": source,
        "long_usd": long_usd,
        "short_usd": short_usd,
        "total_usd": total,
        "window_mean_usd": combined_mean,
        "dominant": dominant,
        "share": share,
        "accelerating": accelerating,
        "accel_ratio": accel_ratio,
        "bars": len(longs),
    }


def into_cluster(table: Dict[str, Any], flow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Is price walking toward a dense liquidation region?

    Combines the resting map with price direction: falling into a long wall,
    or rising into a short wall, is the setup that turns flow into cascade.
    """
    out = {"into": False, "side": None, "distance_pct": None}
    try:
        from backend.services.liquidation_map import liq_hud
    except ImportError:
        return out
    hud = liq_hud(table)
    if not hud.get("available"):
        return out
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    move = _pick(market, "price_change_pct_1h", "change_pct_1h", "pct_1h", "price_change_pct")
    if move is None:
        return out
    nl, ns = hud.get("nearest_long"), hud.get("nearest_short")
    if move < 0 and nl:
        out = {"into": True, "side": "long", "distance_pct": nl.get("distance_pct")}
    elif move > 0 and ns:
        out = {"into": True, "side": "short", "distance_pct": ns.get("distance_pct")}
    return out


def flow_state(flow: Dict[str, Any], cluster: Dict[str, Any]) -> str:
    """Quiet / Active / Cascade risk."""
    if not flow.get("available"):
        return QUIET
    total = flow.get("total_usd") or 0.0
    accel = bool(flow.get("accelerating"))
    lopsided = (flow.get("share") or 0.0) >= LOPSIDED
    heading_in = bool(cluster.get("into"))

    if total >= CASCADE_USD and accel and (lopsided or heading_in):
        return CASCADE
    if total >= ACTIVE_USD and accel and lopsided and heading_in:
        return CASCADE
    if total >= ACTIVE_USD or accel:
        return ACTIVE
    return QUIET


def _usd(v: Optional[float]) -> str:
    if not v:
        return "$0"
    if v >= 1_000_000_000:
        return f"${v / 1_000_000_000:.1f}B"
    if v >= 1_000_000:
        return f"${v / 1_000_000:.1f}M"
    if v >= 1_000:
        return f"${v / 1_000:.0f}K"
    return f"${v:.0f}"


def flow_signal(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    RAIJIN's liquidation-flow read: state, direction bias, short reason.

    Forced flow is a reason to stand aside, so this returns Stand down or
    Reduce and never Accumulate.
    """
    from backend.services.round_table import REDUCE, WAIT

    flow = read_flow(table)
    if not flow["available"]:
        return {**flow, "state": QUIET, "cluster": {"into": False},
                "direction": WAIT, "confidence": 0,
                "reason": "No liquidation feed — forced flow unreadable.", "caution": False}

    cluster = into_cluster(table, flow)
    state = flow_state(flow, cluster)
    side = flow.get("dominant")
    where = "below price" if side == "long" else "above price"
    size = _usd(flow.get("total_usd"))

    if state == CASCADE:
        bits = [f"{side} liquidations accelerating {where}"]
        if cluster.get("into"):
            bits.append(f"price moving into a {cluster['side']} cluster")
        return {
            **flow, "state": state, "cluster": cluster,
            "direction": REDUCE if side == "long" else WAIT,
            "confidence": 85,
            "reason": f"Cascade risk — {', '.join(bits)} ({size}).",
            "caution": True,
        }
    if state == ACTIVE:
        note = " and accelerating" if flow.get("accelerating") else ""
        return {
            **flow, "state": state, "cluster": cluster,
            "direction": WAIT, "confidence": 55,
            "reason": f"Active liquidations {where}{note} ({size}).",
            "caution": False,
        }
    return {
        **flow, "state": state, "cluster": cluster,
        "direction": WAIT, "confidence": 10,
        "reason": f"Liquidations quiet ({size}).",
        "caution": False,
    }


def flow_caution(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """RAIJIN's protective caution when a cascade is running."""
    sig = flow_signal(table)
    if not sig.get("caution"):
        return None
    side = sig.get("dominant") or "long"
    where = "below price" if side == "long" else "above price"
    return {
        "leader": "raijin",
        "code": "liq_cascade",
        "reason": f"{side} liquidations accelerating {where}",
        "detail": sig["reason"],
    }


# Sub-score for the Microstructure Risk Score, 0-100.
_STATE_SCORE = {QUIET: 0.0, ACTIVE: 55.0, CASCADE: 100.0}


def flow_score(table: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Component contribution, or None when the feed is dark."""
    sig = flow_signal(table)
    if not sig.get("available"):
        return None
    score = _STATE_SCORE.get(sig["state"], 0.0)
    if sig["state"] == ACTIVE and sig.get("cluster", {}).get("into"):
        score = min(100.0, score + 15.0)
    return {"score": score, "state": sig["state"], "detail": sig.get("dominant") or "flat"}


def flow_hud(table: Dict[str, Any]) -> Dict[str, Any]:
    """Compact payload for the risk panel."""
    sig = flow_signal(table)
    return {
        "available": bool(sig.get("available")),
        "state": sig.get("state", QUIET),
        "long_usd": sig.get("long_usd"),
        "short_usd": sig.get("short_usd"),
        "long_label": _usd(sig.get("long_usd")),
        "short_label": _usd(sig.get("short_usd")),
        "dominant": sig.get("dominant"),
        "accelerating": bool(sig.get("accelerating")),
        "accel_ratio": sig.get("accel_ratio"),
        "into_cluster": bool((sig.get("cluster") or {}).get("into")),
        "reason": sig.get("reason"),
        "source": sig.get("source"),
        "bars": sig.get("bars"),
        "tone": {QUIET: "ok", ACTIVE: "warn", CASCADE: "hot"}[sig.get("state", QUIET)],
    }
