"""
STREAK – multi-window direction streak + mean-reversion specialist.

Reads prior settled windows from WindowMemory:
  - Continuation when streak is young and path agrees
  - Fade when streak is extended (mean-rev)

ENTRY: Is the multi-window streak a whole-window edge?
MID/FINAL: Has the live path broken the streak thesis?
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class StreakSpecialist(BaseSpecialist):
    name = "streak"
    category = "streak"
    base_weight = settings.BASE_WEIGHTS.get("streak", 0.08)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=54)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)
        prior_hr = self.prior_hit_rate(market_data, 12)

        features: Dict[str, Any] = {
            "streak_dir": streak_dir,
            "streak_n": streak_n,
            "mean_rev_bias": mean_rev,
            "prior_hit_rate": prior_hr,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "STR", "detail": f"{streak_dir or '—'}×{streak_n}"},
                {"name": "MR", "detail": mean_rev or "—"},
                {"name": "HR", "detail": f"{prior_hr:.0%}" if prior_hr is not None else "—"},
            ],
        }

        notes = []
        local_dir = None
        local_conf = 45

        # Young streak → continuation; extended → fade
        continue_max = int(getattr(settings, "STREAK_CONTINUE_MAX", 3))
        fade_min = int(getattr(settings, "STREAK_FADE_MIN", 5))

        if streak_dir in ("UP", "DOWN") and streak_n >= 1:
            if streak_n <= continue_max:
                local_dir = streak_dir
                local_conf = min(72, 50 + streak_n * 5)
                notes.append(f"young streak {streak_dir}×{streak_n} — continue")
            elif streak_n >= fade_min:
                local_dir = "DOWN" if streak_dir == "UP" else "UP"
                local_conf = min(78, 54 + (streak_n - fade_min) * 4)
                notes.append(f"extended streak {streak_dir}×{streak_n} — fade")
            else:
                notes.append(f"mid streak {streak_dir}×{streak_n} — neutral")
        else:
            notes.append("no prior-window streak")

        if mean_rev and local_dir == mean_rev:
            local_conf = min(84, local_conf + 6)
            notes.append("mean-rev agrees")
        elif mean_rev and local_dir and local_dir != mean_rev:
            local_conf = max(48, local_conf - 6)
            notes.append("mean-rev conflicts")

        direction = "WAIT"
        conf = 46

        if phase == "entry":
            if local_dir and local_conf >= 52:
                direction, conf = local_dir, local_conf
                if prior_hr is not None and prior_hr >= 0.60 and local_dir == streak_dir:
                    conf = min(86, conf + 4)
                    notes.append(f"hot prior HR {prior_hr:.0%}")
            else:
                notes.append("no whole-window streak edge")
        else:
            if entry in ("UP", "DOWN"):
                # Live path breaking streak thesis?
                broken = (
                    path is not None
                    and abs(path) >= 5.0
                    and (
                        (entry == "UP" and path <= -5)
                        or (entry == "DOWN" and path >= 5)
                    )
                )
                if broken and local_dir and local_dir != entry:
                    direction, conf = local_dir, max(local_conf, 62)
                    notes.append(f"path broke streak entry {entry} (path {path:+.1f})")
                elif local_dir == entry:
                    direction, conf = entry, max(local_conf, 56)
                    notes.append(f"streak thesis still with entry {entry}")
                else:
                    direction, conf = entry, 53
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision streak edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "streak neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
