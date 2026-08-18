"""
Adaptive re-weighting of Council specialists based on recent performance.
Uses rolling win-rate + Brier score. Bounded, gradual updates.
"""

from __future__ import annotations
import logging
from typing import Dict, Any
from .store import PerformanceStore

logger = logging.getLogger(__name__)


class Reweighter:
    def __init__(
        self,
        store: PerformanceStore,
        base_weights: Dict[str, float],
        max_weight: float = 0.28,
        min_weight: float = 0.05,
        learning_rate: float = 0.15,
        window_size: int = 100,
    ):
        self.store = store
        self.base_weights = dict(base_weights)
        self.current_weights = dict(base_weights)
        self.max_weight = max_weight
        self.min_weight = min_weight
        self.learning_rate = learning_rate
        self.window_size = window_size

    def compute_scores(self) -> Dict[str, float]:
        perf = self.store.get_agent_performance(self.window_size)
        scores = {}
        for agent, stats in perf.items():
            wr = stats.get("win_rate") or 0.5
            brier = stats.get("brier_score")
            if brier is None:
                brier = 0.25
            # Lower Brier is better. Normalize roughly 0-0.5 range -> 0-1 quality
            brier_quality = max(0.0, 1.0 - (brier / 0.5))
            score = 0.6 * wr + 0.4 * brier_quality
            scores[agent] = score
        return scores

    def reweight(self, reason: str = "periodic") -> Dict[str, float]:
        scores = self.compute_scores()
        if not scores:
            logger.info("No performance data yet – keeping base weights")
            return self.current_weights

        # Relative to average score
        avg_score = sum(scores.values()) / len(scores) if scores else 0.5
        new_weights = {}
        for agent, base in self.base_weights.items():
            score = scores.get(agent, 0.5)
            relative = score / avg_score if avg_score > 0 else 1.0
            # Gradual: blend toward performance-adjusted
            target = base * (0.7 + 0.3 * relative)
            updated = (1 - self.learning_rate) * self.current_weights.get(agent, base) + self.learning_rate * target
            # Clamp
            updated = max(self.min_weight, min(self.max_weight, updated))
            new_weights[agent] = updated

            old = self.current_weights.get(agent, base)
            if abs(updated - old) > 0.005:
                self.store.record_weight_change(agent, old, updated, reason)

        # Normalize so total ~ sum of bases (or 1.0)
        total = sum(new_weights.values())
        target_total = sum(self.base_weights.values()) or 1.0
        if total > 0:
            scale = target_total / total
            new_weights = {k: v * scale for k, v in new_weights.items()}

        self.current_weights = new_weights
        logger.info("Reweighted agents: %s", {k: round(v, 3) for k, v in new_weights.items()})
        return new_weights

    def get_weights(self) -> Dict[str, float]:
        return dict(self.current_weights)
