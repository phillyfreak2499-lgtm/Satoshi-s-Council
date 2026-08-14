"""
GUARDIAN – system health, data quality, force-WAIT under degradation.

Not a directional edge bot. Multi-window awareness only so debate log
stays consistent and quiet/regime context is visible.

Forces WAIT when feeds are unhealthy. Soft caution when partial.
"""
from __future__ import annotations
from typing import Any, Dict, List
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
from backend.data.spot_health import spot_feed_ok
from loguru import logger


class GuardianBot(BaseSpecialist):
    name = "guardian"
    category = "health"
    base_weight = settings.BASE_WEIGHTS.get("guardian", 0.02)

    def __init__(self):
        super().__init__()
        self.agent_health: Dict[str, float] = {}
        self.last_errors: List[str] = []

    def update_health(self, pipeline_health: Dict[str, bool], agent_signals: List[AgentSignal]):
        """Called by the orchestrator after each cycle."""
        self.agent_health = {s.agent_name: 1.0 if not s.muted else 0.2 for s in agent_signals}
        if not pipeline_health.get("binance", True) and not pipeline_health.get("coinbase", False):
            self.last_errors.append("Binance feed degraded")
        if not pipeline_health.get("kalshi", True):
            self.last_errors.append("Kalshi feed degraded")
        self.last_errors = self.last_errors[-5:]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)

        health = market_data.get("health") or {}
        binance_ok = bool(health.get("binance", True)) or spot_feed_ok(health, market_data)
        kalshi_ok = health.get("kalshi", True)

        features = {
            "binance": binance_ok,
            "kalshi": kalshi_ok,
            "phase": phase,
            "quiet": quiet,
            "path_move": path,
            "entry_dir": entry,
            "recent_errors": list(self.last_errors[-3:]),
            "subs": [
                {"name": "BN", "detail": "OK" if binance_ok else "DOWN"},
                {"name": "KL", "detail": "OK" if kalshi_ok else "DOWN"},
            ],
        }

        if not binance_ok and not kalshi_ok:
            return AgentSignal(
                self.name, "WAIT", 90,
                self.annotate_reason(market_data, "CRITICAL: both data sources unhealthy – force WAIT"),
                self.category, features=features,
            )
        if not binance_ok or not kalshi_ok:
            return AgentSignal(
                self.name, "WAIT", 55,
                self.annotate_reason(
                    market_data,
                    f"partial data degradation (B={binance_ok}, K={kalshi_ok}) – raise caution",
                ),
                self.category, features=features,
            )

        notes = ["all systems healthy"]
        if quiet:
            notes.append("quiet regime")
        if entry:
            notes.append(f"entry held {entry}")

        return AgentSignal(
            self.name, "WAIT", 20,
            self.annotate_reason(market_data, " · ".join(notes)),
            self.category, features=features,
        )
