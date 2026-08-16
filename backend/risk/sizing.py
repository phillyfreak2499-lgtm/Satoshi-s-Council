"""
Dynamic paper sizing for the BTC 15m path book.

ETH 1H stays a flat paper_stake_for_lock ticket.
Config hard maxes remain clamps. Never a live order.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class SizingResult:
    stake: float
    units: float
    reason: str
    edge_cents: Optional[float] = None
    p_finish: Optional[float] = None
    confidence: Optional[float] = None
    confluence: Optional[float] = None
    mid: Optional[float] = None
    spread: Optional[float] = None
    book_size: Optional[float] = None
    seconds_remaining: Optional[float] = None
    open_risk: Optional[float] = None
    is_scalp: bool = False
    is_dual_sided: bool = False
    clamped: bool = False
    raw_stake: float = 0.0
    multipliers: List[Dict[str, Any]] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    kelly_raw: Optional[float] = None
    hard_max_beats_kelly: bool = True

    def to_dict(self) -> Dict[str, Any]:
        reasons = list(self.reasons or [])
        if not reasons and self.reason:
            reasons = [self.reason]
        return {
            "stake": round(float(self.stake), 4),
            "units": round(float(self.units), 4),
            "reason": self.reason,
            "edge_cents": self.edge_cents,
            "p_finish": self.p_finish,
            "confidence": self.confidence,
            "confluence": self.confluence,
            "mid": self.mid,
            "spread": self.spread,
            "book_size": self.book_size,
            "seconds_remaining": self.seconds_remaining,
            "open_risk": self.open_risk,
            "is_scalp": bool(self.is_scalp),
            "is_dual_sided": bool(self.is_dual_sided),
            "clamped": bool(self.clamped),
            "raw_stake": round(float(self.raw_stake), 4),
            "multipliers": list(self.multipliers or []),
            "reasons": reasons,
            "kelly_raw": self.kelly_raw,
            "hard_max_beats_kelly": True,
            "open_risk_both_legs": True,
        }


def _f(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def compute_position_size(
    *,
    edge_cents: Any = None,
    p_finish: Any = None,
    confidence: Any = None,
    confluence: Any = None,
    mid: Any = None,
    spread: Any = None,
    book_size: Any = None,
    seconds_remaining: Any = None,
    open_risk: Any = None,
    is_scalp: bool = False,
    is_dual_sided: bool = False,
    unit: Any = None,
    hard_max: Any = None,
    hard_min: Any = None,
) -> SizingResult:
    from backend.config import settings

    enabled = bool(getattr(settings, "DYNAMIC_SIZING", True))
    unit_amt = _f(unit)
    if unit_amt is None:
        unit_amt = float(
            getattr(settings, "DYNAMIC_SIZING_UNIT", None)
            or getattr(settings, "PAPER_STAKE_HOLD", 10.0)
            or 10.0
        )
    hi = _f(hard_max)
    if hi is None:
        hi = float(
            getattr(settings, "DYNAMIC_SIZING_MAX", None)
            or getattr(settings, "PAPER_STAKE_DEFAULT", 25.0)
            or 25.0
        )
    lo = _f(hard_min)
    if lo is None:
        lo = float(getattr(settings, "DYNAMIC_SIZING_MIN", 5.0) or 5.0)

    edge = _f(edge_cents)
    p = _f(p_finish)
    conf = _f(confidence)
    if conf is not None and conf > 1.0:
        conf = conf / 100.0
    conf_l = _f(confluence)
    if conf_l is not None and conf_l > 1.0:
        conf_l = min(1.0, conf_l / 100.0)
    mid_px = _f(mid)
    spr = _f(spread)
    depth = _f(book_size)
    secs = _f(seconds_remaining)
    risk = _f(open_risk)

    raw = float(unit_amt)
    multipliers: List[Dict[str, Any]] = []
    # Informational Kelly only. Never raises size. Hard maxes beat Kelly.
    kelly_raw = None
    if p is not None and mid_px is not None and 0.0 < mid_px < 100.0:
        b = (100.0 - mid_px) / mid_px
        if b > 0.0:
            kelly_raw = round(float(p) - (1.0 - float(p)) / b, 6)

    if not enabled:
        stake = min(hi, max(0.0, raw))
        return SizingResult(
            stake=round(stake, 4),
            units=1.0,
            reason="dynamic_off",
            edge_cents=edge,
            p_finish=p,
            confidence=conf,
            confluence=conf_l,
            mid=mid_px,
            spread=spr,
            book_size=depth,
            seconds_remaining=secs,
            open_risk=risk,
            is_scalp=bool(is_scalp),
            is_dual_sided=bool(is_dual_sided),
            clamped=raw > hi,
            raw_stake=round(raw, 4),
            multipliers=multipliers,
            reasons=["dynamic_off"],
            kelly_raw=kelly_raw,
            hard_max_beats_kelly=True,
        )

    # Dead 99¢ / 1¢ chalk — sit-sized. Cannot scale out of chalk.
    if mid_px is not None and (mid_px >= 99.0 or mid_px <= 1.0):
        return SizingResult(
            stake=0.0,
            units=0.0,
            reason="chalk_sit",
            edge_cents=edge,
            p_finish=p,
            confidence=conf,
            confluence=conf_l,
            mid=mid_px,
            spread=spr,
            book_size=depth,
            seconds_remaining=secs,
            open_risk=risk,
            is_scalp=bool(is_scalp),
            is_dual_sided=bool(is_dual_sided),
            clamped=True,
            raw_stake=round(raw, 4),
            multipliers=multipliers,
            reasons=["chalk_sit"],
            kelly_raw=kelly_raw,
            hard_max_beats_kelly=True,
        )

    reasons = ["conf"]
    conf_n = max(0.0, min(1.0, conf if conf is not None else 0.55))
    conf_l_n = max(0.0, min(1.0, conf_l if conf_l is not None else 0.45))
    conf_mult = 0.55 + 0.45 * (0.6 * conf_n + 0.4 * conf_l_n)
    raw = unit_amt * conf_mult
    multipliers.append({"name": "conf", "mult": round(conf_mult, 4)})

    def _apply(name: str, factor: float) -> None:
        nonlocal raw
        raw *= float(factor)
        multipliers.append({"name": name, "mult": round(float(factor), 4)})
        reasons.append(name)

    if edge is not None:
        _apply("edge", 1.0 + min(0.35, max(-0.25, edge / 20.0)))
    if p is not None:
        _apply("p_finish", 1.0 + min(0.20, abs(p - 0.5) * 0.4))
    if spr is not None and spr > 3.0:
        _apply("spread", max(0.6, 1.0 - (spr - 3.0) * 0.05))
    if depth is not None and 0.0 < depth < 50.0:
        _apply("thin_book", 0.7)
    if secs is not None and secs < 180.0:
        _apply("late", 0.75)
    if risk is not None and risk > hi:
        _apply("open_risk", 0.6)
        reasons.append("open_risk_both_legs")
    if is_scalp:
        _apply("scalp", 0.7)
    if is_dual_sided:
        _apply("dual", 0.85)

    clamped = False
    stake = raw
    # Hard maxes beat Kelly — clamp after every multiplier, never size from kelly_raw.
    if stake > hi:
        stake = hi
        clamped = True
        reasons.append("clamp_max")
    # Do not clamp_min a negative-edge add. Sit or size down — never pad
    # a bad add up to PAPER_STAKE_* / DYNAMIC_SIZING_MIN.
    negative_edge = edge is not None and edge < 0.0
    if stake > 0.0 and stake < lo and not negative_edge:
        stake = lo
        clamped = True
        reasons.append("clamp_min")
    elif negative_edge and stake > 0.0 and stake < lo:
        reasons.append("no_clamp_min_neg_edge")
    # Hard maxes beat Kelly AND beat clamp_min.
    if stake > hi:
        stake = hi
        clamped = True
        reasons.append("clamp_max")
    stake = min(float(stake), float(hi))

    units = round(stake / unit_amt, 4) if unit_amt else 1.0
    return SizingResult(
        stake=round(float(stake), 4),
        units=units,
        reason="+".join(reasons),
        edge_cents=edge,
        p_finish=p,
        confidence=conf,
        confluence=conf_l,
        mid=mid_px,
        spread=spr,
        book_size=depth,
        seconds_remaining=secs,
        open_risk=risk,
        is_scalp=bool(is_scalp),
        is_dual_sided=bool(is_dual_sided),
        clamped=clamped,
        raw_stake=round(float(raw), 4),
        multipliers=multipliers,
        reasons=reasons,
        kelly_raw=kelly_raw,
        hard_max_beats_kelly=True,
    )


def size_for_leader(**kwargs: Any) -> SizingResult:
    """Chair entry point. Same math as compute_position_size."""
    return compute_position_size(**kwargs)


def honor_sized_stake(
    fill_stake: Any,
    sizing: Any = None,
    hard_max: Any = None,
) -> float:
    """
    Executed paper stake must honor size_for_leader / compute_position_size.
    Hard maxes beat Kelly and beat any clamp_min. If sizing says $7, the
    fill cannot be $35 (equal-contract expansion or PAPER_STAKE_* default).
    """
    from backend.config import settings

    hi = _f(hard_max)
    if hi is None:
        hi = float(
            getattr(settings, "DYNAMIC_SIZING_MAX", None)
            or getattr(settings, "PAPER_STAKE_DEFAULT", 25.0)
            or 25.0
        )
    sized = None
    if isinstance(sizing, dict) and sizing.get("stake") is not None:
        sized = _f(sizing.get("stake"))
    elif sizing is not None:
        sized = _f(getattr(sizing, "stake", None))
    stake = _f(fill_stake)
    if stake is None:
        stake = sized
    if stake is None or stake <= 0.0:
        return 0.0
    cap = float(hi)
    if sized is not None and sized >= 0.0:
        cap = min(cap, float(sized))
    return round(min(float(stake), cap), 4)
