"""
The Round Table — five leaders, one final authority.

SATOSHI sits in the absolute centre. He is rank 0, never ranked, never moved,
and he is the only seat that produces an official call. The other four leaders
debate; he listens, counts alignment, and locks.

    SATOSHI  Final Authority + BTC Structure   (centre, fixed)
    VITALIK  ETH / Relative Strength
    ARES     Momentum & Trend
    RAIJIN   Crowding, Funding, Regime, Volatility
    ORACLE   Synthesis, cross-checks, process guardian

Every existing specialist bot stays and is assigned to exactly one leader.
Specialists vote; their leader aggregates them into a stance; Satoshi
synthesises the four stances into one call.

Decision language is closed: BUY ZONE | HOLD | REDUCE | WAIT.

WAIT is the default. A directional call needs MIN_ALIGNMENT of the four
leaders on the same side. RAIJIN and ORACLE additionally hold a protective
veto — when a hard risk check fires, the table falls back to WAIT unless
confluence is extreme.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# ── Decision language (closed set) ────────────────────────────────────
# Research-desk wording. Deliberately not Buy / Sell / Hold: this is a paper
# research desk, and the final word should never read as a retail order.
# Constant NAMES are unchanged so every import keeps working.
BUY_ZONE = "Accumulate"
HOLD = "Maintain"
REDUCE = "Reduce"
WAIT = "Stand down"
CALLS = (BUY_ZONE, HOLD, REDUCE, WAIT)

# Rows written before the language change still sit in process-log.jsonl.
# Map them forward so historical metrics keep classifying correctly.
LEGACY_CALLS = {
    "BUY ZONE": BUY_ZONE,
    "BUY_ZONE": BUY_ZONE,
    "HOLD": HOLD,
    "REDUCE": REDUCE,
    "WAIT": WAIT,
    "SIT": WAIT,
}


def canonical_call(raw: Any) -> str:
    """Current wording for any call label, old or new."""
    text = str(raw or "").strip()
    if text in CALLS:
        return text
    return LEGACY_CALLS.get(text.upper(), WAIT)

# Internal direction keys ↔ the words on screen.
DIR_TO_CALL = {
    "UP": BUY_ZONE,
    "UP_HOLD": HOLD,
    "DOWN": REDUCE,
    "DOWN_HOLD": REDUCE,
    "WAIT": WAIT,
    "SWAP": WAIT,
}

CENTER = "satoshi"
MOVABLE = ("vitalik", "ares", "raijin", "oracle")
ALL_LEADERS = (CENTER,) + MOVABLE

# Confluence: how many of the four must agree for a directional call.
MIN_ALIGNMENT = 3
FOUR = len(MOVABLE)
# A full-strength BUY ZONE / REDUCE needs alignment plus conviction.
STRONG_CONF = 62
# Overriding a protective veto takes unanimity and high conviction.
EXTREME_ALIGNMENT = 4
EXTREME_CONF = 80
# A protective CAUTION (currently funding/price divergence) is softer than a
# veto: it cannot force WAIT on its own, but it raises the bar for a
# full-strength call and tips a marginal one to WAIT.
CAUTION_CONF = 75

# ── Leader domains ────────────────────────────────────────────────────
# Every specialist key in backend/agents/roster.py appears exactly once.
LEADER_DOMAINS: Dict[str, Dict[str, Any]] = {
    CENTER: {
        "callsign": "SATOSHI",
        "title": "Final Authority · BTC Structure",
        "domain": "Final synthesis and Bitcoin higher-timeframe structure",
        "fixed": True,
        "agents": ("candle_btc", "candle", "strike", "odds", "quorum", "session_tod"),
    },
    "vitalik": {
        "callsign": "VITALIK",
        "title": "ETH · Relative Strength",
        "domain": "Ethereum flow and cross-major relative strength",
        "fixed": False,
        "agents": ("candle_eth", "volume", "spotlag", "cheap"),
    },
    "ares": {
        "callsign": "ARES",
        "title": "Momentum & Trend",
        "domain": "Momentum, trend continuity and tape",
        "fixed": False,
        "agents": ("momentum", "streak", "orderflow", "exhaust"),
    },
    "raijin": {
        "callsign": "RAIJIN",
        "title": "Crowding · Funding · Regime · Volatility",
        "domain": "Crowded positioning, funding, regime and volatility risk",
        "fixed": False,
        "agents": ("funding", "oi_pressure", "regime", "volatility", "whale", "liq", "panic"),
        "veto": True,
    },
    "oracle": {
        "callsign": "ORACLE",
        "title": "Synthesis · Process Guardian",
        "domain": "Cross-checks, feed health and process adherence",
        "fixed": False,
        "agents": ("guardian", "law", "news"),
        "veto": True,
    },
}

# specialist key → leader
AGENT_TO_LEADER: Dict[str, str] = {
    agent: leader
    for leader, spec in LEADER_DOMAINS.items()
    for agent in spec["agents"]
}


def leader_of(agent_key: str) -> Optional[str]:
    """Which leader a specialist feeds. None when unassigned."""
    return AGENT_TO_LEADER.get(str(agent_key or "").strip().lower())


def is_center(leader: str) -> bool:
    return str(leader or "").strip().lower() == CENTER


def call_for(direction: Any) -> str:
    """Map an internal direction key to the closed decision language."""
    return DIR_TO_CALL.get(str(direction or "WAIT").strip().upper(), WAIT)


# ── Numeric helpers ───────────────────────────────────────────────────
def _f(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if val == val else None  # drop NaN


def _first(src: Dict[str, Any], *keys: str) -> Optional[float]:
    for k in keys:
        val = _f(src.get(k))
        if val is not None:
            return val
    return None


def _dir_of(agent: Dict[str, Any]) -> str:
    return str(agent.get("direction") or "WAIT").strip().upper()


def _side(direction: str) -> Optional[str]:
    d = str(direction or "").upper()
    # LONG_UP / LONG_DOWN are the scalp engine's directional language. The seats
    # emit them, so the council must read them as UP / DOWN — otherwise every
    # momentum/odds/strike seat looks like "no side" and its leader can never
    # lean. (calibration._correct already maps LONG_* the same way.)
    if d in ("UP", "UP_HOLD", "LONG_UP"):
        return "UP"
    if d in ("DOWN", "DOWN_HOLD", "LONG_DOWN"):
        return "DOWN"
    return None


# ── Leader stance ─────────────────────────────────────────────────────
def leader_stance(leader: str, agents: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Aggregate a leader's assigned specialists into one stance.

    Weighted by each specialist's confidence and the weight the learner is
    currently giving it. Muted and hard-muted seats do not vote.
    """
    spec = LEADER_DOMAINS.get(leader) or {}
    want = set(spec.get("agents") or ())
    mine = [
        a for a in (agents or [])
        if isinstance(a, dict)
        and str(a.get("agent_name") or "").lower() in want
        and not a.get("sub")
    ]

    up = 0.0
    down = 0.0
    voters: List[Dict[str, Any]] = []
    for a in mine:
        if a.get("muted") or a.get("hard_mute"):
            continue
        side = _side(_dir_of(a))
        conf = _f(a.get("confidence")) or 0.0
        weight = _f(a.get("weight_used"))
        if weight is None or weight <= 0:
            weight = 0.1
        pull = (conf / 100.0) * weight
        # A faded specialist has been reliably wrong — it contributes to the
        # opposite side, matching the learner's existing fade behaviour.
        if a.get("invert") or a.get("faded"):
            side = "DOWN" if side == "UP" else ("UP" if side == "DOWN" else None)
        if side == "UP":
            up += pull
        elif side == "DOWN":
            down += pull
        voters.append({
            "agent": a.get("agent_name"),
            "display_name": a.get("display_name"),
            "direction": _dir_of(a),
            "confidence": int(conf),
        })

    total = up + down
    seated = len(mine)
    if total <= 0 or not voters:
        direction = "WAIT"
        confidence = 0
    else:
        edge = abs(up - down) / total
        direction = "UP" if up > down else "DOWN"
        confidence = int(round(min(99.0, edge * 100.0)))
        if confidence < 20:
            direction = "WAIT"

    return {
        "leader": leader,
        "callsign": spec.get("callsign") or leader.upper(),
        "title": spec.get("title") or "",
        "domain": spec.get("domain") or "",
        "direction": direction,
        "call": call_for(direction),
        "confidence": confidence if direction != "WAIT" else max(0, 100 - confidence),
        "reason": _stance_reason(spec, direction, voters, seated),
        "voters": voters,
        "seated": seated,
        "voted": len(voters),
    }


def _stance_reason(spec: Dict[str, Any], direction: str, voters: List[Dict[str, Any]], seated: int) -> str:
    """One short sentence, in the leader's own domain language."""
    domain = spec.get("domain") or "its seats"
    if not voters:
        return f"No live read on {domain.lower()} — seats quiet."
    agree = [v for v in voters if _side(v["direction"]) == _side(direction)]
    names = ", ".join(str(v.get("display_name") or v.get("agent") or "?") for v in agree[:3])
    if direction == "WAIT":
        return f"Split across {domain.lower()} — no clean side from {len(voters)} seat(s)."
    word = "upside" if direction == "UP" else "downside"
    if names:
        return f"{len(agree)} of {len(voters)} seats read {word} — {names}."
    return f"Leans {word} on {domain.lower()}."


def votes_to_agents(votes: Any) -> List[Dict[str, Any]]:
    """
    Normalize a persisted agent_votes blob into the agent-dict list that
    leader_stance() expects. Accepts {name: {...}}, {name: "UP"} or a list.
    """
    out: List[Dict[str, Any]] = []
    if isinstance(votes, dict):
        for name, vote in votes.items():
            if isinstance(vote, dict):
                row = dict(vote)
                row.setdefault("agent_name", name)
                out.append(row)
            elif vote is not None:
                out.append({"agent_name": name, "direction": str(vote), "confidence": 50})
    elif isinstance(votes, list):
        out = [v for v in votes if isinstance(v, dict)]
    return out


def leans_from_votes(votes: Any) -> Dict[str, Optional[str]]:
    """
    Replay the four movable leaders' leans from a settled row's agent votes.

    Used to score the ranking after the fact, so a leader is judged on what
    its own seats actually said at call time. Returns UP / DOWN / WAIT, or
    None when that leader had no seat voting (scores 0).
    """
    agents = votes_to_agents(votes)
    out: Dict[str, Optional[str]] = {}
    for name in MOVABLE:
        stance = leader_stance(name, agents)
        out[name] = stance["direction"] if stance.get("voted") else None
    return out


# ── Protective vetoes (RAIJIN + ORACLE) ───────────────────────────────
# Thresholds are deliberately blunt. A veto is a brake, not a forecast.
FUNDING_EXTREME_PCT = 0.08      # |8h funding| in percent
OI_SPIKE_PCT = 5.0              # 1h open-interest change, percent
CASCADE_PRICE_PCT = 1.5         # co-incident price move, percent
LOW_LIQ_HOURS_UTC = (3, 4, 5, 6, 7)
RISK_OFF_VOL_PCT = 0.9          # short-window realised move, percent


def risk_snapshot(table: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pull the few numbers the veto checks need, defensively. Anything the
    feed did not supply comes back None and its check simply does not fire.
    """
    table = table if isinstance(table, dict) else {}
    cg = table.get("coinglass") if isinstance(table.get("coinglass"), dict) else {}
    market = table.get("market") if isinstance(table.get("market"), dict) else {}
    health = table.get("health") if isinstance(table.get("health"), dict) else {}

    funding = _first(cg, "funding_rate", "funding")
    if funding is None:
        funding = _first(market, "funding_rate")
    oi_delta = _first(cg, "oi_delta_1h", "oi_change_1h", "oi_delta")
    price_chg = _first(market, "price_change_pct_1h", "change_pct_1h", "pct_1h", "price_change_pct")
    vol_pct = _first(market, "vol_pct", "realized_vol_pct", "atr_pct")
    hour = _first(market, "utc_hour")

    return {
        "funding_pct": funding,
        "oi_delta_pct": oi_delta,
        "price_change_pct": price_chg,
        "vol_pct": vol_pct,
        "utc_hour": int(hour) if hour is not None else None,
        "feed_ok": bool(health.get("coinglass", True)),
    }


def protective_vetoes(
    table: Dict[str, Any],
    *,
    include_low_liquidity: bool = False,
) -> List[Dict[str, Any]]:
    """
    Hard risk checks owned by RAIJIN and ORACLE.

    Returns a list of active vetoes; empty means clear. Each entry carries
    the owning leader and a short reason for the debate log.
    """
    snap = risk_snapshot(table)
    out: List[Dict[str, Any]] = []
    seen: set = set()

    def _add(entry: Optional[Dict[str, Any]]) -> None:
        if entry and entry.get("code") not in seen:
            seen.add(entry["code"])
            out.append(entry)

    # 1. Extreme funding — the crowd is paying too much to hold the trade.
    # Imported lazily: funding_analysis imports the decision language from here.
    try:
        from backend.services.funding_analysis import funding_veto
        _add(funding_veto(table))
    except ImportError:
        fund = snap["funding_pct"]
        if fund is not None and abs(fund) >= FUNDING_EXTREME_PCT:
            _add({
                "leader": "raijin",
                "code": "extreme_funding",
                "reason": f"extreme funding ({fund:+.3f}%)",
                "detail": "Crowded carry — reversal risk outweighs the edge.",
            })

    # 2. Open interest — crowded positioning and cascade risk.
    try:
        from backend.services.oi_analysis import oi_veto
        _add(oi_veto(table))
    except ImportError:
        pass

    # 3. Liquidation walls — forced flow sitting next to price.
    try:
        from backend.services.liquidation_map import liq_veto
        _add(liq_veto(table))
    except ImportError:
        pass

    # 4. Composite microstructure score. Runs last and stands down when a
    #    component already vetoed — the specific cause beats the summary.
    try:
        from backend.services.micro_risk import micro_veto
        _add(micro_veto(table, existing_codes=seen))
    except ImportError:
        pass

    # Cascade / crowding from OI is owned by backend.services.oi_analysis
    # above — one source of truth, so no coarse duplicate here.

    # 3. Low-liquidity hours (optional — off by default).
    hour = snap["utc_hour"]
    if include_low_liquidity and hour is not None and hour in LOW_LIQ_HOURS_UTC:
        out.append({
            "leader": "oracle",
            "code": "thin_hours",
            "reason": f"thin liquidity hour ({hour:02d}:00 UTC)",
            "detail": "Thin book — fills and signals both degrade.",
        })

    # 4. Risk-off regime — volatility expansion without direction.
    vol = snap["vol_pct"]
    if vol is not None and vol >= RISK_OFF_VOL_PCT:
        out.append({
            "leader": "oracle",
            "code": "risk_off",
            "reason": f"risk-off regime (vol {vol:.2f}%)",
            "detail": "Volatility expansion — regime is hostile to new risk.",
        })

    # 5. A dark derivatives feed is handled as a CAUTION, not a hard veto —
    #    see protective_cautions(). Absence of crowding/funding data is missing
    #    information, not a danger signal, so it raises Satoshi's bar and caps
    #    size rather than freezing the whole desk into a permanent stand-down.

    return out


def veto_line(veto: Dict[str, Any]) -> str:
    """'RAIJIN veto — extreme funding (+0.091%)'"""
    spec = LEADER_DOMAINS.get(veto.get("leader") or "") or {}
    who = spec.get("callsign") or str(veto.get("leader") or "").upper()
    return f"{who} veto — {veto.get('reason') or veto.get('code') or 'risk'}"


def caution_line(caution: Dict[str, Any]) -> str:
    """'RAIJIN caution — funding/price divergence'"""
    spec = LEADER_DOMAINS.get(caution.get("leader") or "") or {}
    who = spec.get("callsign") or str(caution.get("leader") or "").upper()
    return f"{who} caution — {caution.get('reason') or caution.get('code') or 'risk'}"


def protective_cautions(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Soft protective signals. Unlike a veto these never force WAIT by
    themselves — they raise Satoshi's bar and show in the debate log.
    """
    out: List[Dict[str, Any]] = []
    try:
        from backend.services.divergence import divergence_caution

        entry = divergence_caution(table, eth_table=eth_table)
        if entry:
            out.append(entry)
    except ImportError:
        pass
    try:
        from backend.services.funding_analysis import funding_caution

        entry = funding_caution(table)
        if entry:
            out.append(entry)
    except ImportError:
        pass
    try:
        from backend.services.basis_funding import basis_funding_caution

        entry = basis_funding_caution(table)
        if entry:
            out.append(entry)
    except ImportError:
        pass
    try:
        from backend.services.oi_divergence import oi_divergence_caution

        entry = oi_divergence_caution(table)
        if entry:
            out.append(entry)
    except ImportError:
        pass
    try:
        from backend.services.liquidation_flow import flow_caution

        entry = flow_caution(table)
        if entry:
            out.append(entry)
    except ImportError:
        pass
    try:
        from backend.services.micro_risk import micro_caution

        entry = micro_caution(table, eth_table=eth_table)
        if entry:
            out.append(entry)
    except ImportError:
        pass

    # A dark derivatives feed (plan wall / unconfigured / empty) is an absence
    # of information, not a danger. The specific funding/OI/liquidation vetoes
    # already stand down on their own when their data is missing, so the desk
    # notes the dark feed as a caution — size stays small and marginal calls
    # tip to WAIT — instead of a blanket veto that would freeze every decision.
    try:
        if not risk_snapshot(table)["feed_ok"]:
            out.append({
                "leader": "oracle",
                "code": "feed_dark",
                "reason": "derivatives feed dark — reading price and structure only",
                "detail": "Crowding and funding unreadable — size stays small until the feed returns.",
            })
    except Exception:
        pass
    return out


# ── Satoshi's final call ──────────────────────────────────────────────
def alignment(stances: List[Dict[str, Any]]) -> Tuple[Optional[str], int]:
    """Dominant side among the four leaders, and how many hold it."""
    counts = {"UP": 0, "DOWN": 0}
    for s in stances:
        side = _side(s.get("direction"))
        if side:
            counts[side] += 1
    if counts["UP"] == 0 and counts["DOWN"] == 0:
        return None, 0
    side = "UP" if counts["UP"] >= counts["DOWN"] else "DOWN"
    return side, counts[side]


def alignment_phrase(count: int, side: Optional[str] = None) -> str:
    """Plain language, for the debate block and Satoshi's summary."""
    if not side or count <= 0:
        return f"0 of {FOUR} leaders aligned — no side on the floor"
    if count >= MIN_ALIGNMENT:
        return f"{count} of {FOUR} leaders aligned"
    return f"Only {count} of {FOUR} aligned — confluence too weak"


def satoshi_call(
    stances: List[Dict[str, Any]],
    *,
    vetoes: Optional[List[Dict[str, Any]]] = None,
    cautions: Optional[List[Dict[str, Any]]] = None,
    structure: Optional[Dict[str, Any]] = None,
    posture: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    The only official call. WAIT unless the floor earns otherwise.

    - MIN_ALIGNMENT of four leaders must hold the same side.
    - A protective veto forces WAIT unless alignment is unanimous *and*
      conviction is high.
    - Satoshi's own BTC structure read breaks ties and caps conviction.
    """
    vetoes = list(vetoes or [])
    cautions = list(cautions or [])
    posture = posture or {}
    # The regime layer can raise the alignment bar but never lower it.
    need = max(MIN_ALIGNMENT, int(posture.get("min_alignment") or MIN_ALIGNMENT))
    side, count = alignment(stances)
    movers = [s for s in stances if not is_center(s.get("leader"))]
    agree = [s for s in movers if _side(s.get("direction")) == side] if side else []
    conf_avg = int(round(sum(int(s.get("confidence") or 0) for s in agree) / len(agree))) if agree else 0

    confluence_ok = bool(side) and count >= need
    extreme = bool(side) and count >= EXTREME_ALIGNMENT and conf_avg >= EXTREME_CONF

    struct_dir = _side((structure or {}).get("direction")) if structure else None
    reasons: List[str] = []
    veto_active = bool(vetoes)

    # ── veto first: it outranks confluence unless confluence is extreme ──
    if veto_active and not extreme:
        lines = "; ".join(veto_line(v) for v in vetoes[:3])
        return _final(
            WAIT, "WAIT", 0, count, side, confluence_ok, vetoes, cautions,
            summary=f"{WAIT} — {lines}. Protective veto stands over {alignment_phrase(count, side)}.",
            rule="veto",
            posture=posture,
        )

    if not side or count == 0:
        return _final(
            WAIT, "WAIT", 0, 0, None, False, vetoes, cautions,
            summary=f"{WAIT} — {alignment_phrase(0, None)}.",
            rule="no_side",
            posture=posture,
        )

    if not confluence_ok:
        extra = ""
        if need > MIN_ALIGNMENT and posture.get("reason"):
            extra = f" · {posture['reason']}"
        return _final(
            WAIT, "WAIT", 0, count, side, False, vetoes, cautions,
            summary=f"{WAIT} — {alignment_phrase(count, side)}, needed {need} of {FOUR}{extra}.",
            rule="regime" if need > MIN_ALIGNMENT else "below_alignment",
            posture=posture,
        )

    # A caution cannot veto, but a marginal call under one is not worth
    # taking: bare-minimum alignment without conviction tips to WAIT.
    if cautions and count <= MIN_ALIGNMENT and conf_avg < CAUTION_CONF:
        lines = "; ".join(caution_line(c) for c in cautions[:2])
        return _final(
            WAIT, "WAIT", 0, count, side, True, vetoes, cautions,
            summary=(
                f"{WAIT} — {lines}. {alignment_phrase(count, side)} is not enough "
                f"conviction to chase into it."
            ),
            rule="caution",
            posture=posture,
        )

    # Confluence met. Structure agreement decides full call vs HOLD.
    capped = (posture.get("cap_long") and side == "UP") or (posture.get("cap_short") and side == "DOWN")
    if capped:
        reasons.append(posture.get("reason") or f"{posture.get('regime')} posture — size stays small")
        direction = "UP_HOLD" if side == "UP" else "DOWN_HOLD"
    elif struct_dir and struct_dir != side:
        reasons.append("Satoshi's BTC structure disagrees — size stays small")
        direction = "UP_HOLD" if side == "UP" else "DOWN_HOLD"
    elif cautions and not (count >= EXTREME_ALIGNMENT and conf_avg >= CAUTION_CONF):
        reasons.append("; ".join(caution_line(c) for c in cautions[:2]) + " — size stays small")
        direction = "UP_HOLD" if side == "UP" else "DOWN_HOLD"
    elif conf_avg < STRONG_CONF:
        reasons.append("alignment without conviction")
        direction = "UP_HOLD" if side == "UP" else "DOWN_HOLD"
    else:
        direction = side

    if veto_active and extreme:
        reasons.append("overrides " + "; ".join(veto_line(v) for v in vetoes[:2]) + " on unanimous confluence")

    call = call_for(direction)
    head = f"{call} — {alignment_phrase(count, side)}"
    summary = head + (" · " + "; ".join(reasons) + "." if reasons else ".")
    return _final(
        call, direction, conf_avg, count, side, True, vetoes, cautions,
        summary=summary,
        rule="confluence",
        posture=posture,
    )


def _final(
    call: str,
    direction: str,
    confidence: int,
    count: int,
    side: Optional[str],
    confluence_ok: bool,
    vetoes: List[Dict[str, Any]],
    cautions: Optional[List[Dict[str, Any]]] = None,
    *,
    summary: str,
    rule: str,
    posture: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cautions = list(cautions or [])
    posture = posture or {}
    return {
        "leader": CENTER,
        "callsign": "SATOSHI",
        "final_authority": True,
        "voice": satoshi_voice(
            call, rule, count,
            veto=bool(vetoes), caution=bool(cautions),
            regime=posture.get("regime"),
        ),
        "call": call,
        "direction": direction,
        "confidence": int(confidence),
        "aligned": int(count),
        "of": FOUR,
        "side": side,
        "alignment_text": alignment_phrase(count, side),
        "confluence_ok": bool(confluence_ok),
        "min_alignment": max(MIN_ALIGNMENT, int(posture.get("min_alignment") or MIN_ALIGNMENT)),
        "base_alignment": MIN_ALIGNMENT,
        "regime": posture.get("regime"),
        "htf_bias": posture.get("bias"),
        "posture": dict(posture),
        "veto_active": bool(vetoes),
        "vetoes": [dict(v) for v in vetoes],
        "veto_lines": [veto_line(v) for v in vetoes],
        "caution_active": bool(cautions),
        "cautions": [dict(c) for c in cautions],
        "caution_lines": [caution_line(c) for c in cautions],
        "summary": summary,
        "rule": rule,
    }


# ── Satoshi's voice ───────────────────────────────────────────────────
# One formal line under the call. The Chair speaks plainly and never sells:
# no exclamation, no forecast, no encouragement to act.
def satoshi_voice(
    call: str,
    rule: str,
    aligned: int,
    *,
    veto: bool = False,
    caution: bool = False,
    regime: Optional[str] = None,
) -> str:
    """
    The Chair's statement of record: one short lore sentence, then the
    decision in plain words.

    The ending is always one of Accumulate / Accumulate carefully / Reduce /
    Maintain / Stand down — never Buy, Sell or Hold. This is a paper research
    desk and the final word must not read as an order.
    """
    n = int(aligned or 0)
    call = canonical_call(call)

    # ── Stand down ───────────────────────────────────────────────────
    if call == WAIT:
        if veto:
            return f"Protection active. {WAIT}."
        if rule == "caution":
            return f"Pressure uneven. {WAIT}."
        if rule == "regime":
            return f"Regime is hostile. {WAIT}."
        if n == 0:
            return f"No side on the floor. {WAIT}."
        if n <= 1:
            return f"One voice is not a council. {WAIT}."
        if n >= MIN_ALIGNMENT:
            return f"Patience is the position. {WAIT}."
        return f"Council divided. {WAIT}."

    # ── Maintain ─────────────────────────────────────────────────────
    if call == HOLD:
        if caution:
            return f"Signals disagree. {HOLD}."
        if n >= FOUR:
            return f"Unanimous but unproven. {HOLD}."
        return f"Structure intact. {HOLD}."

    # ── Reduce ───────────────────────────────────────────────────────
    if call == REDUCE:
        if n >= FOUR:
            return f"The table is unanimous. {REDUCE}."
        return f"Pressure uneven. {REDUCE}."

    # ── Accumulate ───────────────────────────────────────────────────
    if n >= FOUR:
        return f"The table is unanimous. {BUY_ZONE}."
    if n > MIN_ALIGNMENT:
        return f"Confluence earned. {BUY_ZONE}."
    return f"{_word(n)} aligned. {BUY_ZONE} carefully."


_WORDS = {0: "None", 1: "One", 2: "Two", 3: "Three", 4: "Four"}


def _word(n: int) -> str:
    return _WORDS.get(int(n or 0), str(n))


def main_dissent(stances: List[Dict[str, Any]], side: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    The loudest leader not holding the dominant side. This is what the
    floor should be arguing about, so it earns a line of its own.
    """
    if not stances:
        return None
    off = [s for s in stances if _side(s.get("direction")) != side]
    if not off:
        return None
    off.sort(key=lambda s: int(s.get("confidence") or 0), reverse=True)
    top = off[0]
    return {
        "leader": top.get("leader"),
        "callsign": top.get("callsign"),
        "call": top.get("call"),
        "confidence": top.get("confidence"),
        "reason": top.get("reason"),
    }


# ── Full board ────────────────────────────────────────────────────────
def council_final(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
    include_low_liquidity: bool = False,
) -> Dict[str, Any]:
    """
    Just Satoshi's final decision from a table of agent signals — the lean path
    used to GATE the trade engine. Mirrors the decision core of
    build_round_table() (leaders → vetoes → cautions → posture → satoshi_call)
    without building the HUD / debate / standings the display payload needs.
    """
    table = table if isinstance(table, dict) else {}
    agents = table.get("agents") if isinstance(table.get("agents"), list) else []
    eth_agents = None
    if isinstance(eth_table, dict) and isinstance(eth_table.get("agents"), list):
        eth_agents = eth_table["agents"]
    stances = []
    for name in MOVABLE:
        src = eth_agents if (name == "vitalik" and eth_agents) else agents
        stances.append(leader_stance(name, src))
    structure = leader_stance(CENTER, agents)
    vetoes = protective_vetoes(table, include_low_liquidity=include_low_liquidity)
    cautions = protective_cautions(table, eth_table=eth_table)
    stance_posture: Dict[str, Any] = {}
    try:
        from backend.services.htf import classify_regime, posture as regime_posture
        stance_posture = regime_posture(classify_regime(table), base_alignment=MIN_ALIGNMENT)
    except Exception:
        stance_posture = {}
    return satoshi_call(
        stances, vetoes=vetoes, cautions=cautions,
        structure=structure, posture=stance_posture,
    )


def build_round_table(
    table: Dict[str, Any],
    *,
    eth_table: Optional[Dict[str, Any]] = None,
    standings: Optional[Dict[str, Any]] = None,
    include_low_liquidity: bool = False,
) -> Dict[str, Any]:
    """
    One payload for the Round Table: centre seat, four ranked leaders with
    their debate lines, the alignment count, and Satoshi's final call.
    """
    table = table if isinstance(table, dict) else {}
    agents = table.get("agents") if isinstance(table.get("agents"), list) else []
    # VITALIK reads the ETH table when there is one.
    eth_agents = None
    if isinstance(eth_table, dict) and isinstance(eth_table.get("agents"), list):
        eth_agents = eth_table["agents"]

    stances = []
    for name in MOVABLE:
        src = eth_agents if (name == "vitalik" and eth_agents) else agents
        stances.append(leader_stance(name, src))

    structure = leader_stance(CENTER, agents)
    vetoes = protective_vetoes(table, include_low_liquidity=include_low_liquidity)
    cautions = protective_cautions(table, eth_table=eth_table)
    stance_posture: Dict[str, Any] = {}
    try:
        from backend.services.htf import classify_regime, posture as regime_posture

        stance_posture = regime_posture(classify_regime(table), base_alignment=MIN_ALIGNMENT)
    except Exception:
        # A runtime error in the regime read must not 500 the Round Table
        # endpoints — degrade to a neutral posture, same as council_final().
        stance_posture = {}
    final = satoshi_call(
        stances, vetoes=vetoes, cautions=cautions,
        structure=structure, posture=stance_posture,
    )

    ranks = {}
    if isinstance(standings, dict):
        for row in standings.get("ranked") or []:
            if isinstance(row, dict) and row.get("leader"):
                ranks[row["leader"]] = row

    for s in stances:
        row = ranks.get(s["leader"]) or {}
        s["rank"] = int(row.get("rank") or 0)
        s["score"] = row.get("score")
        s["wrong_streak"] = row.get("wrong_streak")
        s["fixed"] = False
        s["vetoed"] = [veto_line(v) for v in vetoes if v.get("leader") == s["leader"]]
        s["cautioned"] = [caution_line(c) for c in cautions if c.get("leader") == s["leader"]]
    stances.sort(key=lambda s: (s["rank"] or 99, MOVABLE.index(s["leader"])))

    hud = {}
    try:
        from backend.services.funding_analysis import funding_hud, funding_signal
        from backend.services.oi_analysis import oi_hud, oi_signal
        from backend.services.divergence import divergence_hud
        from backend.services.htf import htf_hud
        from backend.services.liquidation_map import liq_hud, liq_signal
        from backend.services.liquidation_flow import flow_hud
        from backend.services.basis_funding import basis_funding_hud
        from backend.services.oi_divergence import oi_divergence_hud
        from backend.services.micro_risk import micro_hud

        hud = {
            "funding": funding_hud(table),
            "oi": oi_hud(table),
            "divergence": divergence_hud(table, eth_table=eth_table),
            "liquidation": liq_hud(table),
            "liq_read": liq_signal(table),
            "htf": htf_hud(table),
            "micro": micro_hud(table, eth_table=eth_table),
            "liq_flow": flow_hud(table),
            "oi_divergence": oi_divergence_hud(table),
            "basis_funding": basis_funding_hud(table),
            "funding_read": funding_signal(table),
            "oi_read": oi_signal(table),
        }
    except Exception:
        # Any HUD builder throwing (bad feed shape, etc.) must not 500 the
        # endpoint — the risk panel just comes back empty for that cycle.
        hud = {}

    return {
        "risk": hud,
        "voice": final.get("voice"),
        "dissent": main_dissent(stances, final.get("side")),
        "posture": final.get("posture") or {},
        "regime": final.get("regime"),
        "cautions": final["cautions"],
        "caution_lines": final["caution_lines"],
        "center": {
            **structure,
            **final,
            "rank": 0,
            "fixed": True,
            "immovable": True,
            "title": LEADER_DOMAINS[CENTER]["title"],
            "domain": LEADER_DOMAINS[CENTER]["domain"],
            "structure_direction": structure.get("direction"),
            "structure_reason": structure.get("reason"),
        },
        "debate": stances,
        "alignment": {
            "aligned": final["aligned"],
            "of": FOUR,
            "side": final["side"],
            "text": final["alignment_text"],
            "confluence_ok": final["confluence_ok"],
            "min_alignment": MIN_ALIGNMENT,
        },
        "vetoes": final["vetoes"],
        "veto_lines": final["veto_lines"],
        "final": final,
        "language": list(CALLS),
        "ranking": standings or {},
        "paper_first": True,
    }
