"""
Kalshi 15-minute BTC up/down — a lens, not a new engine.

This adds no bots and runs no new analysis. It takes the read the council is
ALREADY producing (the round-table board: leader leans, alignment, Satoshi's
call, the microstructure risk) and the Kalshi 15m market data the pipeline
already fetches, and frames both for the up/down question that market asks:
"will BTC finish this 15-minute window up or down?"

Design:

  * LEAN is the headline — the side the desk is leaning (UP/DOWN) and how many
    leaders agree. It shows even when Satoshi stands down, because for a fast
    market "leaning UP but not committed" is useful information.
  * Satoshi's CALL is the discipline overlay — mostly "Stand down", which is
    the honest answer for a process desk. It gates whether you'd actually play.
  * The Kalshi ODDS (implied up %) sit alongside, and the EDGE is the gap
    between the desk's lean and the market's price.

Paper research only. Nothing here places or recommends a live order.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

# UP lean → YES side (finishes up); DOWN lean → NO side (finishes down).
LEAN_UP = "UP"
LEAN_DOWN = "DOWN"
FLAT = "FLAT"


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
        v = _f(src.get(k))
        if v is not None:
            return v
    return None


def _seconds_left(market: Dict[str, Any]) -> Optional[float]:
    secs = _pick(market, "seconds_left", "time_remaining")
    if secs is not None:
        return max(0.0, secs)
    mins = _pick(market, "mins_left")
    if mins is not None:
        return max(0.0, mins * 60.0)
    close = market.get("close_time")
    if close:
        try:
            ct = datetime.fromisoformat(str(close).replace("Z", "+00:00"))
            return max(0.0, (ct - datetime.now(timezone.utc)).total_seconds())
        except Exception:
            return None
    return None


def _clock(secs: Optional[float]) -> str:
    if secs is None:
        return "—:—"
    s = int(secs)
    return f"{s // 60:02d}:{s % 60:02d}"


def _implied_up_pct(market: Dict[str, Any]) -> Optional[float]:
    """
    Market-implied probability of UP, in percent. Kalshi 'yes' on a BTC-up
    market is exactly that. Prefer an explicit field, else the yes bid/ask mid.
    """
    up = _pick(market, "up_pct", "up_mid")
    if up is not None:
        return up
    bid = _pick(market, "kalshi_yes_bid")
    ask = _pick(market, "kalshi_yes_ask")
    if bid is not None and ask is not None:
        return (bid + ask) / 2.0
    if bid is not None:
        return bid
    if ask is not None:
        return ask
    return None


# Council call → whether this is a side worth playing at all.
_DIRECTIONAL_CALLS = ("Accumulate", "Reduce", "Maintain")


def build_view(
    btc_table: Dict[str, Any],
    board: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Assemble the Kalshi 15m lens from the existing BTC table + council board.
    Everything here is derived; nothing is fetched or re-analysed.
    """
    btc_table = btc_table if isinstance(btc_table, dict) else {}
    board = board if isinstance(board, dict) else {}
    market = btc_table.get("market") if isinstance(btc_table.get("market"), dict) else {}
    final = board.get("final") if isinstance(board.get("final"), dict) else {}
    alignment = board.get("alignment") if isinstance(board.get("alignment"), dict) else {}
    risk = board.get("risk") if isinstance(board.get("risk"), dict) else {}

    # ── The lean (headline) — reuse the council's dominant side ──
    side = final.get("side")  # "UP" / "DOWN" / None, survives a Stand down
    lean = LEAN_UP if side == "UP" else (LEAN_DOWN if side == "DOWN" else FLAT)
    aligned = int(final.get("aligned") or 0)
    of = int(final.get("of") or 4)
    # Strength blends how many leaders agree with their conviction.
    leaders = board.get("debate") if isinstance(board.get("debate"), list) else []
    agree_conf = [
        int(d.get("confidence") or 0)
        for d in leaders
        if isinstance(d, dict) and _dir(d) == side and side in ("UP", "DOWN")
    ]
    conviction = int(round(sum(agree_conf) / len(agree_conf))) if agree_conf else 0
    lean_strength = int(round((aligned / of) * 60 + (conviction / 100) * 40)) if side else 0

    # ── Satoshi's discipline overlay ──
    call = str(final.get("call") or "Stand down")
    play = call in _DIRECTIONAL_CALLS
    confluence_ok = bool(final.get("confluence_ok"))

    # ── Market odds + edge ──
    up_pct = _implied_up_pct(market)
    # Desk-implied up probability from the lean, for the edge comparison.
    if lean == LEAN_UP:
        desk_up = 50 + lean_strength / 2.0
    elif lean == LEAN_DOWN:
        desk_up = 50 - lean_strength / 2.0
    else:
        desk_up = 50.0
    edge = None
    edge_side = None
    if up_pct is not None:
        edge = round(desk_up - up_pct, 1)
        if abs(edge) >= 5:
            edge_side = "UP" if edge > 0 else "DOWN"

    secs = _seconds_left(market)
    micro = risk.get("micro") if isinstance(risk.get("micro"), dict) else {}

    # ── Floor detail: each leader's own read, so the 15m tab shows what's
    #    actually happening around the table, not just the summary. ──
    floor = []
    for d in leaders:
        if not isinstance(d, dict):
            continue
        ldir = _dir(d)
        floor.append({
            "name": (d.get("callsign") or d.get("leader") or d.get("name") or "").strip() or "—",
            "side": ldir or FLAT,
            "call": str(d.get("call") or "—"),
            "confidence": int(d.get("confidence") or 0),
            "rank": d.get("rank"),
            "vetoed": bool(d.get("vetoed")),
            "agrees": bool(side in ("UP", "DOWN") and ldir == side),
        })
    floor.sort(key=lambda x: (x["rank"] is None, x["rank"] if x["rank"] is not None else 99))

    veto_lines = [str(v) for v in (board.get("veto_lines") or []) if v][:3]
    caution_lines = [str(v) for v in (board.get("caution_lines") or []) if v][:3]

    return {
        "market": "Kalshi · BTC 15m up/down",
        "ticker": (market.get("kalshi_ticker") or market.get("ticker") or "").strip() or None,
        "price": _pick(market, "price", "last", "spot"),
        "window": {
            "seconds_left": int(secs) if secs is not None else None,
            "clock": _clock(secs),
            "closing_soon": bool(secs is not None and secs <= 60),
        },
        # Headline: which way the existing bots lean.
        "lean": {
            "side": lean,
            "strength": lean_strength,
            "aligned": aligned,
            "of": of,
            "conviction": conviction,
            "text": _lean_text(lean, aligned, of, lean_strength),
        },
        # Discipline: what Satoshi actually calls (mostly Stand down).
        "satoshi": {
            "call": call,
            "play": play,
            "confluence_ok": confluence_ok,
            "voice": final.get("voice") or final.get("summary"),
        },
        # The market's own price + the gap vs the desk.
        "odds": {
            "up_pct": round(up_pct, 1) if up_pct is not None else None,
            "down_pct": round(100 - up_pct, 1) if up_pct is not None else None,
            "yes_bid": _pick(market, "kalshi_yes_bid"),
            "yes_ask": _pick(market, "kalshi_yes_ask"),
            "available": up_pct is not None,
        },
        "edge": {
            "value": edge,
            "side": edge_side,
            "text": _edge_text(edge, edge_side),
        },
        "risk": {
            "state": micro.get("state"),
            "score": micro.get("score"),
            "reason": micro.get("reason"),
        },
        # What's on the floor: alignment count, each leader's read, and any
        # protective veto / caution lines the desk is holding right now.
        "floor": {
            "alignment": {
                "aligned": aligned,
                "of": of,
                "state": alignment.get("state") or alignment.get("label"),
                "text": alignment.get("text") or alignment.get("summary"),
            },
            "leaders": floor,
            "veto_lines": veto_lines,
            "caution_lines": caution_lines,
        },
        "paper": True,
        "note": "Research lens on the existing council read. Paper only — not a live order.",
    }


def _dir(leader: Dict[str, Any]) -> Optional[str]:
    """Map a leader's call back to the internal UP/DOWN side."""
    c = str(leader.get("call") or "").upper()
    if c in ("ACCUMULATE", "MAINTAIN"):
        return "UP"
    if c == "REDUCE":
        return "DOWN"
    d = str(leader.get("direction") or "").upper()
    if d in ("UP", "UP_HOLD"):
        return "UP"
    if d in ("DOWN", "DOWN_HOLD"):
        return "DOWN"
    return None


def _lean_text(lean: str, aligned: int, of: int, strength: int) -> str:
    if lean == FLAT:
        return "No side — the floor is split."
    word = "up" if lean == LEAN_UP else "down"
    return f"Leaning {word} · {aligned} of {of} leaders · {strength}% strength"


def _edge_text(edge: Optional[float], side: Optional[str]) -> str:
    if edge is None:
        return "No market price to compare."
    if side is None:
        return "Desk and market roughly agree."
    word = "up" if side == "UP" else "down"
    return f"Desk leans {word} ~{abs(edge):.0f} pts richer than the market."
