"""
STRIKE – BTC vs Kalshi floor strike + time left in the 15m window.

Core contract feature: YES pays if BTC finishes above strike.

Multi-window:
  ENTRY: Is distance-to-strike + time a whole-window edge?
  MID/FINAL: Has price path relative to strike flipped the thesis?
  Late window: distance matters more (less time to mean-revert).
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


class StrikeSpecialist(BaseSpecialist):
    name = "strike"
    category = "strike"
    base_weight = settings.BASE_WEIGHTS.get("strike", 0.12)

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted", self.category, muted=True)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=54)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)
        streak_dir, streak_n = self.streak(market_data)

        price = market_data.get("current_price")
        strike = market_data.get("kalshi_floor_strike") or market_data.get("kalshi_target")
        close_time = None
        km = market_data.get("kalshi_market") or {}
        if isinstance(km, dict):
            close_time = km.get("close_time")
        close_time = close_time or market_data.get("close_time")
        mins_left_md = market_data.get("mins_left")

        features: Dict[str, Any] = {
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
        }

        if price is None or strike is None:
            return AgentSignal(
                self.name, "WAIT", 30,
                self.annotate_reason(market_data, "no price/strike pair"),
                self.category, features=features,
            )

        try:
            px = float(price)
            st = float(strike)
        except Exception:
            return AgentSignal(
                self.name, "WAIT", 25,
                self.annotate_reason(market_data, "bad price/strike"),
                self.category, features=features,
            )

        if st <= 0:
            return AgentSignal(
                self.name, "WAIT", 25,
                self.annotate_reason(market_data, "invalid strike"),
                self.category, features=features,
            )

        dist = px - st
        dist_pct = dist / st
        features.update({
            "price": round(px, 2),
            "strike": round(st, 2),
            "dist": round(dist, 2),
            "dist_pct": round(dist_pct * 100, 4),
        })

        mins_left: Optional[float] = None
        if mins_left_md is not None:
            try:
                mins_left = float(mins_left_md)
            except Exception:
                mins_left = None
        if mins_left is None and close_time:
            try:
                ct = datetime.fromisoformat(str(close_time).replace("Z", "+00:00"))
                if ct.tzinfo is None:
                    ct = ct.replace(tzinfo=timezone.utc)
                mins_left = max(0.0, (ct - datetime.now(timezone.utc)).total_seconds() / 60.0)
            except Exception:
                pass
        if mins_left is not None:
            features["mins_left"] = round(mins_left, 2)

        notes = []
        local_dir = None
        local_conf = 40

        if dist_pct > 0.0015:
            local_dir = "UP"
            local_conf = min(84, 52 + int(abs(dist_pct) * 12000))
            notes.append(f"above strike by {dist:.0f} ({dist_pct*100:.3f}%)")
        elif dist_pct < -0.0015:
            local_dir = "DOWN"
            local_conf = min(84, 52 + int(abs(dist_pct) * 12000))
            notes.append(f"below strike by {abs(dist):.0f} ({abs(dist_pct)*100:.3f}%)")
        elif dist_pct > 0.0004:
            local_dir, local_conf = "UP", 52
            notes.append(f"slightly above strike ({dist:.0f})")
        elif dist_pct < -0.0004:
            local_dir, local_conf = "DOWN", 52
            notes.append(f"slightly below strike ({dist:.0f})")
        else:
            notes.append(f"near strike ({dist:+.0f})")

        # Late window: distance matters more
        if mins_left is not None and mins_left <= 5 and local_dir:
            local_conf = min(90, local_conf + 8)
            notes.append(f"{mins_left:.1f}m left (late weight)")
        if mins_left is not None and mins_left <= 2 and abs(dist_pct) < 0.0003:
            local_dir, local_conf = None, 58
            notes.append(f"pinning strike with {mins_left:.1f}m left – no edge")

        features["subs"] = [
            {"name": "DIST", "detail": f"{dist:+.0f}"},
            {"name": "PCT", "detail": f"{dist_pct*100:+.3f}%"},
            {"name": "T", "detail": f"{mins_left:.1f}m" if mins_left is not None else "—"},
        ]

        direction = "WAIT"
        conf = 46

        if phase == "entry":
            if local_dir and abs(dist_pct) >= 0.0008:
                direction, conf = local_dir, local_conf
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(92, conf + 4)
                    notes.append(f"streak {streak_dir}×{streak_n}")
            elif local_dir:
                direction, conf = local_dir, max(50, local_conf - 2)
            else:
                notes.append("no whole-window strike edge")
        else:
            if entry in ("UP", "DOWN"):
                # Crossed strike against entry?
                flipped = local_dir and local_dir != entry and abs(dist_pct) >= 0.0008
                supportive = local_dir == entry
                if flipped and path is not None and abs(path) >= 3.5:
                    direction, conf = local_dir, max(local_conf, 64)
                    notes.append(f"price vs strike flipped entry {entry} (path {path:+.1f})")
                elif supportive:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"still {local_dir} of strike — entry {entry} intact")
                elif mins_left is not None and mins_left <= 3 and local_dir:
                    direction, conf = local_dir, max(local_conf, 62)
                    notes.append(f"late window strike dominates → {local_dir}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision strike edge")

        if quiet and direction != "WAIT" and not (mins_left is not None and mins_left <= 4):
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "strike neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
