"""
SESSION / TOD – time-of-day + 15m window clock + historical session trends.

UTC session buckets: Asia / Europe / US with typical BTC behavior priors.
Multi-window:
  ENTRY: session prior as a soft whole-window bias
  MID/FINAL: only reinforce or dampen entry — session doesn't flip mid-window alone
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


# Soft priors: (start_hour, end_hour, name, trend_bias -1..+1, activity 0..1)
SESSION_PRIORS = [
    (0, 7, "ASIA", -0.05, 0.45),
    (7, 12, "EUROPE", 0.08, 0.70),
    (12, 17, "US_AM", 0.12, 0.95),
    (17, 21, "US_PM", 0.05, 0.75),
    (21, 24, "LATE", -0.02, 0.40),
]


def _empirical_15m_clock(hour: int, weekday: int) -> Tuple[Optional[float], Optional[float]]:
    """Read graded 15m finish rates from the BTC 15m brain. None until n exists."""
    try:
        import json
        from pathlib import Path
        from backend.config import settings as _s
        path = Path(getattr(_s, "DATA_DIR", None) or "./data") / "council-learning-btc15m.json"
        if not path.is_file():
            return None, None
        data = json.loads(path.read_text(encoding="utf-8"))
        rec = data.get("backfill") if isinstance(data, dict) else None
        if not isinstance(rec, dict):
            return None, None
        hours = rec.get("hour_up_rate") or []
        days = rec.get("weekday_up_rate") or []
        h = None
        d = None
        if isinstance(hours, list) and 0 <= int(hour) < len(hours) and hours[int(hour)] is not None:
            h = float(hours[int(hour)])
        if isinstance(days, list) and 0 <= int(weekday) < len(days) and days[int(weekday)] is not None:
            d = float(days[int(weekday)])
        return h, d
    except Exception:
        return None, None


def _session_for(hour: int) -> Tuple[str, float, float]:
    for start, end, name, bias, act in SESSION_PRIORS:
        if start <= hour < end:
            return name, bias, act
    return "UNKNOWN", 0.0, 0.5


class SessionTodSpecialist(BaseSpecialist):
    name = "session_tod"
    category = "session"
    base_weight = settings.BASE_WEIGHTS.get("session_tod", 0.06)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=52)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)

        raw_now = market_data.get("as_of") or market_data.get("now")
        if isinstance(raw_now, datetime):
            now = raw_now if raw_now.tzinfo else raw_now.replace(tzinfo=timezone.utc)
        elif raw_now:
            try:
                now = datetime.fromisoformat(str(raw_now).replace("Z", "+00:00"))
                if now.tzinfo is None:
                    now = now.replace(tzinfo=timezone.utc)
            except Exception:
                now = datetime.now(timezone.utc)
        else:
            now = datetime.now(timezone.utc)
        hour = now.hour
        weekday = now.weekday()
        name, bias, activity = _session_for(hour)
        try:
            from backend.learning.btc15m import is_15m_window
            fifteen = is_15m_window(
                market_data.get("window_minutes"),
                market_data.get("ticker") or market_data.get("kalshi_ticker"),
                market_data.get("series_ticker"),
                market_data.get("asset"),
            )
        except Exception:
            fifteen = False
        # Weekend 15m books are choppier — dampen session force, do not invent a side.
        if fifteen and weekday >= 5:
            activity = max(0.35, activity * 0.82)
            bias *= 0.55
        # Blend official 15m Kalshi hour / weekday finish rates when the 15m brain has them.
        if fifteen:
            emp_h, emp_d = _empirical_15m_clock(hour, weekday)
            if emp_h is not None:
                bias = 0.62 * bias + 0.38 * ((emp_h - 0.5) * 0.85)
            if emp_d is not None:
                bias = 0.75 * bias + 0.25 * ((emp_d - 0.5) * 0.70)

        mins_left = market_data.get("mins_left")
        try:
            mins_left_f = float(mins_left) if mins_left is not None else None
        except (TypeError, ValueError):
            mins_left_f = None

        features = {
            "session": name,
            "hour_utc": hour,
            "weekday": weekday,
            "bias": round(bias, 3),
            "activity": round(activity, 2),
            "mins_left": mins_left_f,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "subs": [
                {"name": "SES", "detail": name},
                {"name": "ACT", "detail": f"{activity:.0%}"},
                {"name": "BIAS", "detail": f"{bias:+.2f}"},
            ],
        }

        notes = []
        local_dir = None
        local_conf = 42

        # Soft directional prior only when activity is meaningful
        if abs(bias) >= 0.06 and activity >= 0.55:
            local_dir = "UP" if bias > 0 else "DOWN"
            local_conf = min(62, 48 + int(abs(bias) * 80) + int(activity * 8))
            notes.append(f"{name} session bias {bias:+.2f}")
        elif activity < 0.50:
            notes.append(f"{name} low-activity session — soft WAIT prior")
            local_dir, local_conf = None, 55
        else:
            notes.append(f"{name} session neutral bias")

        # Window clock: early vs late
        if mins_left_f is not None:
            if mins_left_f > 12:
                notes.append("early clock")
            elif mins_left_f <= 3:
                notes.append(f"late clock {mins_left_f:.1f}m")
                if local_dir and activity >= 0.7:
                    local_conf = min(68, local_conf + 4)

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and activity >= 0.55:
                direction, conf = local_dir, local_conf
                if mean_rev == local_dir:
                    conf = min(72, conf + 4)
                    notes.append("mean-rev agrees")
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(72, conf + 3)
                    notes.append(f"streak {streak_dir}×{streak_n}")
            else:
                notes.append("no whole-window session edge")
        else:
            # Session alone almost never flips mid/final
            if entry in ("UP", "DOWN"):
                if local_dir == entry:
                    direction, conf = entry, max(local_conf, 52)
                    notes.append(f"session still soft-supports entry {entry}")
                else:
                    direction, conf = entry, 50
                    notes.append(f"hold entry {entry} — session not a flip signal")
            elif local_dir:
                direction, conf = local_dir, max(48, local_conf - 4)
            else:
                notes.append("no revision session edge")

        if (quiet or activity < 0.45) and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet/low-activity gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "session neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
