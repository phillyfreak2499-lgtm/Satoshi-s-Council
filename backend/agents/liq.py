"""
CASCADE – Liquidation / forced-flow cluster specialist.

Looks for liquidation-style cascades: volume spike + sharp price move + OI flush.
Multi-window:
  - ENTRY: is a cascade starting that can drive the whole 15m window?
  - MID/FINAL: did the cascade exhaust or reverse vs entry?

Uses OI path, volume spikes, and short returns as a proxy when true liq feed is absent.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class LiqSpecialist(BaseSpecialist):
    name = "liq"
    category = "liq"
    base_weight = settings.BASE_WEIGHTS.get("liq", 0.07)

    def __init__(self):
        super().__init__()
        self._oi_hist: List[float] = []
        self._vol_hist: List[float] = []

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=54)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)

        oi = market_data.get("open_interest") or market_data.get("oi")
        candles = market_data.get("candles") or market_data.get("klines") or []
        last_vol = None
        if candles:
            try:
                c = candles[-1]
                last_vol = float(c.get("volume") or c.get("v") or 0)
            except Exception:
                pass

        if oi is not None:
            try:
                self._oi_hist.append(float(oi))
                self._oi_hist = self._oi_hist[-48:]
            except Exception:
                pass
        if last_vol is not None:
            self._vol_hist.append(float(last_vol))
            self._vol_hist = self._vol_hist[-48:]

        oi_delta = 0.0
        oi_delta_pct = 0.0
        if len(self._oi_hist) >= 6:
            oi_delta = self._oi_hist[-1] - self._oi_hist[-6]
            if abs(self._oi_hist[-6]) > 1e-9:
                oi_delta_pct = oi_delta / abs(self._oi_hist[-6])

        vol_spike = 1.0
        if len(self._vol_hist) >= 12:
            avg = sum(self._vol_hist[:-3]) / max(1, len(self._vol_hist) - 3)
            if avg > 0:
                vol_spike = self._vol_hist[-1] / avg

        ret = 0.0
        ret_8 = 0.0
        if len(candles) >= 9:
            try:
                a = float(candles[-4].get("close") or candles[-4].get("c"))
                b = float(candles[-1].get("close") or candles[-1].get("c"))
                a8 = float(candles[-9].get("close") or candles[-9].get("c"))
                if a > 0:
                    ret = (b - a) / a * 100.0
                if a8 > 0:
                    ret_8 = (b - a8) / a8 * 100.0
            except Exception:
                pass

        # Cascade signature: big vol + directional move + OI flushing
        cascade = vol_spike >= 2.0 and abs(ret) >= 0.06
        hard_cascade = vol_spike >= 2.8 and abs(ret) >= 0.10
        oi_flush = oi_delta_pct < -0.008
        oi_build = oi_delta_pct > 0.010

        features = {
            "vol_spike": round(vol_spike, 2),
            "ret_3m_pct": round(ret, 3),
            "ret_8m_pct": round(ret_8, 3),
            "oi_delta": round(oi_delta, 1),
            "oi_delta_pct": round(oi_delta_pct, 4),
            "cascade": cascade,
            "hard_cascade": hard_cascade,
            "oi_flush": oi_flush,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "VOL", "detail": f"×{vol_spike:.1f}"},
                {"name": "RET", "detail": f"{ret:+.2f}%"},
                {"name": "OIΔ", "detail": f"{oi_delta_pct*100:+.1f}%"},
            ],
        }

        notes = []
        local_dir = None
        local_conf = 45

        if cascade:
            local_dir = "UP" if ret > 0 else "DOWN"
            local_conf = min(84, int(52 + vol_spike * 7 + abs(ret) * 35))
            notes.append(f"liq-pressure vol×{vol_spike:.1f} ret {ret:+.2f}%")
            if hard_cascade:
                local_conf = min(90, local_conf + 6)
                notes.append("hard cascade")
            if oi_flush and local_dir:
                # Forced liquidations often continue briefly in direction of move
                local_conf = min(90, local_conf + 5)
                notes.append("OI flushing")
            elif oi_build and local_dir:
                local_conf = max(50, local_conf - 4)
                notes.append("OI still building")
        elif vol_spike >= 1.6 and abs(ret) >= 0.04:
            local_dir = "UP" if ret > 0 else "DOWN"
            local_conf = 54
            notes.append(f"mild pressure vol×{vol_spike:.1f}")
        else:
            notes.append("no cascade signature")

        direction = "WAIT"
        conf = 46

        if phase == "entry":
            if local_dir and (cascade or hard_cascade):
                direction, conf = local_dir, local_conf
                if mean_rev == local_dir:
                    conf = min(92, conf + 4)
                    notes.append("mean-rev agrees")
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(92, conf + 4)
                    notes.append(f"streak {streak_dir}×{streak_n}")
            elif local_dir and not quiet:
                direction, conf = local_dir, max(52, local_conf - 4)
            else:
                notes.append("no whole-window cascade edge")
        else:
            if entry in ("UP", "DOWN"):
                adverse = local_dir and local_dir != entry and cascade
                supportive = local_dir == entry and cascade
                # Cascade exhausted: vol dying while path against entry
                exhausted = vol_spike < 1.2 and path is not None and (
                    (entry == "UP" and path <= -5) or (entry == "DOWN" and path >= 5)
                )
                if adverse and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf, 64)
                    notes.append(f"cascade flipped vs entry {entry} (path {path:+.1f})")
                elif exhausted:
                    direction = "DOWN" if entry == "UP" else "UP"
                    conf = 60
                    notes.append(f"cascade exhausted vs entry {entry}")
                elif supportive:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"cascade still with entry {entry}")
                else:
                    direction, conf = entry, 53
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision cascade edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "liq neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
