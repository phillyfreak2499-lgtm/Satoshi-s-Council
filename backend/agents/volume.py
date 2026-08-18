"""
PULSE – Volume specialist.

Spikes, dry-ups, and volume-price agreement across horizons — not just
the last 3 candles.

ENTRY: Is volume expanding with price in a way that can carry the window?
MID/FINAL: Did volume dry up or flip against the entry path?
Quiet / low-volume regimes raise the bar hard.
"""
from __future__ import annotations
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np


class VolumeSpecialist(BaseSpecialist):
    name = "volume"
    category = "volume"
    base_weight = settings.BASE_WEIGHTS.get("volume", 0.08)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=55)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)

        candles = market_data.get("candles") or []
        if len(candles) < 30:
            return AgentSignal(
                self.name, "WAIT", 25,
                self.annotate_reason(market_data, "insufficient volume history"),
                self.category,
            )

        volumes = np.array([float(c.get("volume") or c.get("v") or 0) for c in candles[-50:]], dtype=float)
        closes = np.array([float(c.get("close") or c.get("c") or 0) for c in candles[-50:]], dtype=float)

        avg_vol = float(volumes[:-4].mean() or 1.0)
        recent_vol = float(volumes[-3:].mean())
        mid_vol = float(volumes[-10:-3].mean() or avg_vol)
        spike_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0
        mid_ratio = mid_vol / avg_vol if avg_vol > 0 else 1.0

        price_change_3 = (closes[-1] - closes[-4]) / closes[-4] if len(closes) > 3 and closes[-4] > 0 else 0.0
        price_change_10 = (closes[-1] - closes[-11]) / closes[-11] if len(closes) > 10 and closes[-11] > 0 else 0.0

        dry = spike_ratio < 0.55 and mid_ratio < 0.75
        expanding = spike_ratio > 1.8 and mid_ratio > 1.1
        hard_spike = spike_ratio > 2.4

        features = {
            "spike_ratio": round(float(spike_ratio), 2),
            "mid_ratio": round(float(mid_ratio), 2),
            "avg_vol": round(float(avg_vol), 2),
            "recent_vol": round(float(recent_vol), 2),
            "price_change_3m": round(float(price_change_3), 5),
            "price_change_10m": round(float(price_change_10), 5),
            "dry": dry,
            "expanding": expanding,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "SPIKE", "detail": f"×{spike_ratio:.1f}"},
                {"name": "MID", "detail": f"×{mid_ratio:.1f}"},
                {"name": "PX3", "detail": f"{price_change_3*100:+.2f}%"},
            ],
        }

        notes = []
        local_dir = None
        local_conf = 45

        if dry or quiet:
            notes.append(f"low volume ×{spike_ratio:.1f} — reduced edge")
            local_dir, local_conf = None, max(floor, 58)
        elif hard_spike and price_change_3 > 0.0005:
            local_dir, local_conf = "UP", min(84, 52 + int(spike_ratio * 10))
            notes.append(f"volume spike ×{spike_ratio:.1f} with rise")
        elif hard_spike and price_change_3 < -0.0005:
            local_dir, local_conf = "DOWN", min(84, 52 + int(spike_ratio * 10))
            notes.append(f"volume spike ×{spike_ratio:.1f} with drop")
        elif expanding and price_change_10 > 0.0008 and price_change_3 > 0:
            local_dir, local_conf = "UP", 60
            notes.append("expanding volume on up path")
        elif expanding and price_change_10 < -0.0008 and price_change_3 < 0:
            local_dir, local_conf = "DOWN", 60
            notes.append("expanding volume on down path")
        elif spike_ratio > 1.3 and price_change_3 > 0.0004:
            local_dir, local_conf = "UP", 54
            notes.append("mild volume confirms up")
        elif spike_ratio > 1.3 and price_change_3 < -0.0004:
            local_dir, local_conf = "DOWN", 54
            notes.append("mild volume confirms down")
        else:
            notes.append("volume neutral")

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and (hard_spike or expanding):
                direction, conf = local_dir, local_conf
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(90, conf + 4)
                    notes.append(f"streak {streak_dir}×{streak_n}")
            elif local_dir and not dry:
                direction, conf = local_dir, max(52, local_conf - 2)
            else:
                notes.append("no whole-window volume edge")
        else:
            if entry in ("UP", "DOWN"):
                adverse = local_dir and local_dir != entry and (hard_spike or expanding)
                supportive = local_dir == entry and (hard_spike or expanding or spike_ratio > 1.2)
                dried_against = dry and path is not None and (
                    (entry == "UP" and path <= -4) or (entry == "DOWN" and path >= 4)
                )
                if adverse and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf, 62)
                    notes.append(f"volume flipped vs entry {entry} (path {path:+.1f})")
                elif dried_against:
                    direction = "DOWN" if entry == "UP" else "UP"
                    conf = 58
                    notes.append(f"volume dried vs entry {entry}")
                elif supportive:
                    direction, conf = entry, max(local_conf, 56)
                    notes.append(f"volume still with entry {entry}")
                else:
                    direction, conf = entry, 53
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision volume edge")

        if (dry or quiet) and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet/dry gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "volume neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
