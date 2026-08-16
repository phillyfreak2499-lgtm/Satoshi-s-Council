"""
Sub-council micro-bots — two behind each main specialist.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from backend.agents.base import AgentSignal


SUB_DEFS = {
    "candle": [
        ("body", "BODY"),
        ("structure", "STRUCT"),
        ("pin", "PIN"),           # Hammer / Shooting Star at levels
        ("engulf", "ENGULF"),     # Bullish/Bearish Engulfing at levels
        ("marubozu", "MARU"),     # Strong Marubozu / consecutive bodies
        ("doji", "DOJI"),         # Doji → confirmation candle
        ("star", "STAR"),         # Morning / Evening Star
    ],
    "volume": [("spike", "SPIKE"), ("dryup", "DRYUP")],
    "momentum": [("rsi", "RSI"), ("macd", "MACD")],
    "orderflow": [("book", "BOOK"), ("taker", "TAKER")],
    "funding": [("rate", "RATE"), ("crowding", "CROWD")],
    "regime": [("session", "SESS"), ("volband", "VOL")],
    "volatility": [("atr", "ATR"), ("impulse", "IMP")],
    "oi_pressure": [("crowd", "CROWD"), ("path", "PATH")],
    "streak": [("run", "RUN"), ("fade", "FADE")],
    "odds": [("mid", "MID"), ("skew", "SKEW")],
    "guardian": [("binance_feed", "BN"), ("kalshi_feed", "KL")],
}


def _sig(parent: str, sid: str, direction: str, confidence: int, reasoning: str, category: str, features: dict | None = None) -> AgentSignal:
    return AgentSignal(
        agent_name=f"{parent}.{sid}",
        direction=direction,  # type: ignore
        confidence=confidence,
        reasoning=reasoning,
        category=f"sub:{category}",
        features=features or {},
        parent=parent,
    )


def _mean(arr: List[float]) -> float:
    return sum(arr) / len(arr) if arr else 0.0


def _rsi(closes: List[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    slice_ = closes[-(period + 1):]
    gains = losses = 0.0
    for i in range(1, len(slice_)):
        d = slice_[i] - slice_[i - 1]
        if d >= 0:
            gains += d
        else:
            losses -= d
    avg_gain = gains / period or 1e-9
    avg_loss = losses / period or 1e-9
    return 100 - 100 / (1 + avg_gain / avg_loss)


def _c_parts(c: dict) -> tuple:
    o, h, l, cl = float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"])
    rng = max(h - l, 1e-9)
    body = abs(cl - o)
    upper = h - max(o, cl)
    lower = min(o, cl) - l
    return o, h, l, cl, body, rng, upper, lower, body / rng


def _near_level(price: float, highs: List[float], lows: List[float], tol: float = 0.0012) -> str:
    """Return 'support', 'resistance', or '' if price is near a local S/R."""
    if len(highs) < 8:
        return ""
    rh = max(highs[-20:-1]) if len(highs) > 20 else max(highs[:-1])
    rl = min(lows[-20:-1]) if len(lows) > 20 else min(lows[:-1])
    if rh and abs(price - rh) / rh <= tol:
        return "resistance"
    if rl and abs(price - rl) / rl <= tol:
        return "support"
    # also treat swing extremes of last 8 bars
    if abs(price - max(highs[-8:-1])) / price <= tol:
        return "resistance"
    if abs(price - min(lows[-8:-1])) / price <= tol:
        return "support"
    return ""


def run_candle_subs(md: Dict[str, Any], parent: str | None = None) -> List[AgentSignal]:
    from backend.agents.chair_gates import market_book_asset, pattern_specialist_name
    parent = parent or pattern_specialist_name(market_book_asset(md) or (md or {}).get("asset"))
    candles = md.get("candles") or []
    thin = [
        _sig(parent, "body", "WAIT", 25, "Thin history", "candle"),
        _sig(parent, "structure", "WAIT", 25, "Thin history", "candle"),
        _sig(parent, "pin", "WAIT", 20, "Thin history", "candle"),
        _sig(parent, "engulf", "WAIT", 20, "Thin history", "candle"),
        _sig(parent, "marubozu", "WAIT", 20, "Thin history", "candle"),
        _sig(parent, "doji", "WAIT", 20, "Thin history", "candle"),
        _sig(parent, "star", "WAIT", 20, "Thin history", "candle"),
    ]
    if len(candles) < 20:
        return thin

    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    opens = [float(c["open"]) for c in candles]
    last = candles[-1]
    prev = candles[-2]
    o, h, l, cl, body, rng, upper, lower, body_ratio = _c_parts(last)
    po, ph, pl, pcl, pbody, prng, pupper, plower, pratio = _c_parts(prev)
    ret5 = (closes[-1] - closes[-6]) / closes[-6] if len(closes) > 5 else 0.0
    level = _near_level(cl, highs, lows)

    # ── CORE: directional body ──
    body_dir, body_conf, body_reason = "WAIT", 40, "Body neutral"
    if cl > o and body_ratio > 0.65 and ret5 > 0.0008:
        body_dir, body_conf = "UP", min(82, 55 + int(abs(ret5) * 7000))
        body_reason = "Bullish body + short momentum"
    elif cl < o and body_ratio > 0.65 and ret5 < -0.0008:
        body_dir, body_conf = "DOWN", min(82, 55 + int(abs(ret5) * 7000))
        body_reason = "Bearish body + short momentum"
    elif body_ratio > 0.55:
        body_dir = "UP" if cl >= o else "DOWN"
        body_conf, body_reason = 48, "Moderate directional body"

    # ── FRAME: structure / S-R ──
    recent_high = max(highs[-15:])
    recent_low = min(lows[-15:])
    struct_dir, struct_conf, struct_reason = "WAIT", 40, "Inside range"
    if cl > recent_high * 0.999:
        struct_dir, struct_conf, struct_reason = "UP", 60, "Local high break"
    elif cl < recent_low * 1.001:
        struct_dir, struct_conf, struct_reason = "DOWN", 60, "Local low break"
    else:
        mid = (recent_high + recent_low) / 2
        if cl > mid * 1.0008:
            struct_dir, struct_conf, struct_reason = "UP", 46, "Upper half of range"
        elif cl < mid * 0.9992:
            struct_dir, struct_conf, struct_reason = "DOWN", 46, "Lower half of range"

    # ── PIN: Hammer / Shooting Star at levels ──
    pin_dir, pin_conf, pin_reason = "WAIT", 35, "No pin bar"
    # Hammer: long lower wick, small body, short upper wick — prefer at support
    is_hammer = (
        lower >= max(body * 2.0, rng * 0.55)
        and upper <= max(body * 1.25, rng * 0.28)
        and body_ratio <= 0.40
    )
    # Shooting star: long upper wick, small body — prefer at resistance
    is_star_pin = (
        upper >= max(body * 2.0, rng * 0.55)
        and lower <= max(body * 1.25, rng * 0.28)
        and body_ratio <= 0.40
    )
    if is_hammer:
        pin_dir = "UP"
        pin_conf = 58
        pin_reason = "Hammer pin"
        if level == "support":
            pin_conf = 78
            pin_reason = "Hammer at support"
        elif level == "resistance":
            pin_conf = 45
            pin_reason = "Hammer mid/high — weaker"
    elif is_star_pin:
        pin_dir = "DOWN"
        pin_conf = 58
        pin_reason = "Shooting-star pin"
        if level == "resistance":
            pin_conf = 78
            pin_reason = "Shooting star at resistance"
        elif level == "support":
            pin_conf = 45
            pin_reason = "Shooting star mid/low — weaker"

    # ── ENGULF: Bullish/Bearish engulfing at levels ──
    eng_dir, eng_conf, eng_reason = "WAIT", 35, "No engulfing"
    bull_engulf = (
        pcl < po  # prior bearish
        and cl > o  # current bullish
        and o <= pcl
        and cl >= po
        and body > pbody * 1.05
    )
    bear_engulf = (
        pcl > po
        and cl < o
        and o >= pcl
        and cl <= po
        and body > pbody * 1.05
    )
    if bull_engulf:
        eng_dir, eng_conf, eng_reason = "UP", 64, "Bullish engulfing"
        if level == "support":
            eng_conf, eng_reason = 82, "Bullish engulfing at support"
    elif bear_engulf:
        eng_dir, eng_conf, eng_reason = "DOWN", 64, "Bearish engulfing"
        if level == "resistance":
            eng_conf, eng_reason = 82, "Bearish engulfing at resistance"

    # ── MARU: Marubozu or consecutive strong bodies ──
    maru_dir, maru_conf, maru_reason = "WAIT", 35, "No marubozu streak"
    is_maru = body_ratio >= 0.85 and upper / rng <= 0.08 and lower / rng <= 0.08
    # consecutive strong bodies same direction
    streak = 0
    for c in reversed(candles[-5:]):
        oo, _, _, cc, bb, rr, uu, ll, br = _c_parts(c)
        bull = cc > oo
        if streak == 0:
            streak_bull = bull
            if br >= 0.6:
                streak = 1
            else:
                break
        else:
            if bull == streak_bull and br >= 0.55:
                streak += 1
            else:
                break
    if is_maru:
        maru_dir = "UP" if cl > o else "DOWN"
        maru_conf = 72
        maru_reason = f"{'Bull' if maru_dir == 'UP' else 'Bear'} marubozu"
    elif streak >= 3:
        maru_dir = "UP" if streak_bull else "DOWN"
        maru_conf = min(80, 55 + streak * 6)
        maru_reason = f"{streak} strong {'bull' if streak_bull else 'bear'} bodies"

    # ── DOJI: doji then strong confirmation ──
    doji_dir, doji_conf, doji_reason = "WAIT", 35, "No doji setup"
    prev_is_doji = pratio <= 0.18  # prior bar body very small vs range
    conf_strong = body_ratio >= 0.55
    if prev_is_doji and conf_strong:
        if cl > o and cl > max(po, pcl):
            doji_dir, doji_conf, doji_reason = "UP", 74, "Doji → bullish confirmation"
        elif cl < o and cl < min(po, pcl):
            doji_dir, doji_conf, doji_reason = "DOWN", 74, "Doji → bearish confirmation"
        else:
            doji_dir = "UP" if cl > o else "DOWN"
            doji_conf, doji_reason = 55, "Doji + directional follow-through"
    elif body_ratio <= 0.18:
        doji_dir, doji_conf, doji_reason = "WAIT", 42, "Doji forming — wait confirm"

    # ── STAR: Morning / Evening Star (clean 3-candle) ──
    star_dir, star_conf, star_reason = "WAIT", 32, "No star pattern"
    if len(candles) >= 3:
        a = candles[-3]
        ao, ah, al, ac, ab, ar, au, alw, abr = _c_parts(a)
        # Evening star: strong up body, small mid, strong down close into first body
        evening = (
            ac > ao and abr >= 0.55  # candle A bullish strong
            and pratio <= 0.35  # small middle
            and cl < o and body_ratio >= 0.45  # C bearish
            and cl < (ao + ac) / 2  # closes into A body
            and max(po, pcl) >= ac * 0.999  # gap/high continuation feel
        )
        morning = (
            ac < ao and abr >= 0.55
            and pratio <= 0.35
            and cl > o and body_ratio >= 0.45
            and cl > (ao + ac) / 2
            and min(po, pcl) <= ac * 1.001
        )
        if morning:
            star_dir, star_conf, star_reason = "UP", 80, "Clean morning star"
            if level == "support":
                star_conf, star_reason = 88, "Morning star at support"
        elif evening:
            star_dir, star_conf, star_reason = "DOWN", 80, "Clean evening star"
            if level == "resistance":
                star_conf, star_reason = 88, "Evening star at resistance"

    return [
        _sig(parent, "body", body_dir, body_conf, body_reason, "candle", {"body_ratio": round(body_ratio, 3)}),
        _sig(parent, "structure", struct_dir, struct_conf, struct_reason, "candle", {"level": level or "none"}),
        _sig(parent, "pin", pin_dir, pin_conf, pin_reason, "candle", {"level": level or "none"}),
        _sig(parent, "engulf", eng_dir, eng_conf, eng_reason, "candle", {"level": level or "none"}),
        _sig(parent, "marubozu", maru_dir, maru_conf, maru_reason, "candle", {"streak": streak}),
        _sig(parent, "doji", doji_dir, doji_conf, doji_reason, "candle"),
        _sig(parent, "star", star_dir, star_conf, star_reason, "candle", {"level": level or "none"}),
    ]


def run_volume_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    candles = md.get("candles") or []
    if len(candles) < 30:
        return [
            _sig("volume", "spike", "WAIT", 22, "Thin volume history", "volume"),
            _sig("volume", "dryup", "WAIT", 22, "Thin volume history", "volume"),
        ]
    volumes = [c["volume"] for c in candles]
    closes = [c["close"] for c in candles]
    avg = _mean(volumes[:-3]) or 1
    recent = _mean(volumes[-3:])
    spike = recent / avg
    price_change = (closes[-1] - closes[-4]) / closes[-4] if len(closes) > 3 else 0

    spike_dir, spike_conf, spike_reason = "WAIT", 40, "No volume spike"
    if spike > 2.2 and price_change > 0.0006:
        spike_dir, spike_conf = "UP", min(80, 50 + int(spike * 10))
        spike_reason = f"Spike {spike:.1f}x with rise"
    elif spike > 2.2 and price_change < -0.0006:
        spike_dir, spike_conf = "DOWN", min(80, 50 + int(spike * 10))
        spike_reason = f"Spike {spike:.1f}x with drop"
    elif spike > 1.4 and abs(price_change) > 0.0003:
        spike_dir = "UP" if price_change > 0 else "DOWN"
        spike_conf, spike_reason = 52, "Mild participation surge"

    dry_dir, dry_conf, dry_reason = "WAIT", 40, "Volume not dry"
    if spike < 0.55:
        dry_conf, dry_reason = 58, "Dry tape – fade edge"
    elif price_change > 0.0004 and spike > 1.05:
        dry_dir, dry_conf, dry_reason = "UP", 50, "Healthy participation up"
    elif price_change < -0.0004 and spike > 1.05:
        dry_dir, dry_conf, dry_reason = "DOWN", 50, "Healthy participation down"

    return [
        _sig("volume", "spike", spike_dir, spike_conf, spike_reason, "volume", {"spike_ratio": round(spike, 2)}),
        _sig("volume", "dryup", dry_dir, dry_conf, dry_reason, "volume"),
    ]


def run_momentum_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    candles = md.get("candles") or []
    if len(candles) < 25:
        return [
            _sig("momentum", "rsi", "WAIT", 28, "Thin momentum data", "momentum"),
            _sig("momentum", "macd", "WAIT", 28, "Thin momentum data", "momentum"),
        ]
    closes = [c["close"] for c in candles]
    r = _rsi(closes, 14)
    ema_fast = _mean(closes[-12:])
    ema_slow = _mean(closes[-26:])
    macd = (ema_fast - ema_slow) / (closes[-1] or 1)

    rsi_dir, rsi_conf, rsi_reason = "WAIT", 42, f"RSI {r:.0f}"
    if r > 68:
        rsi_dir, rsi_conf = "UP", min(78, 50 + int((r - 50) * 0.9))
        rsi_reason = f"RSI {r:.0f} overbought thrust"
    elif r < 32:
        rsi_dir, rsi_conf = "DOWN", min(78, 50 + int((50 - r) * 0.9))
        rsi_reason = f"RSI {r:.0f} oversold thrust"
    elif r > 55:
        rsi_dir, rsi_conf, rsi_reason = "UP", 52, f"RSI {r:.0f} bullish zone"
    elif r < 45:
        rsi_dir, rsi_conf, rsi_reason = "DOWN", 52, f"RSI {r:.0f} bearish zone"

    macd_dir, macd_conf, macd_reason = "WAIT", 42, "MACD flat"
    if macd > 0.0003:
        macd_dir, macd_conf = "UP", min(76, 50 + int(abs(macd) * 40000))
        macd_reason = "Positive MACD bias"
    elif macd < -0.0003:
        macd_dir, macd_conf = "DOWN", min(76, 50 + int(abs(macd) * 40000))
        macd_reason = "Negative MACD bias"
    elif macd > 0:
        macd_dir, macd_conf, macd_reason = "UP", 46, "Slight MACD positive"
    elif macd < 0:
        macd_dir, macd_conf, macd_reason = "DOWN", 46, "Slight MACD negative"

    return [
        _sig("momentum", "rsi", rsi_dir, rsi_conf, rsi_reason, "momentum", {"rsi_14": round(r, 1)}),
        _sig("momentum", "macd", macd_dir, macd_conf, macd_reason, "momentum", {"macd_approx": round(macd, 6)}),
    ]


def run_orderflow_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    book_dir, book_conf, book_reason = "WAIT", 40, "Kalshi book neutral"
    book_feat: Dict[str, Any] = {}
    bid, ask = md.get("kalshi_yes_bid"), md.get("kalshi_yes_ask")
    try:
        b = float(bid) if bid is not None else None
        a = float(ask) if ask is not None else None
    except (TypeError, ValueError):
        b, a = None, None
    if b is not None and a is not None:
        mid = (b + a) / 2.0
        book_feat["kalshi_mid"] = round(mid, 3)
        if mid > 0.62:
            book_dir, book_conf = "UP", min(74, 50 + int((mid - 0.5) * 80))
            book_reason = f"Book mid {mid:.2f} UP lean"
        elif mid < 0.38:
            book_dir, book_conf = "DOWN", min(74, 50 + int((0.5 - mid) * 80))
            book_reason = f"Book mid {mid:.2f} DOWN lean"

    taker_dir, taker_conf, taker_reason = "WAIT", 40, "Taker flow flat"
    taker_feat: Dict[str, Any] = {}
    candles = md.get("candles") or []
    if len(candles) >= 10:
        recent = candles[-8:]
        def _f(c, k, default=0.0):
            try:
                return float(c.get(k, default) if isinstance(c, dict) else default)
            except (TypeError, ValueError):
                return float(default)
        taker_buy = sum(_f(c, "taker_buy_base", _f(c, "volume", 0.0) * 0.5) for c in recent)
        total = sum(_f(c, "volume", 0.0) for c in recent) or 1.0
        ratio = taker_buy / total
        taker_feat["taker_buy_ratio"] = round(ratio, 3)
        if ratio > 0.62:
            taker_dir, taker_conf, taker_reason = "UP", 58, "Aggressive buy flow"
        elif ratio < 0.38:
            taker_dir, taker_conf, taker_reason = "DOWN", 58, "Aggressive sell flow"

    return [
        _sig("orderflow", "book", book_dir, book_conf, book_reason, "orderflow", book_feat),
        _sig("orderflow", "taker", taker_dir, taker_conf, taker_reason, "orderflow", taker_feat),
    ]


def run_funding_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    funding = md.get("funding_rate")
    rate_dir, rate_conf, rate_reason = "WAIT", 40, "Funding neutral"
    rate_feat: Dict[str, Any] = {}
    if funding is not None:
        rate_feat["funding_rate"] = round(funding, 6)
        if funding > 0.0004:
            rate_dir, rate_conf = "DOWN", min(76, 50 + int(funding * 18000))
            rate_reason = "High positive funding – longs crowded"
        elif funding < -0.0003:
            rate_dir, rate_conf = "UP", min(76, 50 + int(abs(funding) * 18000))
            rate_reason = "Negative funding – shorts crowded"

    crowd_dir, crowd_conf, crowd_reason = "WAIT", 40, "OI neutral"
    crowd_feat: Dict[str, Any] = {}
    if md.get("open_interest") is not None:
        crowd_feat["open_interest"] = round(md["open_interest"], 1)
    if funding is not None:
        if funding > 0.0002:
            crowd_dir, crowd_conf, crowd_reason = "DOWN", 50, "Crowded long bias"
        elif funding < -0.00015:
            crowd_dir, crowd_conf, crowd_reason = "UP", 50, "Crowded short bias"

    return [
        _sig("funding", "rate", rate_dir, rate_conf, rate_reason, "funding", rate_feat),
        _sig("funding", "crowding", crowd_dir, crowd_conf, crowd_reason, "funding", crowd_feat),
    ]


def run_regime_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    now = datetime.now(timezone.utc)
    hour, dow = now.hour, now.weekday()  # Mon=0
    # JS uses Sun=0; map weekend as Sat/Sun
    is_weekend = dow >= 5
    low_edge = {3, 4, 5, 6, 7}

    sess_dir, sess_conf, sess_reason = "WAIT", 50, "Standard session"
    if hour in low_edge:
        sess_conf, sess_reason = 68, f"Low-edge hour {hour} UTC – raise WAIT"
    elif is_weekend:
        sess_conf, sess_reason = 58, "Weekend – softer edge"

    vol_dir, vol_conf, vol_reason = "WAIT", 48, "Normal vol band"
    atr_pct = 0.0
    candles = md.get("candles") or []
    if len(candles) >= 20:
        recent = candles[-20:]
        trs = []
        for i in range(1, len(recent)):
            h, l, pc = recent[i]["high"], recent[i]["low"], recent[i - 1]["close"]
            trs.append(max(h - l, abs(h - pc), abs(l - pc)))
        atr = _mean(trs)
        last = recent[-1]["close"] or 1
        atr_pct = atr / last
        if atr_pct > 0.0045:
            vol_conf, vol_reason = 64, "High-vol regime – caution"
        elif atr_pct < 0.0018:
            vol_conf, vol_reason = 46, "Low-vol regime – cleaner"

    return [
        _sig("regime", "session", sess_dir, sess_conf, sess_reason, "regime", {"hour_utc": hour}),
        _sig("regime", "volband", vol_dir, vol_conf, vol_reason, "regime", {"atr_pct": round(atr_pct, 5)}),
    ]


def run_guardian_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    from backend.data.spot_health import spot_feed_ok
    health = md.get("health") or {}
    binance = bool(health.get("binance", True)) or spot_feed_ok(health, md)
    kalshi = bool(health.get("kalshi", True))
    src = health.get("spot_source") or md.get("spot_source")
    bn_reason = "Binance feed OK" if binance else "Binance feed DOWN"
    if binance and src:
        bn_reason = f"Spot feed OK ({src})"
    return [
        _sig("guardian", "binance_feed", "WAIT", 18 if binance else 88, bn_reason, "health", {"binance": binance, "spot_source": src}),
        _sig("guardian", "kalshi_feed", "WAIT", 18 if kalshi else 82, "Kalshi feed OK" if kalshi else "Kalshi feed DOWN", "health", {"kalshi": kalshi}),
    ]


def run_volatility_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    """Lightweight ATR / impulse micro-bots for VOLT."""
    candles = md.get("candles") or []
    if len(candles) < 20:
        return [
            _sig("volatility", "atr", "WAIT", 25, "Thin ATR history", "volatility"),
            _sig("volatility", "impulse", "WAIT", 25, "Thin impulse history", "volatility"),
        ]
    closes = [float(c["close"]) for c in candles[-30:]]
    highs = [float(c["high"]) for c in candles[-30:]]
    lows = [float(c["low"]) for c in candles[-30:]]
    trs = []
    for i in range(1, len(closes)):
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    atr = _mean(trs[-14:]) if trs else 0.0
    last = closes[-1] or 1.0
    atr_pct = atr / last
    ret5 = (closes[-1] - closes[-6]) / closes[-6] if len(closes) > 5 else 0.0

    atr_dir, atr_conf, atr_reason = "WAIT", 40, f"ATR {atr_pct*100:.2f}%"
    if atr_pct > 0.004:
        atr_dir = "UP" if ret5 > 0 else "DOWN" if ret5 < 0 else "WAIT"
        atr_conf = 52
        atr_reason = f"Elevated ATR {atr_pct*100:.2f}%"
    elif atr_pct < 0.0015:
        atr_conf = 48
        atr_reason = f"Compressed ATR {atr_pct*100:.2f}%"

    imp_dir, imp_conf, imp_reason = "WAIT", 40, "No impulse"
    if ret5 > 0.0008:
        imp_dir, imp_conf, imp_reason = "UP", min(72, 50 + int(abs(ret5) * 6000)), "Impulse up"
    elif ret5 < -0.0008:
        imp_dir, imp_conf, imp_reason = "DOWN", min(72, 50 + int(abs(ret5) * 6000)), "Impulse down"

    return [
        _sig("volatility", "atr", atr_dir, atr_conf, atr_reason, "volatility", {"atr_pct": round(atr_pct, 5)}),
        _sig("volatility", "impulse", imp_dir, imp_conf, imp_reason, "volatility", {"ret_5": round(ret5, 5)}),
    ]


def run_oi_pressure_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    funding = md.get("funding_rate")
    candles = md.get("candles") or []
    fund = float(funding) if funding is not None else 0.0
    ret3 = 0.0
    if len(candles) >= 4:
        c0 = float(candles[-1]["close"])
        c3 = float(candles[-4]["close"])
        ret3 = (c0 - c3) / c3 if c3 else 0.0

    crowd_dir, crowd_conf, crowd_reason = "WAIT", 40, "Crowd balanced"
    if fund > 0.0002:
        crowd_dir, crowd_conf, crowd_reason = "DOWN", min(70, 48 + int(fund * 20000)), "Long crowded"
    elif fund < -0.00015:
        crowd_dir, crowd_conf, crowd_reason = "UP", min(70, 48 + int(abs(fund) * 20000)), "Short crowded"

    path_dir, path_conf, path_reason = "WAIT", 40, "Path flat"
    if ret3 > 0.0005:
        path_dir, path_conf, path_reason = "UP", 52, "Short path up"
    elif ret3 < -0.0005:
        path_dir, path_conf, path_reason = "DOWN", 52, "Short path down"

    return [
        _sig("oi_pressure", "crowd", crowd_dir, crowd_conf, crowd_reason, "derivatives", {"funding": fund}),
        _sig("oi_pressure", "path", path_dir, path_conf, path_reason, "derivatives", {"ret_3": round(ret3, 5)}),
    ]


def run_streak_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    candles = md.get("candles") or []
    if len(candles) < 8:
        return [
            _sig("streak", "run", "WAIT", 25, "Thin", "microstructure"),
            _sig("streak", "fade", "WAIT", 25, "Thin", "microstructure"),
        ]
    signs = []
    for c in candles[-10:]:
        body = float(c["close"]) - float(c["open"])
        signs.append(1 if body > 0 else -1 if body < 0 else 0)
    streak = 0
    if signs and signs[-1] != 0:
        last = signs[-1]
        for s in reversed(signs):
            if s == last:
                streak += 1
            else:
                break
    run_dir = "WAIT"
    run_conf = 40
    if streak >= 3 and signs[-1] == 1:
        run_dir, run_conf = "UP", min(75, 48 + streak * 5)
    elif streak >= 3 and signs[-1] == -1:
        run_dir, run_conf = "DOWN", min(75, 48 + streak * 5)
    fade_dir, fade_conf, fade_reason = "WAIT", 40, "No fade"
    if streak >= 5:
        fade_dir = "DOWN" if signs[-1] == 1 else "UP"
        fade_conf = 48
        fade_reason = f"Stretch fade after {streak}"
    return [
        _sig("streak", "run", run_dir, run_conf, f"Run {streak}", "microstructure", {"streak": streak}),
        _sig("streak", "fade", fade_dir, fade_conf, fade_reason, "microstructure", {"streak": streak}),
    ]


def run_odds_subs(md: Dict[str, Any]) -> List[AgentSignal]:
    bid = md.get("kalshi_yes_bid")
    ask = md.get("kalshi_yes_ask")
    if bid is None and ask is None:
        return [
            _sig("odds", "mid", "WAIT", 30, "No book", "kalshi"),
            _sig("odds", "skew", "WAIT", 30, "No book", "kalshi"),
        ]
    try:
        b = float(bid) if bid is not None else None
        a = float(ask) if ask is not None else None
    except Exception:
        return [
            _sig("odds", "mid", "WAIT", 25, "Bad quotes", "kalshi"),
            _sig("odds", "skew", "WAIT", 25, "Bad quotes", "kalshi"),
        ]
    if b is not None and b > 1.5:
        b /= 100.0
    if a is not None and a > 1.5:
        a /= 100.0
    mid = ((b + a) / 2.0) if b is not None and a is not None else float(b if b is not None else a)
    mid = max(0.0, min(1.0, mid))
    mid_dir, mid_conf = "WAIT", 40
    if mid >= 0.58:
        mid_dir, mid_conf = "UP", min(78, 50 + int((mid - 0.5) * 90))
    elif mid <= 0.42:
        mid_dir, mid_conf = "DOWN", min(78, 50 + int((0.5 - mid) * 90))
    skew_dir, skew_conf = mid_dir, max(42, mid_conf - 4)
    return [
        _sig("odds", "mid", mid_dir, mid_conf, f"Mid {mid*100:.0f}%", "kalshi", {"mid": round(mid, 3)}),
        _sig("odds", "skew", skew_dir, skew_conf, f"Skew {mid*100:.0f}%", "kalshi", {"mid": round(mid, 3)}),
    ]


def run_all_subs(md: Dict[str, Any]) -> Dict[str, List[AgentSignal]]:
    from backend.agents.chair_gates import market_book_asset, pattern_specialist_name
    parent = pattern_specialist_name(market_book_asset(md) or (md or {}).get("asset"))
    candle_subs = run_candle_subs(md, parent=parent)
    return {
        parent: candle_subs,
        "candle": candle_subs,
        "volume": run_volume_subs(md),
        "momentum": run_momentum_subs(md),
        "orderflow": run_orderflow_subs(md),
        "funding": run_funding_subs(md),
        "regime": run_regime_subs(md),
        "volatility": run_volatility_subs(md),
        "oi_pressure": run_oi_pressure_subs(md),
        "streak": run_streak_subs(md),
        "odds": run_odds_subs(md),
        "guardian": run_guardian_subs(md),
    }


def synthesize_from_subs(parent_name: str, category: str, subs: List[AgentSignal], fallback: AgentSignal) -> AgentSignal:
    if not subs:
        return fallback

    try:
        from backend.agents.base import lean_side
    except Exception:
        lean_side = None  # type: ignore

    def _sub_lean(d: Any) -> Optional[str]:
        if lean_side:
            return lean_side(d)
        u = str(d or "").upper()
        if u in ("UP", "UP_HOLD", "LONG_UP"):
            return "UP"
        if u in ("DOWN", "DOWN_HOLD", "LONG_DOWN"):
            return "DOWN"
        return None

    score = 0.0
    conf_sum = 0
    for s in subs:
        conf_sum += s.confidence
        side = _sub_lean(s.direction)
        if side == "UP":
            score += s.confidence
        elif side == "DOWN":
            score -= s.confidence
    avg_conf = conf_sum / len(subs)
    abs_score = abs(score)
    # Majority alignment among non-WAIT subs (supports 2+ candle pattern bots)
    active_dirs = [_sub_lean(s.direction) for s in subs if _sub_lean(s.direction) in ("UP", "DOWN")]
    agree = False
    if len(active_dirs) >= 2:
        up_n = active_dirs.count("UP")
        down_n = active_dirs.count("DOWN")
        agree = max(up_n, down_n) >= max(2, (len(active_dirs) + 1) // 2) and (up_n != down_n)

    direction = "WAIT"
    confidence = int(avg_conf * 0.85)
    reasoning = " · ".join(s.reasoning for s in subs)

    if abs_score >= 55 or agree:
        if score > 0:
            direction = "UP"
        elif score < 0:
            direction = "DOWN"
        else:
            direction = "WAIT"
            confidence = max(fallback.confidence, int(avg_conf))
            reasoning = f"Sub-council mixed – {reasoning}"
        if direction != "WAIT":
            confidence = min(90, int(avg_conf + (10 if agree else 0) + abs_score / 12))
            reasoning = (
                f"Sub-council aligned {direction}: {reasoning}"
                if agree
                else f"Sub-council lean {direction}: {reasoning}"
            )
    elif abs_score >= 30:
        direction = "UP" if score > 0 else "DOWN"
        confidence = min(70, int(45 + abs_score / 8))
        reasoning = f"Soft sub lean {direction}: {reasoning}"
    else:
        direction = fallback.direction
        confidence = int((fallback.confidence + avg_conf) / 2)
        reasoning = (
            f"Sub-council indecisive – {fallback.reasoning}"
            if fallback.direction == "WAIT"
            else f"{fallback.reasoning} (subs soft)"
        )

    if parent_name == "regime":
        direction = "WAIT"
        confidence = int(sum(s.confidence for s in subs) / max(len(subs), 1))
        reasoning = " · ".join(s.reasoning for s in subs)
    if parent_name == "guardian":
        direction = "WAIT"
        confidence = max((s.confidence for s in subs), default=0)
        reasoning = " · ".join(s.reasoning for s in subs)

    out = AgentSignal(
        agent_name=parent_name,
        direction=direction,  # type: ignore
        confidence=confidence,
        reasoning=reasoning,
        category=category,
        features={**fallback.features, "sub_score": round(score, 1), "sub_agree": agree},
        muted=fallback.muted,
        subs=subs,
    )
    return out
