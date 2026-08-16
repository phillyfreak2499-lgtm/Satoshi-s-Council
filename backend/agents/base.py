"""
Standardized interface for every Round Table specialist.

Upgraded for multi-window memory and entry/mid/final phase awareness.
Bots are expected to think beyond the last few ticks:
  - prior settled windows (streak, mean-reversion, regime context)
  - current window path since entry
  - which phase of the window they are advising (entry vs revision)
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Literal, Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.agents.roster import display_name, title_of


# Chair management set for the BTC 15m path book. Specialists still vote
# UP / DOWN / WAIT. Holding both doors at once is expected when leftover is real.
# UP_HOLD / DOWN_HOLD stay as legacy UI aliases. BOTH is the dual-sided display.
Direction = Literal[
    "UP",
    "DOWN",
    "WAIT",
    "SWAP",
    "LONG_UP",
    "LONG_DOWN",
    "REDUCE_UP",
    "REDUCE_DOWN",
    "FLAT_UP",
    "FLAT_DOWN",
    "FLAT_ALL",
    "BOTH",
    "UP_HOLD",
    "DOWN_HOLD",
]

LEAN_UP = frozenset({"UP", "UP_HOLD", "LONG_UP"})
LEAN_DOWN = frozenset({"DOWN", "DOWN_HOLD", "LONG_DOWN"})
MANAGE_UP = frozenset({"REDUCE_UP", "FLAT_UP"})
MANAGE_DOWN = frozenset({"REDUCE_DOWN", "FLAT_DOWN"})
DUAL_DIRS = frozenset({"BOTH", "FLAT_ALL", "SWAP"})
WAIT_DIRS = frozenset({"WAIT", "SIT"})
ALL_DIRECTIONS = (
    LEAN_UP
    | LEAN_DOWN
    | MANAGE_UP
    | MANAGE_DOWN
    | DUAL_DIRS
    | WAIT_DIRS
)

# BTC 15m: path P&L + dual-sided scalp. Directional accuracy is secondary.
GOAL_CONTRACT = (
    "GOAL CONTRACT: Scalp both Up and Down contracts inside the 15m window. "
    "Primary edge is realized path P&L, not a finish-direction hit. "
    "Holding both sides at once is expected and normal when UP ask + DOWN ask "
    "leaves room after vig. The Chair may scale in, scale out, reduce, or flip "
    "either leg independently for the full 15 minutes. No irreversible one-call "
    "lock. Dead 99¢ book = sit. Paper fill at the real ask, not mid. "
    "WAIT preferred over chalk or a book with no leftover."
)

GOAL_CONTRACT_SHORT = "GOAL · path P&L · dual-sided scalp (20–80¢)"

# ETH 1H stays the old one-lock finish grade. Do not copy this onto BTC 15m.
ETH_GOAL_CONTRACT = (
    "ETH 1H GOAL: exactly ONE high-quality directional guess on how this "
    "hourly window ends (open→close UP or DOWN) at the best available odds. "
    "Never push outside 10–90¢ or at the 99¢ / 1¢ wall. Once Chair locks, "
    "the call is irreversible for that window. WAIT preferred over low-edge noise."
)
ETH_GOAL_CONTRACT_SHORT = "GOAL · 1 window-end guess @ best odds (10–90¢)"


def normalize_direction(direction: Any) -> str:
    d = str(direction or "").upper().strip()
    if d == "SIT":
        return "WAIT"
    return d


def side_of(direction: Any) -> Optional[str]:
    """Map a lean or management action to UP / DOWN. BOTH / WAIT → None."""
    d = normalize_direction(direction)
    if d in LEAN_UP or d in MANAGE_UP:
        return "UP"
    if d in LEAN_DOWN or d in MANAGE_DOWN:
        return "DOWN"
    return None


def lean_side(direction: Any) -> Optional[str]:
    """Chair / quorum lean. LONG_* counts. REDUCE / FLAT do not add a door."""
    d = normalize_direction(direction)
    if d in LEAN_UP:
        return "UP"
    if d in LEAN_DOWN:
        return "DOWN"
    return None


def invert_direction(direction: Any) -> str:
    d = normalize_direction(direction)
    swap = {
        "UP": "DOWN",
        "UP_HOLD": "DOWN_HOLD",
        "LONG_UP": "LONG_DOWN",
        "DOWN": "UP",
        "DOWN_HOLD": "UP_HOLD",
        "LONG_DOWN": "LONG_UP",
        "REDUCE_UP": "REDUCE_DOWN",
        "FLAT_UP": "FLAT_DOWN",
        "REDUCE_DOWN": "REDUCE_UP",
        "FLAT_DOWN": "FLAT_UP",
    }
    return swap.get(d, d)


def signed_vote(direction: Any, conf_w: float = 1.0) -> float:
    """+ favors UP. REDUCE/FLAT on a door is a mild opposite, not a +lean."""
    d = normalize_direction(direction)
    w = float(conf_w or 0.0)
    if d in LEAN_UP:
        return w
    if d in LEAN_DOWN:
        return -w
    if d in MANAGE_UP:
        return -0.35 * w
    if d in MANAGE_DOWN:
        return 0.35 * w
    return 0.0


def is_wait(direction: Any) -> bool:
    return normalize_direction(direction) in WAIT_DIRS


def is_dual_display(direction: Any) -> bool:
    return normalize_direction(direction) in {"BOTH", "FLAT_ALL"}


def allows_simultaneous_legs(direction: Any) -> bool:
    """BTC 15m path book may hold Up and Down together. Never reject that."""
    d = normalize_direction(direction)
    if d in WAIT_DIRS:
        return True
    return d in DUAL_DIRS or d in MANAGE_UP or d in MANAGE_DOWN or d in {"LONG_UP", "LONG_DOWN", "UP", "DOWN", "UP_HOLD", "DOWN_HOLD"}


PATH_SCALP_MARK = "path scalp · not a finish call"
_PATH_SKIP_AGENTS = frozenset({"guardian", "law", "leader", "chair"})


def _is_btc_15m_market(market_data: Dict[str, Any] | None) -> bool:
    md = market_data if isinstance(market_data, dict) else {}
    ticker = str(md.get("ticker") or md.get("market_ticker") or md.get("kalshi_ticker") or "")
    if ticker.upper().startswith("KXBTC15M"):
        return True
    try:
        from backend.learning.btc15m import is_15m_btc_book
        return bool(is_15m_btc_book(md))
    except Exception:
        return False


def manage_from_lean(
    direction: Any,
    book: Dict[str, Any] | None = None,
    quotes: Dict[str, Any] | None = None,
) -> str:
    """Map a finish-style lean into a path management action. BTC 15m only."""
    d = normalize_direction(direction)
    book = book if isinstance(book, dict) else {}
    quotes = quotes if isinstance(quotes, dict) else {}
    up_sz = float(book.get("size_up") or book.get("up_size") or book.get("up_stake") or 0.0)
    down_sz = float(book.get("size_down") or book.get("down_size") or book.get("down_stake") or 0.0)
    held_up = up_sz > 0.0
    held_down = down_sz > 0.0
    chalk = bool(quotes.get("chalk"))
    already = d in (
        "LONG_UP", "LONG_DOWN",
        "REDUCE_UP", "REDUCE_DOWN",
        "FLAT_UP", "FLAT_DOWN", "FLAT_ALL",
        "BOTH", "SWAP",
    )
    if chalk and (held_up or held_down):
        if held_up and held_down:
            return "FLAT_ALL"
        if held_up:
            return "FLAT_UP"
        return "FLAT_DOWN"
    if already:
        return d
    lean = lean_side(d)
    if lean == "UP":
        if held_down and not held_up:
            return "FLAT_DOWN" if down_sz <= 1.0 else "REDUCE_DOWN"
        return "LONG_UP"
    if lean == "DOWN":
        if held_up and not held_down:
            return "FLAT_UP" if up_sz <= 1.0 else "REDUCE_UP"
        return "LONG_DOWN"
    return "WAIT"


def shape_path_signal(signal: "AgentSignal", market_data: Dict[str, Any] | None) -> "AgentSignal":
    """Rewrite a 15m specialist vote into LONG/REDUCE/FLAT. ETH unchanged."""
    if signal is None or not _is_btc_15m_market(market_data):
        return signal
    name = str(getattr(signal, "agent_name", "") or "")
    if name in _PATH_SKIP_AGENTS:
        return signal
    if bool(getattr(signal, "muted", False)):
        return signal
    md = market_data if isinstance(market_data, dict) else {}
    book = md.get("path_book") if isinstance(md.get("path_book"), dict) else {}
    quotes = md.get("path_quotes") if isinstance(md.get("path_quotes"), dict) else {}
    raw = getattr(signal, "direction", "WAIT")
    shaped = manage_from_lean(raw, book, quotes)
    feats = dict(getattr(signal, "features", None) or {})
    feats["lean"] = lean_side(raw) or lean_side(shaped)
    feats["path_action"] = shaped
    reason = str(getattr(signal, "reasoning", "") or "")
    if PATH_SCALP_MARK not in reason:
        reason = f"{PATH_SCALP_MARK} · {reason}" if reason else PATH_SCALP_MARK
    signal.direction = shaped  # type: ignore[assignment]
    signal.reasoning = reason
    signal.features = feats
    for sub in getattr(signal, "subs", None) or []:
        shape_path_signal(sub, market_data)
    return signal


def shape_path_signals(signals: List[Any], market_data: Dict[str, Any] | None) -> List[Any]:
    if not _is_btc_15m_market(market_data):
        return list(signals or [])
    out = []
    for sig in signals or []:
        out.append(shape_path_signal(sig, market_data))
    return out


@dataclass
class AgentSignal:
    agent_name: str
    direction: Direction
    confidence: int                 # 0-100
    reasoning: str
    category: str                   # candle | volume | momentum | orderflow | funding | regime | health
    features: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    weight_used: float = 0.0
    muted: bool = False
    faded: bool = False
    invert: bool = False
    hard_mute: bool = False
    settle_key: Optional[str] = None
    parent: Optional[str] = None
    subs: List["AgentSignal"] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = {
            "agent_name": self.agent_name,
            "display_name": display_name(self.agent_name),
            "title": title_of(self.agent_name),
            "direction": self.direction,
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "category": self.category,
            "features": self.features,
            "timestamp": self.timestamp.isoformat(),
            "weight_used": self.weight_used,
            "muted": self.muted,
            "faded": bool(self.faded),
            "invert": bool(self.invert),
            "hard_mute": bool(self.hard_mute),
        }
        if self.settle_key:
            d["settle_key"] = self.settle_key
        if self.parent:
            d["parent"] = self.parent
            d["parent_display_name"] = display_name(self.parent)
        if self.subs:
            d["subs"] = [s.to_dict() for s in self.subs]
        return d


class BaseSpecialist(ABC):
    """
    Every rim agent inherits this.

    get_signal() must stay fast. Use helpers below for multi-window context.
    Phase-aware bots should:
      - In ENTRY phase: ask "is there a real edge for the whole window?"
      - In MID/FINAL: ask "has the story changed enough to revise?"
    """

    name: str = "base"
    category: str = "unknown"
    base_weight: float = 0.1

    def __init__(self):
        self._recent_signals: list = []
        self.is_muted: bool = False
        self.health_score: float = 1.0   # 0-1, managed by Guardian

    @abstractmethod
    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        """
        Analyze the latest market_data snapshot and return a structured signal.
        market_data contains:
          - candles: list of recent 1m OHLCV
          - current_price, volume stats
          - funding, oi, kalshi_market, orderbook snapshot
          - regime_context
          - wm: WindowMemory snapshot (multi-window + live path)
          - phase: "entry" | "mid" | "final"
        """
        pass

    def mute(self, reason: str = ""):
        self.is_muted = True

    def unmute(self):
        self.is_muted = False

    # ── multi-window / phase helpers ────────────────────────────────

    def phase(self, market_data: Dict[str, Any]) -> str:
        """Current window phase from memory or mins_left."""
        wm = market_data.get("wm") or {}
        p = wm.get("phase")
        if p in ("entry", "mid", "final"):
            return p
        mins = market_data.get("mins_left")
        try:
            m = float(mins) if mins is not None else None
        except (TypeError, ValueError):
            m = None
        if m is None:
            return "entry"
        if m > 10.0:
            return "entry"
        if m > 5.0:
            return "mid"
        return "final"

    def is_quiet(self, market_data: Dict[str, Any]) -> bool:
        wm = market_data.get("wm") or {}
        atr = market_data.get("atr_pct")
        volp = market_data.get("volume_percentile")
        try:
            if atr is not None and float(atr) < 0.12:
                return True
        except (TypeError, ValueError):
            pass
        try:
            if volp is not None and float(volp) < 25.0:
                return True
        except (TypeError, ValueError):
            pass
        # memory-level quiet flag if present
        return bool(wm.get("quiet"))

    def prior_hit_rate(self, market_data: Dict[str, Any], n: int = 12) -> Optional[float]:
        wm = market_data.get("wm") or {}
        return wm.get("prior_hit_rate")

    def streak(self, market_data: Dict[str, Any]) -> tuple:
        """(direction, count) of consecutive prior window finals."""
        wm = market_data.get("wm") or {}
        return wm.get("streak_dir"), int(wm.get("streak_n") or 0)

    def mean_reversion_bias(self, market_data: Dict[str, Any]) -> Optional[str]:
        wm = market_data.get("wm") or {}
        return wm.get("mean_rev_bias")

    def path_move(self, market_data: Dict[str, Any]) -> Optional[float]:
        """Kalshi YES points since entry (or first tick)."""
        wm = market_data.get("wm") or {}
        return wm.get("path_move")

    def entry_dir(self, market_data: Dict[str, Any]) -> Optional[str]:
        wm = market_data.get("wm") or {}
        return wm.get("entry_dir")

    def quiet_confidence_floor(self, market_data: Dict[str, Any], base: int = 58) -> int:
        """Raise the bar when the tape is dead."""
        if self.is_quiet(market_data):
            return min(85, base + 18)
        return base

    def phase_tag(self, market_data: Dict[str, Any]) -> str:
        p = self.phase(market_data)
        if p == "entry":
            return "ENTRY"
        if p == "mid":
            return "MID"
        return "FINAL"

    def annotate_reason(self, market_data: Dict[str, Any], core: str) -> str:
        """Prefix reasoning with phase + goal awareness so debate log is readable."""
        tag = self.phase_tag(market_data)
        goal = GOAL_CONTRACT_SHORT
        try:
            from backend.learning.btc15m import goal_short_for
            goal = goal_short_for(market_data=market_data)
        except Exception:
            pass
        extra = ""
        try:
            from backend.learning.btc15m import is_15m_btc_book
            if is_15m_btc_book(market_data):
                extra = f"{PATH_SCALP_MARK} · "
        except Exception:
            pass
        return f"[{tag}] {goal} · {extra}{core}"

    def record_signal(self, signal: AgentSignal, limit: int = 40):
        self._recent_signals.append(signal)
        if len(self._recent_signals) > limit:
            self._recent_signals = self._recent_signals[-limit:]
