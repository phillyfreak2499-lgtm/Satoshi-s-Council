"""
FADE / PANIC – research edge on KXBTC15M.

When Kalshi mid rips hard in a short window, take the OTHER side.
Backtests favored panic_fade heavily.

Multi-window:
  ENTRY: is this a real panic big enough to fade for the whole window?
  MID/FINAL: did the panic reverse (good) or continue (bad for the fade)?

Keeps the short-horizon mid tracker, but gates with phase, path, streak, quiet.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings
import time


class PanicSpecialist(BaseSpecialist):
    name = "panic"
    category = "fade"
    base_weight = settings.BASE_WEIGHTS.get("panic", 0.12)

    def __init__(self):
        super().__init__()
        self._mid_hist: List[Tuple[float, float]] = []  # (ts, mid_0_100)

    def _track(self, mid: float) -> Dict[str, float]:
        now = time.time()
        self._mid_hist.append((now, mid))
        cutoff = now - 180
        self._mid_hist = [(t, m) for t, m in self._mid_hist if t >= cutoff]
        out = {"mid": mid, "move_30s": 0.0, "move_60s": 0.0, "move_120s": 0.0}
        if len(self._mid_hist) < 2:
            return out
        first_t, first_m = self._mid_hist[0]
        span = max(1.0, now - first_t)
        total_move = mid - first_m
        for label, secs in (("move_30s", 30), ("move_60s", 60), ("move_120s", 120)):
            target = now - secs
            older = min(self._mid_hist, key=lambda x: abs(x[0] - target))
            if abs(older[0] - target) < secs * 0.65:
                out[label] = mid - older[1]
            elif span >= secs * 0.25:
                out[label] = total_move * min(1.0, secs / span)
            else:
                out[label] = total_move
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

        up = market_data.get("up_pct")
        if up is None:
            bid = market_data.get("kalshi_yes_bid")
            ask = market_data.get("kalshi_yes_ask")
            try:
                if bid is not None and ask is not None:
                    b, a = float(bid), float(ask)
                    if b <= 1.0:
                        b *= 100.0
                    if a <= 1.0:
                        a *= 100.0
                    up = (b + a) / 2.0
                elif bid is not None:
                    up = float(bid)
                    if up <= 1.0:
                        up *= 100.0
            except Exception:
                up = None
        if up is None:
            return AgentSignal(
                self.name, "WAIT", 40,
                self.annotate_reason(market_data, "no Kalshi mid"),
                self.category,
            )

        stats = self._track(float(up))
        move = max(
            abs(stats["move_30s"]),
            abs(stats["move_60s"]) * 0.85,
            abs(stats["move_120s"]) * 0.6,
        )
        signed = stats["move_30s"] if abs(stats["move_30s"]) >= abs(stats["move_60s"]) else stats["move_60s"]
        if abs(signed) < abs(stats["move_30s"]):
            signed = stats["move_30s"]

        thr = float(getattr(settings, "PANIC_THRESHOLD_PTS", 4.0))
        hard = move >= thr * 2

        features = {
            **{k: round(v, 2) if isinstance(v, float) else v for k, v in stats.items()},
            "threshold": thr,
            "move": round(move, 2),
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "30S", "detail": f"{stats['move_30s']:+.1f}pt"},
                {"name": "60S", "detail": f"{stats['move_60s']:+.1f}pt"},
                {"name": "THR", "detail": f"≥{thr:g}pt fade"},
            ],
        }

        notes = []
        local_dir = None
        local_conf = 48

        if move < thr:
            notes.append(f"no panic ({move:.1f}pt < {thr:g})")
        else:
            # Fade the move
            local_dir = "DOWN" if signed > 0 else "UP"
            local_conf = min(88, 55 + int(move * 3.5))
            notes.append(f"panic fade · mid {signed:+.1f}pt → {local_dir}")
            if hard:
                local_conf = min(92, local_conf + 6)
                notes.append("hard panic")

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and move >= thr:
                direction, conf = local_dir, local_conf
                # Fades work better after one-sided streaks (exhaustion context)
                if streak_dir and streak_dir != local_dir and streak_n >= 3:
                    conf = min(94, conf + 5)
                    notes.append(f"fade after streak {streak_dir}×{streak_n}")
                if mean_rev == local_dir:
                    conf = min(94, conf + 4)
                    notes.append("mean-rev agrees")
                # Avoid fading into a quiet tape that can't mean-revert
                if quiet and not hard:
                    conf = max(50, conf - 10)
                    notes.append("quiet — weaker fade")
            else:
                notes.append("no whole-window panic edge")
        else:
            if entry in ("UP", "DOWN"):
                # Panic continued against our fade?
                continued = (
                    local_dir and local_dir != entry and move >= thr
                )
                # Panic reversed (path came back toward fade)
                reversed_ok = (
                    path is not None
                    and (
                        (entry == "UP" and path >= 3.0)
                        or (entry == "DOWN" and path <= -3.0)
                    )
                )
                if continued and path is not None and abs(path) >= 5.0:
                    # Fade failed — revise with the panic
                    direction, conf = local_dir, max(local_conf, 64)
                    notes.append(f"panic continued vs fade entry {entry} (path {path:+.1f})")
                elif reversed_ok and (not local_dir or local_dir == entry):
                    direction, conf = entry, max(58, local_conf if local_dir == entry else 58)
                    notes.append(f"panic reversed — fade entry {entry} working")
                elif local_dir == entry and move >= thr * 0.7:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"another panic leg supports entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision panic edge")

        if quiet and direction != "WAIT" and not hard:
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "panic neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
