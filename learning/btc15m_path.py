"""
BTC 15m path P&L — dual-sided scalp, not one irreversible directional lock.

Hold both Up and Down when combined cost is attractive.
Scale / cut / flip inside the 15m window.
Score realized paper P&L, not close-direction hits.

Official Kalshi yes/no at expiry only marks leftover open legs (100 / 0).
That mark is not the training win. ETH 1H stays a one-call finish grade.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.agents.chair_gates import kalshi_taker_fee_cents
from backend.learning.btc15m import (
    EARLY_NO_LOCK_MINS_15M,
    LATE_MIN_EV_15M,
    LATE_WINDOW_MINS_15M,
    SCORE_BAND_HI,
    SCORE_BAND_LO,
    WINDOW_MINUTES_15M,
    is_btc_15m_ticker,
)

UTC = timezone.utc

PATH_SETTLE_REASONS = frozenset({
    "path_pnl",
    "path_cut",
    "path_flip",
    "path_scale",
    "path_dual",
    "path_open",
})
SKIP_SCORE_REASONS = frozenset({
    "chalk_skip",
    "band_skip",
    "wait_finish",
    "wait_skip",
    "no_entry_odds",
    "paper_lock_score_skip",
})
OLD_FINISH_REASONS = frozenset({"finish_match", "finish_miss"})

DUAL_MIN_LEFTOVER = 3.0
SCALE_EDGE_CENTS = 3.0
CUT_ADVERSE_CENTS = 4.0
FLIP_ADVERSE_CENTS = 6.0
UNIT_STAKE = 10.0
MAX_UNITS_PER_SIDE = 2
EXIT_SLIDE_CENTS = 2.0
ASK_SLIDE_CENTS = 1.0
CHALK_CENTS = 99.0


def _time_scaled_adverse(base: float, mins_left: float) -> float:
    """
    Scale adverse-cent thresholds by remaining time in the 15m window.
    Early (more optionality): higher tolerance (patient, avoid premature cuts).
    Late (time decay): tighter thresholds (protect capital).
    Multiplier range ~1.35x early → ~0.70x very late.
    """
    try:
        ml = max(0.0, float(mins_left))
    except (TypeError, ValueError):
        ml = 7.5
    # Linear from 1.35 at 15 min left → 0.70 at 0 min left
    frac = ml / float(WINDOW_MINUTES_15M)
    mult = 0.70 + 0.65 * frac
    return max(1.5, base * mult)


def path_settle_reasons() -> frozenset:
    return PATH_SETTLE_REASONS


def is_path_settle_reason(reason: Any) -> bool:
    return str(reason or "").strip().lower() in PATH_SETTLE_REASONS


def realized_pnl(stake: Any, entry_cents: Any, exit_cents: Any) -> float:
    """Premium P&L: stake * (exit − entry) / entry. Exit 0 → −stake."""
    try:
        s = float(stake)
        entry = float(entry_cents)
        exit_px = float(exit_cents)
    except (TypeError, ValueError):
        return 0.0
    if s == 0.0 or entry <= 0.0:
        return 0.0
    return round(s * (exit_px - entry) / entry, 4)


def settle_exit_cents(side: str, y_finish: str) -> float:
    """Mark a leftover leg at official expiry. Not the training label."""
    side_u = str(side or "").upper()
    y = str(y_finish or "").upper()
    if side_u == "UP":
        return 100.0 if y == "UP" else 0.0
    if side_u == "DOWN":
        return 100.0 if y == "DOWN" else 0.0
    return 0.0


def combined_leftover(yes_ask: Any, no_ask: Any) -> Optional[float]:
    """100 − yes − no − taker fees. Attractive when the pair is cheap together."""
    try:
        ya = float(yes_ask)
        na = float(no_ask)
    except (TypeError, ValueError):
        return None
    if ya <= 0.0 or na <= 0.0:
        return None
    return round(100.0 - ya - na - kalshi_taker_fee_cents(ya) - kalshi_taker_fee_cents(na), 4)


def in_playable_band(ask: Any, lo: float = SCORE_BAND_LO, hi: float = SCORE_BAND_HI) -> bool:
    try:
        px = float(ask)
    except (TypeError, ValueError):
        return False
    return lo <= px <= hi


def is_chalk(ask: Any) -> bool:
    try:
        px = float(ask)
    except (TypeError, ValueError):
        return False
    return px >= CHALK_CENTS or px <= (100.0 - CHALK_CENTS)


def _ask_cents(raw: Any) -> Optional[float]:
    try:
        px = float(raw)
    except (TypeError, ValueError):
        return None
    if px <= 0.0:
        return None
    if px <= 1.0:
        px *= 100.0
    return max(1.0, min(99.0, px))


def real_yes_no_asks(
    *,
    yes_ask: Any = None,
    no_ask: Any = None,
    yes_bid: Any = None,
    no_bid: Any = None,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Lift prices for a paper fill. Never mid.
    Missing NO ask may be 100 − yes_bid (the real other door).
    Missing YES ask may be 100 − no_bid.
    """
    ya = _ask_cents(yes_ask)
    na = _ask_cents(no_ask)
    yb = _ask_cents(yes_bid)
    nb = _ask_cents(no_bid)
    if ya is None and nb is not None:
        ya = max(1.0, min(99.0, 100.0 - nb))
    if na is None and yb is not None:
        na = max(1.0, min(99.0, 100.0 - yb))
    return ya, na


def dual_attractive(
    yes_ask: Any,
    no_ask: Any,
    *,
    min_left: float = DUAL_MIN_LEFTOVER,
) -> bool:
    """Both legs only when UP ask + DOWN ask leaves room after vig."""
    if not in_playable_band(yes_ask) or not in_playable_band(no_ask):
        return False
    if is_chalk(yes_ask) or is_chalk(no_ask):
        return False
    left = combined_leftover(yes_ask, no_ask)
    return left is not None and left >= float(min_left)


def equal_contract_stakes(
    yes_ask: Any,
    no_ask: Any,
    unit: float = UNIT_STAKE,
) -> Tuple[float, float]:
    """Same contract count on both doors. Size the cheaper ask at `unit` dollars."""
    ya = float(yes_ask)
    na = float(no_ask)
    if ya <= 0.0 or na <= 0.0:
        return float(unit), float(unit)
    if ya <= na:
        up_stake = float(unit)
        contracts = up_stake / (ya / 100.0)
        down_stake = round(contracts * (na / 100.0), 4)
        return up_stake, down_stake
    down_stake = float(unit)
    contracts = down_stake / (na / 100.0)
    up_stake = round(contracts * (ya / 100.0), 4)
    return up_stake, down_stake


def asks_from_mid(yes_mid: Any, slide: float = ASK_SLIDE_CENTS) -> Tuple[Optional[float], Optional[float]]:
    try:
        mid = float(yes_mid)
    except (TypeError, ValueError):
        return None, None
    yes_ask = min(99.0, max(1.0, mid + float(slide)))
    no_ask = min(99.0, max(1.0, (100.0 - mid) + float(slide)))
    return yes_ask, no_ask


def mark_cents(side: str, yes_ask: Any, no_ask: Any, slide: float = EXIT_SLIDE_CENTS) -> Optional[float]:
    """Exit at a conservative bid (ask minus slide)."""
    try:
        if str(side or "").upper() == "UP":
            return max(1.0, min(99.0, float(yes_ask) - float(slide)))
        if str(side or "").upper() == "DOWN":
            return max(1.0, min(99.0, float(no_ask) - float(slide)))
    except (TypeError, ValueError):
        return None
    return None


def side_ask(side: str, yes_ask: Any, no_ask: Any) -> Optional[float]:
    try:
        if str(side or "").upper() == "UP":
            return float(yes_ask)
        if str(side or "").upper() == "DOWN":
            return float(no_ask)
    except (TypeError, ValueError):
        return None
    return None


def other_side(side: str) -> str:
    return "DOWN" if str(side or "").upper() == "UP" else "UP"


def lean_from_votes(votes: Dict[str, Any] | None) -> Optional[str]:
    up = 0
    down = 0
    try:
        from backend.agents.base import lean_side
    except Exception:
        lean_side = None  # type: ignore
    for vote in (votes or {}).values():
        if not isinstance(vote, dict):
            continue
        d = str(vote.get("direction") or "").upper()
        side = lean_side(d) if lean_side else (d if d in ("UP", "DOWN") else None)
        if side == "UP":
            up += 1
        elif side == "DOWN":
            down += 1
    if up > down:
        return "UP"
    if down > up:
        return "DOWN"
    return None


def open_risk_both_legs(book: Any) -> float:
    """Open risk counts BOTH legs. Never one side only."""
    if book is None:
        return 0.0
    legs = getattr(book, "open_legs", None) or []
    return round(sum(float(getattr(leg, "stake", 0) or 0) for leg in legs), 4)


def cut_sides_from_path_legs(legs: Iterable[Any]) -> set:
    """Sides closed by path_cut / path_flip in this window."""
    out = set()
    for leg in legs or []:
        if isinstance(leg, dict):
            reason = str(leg.get("settle_reason") or "")
            d = str(leg.get("direction") or "").upper()
        else:
            reason = str(getattr(leg, "settle_reason", None) or "")
            d = str(getattr(leg, "direction", None) or "").upper()
        if reason in ("path_cut", "path_flip") and d in ("UP", "DOWN"):
            out.add(d)
    return out


@dataclass
class PathLeg:
    side: str
    entry_cents: float
    stake: float
    opened_elapsed: float = 0.0


@dataclass
class PathFill:
    action: str
    fill_kind: str
    side: str
    entry_cents: float
    exit_cents: Optional[float] = None
    stake: float = UNIT_STAKE
    paper_pnl: Optional[float] = None
    leftover: Optional[float] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "action": self.action,
            "fill_kind": self.fill_kind,
            "side": self.side,
            "entry_cents": self.entry_cents,
            "exit_cents": self.exit_cents,
            "stake": self.stake,
            "paper_pnl": self.paper_pnl,
            "leftover": self.leftover,
        }


@dataclass
class PathBook:
    ticker: str = ""
    open_legs: List[PathLeg] = field(default_factory=list)
    closed: List[PathFill] = field(default_factory=list)
    realized_pnl: float = 0.0

    def held_sides(self) -> set:
        return {str(leg.side).upper() for leg in self.open_legs if leg.side}

    def display_direction(self) -> str:
        sides = self.held_sides()
        if sides == {"UP", "DOWN"}:
            return "BOTH"
        if "UP" in sides:
            return "UP"
        if "DOWN" in sides:
            return "DOWN"
        return "WAIT"

    def units_on(self, side: str) -> int:
        want = str(side or "").upper()
        return sum(1 for leg in self.open_legs if str(leg.side).upper() == want)

    def size_on(self, side: str) -> float:
        want = str(side or "").upper()
        return round(sum(float(leg.stake) for leg in self.open_legs if str(leg.side).upper() == want), 4)

    def avg_on(self, side: str) -> Optional[float]:
        want = str(side or "").upper()
        legs = [leg for leg in self.open_legs if str(leg.side).upper() == want]
        if not legs:
            return None
        num = 0.0
        den = 0.0
        for leg in legs:
            entry = float(leg.entry_cents or 0)
            stake = float(leg.stake or 0)
            if entry <= 0 or stake <= 0:
                continue
            contracts = stake / (entry / 100.0)
            num += entry * contracts
            den += contracts
        if den <= 0:
            return None
        return round(num / den, 4)

    def oldest(self, side: str) -> Optional[PathLeg]:
        want = str(side or "").upper()
        for leg in self.open_legs:
            if str(leg.side).upper() == want:
                return leg
        return None

    def unrealized(self, yes_ask: Any, no_ask: Any) -> float:
        total = 0.0
        for leg in self.open_legs:
            mark = mark_cents(leg.side, yes_ask, no_ask)
            if mark is None:
                continue
            total += realized_pnl(leg.stake, leg.entry_cents, mark)
        return round(total, 4)

    def mtm(self, yes_ask: Any, no_ask: Any) -> float:
        return round(float(self.realized_pnl) + self.unrealized(yes_ask, no_ask), 4)

    def position_state(
        self,
        yes_ask: Any = None,
        no_ask: Any = None,
        next_action: str = "WAIT",
    ) -> Dict[str, Any]:
        marked = yes_ask is not None and no_ask is not None
        return {
            "size_up": self.size_on("UP"),
            "size_down": self.size_on("DOWN"),
            "avg_up": self.avg_on("UP"),
            "avg_down": self.avg_on("DOWN"),
            "unrealized": self.unrealized(yes_ask, no_ask) if marked else 0.0,
            "realized": round(float(self.realized_pnl), 4),
            "next_action": next_action,
            "open": bool(self.open_legs),
            "held_sides": sorted(self.held_sides()),
        }


def map_path_action_to_direction(
    action: str,
    book: PathBook,
    side: Optional[str] = None,
) -> str:
    """Chair management Direction after fills have been applied."""
    a = str(action or "").upper()
    s = str(side or "").upper()
    if a == "SIT":
        return "WAIT"
    if a == "DUAL":
        return "BOTH"
    if a == "FLIP":
        return "SWAP"
    if a in {"OPEN", "SCALE"}:
        return "LONG_UP" if s == "UP" else "LONG_DOWN"
    if a == "CUT":
        held = book.held_sides()
        if not held:
            return "FLAT_ALL"
        if s == "UP":
            return "FLAT_UP" if "UP" not in held else "REDUCE_UP"
        if s == "DOWN":
            return "FLAT_DOWN" if "DOWN" not in held else "REDUCE_DOWN"
        return "FLAT_ALL"
    return "WAIT"


@dataclass
class PathInputs:
    elapsed_mins: float
    mins_left: float
    yes_ask: Optional[float]
    no_ask: Optional[float]
    lean: Optional[str] = None
    ev_cents: Optional[float] = None
    dead: bool = False
    chalk: bool = False
    allow_late_open: bool = False


@dataclass
class PathDecision:
    action: str
    fills: List[PathFill] = field(default_factory=list)
    reason: str = ""


def _sit_new_risk(inp: PathInputs) -> Optional[str]:
    if inp.elapsed_mins < float(EARLY_NO_LOCK_MINS_15M):
        return "first_3m"
    if inp.mins_left <= float(LATE_WINDOW_MINS_15M) and not inp.allow_late_open:
        if inp.ev_cents is None or float(inp.ev_cents) < float(LATE_MIN_EV_15M):
            return "last_2_5m"
    if inp.dead:
        return "dead_book"
    if inp.chalk:
        return "chalk"
    return None


def _open_fill(side: str, ask: float, stake: float, kind: str, leftover: Optional[float] = None) -> PathFill:
    return PathFill(
        action=kind.split("_")[0].upper() if kind != "dual_open" else "DUAL",
        fill_kind=kind,
        side=side,
        entry_cents=float(ask),
        stake=float(stake),
        leftover=leftover,
    )


def _close_fill(leg: PathLeg, exit_px: float, kind: str) -> PathFill:
    pnl = realized_pnl(leg.stake, leg.entry_cents, exit_px)
    action = "CUT" if kind == "cut" else "FLIP"
    return PathFill(
        action=action,
        fill_kind=kind,
        side=leg.side,
        entry_cents=leg.entry_cents,
        exit_cents=float(exit_px),
        stake=leg.stake,
        paper_pnl=pnl,
    )


def apply_fills(book: PathBook, fills: Sequence[PathFill], elapsed: float = 0.0) -> PathBook:
    for fill in fills:
        kind = str(fill.fill_kind or "")
        if kind in ("cut", "flip_close"):
            leg = book.oldest(fill.side)
            if leg is None:
                continue
            book.open_legs.remove(leg)
            closed = fill
            if closed.paper_pnl is None and closed.exit_cents is not None:
                closed.paper_pnl = realized_pnl(leg.stake, leg.entry_cents, closed.exit_cents)
            book.closed.append(closed)
            book.realized_pnl = round(book.realized_pnl + float(closed.paper_pnl or 0.0), 4)
        elif kind in ("open", "scale", "flip_open", "dual_open"):
            book.open_legs.append(PathLeg(
                side=str(fill.side).upper(),
                entry_cents=float(fill.entry_cents),
                stake=float(fill.stake),
                opened_elapsed=float(elapsed),
            ))
            book.closed.append(fill)
    return book


def settle_open_legs(book: PathBook, y_finish: str) -> List[PathFill]:
    """Mark leftover legs at 100/0. Adds to realized P&L. Not a directional hit."""
    fills: List[PathFill] = []
    leftover = list(book.open_legs)
    book.open_legs = []
    for leg in leftover:
        exit_px = settle_exit_cents(leg.side, y_finish)
        fill = PathFill(
            action="SETTLE",
            fill_kind="settle",
            side=leg.side,
            entry_cents=leg.entry_cents,
            exit_cents=exit_px,
            stake=leg.stake,
            paper_pnl=realized_pnl(leg.stake, leg.entry_cents, exit_px),
        )
        book.closed.append(fill)
        book.realized_pnl = round(book.realized_pnl + float(fill.paper_pnl or 0.0), 4)
        fills.append(fill)
    return fills


def decide_action(inp: PathInputs, book: PathBook) -> PathDecision:
    """
    Smallest honest manager:
      sit → DUAL if the pair is cheap → SCALE / CUT / FLIP open legs → OPEN lean → sit.
    Late / early / chalk / dead block new risk. CUT may still flatten.
    """
    yes_ask, no_ask = inp.yes_ask, inp.no_ask
    sit_why = _sit_new_risk(inp)
    held = book.held_sides()

    # Dead 99¢ book = sit. Path exits too — not just entries.
    # Same rail as the #50 99¢ sit. Cannot scale / cut / flip / dual out of chalk.
    if is_chalk(yes_ask) or is_chalk(no_ask) or inp.chalk:
        return PathDecision("SIT", [], "chalk")

    # Flatten first if a held side is bleeding — even in the sit bands.
    # Thresholds are time-scaled: patient early, tighter late → better path P&L.
    cut_thr = _time_scaled_adverse(CUT_ADVERSE_CENTS, getattr(inp, "mins_left", 7.5))
    flip_thr = _time_scaled_adverse(FLIP_ADVERSE_CENTS, getattr(inp, "mins_left", 7.5))
    if held and yes_ask is not None and no_ask is not None:
        for side in ("UP", "DOWN"):
            if side not in held:
                continue
            leg = book.oldest(side)
            if leg is None:
                continue
            mark = mark_cents(side, yes_ask, no_ask)
            if mark is None or is_chalk(mark):
                continue
            adverse = float(leg.entry_cents) - float(mark)
            other = other_side(side)
            other_ask = side_ask(other, yes_ask, no_ask)
            if (
                adverse >= flip_thr
                and other_ask is not None
                and in_playable_band(other_ask)
                and not is_chalk(other_ask)
                and sit_why is None
            ):
                fills = [_close_fill(leg, mark, "flip_close")]
                fills.append(_open_fill(other, float(other_ask), UNIT_STAKE, "flip_open"))
                return PathDecision("FLIP", fills, f"flip {side}→{other} adverse {adverse:.1f}¢ (thr {flip_thr:.1f})")
            if adverse >= cut_thr:
                return PathDecision(
                    "CUT",
                    [_close_fill(leg, mark, "cut")],
                    f"cut {side} adverse {adverse:.1f}¢ (thr {cut_thr:.1f})",
                )

    if sit_why:
        return PathDecision("SIT", [], sit_why)

    if yes_ask is None or no_ask is None:
        return PathDecision("SIT", [], "no_asks")

    left = combined_leftover(yes_ask, no_ask)
    if dual_attractive(yes_ask, no_ask):
        missing = [s for s in ("UP", "DOWN") if s not in held]
        if missing:
            up_s, down_s = equal_contract_stakes(yes_ask, no_ask)
            fills = []
            if "UP" in missing:
                fills.append(_open_fill("UP", float(yes_ask), up_s, "dual_open", left))
            if "DOWN" in missing:
                fills.append(_open_fill("DOWN", float(no_ask), down_s, "dual_open", left))
            return PathDecision("DUAL", fills, f"dual leftover {left:.1f}¢")

    lean = str(inp.lean or "").upper() if inp.lean else None
    if lean in ("UP", "DOWN") and lean in held:
        leg = book.oldest(lean)
        mark = mark_cents(lean, yes_ask, no_ask)
        ask = side_ask(lean, yes_ask, no_ask)
        if (
            leg is not None
            and mark is not None
            and ask is not None
            and in_playable_band(ask)
            and not is_chalk(ask)
            and (float(mark) - float(leg.entry_cents)) >= SCALE_EDGE_CENTS
            and book.units_on(lean) < MAX_UNITS_PER_SIDE
        ):
            return PathDecision(
                "SCALE",
                [_open_fill(lean, float(ask), UNIT_STAKE, "scale")],
                f"scale {lean} +{float(mark) - float(leg.entry_cents):.1f}¢",
            )

    if lean in ("UP", "DOWN") and lean not in held:
        # A second door is DUAL-only (leftover after vig). Never OPEN into both.
        if held:
            return PathDecision("SIT", [], "second_leg_needs_leftover")
        ask = side_ask(lean, yes_ask, no_ask)
        ev_ok = inp.ev_cents is None or float(inp.ev_cents) >= 3.0
        if ask is not None and in_playable_band(ask) and not is_chalk(ask) and ev_ok:
            return PathDecision(
                "OPEN",
                [_open_fill(lean, float(ask), UNIT_STAKE, "open")],
                f"open {lean} @ {float(ask):.0f}¢",
            )

    return PathDecision("SIT", [], "no_edge")


def _bar_time(row: Dict[str, Any]) -> Optional[datetime]:
    try:
        t = int(row.get("open_time") or row.get("close_time") or 0)
    except (TypeError, ValueError):
        return None
    if t <= 0:
        return None
    if t > 10_000_000_000:
        return datetime.fromtimestamp(t / 1000.0, tz=UTC)
    return datetime.fromtimestamp(t, tz=UTC)


def _bar_close(row: Dict[str, Any]) -> Optional[float]:
    try:
        return float(row.get("close") or 0) or None
    except (TypeError, ValueError):
        return None


def simulate_path(
    *,
    candles: Sequence[Dict[str, Any]],
    floor_strike: Any,
    close_time: datetime,
    votes: Dict[str, Any] | None = None,
    y_finish: str | None = None,
    ticker: str = "",
    quotes: Sequence[Dict[str, Any]] | None = None,
    ev_cents: float | None = 3.0,
) -> Dict[str, Any]:
    """
    Walk 1m bars inside the 15m window. Seats vote a lean; the book manages.
    y_finish only marks leftover legs. Training label is net paper P&L.
    """
    from backend.learning.seat_backfill import reconstructed_yes_mid

    close_utc = close_time if close_time.tzinfo else close_time.replace(tzinfo=UTC)
    window_open = close_utc - timedelta(minutes=WINDOW_MINUTES_15M)
    lean = lean_from_votes(votes)
    book = PathBook(ticker=str(ticker or ""))
    quote_by_min: Dict[int, Dict[str, Any]] = {}
    for q in quotes or []:
        try:
            quote_by_min[int(q.get("elapsed_mins"))] = q
        except (TypeError, ValueError, AttributeError):
            continue

    actions: List[str] = []
    for row in candles:
        ts = _bar_time(row)
        if ts is None or ts < window_open or ts > close_utc:
            continue
        elapsed = max(0.0, (ts - window_open).total_seconds() / 60.0)
        mins_left = max(0.0, WINDOW_MINUTES_15M - elapsed)
        q = quote_by_min.get(int(elapsed))
        if q and q.get("yes_ask") is not None and q.get("no_ask") is not None:
            yes_ask = float(q["yes_ask"])
            no_ask = float(q["no_ask"])
        else:
            spot = _bar_close(row)
            mid = reconstructed_yes_mid(spot, floor_strike) if spot is not None else None
            yes_ask, no_ask = asks_from_mid(mid)
        if yes_ask is None or no_ask is None:
            continue
        inp = PathInputs(
            elapsed_mins=elapsed,
            mins_left=mins_left,
            yes_ask=yes_ask,
            no_ask=no_ask,
            lean=lean,
            ev_cents=ev_cents,
            chalk=is_chalk(yes_ask) or is_chalk(no_ask),
        )
        decision = decide_action(inp, book)
        if decision.fills:
            apply_fills(book, decision.fills, elapsed)
            actions.append(decision.action)

    if y_finish in ("UP", "DOWN"):
        settle_open_legs(book, y_finish)

    held = {str(f.side).upper() for f in book.closed if f.fill_kind in ("open", "scale", "dual_open", "flip_open", "settle", "cut", "flip_close")}
    if not held:
        held = book.held_sides()
    # Sides we actually traded, not the official settle.
    traded = {str(f.side).upper() for f in book.closed if f.side in ("UP", "DOWN")}
    net = round(float(book.realized_pnl), 4)
    return {
        "ticker": ticker,
        "net_pnl": net,
        "path_win": net > 1e-9,
        "path_loss": net < -1e-9,
        "held_sides": sorted(traded),
        "lean": lean,
        "actions": actions,
        "fills": [f.as_dict() for f in book.closed],
        "y_finish": y_finish,
        "score": "realized_paper_pnl",
    }


def window_path_pnl(rows: Iterable[Any]) -> float:
    total = 0.0
    for row in rows:
        raw = getattr(row, "paper_pnl", None)
        if raw is None and isinstance(row, dict):
            raw = row.get("paper_pnl")
        try:
            total += float(raw or 0.0)
        except (TypeError, ValueError):
            continue
    return round(total, 4)


def group_path_windows(rows: Iterable[Any]) -> List[Tuple[Tuple[str, str], List[Any], float]]:
    """Group settled 15m path fills by ticker + close_time. Skip old finish hits."""
    groups: Dict[Tuple[str, str], List[Any]] = {}
    for row in rows:
        ticker = str(getattr(row, "ticker", None) or (row.get("ticker") if isinstance(row, dict) else "") or "")
        if not is_btc_15m_ticker(ticker):
            continue
        direction = str(getattr(row, "direction", None) or (row.get("direction") if isinstance(row, dict) else "") or "").upper()
        reason = str(getattr(row, "settle_reason", None) or (row.get("settle_reason") if isinstance(row, dict) else "") or "")
        if direction == "WAIT" or reason in SKIP_SCORE_REASONS or reason in OLD_FINISH_REASONS:
            continue
        if reason and not is_path_settle_reason(reason):
            continue
        if not reason:
            continue
        close_time = str(getattr(row, "close_time", None) or (row.get("close_time") if isinstance(row, dict) else "") or "")
        key = (ticker, close_time)
        groups.setdefault(key, []).append(row)
    out: List[Tuple[Tuple[str, str], List[Any], float]] = []
    for key, legs in groups.items():
        out.append((key, legs, window_path_pnl(legs)))
    return out
