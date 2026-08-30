"""
EXHAUST – fade continuation after a large 1h run when short momentum flips.

Research edge: after ≥~1% 1h BTC move near high/low, 5m flips against,
Kalshi still extreme → fade the crowded side.

Multi-window:
  ENTRY: is this a fresh exhaustion setup worth a full-window fade?
  MID/FINAL: did the fade work, or did the run resume against entry?
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class ExhaustSpecialist(BaseSpecialist):
    name = "exhaust"
    category = "fade"
    base_weight = settings.BASE_WEIGHTS.get("exhaust", 0.09)

    @staticmethod
    def _candle_returns(candles: List[Dict[str, Any]]) -> Dict[str, Optional[float]]:
        if not candles or len(candles) < 5:
            return {"ret_3m": None, "ret_5m": None, "ret_15m": None, "ret_60m": None, "near_high": None, "near_low": None}
        rows = []
        for c in candles:
            try:
                o = float(c.get("open") or c.get("o") or 0)
                h = float(c.get("high") or c.get("h") or 0)
                l = float(c.get("low") or c.get("l") or 0)
                cl = float(c.get("close") or c.get("c") or 0)
                ts = float(c.get("time") or c.get("t") or c.get("open_time") or 0)
                if cl > 0:
                    rows.append((ts, o, h, l, cl))
            except Exception:
                continue
        if len(rows) < 5:
            return {"ret_3m": None, "ret_5m": None, "ret_15m": None, "ret_60m": None, "near_high": None, "near_low": None}
        rows.sort(key=lambda x: x[0])
        last = rows[-1][4]

        def ret_n(n):
            if len(rows) <= n:
                return None
            base = rows[-(n + 1)][4]
            if base <= 0:
                return None
            return (last - base) / base * 100.0

        window = rows[-60:] if len(rows) >= 60 else rows
        hi = max(r[2] for r in window)
        lo = min(r[3] for r in window)
        near_high = (hi - last) / hi * 100.0 if hi > 0 else None
        near_low = (last - lo) / lo * 100.0 if lo > 0 else None
        return {
            "ret_3m": ret_n(3),
            "ret_5m": ret_n(5),
            "ret_15m": ret_n(15),
            "ret_60m": ret_n(60) if len(rows) > 60 else ret_n(min(55, len(rows) - 1)),
            "near_high": near_high,
            "near_low": near_low,
        }

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=55)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)

        candles = market_data.get("candles") or []
        stats = self._candle_returns(candles)
        r60 = stats["ret_60m"]
        r5 = stats["ret_5m"]
        r15 = stats["ret_15m"]
        up = market_data.get("up_pct")
        try:
            up = float(up) if up is not None else None
        except Exception:
            up = None

        features = {
            **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in stats.items()},
            "up_pct": up,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "1H", "detail": f"{r60:+.2f}%" if r60 is not None else "—"},
                {"name": "5M", "detail": f"{r5:+.2f}%" if r5 is not None else "—"},
                {"name": "YES", "detail": f"{up:.0f}¢" if up is not None else "—"},
            ],
        }

        if r60 is None or r5 is None:
            return AgentSignal(
                self.name, "WAIT", 45,
                self.annotate_reason(market_data, "need more candle history"),
                self.category, features=features,
            )

        run_thr = float(getattr(settings, "EXHAUST_1H_PCT", 0.9))
        flip_thr = float(getattr(settings, "EXHAUST_5M_FLIP", 0.12))
        extreme_yes = float(getattr(settings, "EXHAUST_YES_HIGH", 68.0))
        extreme_no = float(getattr(settings, "EXHAUST_YES_LOW", 32.0))
        run_label = "1h"
        flip_label = "5m"
        run_px = r60
        flip_px = r5
        try:
            from backend.learning.btc15m import exhaust_thresholds_15m, is_15m_btc_book
            if is_15m_btc_book(market_data):
                hz = exhaust_thresholds_15m()
                run_thr = float(hz["run_pct"])
                flip_thr = float(hz["flip_pct"])
                run_label = "15m"
                flip_label = "3m"
                run_px = r15 if r15 is not None else r60
                flip_px = stats.get("ret_3m")
                if flip_px is None:
                    flip_px = r5
        except Exception:
            pass

        notes = []
        local_dir = None
        local_conf = 48
        from backend.agents.regime import orbit_context
        orbit = orbit_context(market_data)

        # Fade run-up
        fade_up_run = (
            run_px is not None
            and flip_px is not None
            and run_px >= run_thr
            and flip_px <= -flip_thr
            and stats.get("near_high") is not None
            and stats["near_high"] <= 0.40
            and (up is None or up >= extreme_yes - 4)
        )
        # Fade dump
        fade_down_run = (
            run_px is not None
            and flip_px is not None
            and run_px <= -run_thr
            and flip_px >= flip_thr
            and stats.get("near_low") is not None
            and stats["near_low"] <= 0.40
            and (up is None or up <= extreme_no + 4)
        )

        if fade_up_run:
            local_dir = "DOWN"
            local_conf = min(88, 60 + int((float(run_px) - run_thr) * 12))
            notes.append(f"exhaust fade · {run_label} +{run_px:.2f}% but {flip_label} {flip_px:+.2f}%")
            if up is not None and up >= extreme_yes:
                local_conf = min(92, local_conf + 4)
                notes.append("YES crowded")
        elif fade_down_run:
            local_dir = "UP"
            local_conf = min(88, 60 + int((abs(float(run_px)) - run_thr) * 12))
            notes.append(f"exhaust fade · {run_label} {run_px:.2f}% but {flip_label} {flip_px:+.2f}%")
            if up is not None and up <= extreme_no:
                local_conf = min(92, local_conf + 4)
                notes.append("YES cheap / NO crowded")
        else:
            rp = f"{run_px:+.2f}%" if run_px is not None else "—"
            fp = f"{flip_px:+.2f}%" if flip_px is not None else "—"
            notes.append(f"no exhaust ({run_label} {rp} · {flip_label} {fp})")

        hard = bool(
            local_dir is not None
            and run_px is not None
            and abs(float(run_px)) >= run_thr * 1.5
        )
        features["hard_trigger"] = hard
        features["orbit_agg"] = orbit["aggressiveness"]

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and orbit["trend_day"] and not hard:
                # ORBIT trend day: do not fade initiative without a hard exhaust.
                local_dir = None
                notes.append(f"ORBIT trend day {orbit['streak_dir']}×{orbit['streak_n']} — fade muted")
            if local_dir:
                direction, conf = local_dir, local_conf
                if (orbit["aggressiveness"] < 0.35 or orbit["quiet"]) and not hard:
                    conf = min(conf, floor)
                    notes.append("ORBIT quiet/low-agg — fade capped")
                # Multi-window: exhaustion fades work better after extended streaks
                if streak_dir and streak_dir != local_dir and streak_n >= 3:
                    conf = min(94, conf + 5)
                    notes.append(f"fade after streak {streak_dir}×{streak_n}")
                if mean_rev == local_dir:
                    conf = min(94, conf + 4)
                    notes.append("mean-rev agrees")
            else:
                notes.append("no whole-window exhaust edge")
        else:
            if entry in ("UP", "DOWN"):
                # Did the run resume against our fade?
                resumed = (
                    (entry == "DOWN" and r5 is not None and r5 > flip_thr * 1.5 and r15 is not None and r15 > 0.15)
                    or (entry == "UP" and r5 is not None and r5 < -flip_thr * 1.5 and r15 is not None and r15 < -0.15)
                )
                still_exhaust = local_dir == entry
                if resumed and path is not None and abs(path) >= 4.0:
                    direction = "UP" if entry == "DOWN" else "DOWN"
                    conf = 64
                    notes.append(f"run resumed vs exhaust entry {entry} (path {path:+.1f})")
                elif still_exhaust:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"exhaust still valid for entry {entry}")
                elif local_dir and local_dir != entry:
                    direction, conf = local_dir, max(local_conf, 60)
                    notes.append(f"new exhaust vs entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision exhaust edge")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "exhaust neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
