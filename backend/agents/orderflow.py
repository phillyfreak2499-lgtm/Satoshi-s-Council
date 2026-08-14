"""
TAPE – Order Flow & Liquidity Specialist.

Real job: read the Kalshi book as a multi-horizon story, not a single snapshot.

- Live imbalance + rate of change of imbalance (book dynamics)
- Persistent pressure across the current window path
- Multi-window: does one side of the book keep winning recent settles?

ENTRY: Is book pressure persistent enough to bet the whole 15m window?
MID/FINAL: Has the book flipped against the entry thesis hard enough to revise?
"""
from __future__ import annotations
import time
from typing import Any, Dict, List, Tuple, Optional, Deque
from collections import deque
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings


def _parse_levels(raw) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    if not raw:
        return out
    for row in raw:
        try:
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                p, s = float(row[0]), float(row[1])
                if p > 0 and s > 0:
                    out.append((p, s))
        except (TypeError, ValueError):
            continue
    return out


def kalshi_book_imbalance(orderbook: Dict[str, Any] | None) -> Dict[str, Any]:
    result = {
        "imbalance": 0.0, "yes_depth": 0.0, "no_depth": 0.0,
        "yes_best": None, "no_best": None, "top_n_imbalance": 0.0,
        "levels": 0, "ok": False,
    }
    if not orderbook or not isinstance(orderbook, dict):
        return result
    fp = orderbook.get("orderbook_fp") or orderbook
    yes_raw = fp.get("yes_dollars") or fp.get("yes") or orderbook.get("yes") or []
    no_raw = fp.get("no_dollars") or fp.get("no") or orderbook.get("no") or []
    yes_lv = _parse_levels(yes_raw)
    no_lv = _parse_levels(no_raw)
    if not yes_lv and not no_lv:
        return result
    yes_depth = sum(s for _, s in yes_lv)
    no_depth = sum(s for _, s in no_lv)
    total = yes_depth + no_depth
    if total <= 0:
        return result
    imb = (yes_depth - no_depth) / total
    top_n = int(getattr(settings, "BOOK_IMBALANCE_TOP_N", 5))
    yes_top = yes_lv[-top_n:] if yes_lv else []
    no_top = no_lv[-top_n:] if no_lv else []
    yt = sum(s for _, s in yes_top)
    nt = sum(s for _, s in no_top)
    top_total = yt + nt
    top_imb = (yt - nt) / top_total if top_total > 0 else 0.0
    result.update({
        "imbalance": round(imb, 4),
        "yes_depth": round(yes_depth, 2),
        "no_depth": round(no_depth, 2),
        "yes_best": round(yes_lv[-1][0], 4) if yes_lv else None,
        "no_best": round(no_lv[-1][0], 4) if no_lv else None,
        "top_n_imbalance": round(top_imb, 4),
        "levels": len(yes_lv) + len(no_lv),
        "ok": True,
    })
    return result


class OrderFlowSpecialist(BaseSpecialist):
    name = "orderflow"
    category = "orderflow"
    base_weight = settings.BASE_WEIGHTS.get("orderflow", 0.11)

    def __init__(self):
        super().__init__()
        # (ts, imbalance) history for dynamics
        self._imb_hist: Deque[Tuple[float, float]] = deque(maxlen=120)
        # Rolling sign of imbalance within the current window
        self._window_sign_hist: Deque[int] = deque(maxlen=60)

    def _dynamics(self, imb: float) -> Dict[str, float]:
        now = time.time()
        self._imb_hist.append((now, imb))
        # prune > 3 minutes
        cutoff = now - 180
        while self._imb_hist and self._imb_hist[0][0] < cutoff:
            self._imb_hist.popleft()

        out = {"delta_30s": 0.0, "delta_90s": 0.0, "persist": 0.0}
        if len(self._imb_hist) < 3:
            return out

        def _at(age: float) -> Optional[float]:
            target = now - age
            best = None
            best_dt = 1e9
            for t, v in self._imb_hist:
                dt = abs(t - target)
                if dt < best_dt:
                    best_dt = dt
                    best = v
            return best if best_dt < age * 0.6 else None

        v30 = _at(30)
        v90 = _at(90)
        if v30 is not None:
            out["delta_30s"] = round(imb - v30, 4)
        if v90 is not None:
            out["delta_90s"] = round(imb - v90, 4)

        # Persistence: fraction of recent samples with same sign as current
        sign = 1 if imb > 0.02 else (-1 if imb < -0.02 else 0)
        self._window_sign_hist.append(sign)
        if sign != 0 and len(self._window_sign_hist) >= 8:
            same = sum(1 for s in self._window_sign_hist if s == sign)
            out["persist"] = round(same / len(self._window_sign_hist), 3)
        return out

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

        orderbook = (
            market_data.get("kalshi_orderbook")
            or market_data.get("orderbook")
            or (market_data.get("kalshi_market") or {}).get("orderbook")
        )
        book = kalshi_book_imbalance(orderbook)
        imb = float(book.get("imbalance") or 0.0)
        top_imb = float(book.get("top_n_imbalance") or 0.0)
        dyn = self._dynamics(imb)

        features = {
            **book,
            **dyn,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "streak_n": streak_n,
            "quiet": quiet,
            "subs": [
                {"name": "IMB", "detail": f"{imb:+.2f}"},
                {"name": "TOP", "detail": f"{top_imb:+.2f}"},
                {"name": "d30", "detail": f"{dyn['delta_30s']:+.3f}"},
                {"name": "PER", "detail": f"{dyn['persist']:.0%}"},
            ],
        }

        if not book.get("ok"):
            return AgentSignal(
                self.name, "WAIT", 35,
                self.annotate_reason(market_data, "no usable Kalshi book"),
                self.category, features=features,
            )

        # Local lean from book
        local_dir = None
        local_conf = 0
        notes = []

        strong = abs(imb) >= 0.18 or abs(top_imb) >= 0.22
        building = (imb > 0 and dyn["delta_30s"] > 0.03) or (imb < 0 and dyn["delta_30s"] < -0.03)
        persistent = dyn["persist"] >= 0.65

        if strong and imb > 0:
            local_dir = "UP"
            local_conf = min(86, 56 + int(abs(imb) * 80) + (8 if building else 0) + (6 if persistent else 0))
            notes.append(f"YES book pressure {imb:+.2f}")
            if building:
                notes.append("building")
            if persistent:
                notes.append(f"persist {dyn['persist']:.0%}")
        elif strong and imb < 0:
            local_dir = "DOWN"
            local_conf = min(86, 56 + int(abs(imb) * 80) + (8 if building else 0) + (6 if persistent else 0))
            notes.append(f"NO book pressure {imb:+.2f}")
            if building:
                notes.append("building")
            if persistent:
                notes.append(f"persist {dyn['persist']:.0%}")
        elif abs(imb) >= 0.10:
            local_dir = "UP" if imb > 0 else "DOWN"
            local_conf = 54
            notes.append(f"mild book lean {imb:+.2f}")
        else:
            notes.append(f"book balanced {imb:+.2f}")

        direction = "WAIT"
        conf = 48

        if phase == "entry":
            if local_dir and (strong or (building and persistent)):
                direction, conf = local_dir, local_conf
                # Multi-window reinforcement
                if mean_rev == local_dir:
                    conf = min(90, conf + 6)
                    notes.append("mean-rev agrees")
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(90, conf + 5)
                    notes.append(f"streak {streak_dir}×{streak_n}")
                if streak_dir and streak_dir != local_dir and streak_n >= 4 and not persistent:
                    conf = max(50, conf - 10)
                    notes.append("fighting streak without persist")
            elif local_dir and not quiet:
                direction, conf = local_dir, max(52, local_conf - 4)
            else:
                notes.append("no whole-window book edge")
        else:
            # Revision vs entry
            if entry in ("UP", "DOWN") and local_dir:
                adverse = local_dir != entry and (strong or persistent)
                supportive = local_dir == entry and (strong or persistent or building)
                if adverse and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf, 64)
                    notes.append(f"book flipped vs entry {entry} (path {path:+.1f})")
                elif supportive:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"book still with entry {entry}")
                elif local_dir == entry:
                    direction, conf = entry, 55
                    notes.append(f"soft support for entry {entry}")
                else:
                    direction, conf = entry, 53
                    notes.append(f"hold entry {entry} — book not decisive")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision edge from book")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "orderflow neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
