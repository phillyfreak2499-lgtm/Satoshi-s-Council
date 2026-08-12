"""
QUORUM – tracks how many directional bots usually need to agree to be right,
and which combinations historically win together.

Competes in the hierarchy like any other seat.
Sub-lanes: SIZE (optimal headcount), COMBO (best co-correct sets).
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class QuorumSpecialist(BaseSpecialist):
    name = "quorum"
    category = "quorum"
    base_weight = settings.BASE_WEIGHTS.get("quorum", 0.09)

    def __init__(self):
        super().__init__()
        self._learner = None  # injected by Council each cycle

    def bind_learner(self, learner) -> None:
        self._learner = learner

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        """Fallback if called without peers — pure stats lean."""
        return self.from_peers(market_data.get("peer_dirs") or {}, market_data)

    def from_peers(
        self,
        peer_dirs: Dict[str, str],
        market_data: Optional[Dict[str, Any]] = None,
    ) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        # Count live colors among peers (exclude self/non-voters)
        skip = {"quorum", "guardian", "law", "leader", "chair"}
        up_names = [n for n, d in peer_dirs.items() if d == "UP" and n not in skip]
        down_names = [n for n, d in peer_dirs.items() if d == "DOWN" and n not in skip]
        wait_n = sum(1 for n, d in peer_dirs.items() if d == "WAIT" and n not in skip)
        up_n, down_n = len(up_names), len(down_names)
        total_dir = up_n + down_n

        lean = "WAIT"
        lean_names: List[str] = []
        if up_n > down_n:
            lean = "UP"
            lean_names = up_names
        elif down_n > up_n:
            lean = "DOWN"
            lean_names = down_names

        features: Dict[str, Any] = {
            "up_count": up_n,
            "down_count": down_n,
            "wait_count": wait_n,
            "dir_count": total_dir,
            "lean_size": len(lean_names),
        }

        # Historical optimal size + combo stats from learner
        opt_size = 3
        size_wr = None
        best_combos: List[Dict[str, Any]] = []
        if self._learner is not None:
            try:
                qs = self._learner.quorum_snapshot()
                opt_size = int(qs.get("best_size") or 3)
                size_wr = qs.get("best_size_wr")
                best_combos = qs.get("top_combos") or []
                features["hist_best_size"] = opt_size
                features["hist_best_size_wr"] = size_wr
                features["top_combos"] = best_combos[:3]
            except Exception:
                pass

        direction = "WAIT"
        conf = 40
        reason = f"Floor split UP {up_n} · DOWN {down_n} · WAIT {wait_n}"

        if lean == "WAIT" or total_dir == 0:
            return AgentSignal(
                self.name, "WAIT", 48, "No directional majority on the floor", self.category, features=features
            )

        size = len(lean_names)
        # Closer to historical winning size → stronger
        size_delta = abs(size - opt_size)
        if size >= max(2, opt_size - 1):
            direction = lean
            conf = min(86, 48 + size * 6 - size_delta * 5)
            reason = (
                f"{lean} quorum {size} seats "
                f"(hist best ≈{opt_size}"
                + (f" @ {size_wr:.0%}" if size_wr is not None else "")
                + ")"
            )
            if size_delta == 0 and size >= 2:
                conf = min(90, conf + 6)
                reason += " · size match"
        elif size >= 2:
            direction = lean
            conf = 50 + size * 3
            reason = f"Thin {lean} quorum ({size}) — below hist best {opt_size}"
        else:
            direction = "WAIT"
            conf = 52
            reason = f"Only {size} on {lean} — need broader floor"

        # Combo sub-signal: if current lean set matches a proven combination
        combo_boost = 0
        if lean_names and best_combos:
            lean_set = set(lean_names)
            for c in best_combos:
                members = set(c.get("members") or [])
                if not members:
                    continue
                # Current lean covers this winning combo
                if members.issubset(lean_set):
                    wr = float(c.get("wr") or 0)
                    if wr >= 0.55 and int(c.get("tries") or 0) >= 3:
                        combo_boost = max(combo_boost, int(8 + wr * 10))
                        labels = "+".join(c.get("labels") or list(members)[:4])
                        reason += f" · combo {labels}"
                        features["active_combo"] = labels
                        break
        if combo_boost and direction != "WAIT":
            conf = min(92, conf + combo_boost)

        # Subs detail for UI
        features["subs"] = [
            {"name": "SIZE", "detail": f"opt={opt_size} live={size}"},
            {"name": "COMBO", "detail": features.get("active_combo") or "scanning"},
            {"name": "FLOOR", "detail": f"U{up_n}/D{down_n}/W{wait_n}"},
        ]

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
