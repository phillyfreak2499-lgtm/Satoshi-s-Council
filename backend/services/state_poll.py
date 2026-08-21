"""Thin /api/state poll: decision, clock, seat directions, health flags.

The Round Table asks for this every couple of seconds. Fat copies of
accuracy, weights, hierarchy, learning, huddle, and lifetime logs belong
on their own gated routes — not on the wire to every visitor.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Fields the 2s poll is allowed to carry. Everything else is a leak or ballast.
_AGENT_KEYS = (
    "agent_name",
    "display_name",
    "direction",
    "confidence",
    "muted",
    "faded",
    "category",
)
_DECISION_KEYS = (
    "direction",
    "confidence",
    "summary",
    "lean",
    "score",
    "lockdown",
)
_MARKET_KEYS = (
    "price",
    "funding",
    "oi",
    "kalshi_ticker",
    "ticker",
    "up_pct",
    "down_pct",
    "mins_left",
    "seconds_left",
    "close_time",
    "window_minutes",
    "stale",
)
_HEALTH_KEYS = (
    "kalshi",
    "binance",
    "coinbase",
    "coinglass",
    "coinglass_reason",
    "derivs_ok",
    "derivs_source",
    "spot_source",
    "last_fetch_ms",
    "quote_age_s",
)
_LOCKED_KEYS = ("direction", "confidence", "side", "asset")

# Must never ride the poll. SECURITY.md names these.
POLL_STRIP = frozenset({
    "accuracy",
    "weights",
    "hierarchy",
    "learning",
    "huddle",
    "lifetime",
    "log",
    "scorecard",
    "system_settings",
    "btc",
    "eth",
    "color_counts",
    "lock_timeline",
    "shadow_book",
    "last_settle_review",
    "ev_cents",
    "ev_phase",
    "p_finish",
    "quorum",
    "regime",
    "regime_key",
    "law",
    "beast_mode",
    "dual_spot",
    "parallel_agents",
    "sub_council_count",
    "mode_hint",
    "analysis_interval_s",
    "fetch_ms",
    "fetched_at",
    "signal_id",
    "mode",
})


def _pick(src: Any, keys: tuple) -> Dict[str, Any]:
    if not isinstance(src, dict):
        return {}
    out: Dict[str, Any] = {}
    for k in keys:
        if k in src and src[k] is not None:
            out[k] = src[k]
    return out


def _thin_agent(agent: Any) -> Dict[str, Any]:
    if not isinstance(agent, dict):
        return {}
    row = _pick(agent, _AGENT_KEYS)
    if "agent_name" not in row:
        name = agent.get("id") or agent.get("name") or agent.get("callsign")
        if name:
            row["agent_name"] = name
    if "display_name" not in row:
        disp = agent.get("name") or agent.get("callsign") or row.get("agent_name")
        if disp:
            row["display_name"] = disp
    if "direction" not in row:
        row["direction"] = "WAIT"
    return row


def _thin_locked(lock: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(lock, dict) or not lock:
        return None
    return _pick(lock, _LOCKED_KEYS) or None


def thin_table(table: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(table, dict) or not table:
        return None
    agents = table.get("agents") if isinstance(table.get("agents"), list) else []
    return {
        "timestamp": table.get("timestamp"),
        "asset": table.get("asset"),
        "leader_name": table.get("leader_name"),
        "decision": _pick(table.get("decision") or {}, _DECISION_KEYS),
        "agents": [_thin_agent(a) for a in agents],
        "market": _pick(table.get("market") or {}, _MARKET_KEYS),
        "health": _pick(table.get("health") or {}, _HEALTH_KEYS),
        "locked_call": _thin_locked(table.get("locked_call")),
    }


def thin_poll_state(state: Any) -> Dict[str, Any]:
    """Return the 2s poll body. Never include POLL_STRIP keys."""
    if not isinstance(state, dict):
        return {"dual": False, "agents": [], "decision": {"direction": "WAIT"}, "health": {}}
    tables_in = state.get("tables") if isinstance(state.get("tables"), dict) else {}
    btc_src = tables_in.get("bitcoin") or state.get("btc") or state
    eth_src = tables_in.get("ethereum") or state.get("eth")
    btc = thin_table(btc_src) or thin_table(state)
    eth = thin_table(eth_src) if isinstance(eth_src, dict) else None
    agents = state.get("agents") if isinstance(state.get("agents"), list) else (btc or {}).get("agents") or []
    out: Dict[str, Any] = {
        "timestamp": state.get("timestamp") or (btc or {}).get("timestamp"),
        "server_time": state.get("server_time"),
        "asset": state.get("asset") or (btc or {}).get("asset") or "btc",
        "dual": bool(state.get("dual") or eth),
        "leader_name": state.get("leader_name") or (btc or {}).get("leader_name"),
        "decision": _pick(state.get("decision") or (btc or {}).get("decision") or {}, _DECISION_KEYS),
        "agents": [_thin_agent(a) for a in agents],
        "market": _pick(state.get("market") or (btc or {}).get("market") or {}, _MARKET_KEYS),
        "health": _pick(state.get("health") or (btc or {}).get("health") or {}, _HEALTH_KEYS),
        "locked_call": _thin_locked(state.get("locked_call") or (btc or {}).get("locked_call")),
        "tables": {"bitcoin": btc, "ethereum": eth},
        "leaders": state.get("leaders") or {"bitcoin": "satoshi", "ethereum": "vitalik" if eth else None},
    }
    for banned in POLL_STRIP:
        out.pop(banned, None)
        if isinstance(out.get("tables"), dict):
            for t in out["tables"].values():
                if isinstance(t, dict):
                    t.pop(banned, None)
    return out
