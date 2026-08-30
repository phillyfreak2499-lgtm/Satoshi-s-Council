"""
WHALE – Whale Tape specialist.

Looks for large / unusual size prints and clustered flow that can push
a 15m Kalshi window.

Uses market_data keys when present:
  whale_trades, large_trades, taker_volume, buy_volume, sell_volume,
  aggr tape (api.aggr.trade / aegx workspace),
  or orderflow-style imbalance as a fallback proxy.
"""
from __future__ import annotations
import time
from typing import Any, Dict, Deque, Tuple
from collections import deque
from backend.agents.base import BaseSpecialist, AgentSignal
from backend.config import settings

try:
    from backend.data.aggr import install_pipeline_hook
    install_pipeline_hook()
except Exception:
    pass


class WhaleSpecialist(BaseSpecialist):
    name = "whale"
    category = "orderflow"
    base_weight = settings.BASE_WEIGHTS.get("whale", 0.09)

    def __init__(self):
        super().__init__()
        self._prints: Deque[Tuple[float, float]] = deque(maxlen=80)
        self._window_bias: Deque[int] = deque(maxlen=40)

    def _ingest_prints(self, market_data: Dict[str, Any]) -> Dict[str, float]:
        now = time.time()
        signed = 0.0
        count = 0
        biggest = 0.0

        raw = (
            market_data.get("whale_trades")
            or market_data.get("large_trades")
            or market_data.get("agg_trades")
            or []
        )
        aggr = market_data.get("aggr") if isinstance(market_data.get("aggr"), dict) else {}
        extra = aggr.get("whale_trades") if isinstance(aggr.get("whale_trades"), list) else []
        if extra:
            raw = list(raw or []) + extra
        if isinstance(raw, list):
            for t in raw[-30:]:
                try:
                    if isinstance(t, dict):
                        size = float(t.get("size") or t.get("qty") or t.get("amount") or 0)
                        side = str(t.get("side") or t.get("direction") or "").lower()
                    elif isinstance(t, (list, tuple)) and len(t) >= 2:
                        size = float(t[1])
                        side = str(t[2]).lower() if len(t) > 2 else ""
                    else:
                        continue
                    if size <= 0:
                        continue
                    sign = 1.0
                    if side in ("sell", "s", "down", "no", "ask"):
                        sign = -1.0
                    elif side in ("buy", "b", "up", "yes", "bid"):
                        sign = 1.0
                    else:
                        continue
                    signed += sign * size
                    count += 1
                    biggest = max(biggest, size)
                    self._prints.append((now, sign * size))
                except (TypeError, ValueError):
                    continue

        buy_v = market_data.get("buy_volume") or market_data.get("taker_buy_volume") or aggr.get("vbuy")
        sell_v = market_data.get("sell_volume") or market_data.get("taker_sell_volume") or aggr.get("vsell")
        try:
            if buy_v is not None and sell_v is not None:
                bv, sv = float(buy_v), float(sell_v)
                total = bv + sv
                if total > 0:
                    proxy = (bv - sv) / total
                    signed += proxy * min(total, 5_000_000.0) * 0.15
                    if count == 0 and max(bv, sv) >= 100_000:
                        count = 1
                        biggest = max(biggest, bv, sv)
        except (TypeError, ValueError):
            pass

        cutoff = now - 240
        while self._prints and self._prints[0][0] < cutoff:
            self._prints.popleft()

        recent = sum(s for _, s in self._prints)
        sign = 1 if recent > 0 else (-1 if recent < 0 else 0)
        if sign != 0:
            self._window_bias.append(sign)

        persist = 0.0
        if sign != 0 and len(self._window_bias) >= 6:
            same = sum(1 for s in self._window_bias if s == sign)
            persist = same / len(self._window_bias)

        return {
            "signed_flow": round(float(signed), 2),
            "recent_flow": round(float(recent), 2),
            "print_count": float(count),
            "biggest": round(float(biggest), 2),
            "persist": round(persist, 3),
            "aggr_ok": bool(aggr.get("ok")),
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

        flow = self._ingest_prints(market_data)
        recent = flow["recent_flow"]
        persist = flow["persist"]
        biggest = flow["biggest"]
        aggr = market_data.get("aggr") if isinstance(market_data.get("aggr"), dict) else {}

        features = {
            **flow,
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "entry_dir": entry,
            "streak_n": streak_n,
            "quiet": quiet,
            "aggr_pressure": aggr.get("pressure"),
            "subs": [
                {"name": "FLOW", "detail": f"{recent:+.0f}"},
                {"name": "BIG", "detail": f"{biggest:.0f}"},
                {"name": "PER", "detail": f"{persist:.0%}"},
            ],
        }

        has_feed = flow["print_count"] > 0
        strong = abs(recent) >= 8 or (biggest >= 5 and abs(recent) >= 3) or (
            aggr.get("ok") and aggr.get("pressure") in ("up", "down") and abs(float(aggr.get("buy_ratio") or 0.5) - 0.5) >= 0.16
        )
        clustered = persist >= 0.70 and abs(recent) >= 4

        local_dir = None
        local_conf = 0
        notes = []

        if aggr.get("ok") and aggr.get("pressure") in ("up", "down") and not has_feed:
            has_feed = True
            local_dir = "UP" if aggr["pressure"] == "up" else "DOWN"
            local_conf = 58
            notes.append(f"AGGR {aggr['pressure']} tape {float(aggr.get('buy_ratio') or 0):.0%} buy")

        if not has_feed:
            notes.append("no whale feed — neutral")
        elif strong and recent > 0:
            local_dir, local_conf = "UP", min(85, 58 + int(min(abs(recent), 40)))
            notes.append(f"whale buy flow {recent:+.0f}")
            if clustered:
                local_conf = min(90, local_conf + 6)
                notes.append("clustered")
        elif strong and recent < 0:
            local_dir, local_conf = "DOWN", min(85, 58 + int(min(abs(recent), 40)))
            notes.append(f"whale sell flow {recent:+.0f}")
            if clustered:
                local_conf = min(90, local_conf + 6)
                notes.append("clustered")
        elif abs(recent) >= 3:
            local_dir = "UP" if recent > 0 else "DOWN"
            local_conf = 54
            notes.append(f"mild whale lean {recent:+.0f}")
        elif local_dir:
            pass
        else:
            notes.append("whale tape quiet")

        if aggr.get("ok") and local_dir:
            if (local_dir == "UP" and aggr.get("pressure") == "up") or (local_dir == "DOWN" and aggr.get("pressure") == "down"):
                local_conf = min(90, (local_conf or 58) + 4)
                notes.append("AGGR agrees")
            elif aggr.get("pressure") in ("up", "down"):
                notes.append(f"AGGR {aggr.get('pressure')}")

        direction = "WAIT"
        conf = 46

        if phase == "entry":
            if local_dir and (strong or clustered or (aggr.get("ok") and aggr.get("whale"))):
                direction, conf = local_dir, local_conf or 58
                if mean_rev == local_dir:
                    conf = min(92, conf + 5)
                    notes.append("mean-rev agrees")
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(92, conf + 4)
                    notes.append(f"streak {streak_dir}×{streak_n}")
                if streak_dir and streak_dir != local_dir and streak_n >= 4 and not clustered:
                    conf = max(50, conf - 10)
                    notes.append("counter-streak without cluster")
            elif local_dir and not quiet:
                direction, conf = local_dir, max(52, (local_conf or 54) - 3)
            else:
                notes.append("no whole-window whale edge")
        else:
            if entry in ("UP", "DOWN") and local_dir:
                adverse = local_dir != entry and (strong or clustered)
                supportive = local_dir == entry and (strong or clustered)
                if adverse and path is not None and abs(path) >= 4.0:
                    direction, conf = local_dir, max(local_conf or 0, 64)
                    notes.append(f"whales flipped vs entry {entry} (path {path:+.1f})")
                elif supportive:
                    direction, conf = entry, max(local_conf or 0, 58)
                    notes.append(f"whales still with entry {entry}")
                elif local_dir == entry:
                    direction, conf = entry, 54
                    notes.append(f"soft whale support for {entry}")
                else:
                    direction, conf = entry, 52
                    notes.append(f"hold entry {entry}")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision edge from whales")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        if int(flow.get("print_count") or 0) <= 0 and not aggr.get("ok"):
            direction, conf = "WAIT", 46
            notes.append("silent until print_count>0")

        reason = self.annotate_reason(market_data, " · ".join(notes) if notes else "whale neutral")
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
