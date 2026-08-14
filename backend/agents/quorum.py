"""
QUORUM – floor majority + historical winning-size / combo specialist.

Looks at the current agent vote slate (when provided) and compares
to historically profitable coalition sizes.

Multi-window:
  ENTRY: Is there a real directional quorum for a whole-window call?
  MID/FINAL: Has the floor flipped enough vs entry to support a revision?

Does NOT invent votes — needs peer_signals or agent_votes in market_data.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class QuorumSpecialist(BaseSpecialist):
    name = "quorum"
    category = "quorum"
    base_weight = settings.BASE_WEIGHTS.get("quorum", 0.07)

    def _collect_votes(self, market_data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize peer votes from several possible payload shapes."""
        up_n = down_n = wait_n = 0
        lean_names: List[str] = []
        peers = (
            market_data.get("peer_signals")
            or market_data.get("agent_votes")
            or market_data.get("floor_votes")
            or []
        )
        if isinstance(peers, dict):
            items = list(peers.items())
            for name, val in items:
                d = str(val).upper() if not isinstance(val, dict) else str(val.get("direction") or "WAIT").upper()
                if d in ("UP", "UP_HOLD"):
                    up_n += 1
                    lean_names.append(str(name))
                elif d in ("DOWN", "DOWN_HOLD"):
                    down_n += 1
                    lean_names.append(str(name))
                else:
                    wait_n += 1
        elif isinstance(peers, list):
            for s in peers:
                if isinstance(s, dict):
                    d = str(s.get("direction") or "WAIT").upper()
                    name = str(s.get("agent_name") or s.get("name") or "?")
                else:
                    d = str(getattr(s, "direction", "WAIT")).upper()
                    name = str(getattr(s, "agent_name", getattr(s, "name", "?")))
                if d in ("UP", "UP_HOLD"):
                    up_n += 1
                    lean_names.append(name)
                elif d in ("DOWN", "DOWN_HOLD"):
                    down_n += 1
                    lean_names.append(name)
                else:
                    wait_n += 1
        return {"up_n": up_n, "down_n": down_n, "wait_n": wait_n, "lean_names": lean_names}

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=52)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)

        votes = self._collect_votes(market_data)
        up_n, down_n, wait_n = votes["up_n"], votes["down_n"], votes["wait_n"]
        lean_names = votes["lean_names"]
        total_dir = up_n + down_n

        # Historical optimal size from learner snapshot if present
        learning = market_data.get("learning") or {}
        size_stats = learning.get("quorum_size") or market_data.get("quorum_size_stats") or {}
        opt_size = int(size_stats.get("best_size") or getattr(settings, "QUORUM_OPT_SIZE", 4))
        size_wr = size_stats.get("best_wr")
        best_combos = learning.get("best_combos") or market_data.get("best_combos") or []

        if up_n > down_n and up_n >= 2:
            lean = "UP"
        elif down_n > up_n and down_n >= 2:
            lean = "DOWN"
        else:
            lean = "WAIT"

        features = {
            "up_n": up_n,
            "down_n": down_n,
            "wait_n": wait_n,
            "lean": lean,
            "opt_size": opt_size,
            "size_wr": size_wr,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "FLOOR", "detail": f"U{up_n}/D{down_n}/W{wait_n}"},
                {"name": "SIZE", "detail": f"opt={opt_size}"},
            ],
        }

        notes = []
        local_dir = None
        local_conf = 48

        if lean == "WAIT" or total_dir == 0:
            notes.append(f"no directional majority · U{up_n}/D{down_n}/W{wait_n}")
        else:
            size = up_n if lean == "UP" else down_n
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
                            features["subs"].append({"name": "COMBO", "detail": labels})
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

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "quorum neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
