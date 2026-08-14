"""
CHAIN – OI Pressure specialist.

Open interest path + funding as crowding pressure across windows.

ENTRY: Is positioning building in a way that fuels a full-window move
       (or sets up a fade if already extreme)?
MID/FINAL: Did OI flush or flip relative to the entry thesis?

Works with CARRY (funding) but focuses more on OI trajectory + price path.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Deque, Tuple
from collections import deque
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import numpy as np
import time


class OIPressureSpecialist(BaseSpecialist):
    name = "oi_pressure"
    category = "derivatives"
    base_weight = settings.BASE_WEIGHTS.get("oi_pressure", 0.10)

    def __init__(self):
        super().__init__()
        self._oi_hist: Deque[Tuple[float, float]] = deque(maxlen=60)

    def _oi_path(self, oi: Optional[float]) -> Dict[str, Optional[float]]:
        out: Dict[str, Optional[float]] = {
            "oi": None, "chg_3m": None, "chg_10m": None, "trend": None
        }
        if oi is None:
            return out
        try:
            oi_f = float(oi)
        except (TypeError, ValueError):
            return out
        now = time.time()
        self._oi_hist.append((now, oi_f))
        cutoff = now - 900
        while self._oi_hist and self._oi_hist[0][0] < cutoff:
            self._oi_hist.popleft()
        out["oi"] = round(oi_f, 1)

        def _chg_since(sec: float) -> Optional[float]:
            target = now - sec
            prev = None
            for t, v in self._oi_hist:
                if t <= target:
                    prev = v
                else:
                    break
            if prev is None or prev <= 0:
                if len(self._oi_hist) >= 2 and self._oi_hist[0][1] > 0:
                    prev = self._oi_hist[0][1]
                else:
                    return None
            return (oi_f - prev) / prev

        out["chg_3m"] = _chg_since(180)
        out["chg_10m"] = _chg_since(600)
        if out["chg_10m"] is not None:
            if out["chg_10m"] > 0.008:
                out["trend"] = 1.0
            elif out["chg_10m"] < -0.008:
                out["trend"] = -1.0
            else:
                out["trend"] = 0.0
        return out

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

        oi = market_data.get("open_interest")
        candles = market_data.get("candles") or []
        funding = market_data.get("funding_rate")

        if len(candles) < 12:
            return AgentSignal(
                self.name, "WAIT", 25,
                self.annotate_reason(market_data, "thin history for OI path"),
                self.category,
            )

        closes = np.array([float(c.get("close") or c.get("c") or 0) for c in candles[-24:]], dtype=float)
        ret8 = (closes[-1] - closes[-9]) / closes[-9] if len(closes) > 8 and closes[-9] > 0 else 0.0
        ret3 = (closes[-1] - closes[-4]) / closes[-4] if len(closes) > 3 and closes[-4] > 0 else 0.0

        oi_info = self._oi_path(float(oi) if isinstance(oi, (int, float)) else None)
        fund = 0.0
        try:
            if funding is not None:
                fund = float(funding)
        except (TypeError, ValueError):
            fund = 0.0

        features: Dict[str, Any] = {
            "oi": oi_info.get("oi"),
            "ret_8": round(float(ret8), 5),
            "ret_3": round(float(ret3), 5),
            "funding": fund,
            "oi_chg_3m": round(oi_info["chg_3m"], 4) if oi_info.get("chg_3m") is not None else None,
            "oi_chg_10m": round(oi_info["chg_10m"], 4) if oi_info.get("chg_10m") is not None else None,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "RET8", "detail": f"{ret8*100:+.2f}%"},
                {"name": "FUND", "detail": f"{fund*100:.3f}%"},
            ],
        }
        if oi_info.get("chg_10m") is not None:
            features["subs"].append({"name": "OI10", "detail": f"{oi_info['chg_10m']*100:+.1f}%"})

        notes = []
        local_dir = None
        local_conf = 45

        oi_rising = (oi_info.get("chg_10m") or 0) > 0.01 or (oi_info.get("chg_3m") or 0) > 0.008
        oi_falling = (oi_info.get("chg_10m") or 0) < -0.01 or (oi_info.get("chg_3m") or 0) < -0.008

        # Crowded longs rolling over
        if fund > 0.00025 and ret3 < -0.0004:
            local_dir, local_conf = "DOWN", min(80, 52 + int(fund * 25000))
            notes.append("crowded longs + roll over")
            if oi_falling:
                local_conf = min(88, local_conf + 6)
                notes.append("OI flushing")
            elif oi_rising:
                local_conf = min(90, local_conf + 4)
                notes.append("OI still building into fade")
        elif fund < -0.00018 and ret3 > 0.0004:
            local_dir, local_conf = "UP", min(80, 52 + int(abs(fund) * 25000))
            notes.append("crowded shorts + bounce")
            if oi_falling:
                local_conf = min(88, local_conf + 6)
                notes.append("OI flushing")
            elif oi_rising:
                local_conf = min(90, local_conf + 4)
                notes.append("OI still building into bounce")
        # OI-backed trend
        elif oi_rising and ret8 > 0.0012 and ret3 > 0:
            local_dir, local_conf = "UP", 60
            notes.append("OI-backed uptrend path")
        elif oi_rising and ret8 < -0.0012 and ret3 < 0:
            local_dir, local_conf = "DOWN", 60
            notes.append("OI-backed downtrend path")
        elif oi_falling and abs(ret8) > 0.001:
            # Flush often continues briefly then fades
            local_dir = "UP" if ret8 > 0 else "DOWN"
            local_conf = 54
            notes.append(f"OI flush with {local_dir} path")
        elif ret8 > 0.0008 and fund > 0.0001:
            local_dir, local_conf = "UP", 50
            notes.append("mild long pressure")
        elif ret8 < -0.0008 and fund < -0.00005:
            local_dir, local_conf = "DOWN", 50
            notes.append("mild short pressure")
        else:
            notes.append("OI pressure neutral")

        direction = "WAIT"
        conf = 46

        if phase == "entry":
            if local_dir and local_conf >= 54:
                direction, conf = local_dir, local_conf
                if mean_rev == local_dir:
                    conf = min(90, conf + 5)
                    notes.append("mean-rev agrees")
                if streak_dir == local_dir and streak_n >= 3 and oi_rising:
                    conf = min(90, conf + 4)
                    notes.append(f"streak {streak_dir}×{streak_n} + OI")
            else:
                notes.append("no whole-window OI edge")
        else:
            if entry in ("UP", "DOWN"):
                adverse = local_dir and local_dir != entry and local_conf >= 56
                supportive = local_dir == entry and local_conf >= 54
                # OI flushed against a trend entry
                flush_against = oi_falling and path is not None and (
                    (entry == "UP" and path <= -4) or (entry == "DOWN" and path >= 4)
                )
                if adverse and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf, 62)
                    notes.append(f"OI pressure flipped vs entry {entry} (path {path:+.1f})")
                elif flush_against:
                    direction = "DOWN" if entry == "UP" else "UP"
                    conf = 58
                    notes.append(f"OI flush vs entry {entry}")
                elif supportive:
                    direction, conf = entry, max(local_conf, 56)
                    notes.append(f"OI still with entry {entry}")
                else:
                    direction, conf = entry, 53
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision OI edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "OI pressure neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
