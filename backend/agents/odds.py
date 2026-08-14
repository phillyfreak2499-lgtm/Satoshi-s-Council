"""
ODDS – Kalshi Skew specialist.

Real job: read the *path of the contract* across the window and across
recent windows — not just the last mid.

Entry phase:
  - Is YES mispriced relative to recent settle distribution / spot path?
  - Cheap extremes with confirmation from multi-window context.

Mid / Final:
  - Has the path from entry invalidated the original skew thesis?
  - Momentum of the contract itself (YES climbing vs fading).

Uses WindowMemory path_move and prior window outcomes.
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class OddsSpecialist(BaseSpecialist):
    name = "odds"
    category = "odds"
    base_weight = settings.BASE_WEIGHTS.get("odds", 0.11)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        up = _pct(market_data.get("up_pct"))
        if up is None:
            bid = market_data.get("kalshi_yes_bid")
            up = _pct(bid)
        if up is None:
            return AgentSignal(self.name, "WAIT", 35, "No Kalshi mid", self.category)

        down = 100.0 - up
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        entry_px = (market_data.get("wm") or {}).get("entry_up_pct")
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=56)
        mean_rev = self.mean_reversion_bias(market_data)
        streak_dir, streak_n = self.streak(market_data)

        features = {
            "up_pct": up,
            "down_pct": down,
            "path_move": path,
            "entry_dir": entry,
            "entry_up_pct": entry_px,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "quiet": quiet,
        }

        direction = "WAIT"
        conf = 48
        notes = []

        # ── ENTRY: whole-window value ───────────────────────────────
        if phase == "entry":
            # Extreme cheap with multi-window support
            if up <= 28 and not quiet:
                direction, conf = "UP", min(84, 62 + int((28 - up) * 1.5))
                notes.append(f"deep cheap YES {up:.0f}¢")
                if mean_rev == "UP":
                    conf = min(88, conf + 6)
                    notes.append("aligned multi-window mean-rev")
                if streak_dir == "DOWN" and streak_n >= 3:
                    conf = min(90, conf + 4)
                    notes.append(f"fade {streak_n}-down streak")
            elif down <= 28 and not quiet:
                direction, conf = "DOWN", min(84, 62 + int((28 - down) * 1.5))
                notes.append(f"deep cheap NO ({down:.0f}¢)")
                if mean_rev == "DOWN":
                    conf = min(88, conf + 6)
                    notes.append("aligned multi-window mean-rev")
            elif up <= 38 and not quiet:
                direction, conf = "UP", 60
                notes.append(f"value YES {up:.0f}¢")
            elif down <= 38 and not quiet:
                direction, conf = "DOWN", 60
                notes.append(f"value NO {down:.0f}¢")
            elif abs(up - 50) < 8:
                direction, conf = "WAIT", max(floor, 58)
                notes.append(f"fair {up:.0f}¢ — no skew edge")
            else:
                # Mild lean only if not quiet
                if not quiet and up < 45:
                    direction, conf = "UP", 54
                    notes.append(f"mild YES value {up:.0f}¢")
                elif not quiet and up > 55:
                    direction, conf = "DOWN", 54
                    notes.append(f"mild NO value {down:.0f}¢")
                else:
                    notes.append(f"mid {up:.0f}¢ — no entry edge")

            if quiet and direction != "WAIT":
                conf = min(conf, floor - 5)
                notes.append("quiet — trimmed")

        # ── MID / FINAL: path vs entry thesis ───────────────────────
        else:
            if entry in ("UP", "DOWN") and path is not None:
                # Path supporting entry
                if entry == "UP" and path >= 3.0:
                    direction, conf = "UP", min(80, 58 + int(path))
                    notes.append(f"path supports entry UP +{path:.1f}pts")
                elif entry == "DOWN" and path <= -3.0:
                    direction, conf = "DOWN", min(80, 58 + int(abs(path)))
                    notes.append(f"path supports entry DOWN {path:.1f}pts")
                # Path against entry — candidate revision
                elif entry == "UP" and path <= -5.0:
                    direction, conf = "DOWN", min(78, 55 + int(abs(path)))
                    notes.append(f"path broken vs entry UP ({path:.1f}) — revise")
                elif entry == "DOWN" and path >= 5.0:
                    direction, conf = "UP", min(78, 55 + int(path))
                    notes.append(f"path broken vs entry DOWN (+{path:.1f}) — revise")
                else:
                    # Hold entry side with moderate conf
                    direction, conf = entry, 57
                    notes.append(f"path {path:+.1f} still with entry {entry}")
            else:
                # No entry yet — fall back to level
                if up <= 35:
                    direction, conf = "UP", 58
                    notes.append(f"late value YES {up:.0f}¢")
                elif up >= 65:
                    direction, conf = "DOWN", 58
                    notes.append(f"late value NO {down:.0f}¢")
                else:
                    notes.append(f"no entry lock · mid {up:.0f}¢")

        if not notes:
            notes.append("odds neutral")

        reason = self.annotate_reason(market_data, "; ".join(notes))
        if direction != "WAIT" and conf < floor and quiet:
            direction, conf = "WAIT", floor
            reason = self.annotate_reason(market_data, "quiet gate — odds WAIT")

        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)


def _pct(v) -> Optional[float]:
    try:
        if v is None:
            return None
        x = float(v)
        if x <= 1.0:
            x *= 100.0
        return x
    except (TypeError, ValueError):
        return None
