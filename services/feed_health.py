"""
Feed health — is the desk looking at fresh data?

A research desk is only as good as its inputs. This turns the pipeline's
health flags and timestamps into one honest per-feed read: live / stale /
down, with a real last-success age wherever the pipeline records one.

Nothing here fetches or re-analyses. It reads the council's existing state
(the `health` dict, the public `market` payload, and the CoinGlass snapshot)
and frames it for a data-health panel.

Feed criticality:
  * SPOT and KALSHI are critical — no price or no market means no call.
  * DERIVATIVES (CoinGlass funding/OI/liquidations) degrades signal quality
    but the desk can still read without it.
  * ETH feeds VITALIK only, so its loss is contained to one advisor.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

# (live_below, stale_below) in seconds. Past stale_below → down.
_FAST = (20.0, 150.0)      # price feeds, refreshed every ~4.5s cycle
_KALSHI = (30.0, 240.0)    # Kalshi quote
_SLOW = (2400.0, 5400.0)   # CoinGlass 30m-bar derivatives: 40m live, 90m stale
_ANALYSIS = (30.0, 300.0)  # completed analyze_once passes (seats re-vote)


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _state_of(age: Optional[float], healthy: bool, thresh) -> str:
    """live / stale / down from an age and a health flag."""
    if not healthy:
        return "down"
    if age is None:
        return "live" if healthy else "down"   # healthy but no clock → trust flag
    live_below, stale_below = thresh
    if age <= live_below:
        return "live"
    if age <= stale_below:
        return "stale"
    return "down"


def _feed(name: str, key: str, state: str, *, critical: bool,
          age: Optional[float], value: Optional[str], detail: str) -> Dict[str, Any]:
    return {
        "name": name,
        "key": key,
        "state": state,
        "critical": critical,
        "age_s": round(age, 1) if age is not None else None,
        "age_text": _age_text(age),
        "value": value,
        "detail": detail,
    }


def _iso_age(ts: Any, now: float) -> Optional[float]:
    if not ts:
        return None
    try:
        from datetime import datetime
        t = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
        return max(0.0, now - t)
    except Exception:
        return None


def _age_text(age: Optional[float]) -> str:
    if age is None:
        return "—"
    a = int(age)
    if a < 90:
        return f"{a}s ago"
    if a < 5400:
        return f"{a // 60}m ago"
    return f"{a // 3600}h ago"


def build_feed_health(state: Dict[str, Any]) -> Dict[str, Any]:
    state = state if isinstance(state, dict) else {}
    tables = state.get("tables") if isinstance(state.get("tables"), dict) else {}
    btc = tables.get("bitcoin") or state.get("btc") or state
    eth = tables.get("ethereum") or state.get("eth")
    btc = btc if isinstance(btc, dict) else {}
    eth = eth if isinstance(eth, dict) else None

    health = btc.get("health") if isinstance(btc.get("health"), dict) else {}
    market = btc.get("market") if isinstance(btc.get("market"), dict) else {}
    coinglass = btc.get("coinglass") if isinstance(btc.get("coinglass"), dict) else {}

    now = time.time()
    snap_at = _num(btc.get("fetched_at")) or _num(state.get("fetched_at"))
    snap_age = (now - snap_at) if snap_at else None

    feeds: List[Dict[str, Any]] = []

    # ── 1. BTC spot price (critical) ──
    spot_ok = bool(health.get("binance") or health.get("coinbase") or health.get("cfb"))
    src = health.get("spot_source") or "—"
    px = _num(market.get("price"))
    feeds.append(_feed(
        "BTC Spot", "spot", _state_of(snap_age, spot_ok, _FAST),
        critical=True, age=snap_age,
        value=(f"${px:,.0f}" if px else "—"),
        detail=f"source: {src}",
    ))

    # ── 2. Kalshi 15m market (critical) ──
    kalshi_ok = bool(health.get("kalshi", True))
    quote_age = _num(health.get("quote_age_s"))
    if quote_age is None:
        quote_age = snap_age
    up = _num(market.get("up_pct")) or _num(market.get("up_mid"))
    tkr = str(market.get("kalshi_ticker") or market.get("ticker") or "").strip()
    feeds.append(_feed(
        "Kalshi 15m", "kalshi", _state_of(quote_age, kalshi_ok, _KALSHI),
        critical=True, age=quote_age,
        value=(f"UP {up:.0f}%" if up is not None else (tkr or "—")),
        detail=(tkr or "no live 15m market"),
    ))

    # ── 3. CoinGlass derivatives (funding / OI / liquidations) ──
    cg_ok = bool(health.get("coinglass"))
    cg_at = _num(coinglass.get("fetched_at"))
    cg_age = (now - cg_at) if cg_at else None
    fund = _num(market.get("funding"))
    oi = _num(market.get("oi"))
    cg_reason = health.get("coinglass_reason")
    cg_val_bits = []
    if fund is not None:
        cg_val_bits.append(f"funding {fund*100:+.3f}%" if abs(fund) < 1 else f"funding {fund:+.3f}")
    if oi is not None:
        cg_val_bits.append(f"OI {oi/1e9:.2f}B" if oi >= 1e9 else f"OI {oi/1e6:.0f}M")
    feeds.append(_feed(
        "CoinGlass Derivs", "coinglass", _state_of(cg_age, cg_ok, _SLOW),
        critical=False, age=cg_age,
        value=(" · ".join(cg_val_bits) if cg_val_bits else "—"),
        detail=(str(cg_reason) if (cg_reason and not cg_ok) else "funding · OI · liquidations"),
    ))

    # ── 4. ETH signal (feeds VITALIK only) ──
    if eth is not None:
        eth_h = eth.get("health") if isinstance(eth.get("health"), dict) else {}
        eth_m = eth.get("market") if isinstance(eth.get("market"), dict) else {}
        eth_ok = bool(eth_h.get("binance") or eth_h.get("coinbase") or eth_h.get("cfb"))
        eth_at = _num(eth.get("fetched_at")) or snap_at
        eth_age = (now - eth_at) if eth_at else None
        eth_px = _num(eth_m.get("price"))
        feeds.append(_feed(
            "ETH Signal", "eth", _state_of(eth_age, eth_ok, _FAST),
            critical=False, age=eth_age,
            value=(f"${eth_px:,.0f}" if eth_px else "—"),
            detail="feeds VITALIK",
        ))

    # ── 5. Analysis loop (critical) — are the seats actually re-voting? ──
    # The loop heartbeat keeps /health green through failed cycles by design
    # (Render must not restart-loop the desk), so this row is the honest tell:
    # `cycle` is the last loop outcome and `analysis_ok_at` only moves when a
    # full analyze pass completes. Frozen seats show up here, nowhere else.
    cycle = str(health.get("cycle") or "")
    ok_age = _iso_age(health.get("analysis_ok_at"), now)
    failing = cycle in ("error", "timeout", "lock_busy")
    if failing and (ok_age is None or ok_age > 60.0):
        a_state = "down"
    elif failing:
        a_state = "stale"
    else:
        a_state = _state_of(ok_age, True, _ANALYSIS)
    feeds.append(_feed(
        "Analysis", "analysis", a_state,
        critical=True, age=ok_age,
        value=(cycle or "—"),
        detail=(f"seats frozen at their last completed vote ({cycle})" if a_state == "down"
                else "seats re-vote every completed cycle"),
    ))

    # ── Overall roll-up ──
    crit = [f for f in feeds if f["critical"]]
    crit_down = [f for f in crit if f["state"] == "down"]
    any_stale = any(f["state"] == "stale" for f in feeds)
    any_down = any(f["state"] == "down" for f in feeds)
    if not state.get("running", True) and not feeds:
        overall = "warming"
    elif crit_down:
        overall = "down"
    elif any_down or any_stale:
        overall = "degraded"
    else:
        overall = "healthy"

    live_n = sum(1 for f in feeds if f["state"] == "live")
    return {
        "overall": overall,
        "summary": _summary(overall, live_n, len(feeds), crit_down),
        "live": live_n,
        "total": len(feeds),
        "feeds": feeds,
        "server_time": now,
        "note": "Freshness of the desk's inputs. Ages are last successful update. Paper research only.",
    }


def _summary(overall: str, live: int, total: int, crit_down: List[Dict[str, Any]]) -> str:
    if overall == "warming":
        return "Desk warming up — feeds hydrating."
    if overall == "down":
        names = ", ".join(f["name"] for f in crit_down)
        return f"Critical feed down: {names}. The desk should not be calling."
    if overall == "degraded":
        return f"{live} of {total} feeds live — running, but a feed is stale or down."
    return f"All {total} feeds live — the desk is on fresh data."
