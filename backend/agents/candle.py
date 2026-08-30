"""
Dedicated pattern specialists — not one shared Pattern Seer.

Bitcoin Pattern Specialist (candle_btc): BTC structure only.
Ethereum Pattern Specialist (candle_eth): ETH structure only.

They keep separate names, weights, memory, and settle keys. Internals are
asset-tuned (lookback, % thresholds, wick rules, mean-rev vs trend) so they
are not a cloned pair. Each refuses the other coin. They vote; they do not lock.
Satoshi / Vitalik remain the only lockers.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import numpy as np

from backend.agents.base import AgentSignal, BaseSpecialist
from backend.agents.chair_gates import market_book_asset, pattern_specialist_name
from backend.config import settings


def _ohlc_arrays(candles: list, lookback: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    window = candles[-int(lookback) :]
    closes = np.array([c["close"] for c in window], dtype=float)
    opens = np.array([c["open"] for c in window], dtype=float)
    highs = np.array([c["high"] for c in window], dtype=float)
    lows = np.array([c["low"] for c in window], dtype=float)
    return closes, opens, highs, lows


class _AssetPatternSpecialist(BaseSpecialist):
    """Asset-pure candle reader. Subclasses set name + book constants."""

    name = "candle"
    category = "candle"
    book_asset = "btc"
    lookback = 60
    body_ratio_bar = 0.65
    ret5_bar = 0.0008
    ret15_bar = 0.0025
    wick_rej = 0.55
    mean_rev_boost = 8
    streak_boost = 5
    fade_streak_n = 4
    quiet_floor_base = 55
    prefer_mean_rev = False
    extension_fade = False

    def __init__(self):
        super().__init__()
        self.base_weight = settings.BASE_WEIGHTS.get(self.name, 0.10)

    def _wrong_coin(self, market_data: Dict[str, Any]) -> Optional[AgentSignal]:
        book = market_book_asset(market_data)
        if book and book != self.book_asset:
            return AgentSignal(
                self.name,
                "WAIT",
                90,
                f"Wrong coin — {self.name} answers {self.book_asset.upper()} only",
                self.category,
                features={
                    "asset": self.book_asset,
                    "refused_asset": book,
                    "lock_force": False,
                    "advisory": True,
                    "final_call": False,
                },
            )
        return None

    async def get_signal(self, market_data: Dict[str, Any]) -> AgentSignal:
        refused = self._wrong_coin(market_data)
        if refused is not None:
            return refused
        if self.is_muted:
            return AgentSignal(self.name, "WAIT", 0, "Muted by Guardian", self.category, muted=True)

        candles = market_data.get("candles") or []
        if len(candles) < 20:
            return AgentSignal(self.name, "WAIT", 30, "Insufficient candle history", self.category)

        phase = self.phase(market_data)
        quiet = self.is_quiet(market_data)
        floor = self.quiet_confidence_floor(market_data, base=self.quiet_floor_base)
        streak_dir, streak_n = self.streak(market_data)
        mean_rev = self.mean_reversion_bias(market_data)
        path = self.path_move(market_data)
        entry = self.entry_dir(market_data)

        closes, _opens, highs, lows = _ohlc_arrays(candles, self.lookback)
        last = candles[-1]
        prev = candles[-2]
        body = abs(last["close"] - last["open"])
        range_ = (last["high"] - last["low"]) or 1e-9
        body_ratio = body / range_

        # Dead bar: no traded range worth reading. Do not invent a story.
        if range_ / max(float(last["close"]), 1e-9) < 1e-6:
            return AgentSignal(self.name, "WAIT", 35, self.annotate_reason(market_data, "Dead bar — no range"), self.category)

        # Provisional bar: OHLC of a still-open bucket can repaint. Read it,
        # but cap conviction — never vote an open bar like a closed one.
        provisional = False
        try:
            t0 = float(last.get("open_time") or last.get("t") or 0.0)
            t1 = float(prev.get("open_time") or prev.get("t") or 0.0)
            interval_ms = t0 - t1
            if t0 > 0 and interval_ms > 0:
                import time as _time
                provisional = (_time.time() * 1000.0) < (t0 + interval_ms)
        except (TypeError, ValueError):
            provisional = False

        ret_5 = (closes[-1] - closes[-6]) / closes[-6] if len(closes) > 5 else 0.0
        ret_15 = (closes[-1] - closes[-16]) / closes[-16] if len(closes) > 15 else 0.0
        ret_30 = (closes[-1] - closes[-31]) / closes[-31] if len(closes) > 30 else 0.0

        hh = len(closes) >= 20 and closes[-1] > closes[-20:].max() * 0.999
        ll = len(closes) >= 20 and closes[-1] < closes[-20:].min() * 1.001
        upper_wick = last["high"] - max(last["close"], last["open"])
        lower_wick = min(last["close"], last["open"]) - last["low"]
        upper_rej = upper_wick / range_ > self.wick_rej and body_ratio < 0.35
        lower_rej = lower_wick / range_ > self.wick_rej and body_ratio < 0.35

        # ── Location (read the map before the candle) ─────────────────────
        # A) at the window high  B) at the window low  D) stretched move
        # C) mid-range / in transit — pattern votes are OFF here.
        win = min(20, len(highs))
        win_high = float(highs[-win:].max())
        win_low = float(lows[-win:].min())
        span = max(win_high - win_low, 1e-9)
        at_high = (win_high - float(last["high"])) / span <= 0.10
        at_low = (float(last["low"]) - win_low) / span <= 0.10
        stretched = abs(ret_15) > self.ret15_bar * 1.8
        if at_high:
            location = "high"
        elif at_low:
            location = "low"
        elif stretched:
            location = "stretched"
        else:
            location = "mid"

        # Inside bar: coil. The break is the event, not the bar.
        inside_bar = last["high"] < prev["high"] and last["low"] > prev["low"]

        # Break-and-fail trap: this bar poked beyond the prior window extreme
        # but CLOSED back inside. Vote the fail direction; the fake extreme
        # is the invalidation.
        prior_high = float(highs[-win:-1].max()) if win > 1 else win_high
        prior_low = float(lows[-win:-1].min()) if win > 1 else win_low
        trap_down = last["high"] > prior_high and last["close"] < prior_high and body_ratio < 0.55
        trap_up = last["low"] < prior_low and last["close"] > prior_low and body_ratio < 0.55

        # Two-bar engulf — only at an extreme, and only as a fallback so the
        # same three bars never stack hammer+engulf+star.
        prev_body = abs(prev["close"] - prev["open"])
        bull_engulf = (
            prev["close"] < prev["open"] and last["close"] > last["open"]
            and last["close"] >= max(prev["close"], prev["open"])
            and last["open"] <= min(prev["close"], prev["open"])
            and prev_body > 0 and at_low
        )
        bear_engulf = (
            prev["close"] > prev["open"] and last["close"] < last["open"]
            and last["open"] >= max(prev["close"], prev["open"])
            and last["close"] <= min(prev["close"], prev["open"])
            and prev_body > 0 and at_high
        )

        features = {
            "body_ratio": round(body_ratio, 3),
            "ret_5": round(float(ret_5), 5),
            "ret_15": round(float(ret_15), 5),
            "ret_30": round(float(ret_30), 5),
            "hh": bool(hh),
            "ll": bool(ll),
            "location": location,
            "inside_bar": bool(inside_bar),
            "provisional_bar": bool(provisional),
            "phase": phase,
            "horizon": "entry" if phase == "entry" else "revision",
            "path_move": path,
            "streak_n": streak_n,
            "asset": self.book_asset,
            "lookback": self.lookback,
            "book": self.name,
            "final_call": False,
        }

        direction = "WAIT"
        conf = 42
        notes = []

        local_dir = None
        local_conf = 0
        invalidation = None
        if inside_bar and body_ratio < self.body_ratio_bar:
            # Coil — vote the break close, not the poke. Nothing else fires.
            notes.append("inside bar — coil, vote the break")
        elif last["close"] > last["open"] and body_ratio > self.body_ratio_bar and ret_5 > self.ret5_bar:
            local_dir, local_conf = "UP", min(82, 55 + int(abs(ret_5) * 8000))
            invalidation = float(last["low"])
            notes.append(f"bull body {body_ratio:.0%} · 5m +{ret_5 * 100:.2f}%")
        elif last["close"] < last["open"] and body_ratio > self.body_ratio_bar and ret_5 < -self.ret5_bar:
            local_dir, local_conf = "DOWN", min(82, 55 + int(abs(ret_5) * 8000))
            invalidation = float(last["high"])
            notes.append(f"bear body {body_ratio:.0%} · 5m {ret_5 * 100:.2f}%")
        elif trap_down and not trap_up:
            local_dir, local_conf = "DOWN", 66
            invalidation = float(last["high"])
            notes.append("break-and-fail above the window high")
        elif trap_up and not trap_down:
            local_dir, local_conf = "UP", 66
            invalidation = float(last["low"])
            notes.append("break-and-fail below the window low")
        elif lower_rej and ret_5 > -self.ret5_bar * 0.4:
            # Wick rejection only counts WITH location: at the low, or after a
            # stretched sell. A long wick mid-range is noise, not a vote.
            if at_low or (stretched and ret_15 < 0):
                local_dir, local_conf = "UP", 64
                invalidation = float(last["low"])
                notes.append("lower wick rejection at the low")
            else:
                notes.append("lower wick mid-range — noise, no vote")
        elif upper_rej and ret_5 < self.ret5_bar * 0.4:
            if at_high or (stretched and ret_15 > 0):
                local_dir, local_conf = "DOWN", 64
                invalidation = float(last["high"])
                notes.append("upper wick rejection at the high")
            else:
                notes.append("upper wick mid-range — noise, no vote")
        elif bull_engulf:
            local_dir, local_conf = "UP", 62
            invalidation = float(min(last["low"], prev["low"]))
            notes.append("bull engulf at the low")
        elif bear_engulf:
            local_dir, local_conf = "DOWN", 62
            invalidation = float(max(last["high"], prev["high"]))
            notes.append("bear engulf at the high")
        elif ret_15 > self.ret15_bar and ret_5 > 0:
            if self.extension_fade and abs(ret_15) > self.ret15_bar * 1.8:
                local_dir, local_conf = "DOWN", 60
                invalidation = float(last["high"])
                notes.append(f"ETH extension fade 15m +{ret_15 * 100:.2f}%")
            else:
                local_dir, local_conf = "UP", 62
                invalidation = float(last["low"])
                notes.append(f"15m trend +{ret_15 * 100:.2f}%")
        elif ret_15 < -self.ret15_bar and ret_5 < 0:
            if self.extension_fade and abs(ret_15) > self.ret15_bar * 1.8:
                local_dir, local_conf = "UP", 60
                invalidation = float(last["low"])
                notes.append(f"ETH extension fade 15m {ret_15 * 100:.2f}%")
            else:
                local_dir, local_conf = "DOWN", 62
                invalidation = float(last["high"])
                notes.append(f"15m trend {ret_15 * 100:.2f}%")
        elif (not self.prefer_mean_rev) and hh and ret_5 > 0:
            local_dir, local_conf = "UP", 58
            invalidation = float(last["low"])
            notes.append("higher-high break")
        elif (not self.prefer_mean_rev) and ll and ret_5 < 0:
            local_dir, local_conf = "DOWN", 58
            invalidation = float(last["high"])
            notes.append("lower-low break")
        elif self.prefer_mean_rev and hh and ret_5 > 0 and mean_rev == "DOWN":
            local_dir, local_conf = "DOWN", 57
            invalidation = float(last["high"])
            notes.append("ETH fade stretched HH")
        elif self.prefer_mean_rev and ll and ret_5 < 0 and mean_rev == "UP":
            local_dir, local_conf = "UP", 57
            invalidation = float(last["low"])
            notes.append("ETH fade stretched LL")

        # No invalidation, no vote: a directional read must name the price
        # that kills it.
        if local_dir and invalidation is None:
            local_dir, local_conf = None, 0
            notes.append("no invalidation — WAIT")
        if invalidation is not None:
            features["invalidation"] = round(invalidation, 2)

        if phase == "entry":
            if local_dir:
                direction, conf = local_dir, local_conf
                if mean_rev == local_dir:
                    conf = min(84, conf + self.mean_rev_boost)
                    notes.append("mean-rev agrees")
                elif self.prefer_mean_rev and mean_rev and mean_rev != local_dir:
                    conf = max(50, conf - 6)
                    notes.append("ETH mean-rev disagrees")
                if streak_dir == local_dir and streak_n >= 3:
                    conf = min(84, conf + self.streak_boost)
                    notes.append(f"streak {streak_dir}×{streak_n}")
                if streak_dir and streak_dir != local_dir and streak_n >= self.fade_streak_n:
                    conf = max(50, conf - 8)
                    notes.append("fighting strong streak")
                if invalidation is not None:
                    notes.append(f"inval {invalidation:.0f}")
            elif mean_rev and not quiet:
                direction, conf = mean_rev, 58 if self.prefer_mean_rev else 56
                notes.append(f"structure quiet — multi-window mean-rev {mean_rev}")
            else:
                notes.append("no clean entry structure")
        else:
            if entry in ("UP", "DOWN") and path is not None:
                if entry == "UP" and path <= -5.0 and (local_dir == "DOWN" or ret_15 < -self.ret15_bar * 0.4):
                    direction, conf = "DOWN", max(local_conf, 62)
                    notes.append(f"structure broke entry UP (path {path:.1f})")
                elif entry == "DOWN" and path >= 5.0 and (local_dir == "UP" or ret_15 > self.ret15_bar * 0.4):
                    direction, conf = "UP", max(local_conf, 62)
                    notes.append(f"structure broke entry DOWN (path +{path:.1f})")
                elif local_dir == entry:
                    direction, conf = entry, max(local_conf, 58)
                    notes.append(f"structure still with entry {entry}")
                elif local_dir:
                    direction, conf = local_dir, max(52, local_conf - 6)
                    notes.append(f"local {local_dir} vs entry {entry}")
                else:
                    direction, conf = entry, 54
                    notes.append(f"hold entry {entry} — no break")
            elif local_dir:
                direction, conf = local_dir, local_conf
            else:
                notes.append("no revision edge")

        # Rubric ceiling: a voter never speaks above 84 off local bars — 90+
        # belongs to the locker, not the pattern seat.
        if direction != "WAIT":
            conf = min(conf, 84)
        # Open bar is provisional: read it, but do not vote it like a close.
        if provisional and direction != "WAIT":
            conf = min(conf, 68)
            notes.append("bar open — provisional")

        if quiet and direction != "WAIT":
            conf = min(conf, floor)
            if conf < floor:
                direction, conf = "WAIT", floor
                notes.append("quiet gate")

        if not notes:
            notes.append("chop / mixed wicks")

        reason = self.annotate_reason(market_data, " · ".join(notes))
        return AgentSignal(self.name, direction, conf, reason, self.category, features=features)


class BitcoinPatternSpecialist(_AssetPatternSpecialist):
    """Pure BTC patterns. Satoshi calls this seat + shared services."""

    name = "candle_btc"
    book_asset = "btc"
    lookback = 24  # 15m book: window + a short prior, not a 1H 60-bar clone
    body_ratio_bar = 0.62
    ret5_bar = 0.0006
    ret15_bar = 0.0018
    wick_rej = 0.55
    mean_rev_boost = 8
    streak_boost = 5
    fade_streak_n = 4
    quiet_floor_base = 55
    prefer_mean_rev = False
    extension_fade = False


class EthereumPatternSpecialist(_AssetPatternSpecialist):
    """Pure ETH patterns. Vitalik calls this seat + shared services."""

    name = "candle_eth"
    book_asset = "eth"
    lookback = 45
    body_ratio_bar = 0.58
    ret5_bar = 0.0014
    ret15_bar = 0.0040
    wick_rej = 0.48
    mean_rev_boost = 11
    streak_boost = 2
    fade_streak_n = 3
    quiet_floor_base = 60
    prefer_mean_rev = True
    extension_fade = True


# Back-compat alias — do not instantiate on a live desk. Use the asset class.
CandlePatternSpecialist = BitcoinPatternSpecialist


def pattern_specialist_for_asset(asset: str | None) -> _AssetPatternSpecialist:
    key = pattern_specialist_name(asset)
    if key == "candle_eth":
        return EthereumPatternSpecialist()
    return BitcoinPatternSpecialist()
