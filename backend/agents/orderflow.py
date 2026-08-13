"""
Order Flow & Liquidity Specialist.
Prioritizes Kalshi book imbalance + BOOK DYNAMICS (rate of change of imbalance).
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
    base_weight = settings.BASE_WEIGHTS.get("orderflow", 0.08)

    def __init__(self):
        super().__init__()
        # Book dynamics: (ts, signal_imbalance)
        self._imb_hist: Deque[Tuple[float, float]] = deque(maxlen=40)

    def _book_delta(self, signal_imb: float) -> Dict[str, float]:
        """Rate of change of book imbalance over ~30s and ~60s."""
        now = time.time()
        self._imb_hist.append((now, signal_imb))
        out = {"d30": 0.0, "d60": 0.0, "samples": float(len(self._imb_hist))}
        if len(self._imb_hist) < 3:
            return out
        for key, secs in (("d30", 30.0), ("d60", 60.0)):
            target = now - secs
            # find sample closest to target
            older = min(self._imb_hist, key=lambda x: abs(x[0] - target))
            if abs(older[0] - target) <= secs * 0.6:
                out[key] = round(signal_imb - older[1], 4)
        return out

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        kalshi = market_data.get("kalshi") or {}
        orderbook = (
            market_data.get("kalshi_orderbook")
            or kalshi.get("orderbook")
            or market_data.get("orderbook")
            or {}
        )
        candles = market_data.get("candles") or market_data.get("klines") or []

        direction = "WAIT"
        conf = 40
        reason_parts: List[str] = []
        features: Dict[str, Any] = {}

        # ── 1) Static book imbalance ────────────────────────────────────
        book = kalshi_book_imbalance(orderbook if isinstance(orderbook, dict) else {})
        features.update({f"book_{k}": v for k, v in book.items()})

        thr = float(getattr(settings, "BOOK_IMBALANCE_THRESHOLD", 0.18))
        strong = float(getattr(settings, "BOOK_IMBALANCE_STRONG", 0.32))
        signal_imb = 0.0

        if book["ok"]:
            signal_imb = book["top_n_imbalance"] if abs(book["top_n_imbalance"]) >= abs(book["imbalance"]) * 0.7 else book["imbalance"]
            features["book_signal_imb"] = round(signal_imb, 4)

            if signal_imb >= strong:
                direction = "UP"
                conf = min(82, 58 + int(signal_imb * 50))
                reason_parts.append(f"YES book heavy +{signal_imb:.0%}")
            elif signal_imb <= -strong:
                direction = "DOWN"
                conf = min(82, 58 + int(abs(signal_imb) * 50))
                reason_parts.append(f"NO book heavy {signal_imb:.0%}")
            elif signal_imb >= thr:
                direction = "UP"
                conf = min(70, 50 + int(signal_imb * 40))
                reason_parts.append(f"YES imbalance +{signal_imb:.0%}")
            elif signal_imb <= -thr:
                direction = "DOWN"
                conf = min(70, 50 + int(abs(signal_imb) * 40))
                reason_parts.append(f"NO imbalance {signal_imb:.0%}")
            else:
                reason_parts.append(f"book balanced ({signal_imb:+.0%})")

        # ── 2) BOOK DYNAMICS (rate of change) ───────────────────────────
        dyn = self._book_delta(signal_imb if book["ok"] else 0.0)
        features["book_d30"] = dyn["d30"]
        features["book_d60"] = dyn["d60"]
        dyn_thr = float(getattr(settings, "BOOK_DYNAMICS_THRESHOLD", 0.12))
        dyn_strong = float(getattr(settings, "BOOK_DYNAMICS_STRONG", 0.22))

        # Prefer 30s delta for short-horizon
        d = dyn["d30"] if abs(dyn["d30"]) >= abs(dyn["d60"]) * 0.5 else dyn["d60"]
        if abs(d) >= dyn_thr:
            if d >= dyn_strong:
                if direction != "DOWN":
                    direction = "UP"
                    conf = min(88, max(conf, 62) + int(d * 40))
                else:
                    conf = max(30, conf - 12)  # dynamics fights static lean
                reason_parts.append(f"book filling YES fast (+{d:.0%}/30s)")
            elif d <= -dyn_strong:
                if direction != "UP":
                    direction = "DOWN"
                    conf = min(88, max(conf, 62) + int(abs(d) * 40))
                else:
                    conf = max(30, conf - 12)
                reason_parts.append(f"book filling NO fast ({d:.0%}/30s)")
            elif d >= dyn_thr:
                if direction == "WAIT":
                    direction, conf = "UP", 58
                elif direction == "UP":
                    conf = min(85, conf + 6)
                reason_parts.append(f"YES book building (+{d:.0%})")
            elif d <= -dyn_thr:
                if direction == "WAIT":
                    direction, conf = "DOWN", 58
                elif direction == "DOWN":
                    conf = min(85, conf + 6)
                reason_parts.append(f"NO book building ({d:.0%})")

        # ── 3) Spread / mid fallback ────────────────────────────────────
        yes_bid = kalshi.get("yes_bid") or market_data.get("kalshi_yes_bid")
        yes_ask = kalshi.get("yes_ask") or market_data.get("kalshi_yes_ask")
        try:
            if yes_bid is not None and yes_ask is not None:
                yb, ya = float(yes_bid), float(yes_ask)
                if yb > 1.5:
                    yb, ya = yb / 100.0, ya / 100.0
                mid = (yb + ya) / 2.0
                spread = max(0.0, ya - yb)
                features["kalshi_mid"] = round(mid, 4)
                features["kalshi_spread"] = round(spread, 4)
                max_spread = float(getattr(settings, "SPREAD_MAX_CENTS", 6.0)) / 100.0
                if spread > max_spread:
                    conf = max(30, conf - 15)
                    reason_parts.append(f"wide spread {spread:.0%}")
                elif not book["ok"]:
                    if mid > 0.62:
                        direction = "UP"
                        conf = max(conf, min(72, 48 + int((mid - 0.5) * 70)))
                        reason_parts.append(f"mid {mid:.2f} UP")
                    elif mid < 0.38:
                        direction = "DOWN"
                        conf = max(conf, min(72, 48 + int((0.5 - mid) * 70)))
                        reason_parts.append(f"mid {mid:.2f} DOWN")
        except Exception:
            pass

        # ── 4) Taker confirmation ───────────────────────────────────────
        if len(candles) >= 10:
            recent = candles[-8:]
            taker_buy = 0.0
            total_vol = 0.0
            for c in recent:
                try:
                    taker_buy += float(c.get("taker_buy_base") or c.get("taker_buy_base_asset_volume") or 0)
                    total_vol += float(c.get("volume") or c.get("v") or 0)
                except Exception:
                    pass
            if total_vol > 0:
                ratio = taker_buy / total_vol
                features["taker_buy_ratio"] = round(ratio, 3)
                if ratio > 0.62 and direction != "DOWN":
                    if direction == "WAIT":
                        direction, conf = "UP", 55
                    else:
                        conf = min(85, conf + 6)
                    reason_parts.append("buy aggression")
                elif ratio < 0.38 and direction != "UP":
                    if direction == "WAIT":
                        direction, conf = "DOWN", 55
                    else:
                        conf = min(85, conf + 6)
                    reason_parts.append("sell aggression")

        reason = " · ".join(reason_parts) if reason_parts else "Order flow neutral"
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)
