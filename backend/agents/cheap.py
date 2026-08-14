"""
CHEAP – Value Side.

Kalshi contract value with multi-window context.
- Entry: only lean into extreme cheap when multi-window regime supports it
- Avoid chronic "always buy cheap" behavior that gets run over on trend days
- Revision: if we bought cheap and path goes further against, admit the value trap

Works with AdaptiveLearner fade/invert when historically wrong.
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class CheapSpecialist(BaseSpecialist):
    name = "cheap"
    category = "value"
    base_weight = settings.BASE_WEIGHTS.get("cheap", 0.09)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        up = _pct(market_data.get("up_pct"))
        if up is None:
            bid = market_data.get("kalshi_yes_bid")
            up = _pct(bid)
        if up is None:
            return AgentSignal(self.name, "WAIT", 40, "No Kalshi mid", self.category)

        down = 100.0 - up
        cheap_thr = float(getattr(settings, "CHEAP_SIDE_MAX", 42.0))
        fair_band = float(getattr(settings, "CHEAP_FAIR_BAND", 8.0))
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=55)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)

        features = {
            "up_pct": up,
            "down_pct": down,
            "cheap_thr": cheap_thr,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "streak_n": streak_n,
            "path_move": path,
            "subs": [
                {"name": "YES", "detail": f"{up:.0f}¢"},
                {"name": "NO", "detail": f"{down:.0f}¢"},
                {"name": "BAND", "detail": f"≤{cheap_thr:g}¢ lean"},
            ],
        }

        direction = "WAIT"
        conf = 48
        notes = []

        if phase == "entry":
            # Strong value only if not fighting a hard streak without mean-rev support
            fighting_streak = (
                streak_n >= 4
                and streak_dir in ("UP", "DOWN")
            )
            if up <= cheap_thr:
                direction, conf = "UP", min(86, 58 + int((cheap_thr - up) * 1.8))
                notes.append(f"cheap YES {up:.0f}¢ → lean UP")
                if mean_rev == "UP":
                    conf = min(90, conf + 6)
                    notes.append("mean-rev supports")
                if fighting_streak and streak_dir == "DOWN" and mean_rev != "UP":
                    conf = max(50, conf - 12)
                    notes.append(f"careful: {streak_n}-down streak")
            elif down <= cheap_thr:
                direction, conf = "DOWN", min(86, 58 + int((cheap_thr - down) * 1.8))
                notes.append(f"cheap NO {down:.0f}¢ → lean DOWN")
                if mean_rev == "DOWN":
                    conf = min(90, conf + 6)
                    notes.append("mean-rev supports")
                if fighting_streak and streak_dir == "UP" and mean_rev != "DOWN":
                    conf = max(50, conf - 12)
                    notes.append(f"careful: {streak_n}-up streak")
            elif abs(up - 50.0) <= fair_band:
                direction, conf = "WAIT", max(floor, 52)
                notes.append(f"fair mid {up:.0f}¢ — no value")
            elif up < 50.0:
                direction, conf = "UP", 52
                notes.append(f"mild value UP ({up:.0f}¢)")
            else:
                direction, conf = "DOWN", 52
                notes.append(f"mild value DOWN ({down:.0f}¢)")

        else:
            # Revision: value trap detection
            if entry == "UP" and path is not None and path <= -6.0 and up < 40:
                # Bought cheap YES, still cheap, path bleeding — trap
                direction, conf = "DOWN", 64
                notes.append(f"value trap UP (path {path:.1f}, still {up:.0f}¢)")
            elif entry == "DOWN" and path is not None and path >= 6.0 and down < 40:
                direction, conf = "UP", 64
                notes.append(f"value trap DOWN (path +{path:.1f}, still NO {down:.0f}¢)")
            elif up <= cheap_thr:
                direction, conf = "UP", 58
                notes.append(f"still cheap YES {up:.0f}¢")
            elif down <= cheap_thr:
                direction, conf = "DOWN", 58
                notes.append(f"still cheap NO {down:.0f}¢")
            elif entry in ("UP", "DOWN"):
                direction, conf = entry, 54
                notes.append(f"hold entry {entry} — value stable")
            else:
                notes.append(f"mid {up:.0f}¢ — no value revise")

        if quiet and direction != "WAIT" and conf < floor + 5:
            direction, conf = "WAIT", floor
            notes.append("quiet gate")

        reason = self.annotate_reason(market_data, "; ".join(notes) if notes else "value neutral")
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
