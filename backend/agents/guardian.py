"""
Guardian Bot – system health, data quality, mute under-performing or broken agents.
"""
from __future__ import annotations
from typing import Any, Dict, List
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
from loguru import logger


class GuardianBot(BaseSpecialist):
    name = "guardian"
    category = "health"
    base_weight = settings.BASE_WEIGHTS["guardian"]

    def __init__(self):
        super().__init__()
        self.agent_health: Dict[str, float] = {}
        self.last_errors: List[str] = []

    def update_health(self, pipeline_health: Dict[str, bool], agent_signals: List[AgentSignal]):
        """Called by the orchestrator after each cycle."""
        self.agent_health = {s.agent_name: 1.0 if not s.muted else 0.2 for s in agent_signals}
        if not pipeline_health.get("binance", True):
            self.last_errors.append("Binance feed degraded")
        if not pipeline_health.get("kalshi", True):
            self.last_errors.append("Kalshi feed degraded")
        # Keep only recent
        self.last_errors = self.last_errors[-5:]

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        health = market_data.get("health") or {}
        binance_ok = health.get("binance", False)
        kalshi_ok = health.get("kalshi", False)

        if not binance_ok and not kalshi_ok:
            return AgentSignal(
                self.name, "WAIT", 90,
                "CRITICAL: both data sources unhealthy – force WAIT",
                self.category,
                features={"binance": binance_ok, "kalshi": kalshi_ok},
            )
        if not binance_ok or not kalshi_ok:
            return AgentSignal(
                self.name, "WAIT", 55,
                f"Partial data degradation (B={binance_ok}, K={kalshi_ok}) – raise caution",
                self.category,
                features={"binance": binance_ok, "kalshi": kalshi_ok},
            )
        return AgentSignal(
            self.name, "WAIT", 20,
            "All systems healthy",
            self.category,
            features={"binance": True, "kalshi": True},
        )
