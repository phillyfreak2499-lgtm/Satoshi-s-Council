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


# SWAP = big directional flip (paper signal only — not trade execution advice)
# UP_HOLD / DOWN_HOLD = 1/4-size scalp (weaker confluence, smaller Kalshi path target)
Direction = Literal["UP", "DOWN", "WAIT", "SWAP", "UP_HOLD", "DOWN_HOLD"]

# Shared non-negotiable mission for every specialist + the Chair.
GOAL_CONTRACT = (
    "GOAL CONTRACT: Contribute to exactly ONE high-quality directional guess "
    "on how this Kalshi 15m BTC window ends (open→close UP or DOWN) at the "
    "best available odds. Never push when the book is outside 10–90¢ "
    "or at the 99¢ / 1¢ wall. Once Chair locks, "
    "support/monitor only. WAIT preferred over low-edge noise."
)

GOAL_CONTRACT_SHORT = "GOAL · 1 window-end guess @ best odds (10–90¢)"


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
        }
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
        return f"[{tag}] {GOAL_CONTRACT_SHORT} · {core}"

    def record_signal(self, signal: AgentSignal, limit: int = 40):
        self._recent_signals.append(signal)
        if len(self._recent_signals) > limit:
            self._recent_signals = self._recent_signals[-limit:]
