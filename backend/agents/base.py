"""
Standardized interface for every Round Table specialist.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Literal, Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.agents.roster import display_name, title_of


# SWAP = big directional flip (paper signal only — not trade execution advice)
# UP_HOLD / DOWN_HOLD = 1/4-size scalp (weaker confluence, smaller Kalshi path target)
Direction = Literal["UP", "DOWN", "WAIT", "SWAP", "UP_HOLD", "DOWN_HOLD"]


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
    get_signal() must be fast, pure, and side-effect free (except internal state).
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
        """
        pass

    def mute(self, reason: str = ""):
        self.is_muted = True

    def unmute(self):
        self.is_muted = False

    def set_health(self, score: float):
        self.health_score = max(0.0, min(1.0, score))
