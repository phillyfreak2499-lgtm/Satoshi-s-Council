"""
Cool callsigns for Satoshi's Council members.

Internal agent keys stay stable (candle_btc / candle_eth, volume, …) for weights + logic.
Display names are what the Round Table and Debate Log show.
"""
from __future__ import annotations
from typing import Dict, Optional, Tuple

# Main specialists: key → (callsign, title)
MAIN_ROSTER: Dict[str, Tuple[str, str]] = {
    "candle": ("WICK", "Pattern Seer"),  # legacy — remapped; not a live desk seat
    "candle_btc": ("WICK", "Bitcoin Pattern Specialist"),
    "candle_eth": ("WICK", "Ethereum Pattern Specialist"),
    "volume": ("PULSE", "Flow Reader"),
    "momentum": ("DRIFT", "Trend Scout"),
    "orderflow": ("TAPE", "Book Walker"),
    "funding": ("CARRY", "Rate Oracle"),
    "regime": ("ORBIT", "Regime Watch"),
    "volatility": ("VOLT", "Vol Scout"),
    "oi_pressure": ("CHAIN", "OI Pressure"),
    "streak": ("STREAK", "Path Reader"),
    "odds": ("ODDS", "Kalshi Skew"),
    "strike": ("STRIKE", "Strike Scout"),
    "session_tod": ("CLOCK", "Session Clock"),
    "whale": ("WHALE", "Whale Tape"),
    "quorum": ("QUORUM", "Floor Count"),
    "panic": ("FADE", "Panic Fade"),
    "cheap": ("CHEAP", "Value Side"),
    "spotlag": ("VEL", "Spot Lag"),
    "news": ("WIRE", "Sentiment Desk"),
    "liq": ("CASCADE", "Liq Cluster"),
    "exhaust": ("EXHAUST", "Run Fade"),
    "guardian": ("WARDEN", "System Guard"),
    "law": ("LAW", "Enforcer"),
    "leader": ("CHAIR", "The Gavel"),
    "chair": ("CHAIR", "The Gavel"),
}

# Sub-council micro-bots: "parent.sid" or just sid → (callsign, title)
SUB_ROSTER: Dict[str, Tuple[str, str]] = {
    "body": ("CORE", "Body Reader"),
    "structure": ("FRAME", "Structure Scout"),
    # WICK pattern unit — pin / engulf / marubozu / doji / star
    "pin": ("PIN", "Pin Bar Scout"),
    "engulf": ("SWALLOW", "Engulf Reader"),
    "marubozu": ("BLADE", "Marubozu Edge"),
    "doji": ("VOID", "Doji Confirm"),
    "star": ("TRINE", "Star Pattern"),
    "spike": ("SURGE", "Spike Hunter"),
    "dryup": ("ECHO", "Dry-up Watch"),
    "rsi": ("RIFT", "RSI Scout"),
    "macd": ("SWING", "MACD Reader"),
    "book": ("LEDGER", "Book Depth"),
    "taker": ("EDGE", "Taker Flow"),
    "rate": ("YIELD", "Funding Rate"),
    "crowding": ("SWARM", "Crowding Sense"),
    "session": ("CLOCK", "Session Clock"),
    "volband": ("BAND", "Vol Band"),
    "binance_feed": ("NODE-B", "Binance Feed"),
    "kalshi_feed": ("NODE-K", "Kalshi Feed"),
    "atr": ("ATR", "ATR Band"),
    "impulse": ("IMP", "Impulse"),
    "crowd": ("CROWD", "Crowd Sense"),
    "path": ("PATH", "OI Path"),
    "run": ("RUN", "Streak Run"),
    "fade": ("FADE", "Stretch Fade"),
    "mid": ("MID", "Odds Mid"),
    "skew": ("SKEW", "Odds Skew"),
}


def display_name(agent_key: str) -> str:
    """Resolve a cool callsign for any agent key (main or parent.sub)."""
    if not agent_key:
        return "UNKNOWN"
    if agent_key in MAIN_ROSTER:
        return MAIN_ROSTER[agent_key][0]
    if "." in agent_key:
        parent, sid = agent_key.split(".", 1)
        if sid in SUB_ROSTER:
            return SUB_ROSTER[sid][0]
        # fallback: parent callsign + sub key
        parent_name = MAIN_ROSTER.get(parent, (parent.upper(),))[0]
        return f"{parent_name}.{sid.upper()}"
    if agent_key in SUB_ROSTER:
        return SUB_ROSTER[agent_key][0]
    return agent_key.upper()


def title_of(agent_key: str) -> str:
    """Short role title for tooltips / dashboard cards."""
    if agent_key in MAIN_ROSTER:
        return MAIN_ROSTER[agent_key][1]
    if "." in agent_key:
        sid = agent_key.split(".", 1)[1]
        if sid in SUB_ROSTER:
            return SUB_ROSTER[sid][1]
    if agent_key in SUB_ROSTER:
        return SUB_ROSTER[agent_key][1]
    return ""


def roster_payload() -> dict:
    """Public roster map for the frontend (optional /api/roster)."""
    mains = {
        k: {"display_name": v[0], "title": v[1], "role": "main"}
        for k, v in MAIN_ROSTER.items()
        if k not in ("leader", "chair")
    }
    mains["chair"] = {
        "display_name": MAIN_ROSTER["chair"][0],
        "title": MAIN_ROSTER["chair"][1],
        "role": "chair",
    }
    subs = {
        k: {"display_name": v[0], "title": v[1], "role": "sub"}
        for k, v in SUB_ROSTER.items()
    }
    return {"mains": mains, "subs": subs}
