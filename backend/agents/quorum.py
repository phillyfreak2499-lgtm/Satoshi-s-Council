"""
QUORUM – floor majority + historical winning-size / combo specialist.

Council calls from_peers(peer_dirs, market_data) after other bots vote.
Also supports get_signal() fallback.

Multi-window:
  ENTRY: Is there a real directional quorum for a whole-window call?
  MID/FINAL: Has the floor flipped enough vs entry to support a revision?
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
        peer_dirs = market_data.get("peer_dirs") or {}
        if not peer_dirs:
            # Try to build from peer_signals / agent_votes shapes
            peers = (
                market_data.get("peer_signals")
                or market_data.get("agent_votes")
                or market_data.get("floor_votes")
                or {}
            )
            if isinstance(peers, dict):
                peer_dirs = {
                    str(k): (
                        str(v).upper()
                        if not isinstance(v, dict)
                        else str(v.get("direction") or "WAIT").upper()
                    )
                    for k, v in peers.items()
                }
        return self.from_peers(peer_dirs, market_data)

    def from_peers(
        self,
        peer_dirs: Dict[str, str],
        market_data: Optional[Dict[str, Any]] = None,
    ) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        market_data = market_data or {}
        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=52)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)

        # Count live colors among peers (exclude self/non-voters)
        skip = {"quorum", "guardian", "law", "leader", "chair"}
        try:
            from backend.agents.base import lean_side
        except Exception:
            lean_side = None  # type: ignore

        def _peer_lean(d: Any) -> Optional[str]:
            if lean_side:
                return lean_side(d)
            u = str(d or "").upper()
            if u in ("UP", "UP_HOLD", "LONG_UP"):
                return "UP"
            if u in ("DOWN", "DOWN_HOLD", "LONG_DOWN"):
                return "DOWN"
            return None

        up_names = [n for n, d in peer_dirs.items() if _peer_lean(d) == "UP" and n not in skip]
        down_names = [n for n, d in peer_dirs.items() if _peer_lean(d) == "DOWN" and n not in skip]
        wait_n = sum(
            1
            for n, d in peer_dirs.items()
            if _peer_lean(d) not in ("UP", "DOWN") and n not in skip
        )
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
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
        }

        # Historical optimal size + combo stats from learner
        opt_size = 3
        size_wr = None
        best_combos: List[Dict[str, Any]] = []
        if self._learner is not None:
            try:
                qs = self._learner.quorum_snapshot()
                opt_size = int(qs.get("best_size") or 3)
                size_wr = qs.get("best_wr")
                best_combos = qs.get("best_combos") or []
            except Exception:
                pass
        else:
            learning = market_data.get("learning") or {}
            size_stats = learning.get("quorum_size") or market_data.get("quorum_size_stats") or {}
            opt_size = int(size_stats.get("best_size") or getattr(settings, "QUORUM_OPT_SIZE", 3))
            size_wr = size_stats.get("best_wr")
            best_combos = learning.get("best_combos") or market_data.get("best_combos") or []

        notes: List[str] = []
        local_dir = None
        local_conf = 48

        if lean == "WAIT" or total_dir == 0:
            notes.append(f"no directional majority · U{up_n}/D{down_n}/W{wait_n}")
        else:
            size = len(lean_names)
            size_delta = abs(size - opt_size)
            if size >= max(2, opt_size - 1):
                local_dir = lean
                local_conf = min(86, 48 + size * 6 - size_delta * 5)
                notes.append(
                    f"{lean} quorum {size} seats (hist best ≈{opt_size}"
                    + (f" @ {size_wr:.0%}" if size_wr is not None else "")
                    + ")"
                )
                if size_delta == 0 and size >= 2:
                    local_conf = min(90, local_conf + 6)
                    notes.append("size match")
            elif size >= 2:
                local_dir, local_conf = lean, 50 + size * 3
                notes.append(f"thin {lean} quorum ({size}) — below hist best {opt_size}")
            else:
                notes.append(f"only {size} on {lean} — need broader floor")

            # Combo boost
            if lean_names and best_combos:
                lean_set = set(lean_names)
                for c in best_combos:
                    members = set(c.get("members") or [])
                    if not members:
                        continue
                    if members.issubset(lean_set):
                        wr = float(c.get("wr") or 0)
                        if wr >= 0.55 and int(c.get("tries") or 0) >= 3:
                            local_conf = min(92, (local_conf or 50) + int(8 + wr * 10))
                            labels = "+".join(c.get("labels") or list(members)[:4])
                            notes.append(f"combo {labels}")
                            features["active_combo"] = labels
                            break

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and local_conf >= 52:
                direction, conf = local_dir, local_conf
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(92, conf + 3)
                    notes.append(f"streak {streak_dir}×{streak_n}")
            else:
                notes.append("no whole-window quorum edge")
        else:
            if entry in ("UP", "DOWN"):
                flipped = local_dir and local_dir != entry and local_conf >= 56
                supportive = local_dir == entry and local_conf >= 52
                if flipped and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf, 62)
                    notes.append(f"floor flipped vs entry {entry} (path {path:+.1f})")
                elif supportive:
                    direction, conf = entry, max(local_conf, 56)
                    notes.append(f"floor still with entry {entry}")
                else:
                    direction, conf = entry, 52
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision quorum edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        features["subs"] = [
            {"name": "SIZE", "detail": f"opt={opt_size} live={len(lean_names)}"},
            {"name": "COMBO", "detail": features.get("active_combo") or "scanning"},
            {"name": "FLOOR", "detail": f"U{up_n}/D{down_n}/W{wait_n}"},
        ]

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "quorum neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
