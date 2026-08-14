"""
ORBIT – Regime Watch.

True job: classify the multi-window environment and set aggressiveness.
Not a directional voter most of the time — a gatekeeper.

Looks across:
  - session / time-of-day pocket
  - realized vol & ATR percentile over recent windows
  - consecutive window direction streaks (trend day vs mean-revert day)
  - current window phase

In quiet / low-vol regimes: raises the directional bar for the whole council.
In expansion / high-vol: allows more directional risk.
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class RegimeSpecialist(BaseSpecialist):
    name = "regime"
    category = "regime"
    base_weight = settings.BASE_WEIGHTS.get("regime", 0.08)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        phase = self.phase(market_data)
        wm = market_data.get("wm") or {}
        atr = _f(market_data.get("atr_pct"))
        volp = _f(market_data.get("volume_percentile"))
        rv = _f(market_data.get("realized_vol"))
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)
        prior_hr = self.prior_hit_rate(market_data, 12)

        # Session tag from existing regime key machinery if present
        regime_key = (market_data.get("regime_key")
                      or (market_data.get("regime_context") or {}).get("key")
                      or "UNKNOWN")

        quiet = self.is_quiet(market_data)
        if atr is not None and atr < 0.10:
            quiet = True
        if volp is not None and volp < 20:
            quiet = True

        # Aggressiveness 0..1 — consumed by Chair / other bots via features
        aggressiveness = 0.55
        notes = []

        if quiet:
            aggressiveness = 0.28
            notes.append("quiet tape — raise bar")
        elif atr is not None and atr > 0.35:
            aggressiveness = 0.78
            notes.append(f"expanded ATR {atr:.2f}%")
        elif volp is not None and volp > 75:
            aggressiveness = 0.70
            notes.append(f"high volume pctile {volp:.0f}")

        # Multi-window: strong streak → trend-day bias (don't fight)
        if streak_n >= 4 and streak_dir in ("UP", "DOWN"):
            aggressiveness = min(0.85, aggressiveness + 0.12)
            notes.append(f"trend day {streak_dir}×{streak_n}")
        elif mean_rev and streak_n >= 3:
            notes.append(f"mean-rev setup vs {streak_dir}×{streak_n}")

        # Council recent skill
        if prior_hr is not None:
            if prior_hr < 0.45:
                aggressiveness = max(0.20, aggressiveness - 0.15)
                notes.append(f"council cold {prior_hr:.0%}")
            elif prior_hr > 0.62:
                aggressiveness = min(0.90, aggressiveness + 0.08)
                notes.append(f"council hot {prior_hr:.0%}")

        features = {
            "regime_key": regime_key,
            "aggressiveness": round(aggressiveness, 3),
            "quiet": quiet,
            "atr_pct": atr,
            "volume_percentile": volp,
            "realized_vol": rv,
            "streak_dir": streak_dir,
            "streak_n": streak_n,
            "mean_rev_bias": mean_rev,
            "prior_hit_rate": prior_hr,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
        }

        # Regime rarely votes direction; when it does, it's multi-window structure
        direction = "WAIT"
        conf = 55
        if mean_rev and phase == "entry" and not quiet:
            direction = mean_rev
            conf = 58
            notes.append(f"entry lean mean-rev {mean_rev}")
        elif streak_n >= 5 and streak_dir and phase == "entry" and aggressiveness > 0.6:
            direction = streak_dir
            conf = 60
            notes.append(f"entry ride streak {streak_dir}")

        reason = self.annotate_reason(
            market_data,
            f"Regime {regime_key} · agg {aggressiveness:.2f} · " + ("; ".join(notes) if notes else "neutral"),
        )
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)


def _f(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None
