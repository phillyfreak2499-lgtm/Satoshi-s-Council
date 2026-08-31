"""
BTC 15-minute Chair brain — a full retrain, not a 1H clock change.

Official Kalshi series is KXBTC15M: one up/down book per 15m window,
settled on the 60s CFB BRTI average (same print as the series terms).
ETH now runs the same 15m clock on KXETH15M (a real Kalshi market that
did not exist when this note first said "Do not start KXETH15M"). ETH 15m
uses these same 15m timers/bands — never the old 1H copy.

Do not port 1H weights, 1H settle keys, or CoinGlass 1h features onto this
book. Displayed BTC hits for this brain start clean.

Scoring is realized paper P&L on a dual-sided path book — not one
irreversible UP/DOWN lock that matches the official settle.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

SERIES_BTC_15M = "KXBTC15M"
SERIES_BTC_1H = "KXBTCD"
SERIES_ETH_1H = "KXETHD"
SERIES_ETH_15M = "KXETH15M"  # real Kalshi 15m ETH book — the live ETH series now
WINDOW_MINUTES_15M = 15.0
WINDOW_MINUTES_1H = 60.0
BRAIN_TAG_BTC_15M = "btc15m"
BRAIN_FILE_BTC_15M = "council-learning-btc15m.json"
SEED_NAME = "council-learning-btc15m.json"

# Soft display watermark. Does not delete window_calls or ETH memory.
BTC_15M_DISPLAY_RESET_ID = "2026-08-16-btc-15m-display-reset"
BTC_15M_DISPLAY_RESET_AT = "2026-08-16T15:50:00+00:00"

# Sit rules from official KXBTC15M tape + the repo's own 15m research gates.
# First 10m of a 15m window is the 1H clock copied wrong (sits 2/3 of the book).
# Sit the first ~3m (book form) and the last ~2.5m unless leftover is huge.
EARLY_NO_LOCK_MINS_15M = 3.0
EARLY_WINDOW_MINS_15M = 4.0
LATE_WINDOW_MINS_15M = 2.5
LATE_MIN_P_15M = 0.70
LATE_MIN_EV_15M = 8.0
LATE_VOL_PCT_15M = 0.18  # 15m vol, not the 1H 0.40% figure
SCORE_BAND_LO = 20.0
SCORE_BAND_HI = 80.0
CHALK_CENTS = 99.0
MIN_EV_CENTS = 3.0
SNAPSHOT_MINS_INTO_15M = 4.0  # after the 3m sit; not the close print
CANDLE_LOOKBACK_MIN_15M = 60  # 1m bars: enough for 3/8/15 + volume, not a 1H clone
GOAL_SHORT_15M = "GOAL · process over prediction · WAIT unless confluence"
P_FINISH_COLD_N = 15

# CoinGlass 1h / 30m is the wrong timeframe for a 15m lock.
COINGLASS_SEATS_15M = ("funding", "oi_pressure", "liq")

# Quiet priors until the 15m brain has its own graded books.
BTC_15M_QUIET_CG: Dict[str, float] = {
    "funding": 0.012,
    "oi_pressure": 0.012,
    "liq": 0.012,
}

_ET = ZoneInfo("America/New_York")
_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_15M_TICK = re.compile(
    r"^KX(?:BTC|ETH)15M-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})(?:-(\d{2}))?$",
    re.I,
)
_15M_EVENT = re.compile(r"^(KX(?:BTC|ETH)15M-\d{2}[A-Z]{3}\d{6})", re.I)
_1H_BTC = re.compile(r"^KXBTCD-", re.I)
_1H_ETH = re.compile(r"^KXETHD-", re.I)


def series_ticker_of(raw: Any) -> str:
    text = str(raw or "").strip().upper()
    if text.startswith("KXBTC15M"):
        return SERIES_BTC_15M
    if text.startswith("KXBTCD"):
        return SERIES_BTC_1H
    if text.startswith("KXETHD") or text.startswith("KXETH15M"):
        return SERIES_ETH_1H if text.startswith("KXETHD") else "KXETH15M"
    if "SERIES_TICKER" in text:
        return text
    return text


def is_btc_15m_ticker(ticker: Any) -> bool:
    text = str(ticker or "").strip().upper()
    return text.startswith("KXBTC15M")


def is_btc_1h_ticker(ticker: Any) -> bool:
    return bool(_1H_BTC.match(str(ticker or "").strip()))


def is_eth_1h_ticker(ticker: Any) -> bool:
    return bool(_1H_ETH.match(str(ticker or "").strip()))


def is_eth_15m_ticker(ticker: Any) -> bool:
    return str(ticker or "").strip().upper().startswith("KXETH15M")


def is_btc_15m_series(series: Any) -> bool:
    return str(series or "").strip().upper() == SERIES_BTC_15M


def is_15m_window(
    window_minutes: Any = None,
    ticker: Any = None,
    series: Any = None,
    asset: Any = None,
) -> bool:
    """BTC Chair is 15m unless the ticker is the old hourly KXBTCD book. ETH stays 1H."""
    if is_eth_1h_ticker(ticker) or is_eth_15m_ticker(ticker):
        return is_eth_15m_ticker(ticker)
    if is_btc_15m_ticker(ticker) or is_btc_15m_series(series):
        return True
    if is_btc_1h_ticker(ticker):
        return False
    a = str(asset or "").strip().lower()
    if a in ("eth", "ethereum"):
        return False
    if a in ("btc", "bitcoin", "btc15m"):
        return True
    try:
        mins = float(window_minutes)
    except (TypeError, ValueError):
        return False
    return 10.0 <= mins <= 20.0


def window_minutes_for(
    *,
    asset: Any = None,
    ticker: Any = None,
    series: Any = None,
    open_time: Any = None,
    close_time: Any = None,
    fallback: float | None = None,
) -> float:
    if is_btc_15m_ticker(ticker) or is_btc_15m_series(series):
        return WINDOW_MINUTES_15M
    if is_eth_15m_ticker(ticker):
        # ETH now runs the 15m KXETH15M book on the same clock as BTC.
        return WINDOW_MINUTES_15M
    a = str(asset or "").strip().lower()
    if a in ("btc", "bitcoin") and not is_btc_1h_ticker(ticker):
        if series is None or is_btc_15m_series(series):
            return WINDOW_MINUTES_15M
    if fallback is not None:
        try:
            return float(fallback)
        except (TypeError, ValueError):
            pass
    return WINDOW_MINUTES_1H


def series_for_live_asset(asset: Any) -> str:
    a = str(asset or "btc").strip().lower()
    if a in ("eth", "ethereum"):
        return SERIES_ETH_15M
    return SERIES_BTC_15M


def learner_brain_tag(asset: Any) -> str:
    a = str(asset or "btc").strip().lower()
    if a in ("eth", "ethereum"):
        return "eth"
    if a in ("btc", "bitcoin", "btc15m"):
        return BRAIN_TAG_BTC_15M
    return a or BRAIN_TAG_BTC_15M


def event_ticker_from_15m(ticker: Any) -> Optional[str]:
    text = str(ticker or "").strip()
    if not text:
        return None
    m = _15M_EVENT.match(text)
    if m:
        return m.group(1).upper()
    if text.upper().startswith(("KXBTC15M-", "KXETH15M-")) and text.count("-") >= 1:
        parts = text.split("-")
        if len(parts) >= 2:
            return f"{parts[0].upper()}-{parts[1].upper()}"
    return None


def close_time_from_15m_ticker(ticker: Any) -> Optional[datetime]:
    """
    KXBTC15M-26AUG161200-00 → 12:00 America/New_York on 2026-08-16.
    That is the official 15m close (16:00 UTC while EDT).
    """
    m = _15M_TICK.match(str(ticker or "").strip())
    if not m:
        return None
    yy, mon, dd, hh, mm = m.group(1), m.group(2).upper(), m.group(3), m.group(4), m.group(5)
    month = _MONTHS.get(mon)
    if month is None:
        return None
    try:
        local = datetime(
            2000 + int(yy), month, int(dd), int(hh), int(mm), 0,
            tzinfo=_ET,
        )
        return local.astimezone(timezone.utc)
    except Exception:
        return None


def event_ticker_for_15m_close(close_et: datetime) -> str:
    local = close_et.astimezone(_ET)
    mon = local.strftime("%b").upper()
    return f"{SERIES_BTC_15M}-{local.strftime('%y')}{mon}{local.strftime('%d%H%M')}"


def playable_band_cents_for(
    *,
    asset: Any = None,
    ticker: Any = None,
    series: Any = None,
    window_minutes: Any = None,
) -> Tuple[float, float]:
    """15m BTC locks and scores 20–80 after vig. ETH 1H stays 10–90."""
    if is_15m_window(window_minutes, ticker, series, asset) and not is_eth_1h_ticker(ticker):
        if str(asset or "btc").lower() in ("btc", "bitcoin", "btc15m", ""):
            return SCORE_BAND_LO, SCORE_BAND_HI
        if is_btc_15m_ticker(ticker) or is_btc_15m_series(series):
            return SCORE_BAND_LO, SCORE_BAND_HI
    try:
        from backend.config import settings
        lo = float(getattr(settings, "PLAYABLE_MID_MIN", 10.0))
        hi = float(getattr(settings, "PLAYABLE_MID_MAX", 90.0))
        return lo, hi
    except Exception:
        return 10.0, 90.0


def early_no_lock_mins_for(
    *,
    window_minutes: Any = None,
    ticker: Any = None,
    series: Any = None,
    asset: Any = None,
) -> float:
    if is_15m_window(window_minutes, ticker, series, asset) and (
        is_btc_15m_ticker(ticker) or is_btc_15m_series(series)
        or is_eth_15m_ticker(ticker)
        or str(asset or "").lower() in ("btc", "bitcoin", "btc15m", "")
    ):
        return EARLY_NO_LOCK_MINS_15M
    try:
        from backend.config import settings
        return float(getattr(settings, "EARLY_NO_LOCK_MINS", 10.0))
    except Exception:
        return 10.0


def timeframe_gates(
    *,
    window_minutes: Any = None,
    ticker: Any = None,
    series: Any = None,
    asset: Any = None,
) -> Dict[str, float]:
    """Per-book timers. Never copy 1H first-10 / last-15 onto a 15m book."""
    fifteen = is_15m_window(window_minutes, ticker, series, asset) and not is_eth_1h_ticker(ticker)
    if fifteen and (
        is_btc_15m_ticker(ticker)
        or is_btc_15m_series(series)
        or is_eth_15m_ticker(ticker)
        or str(asset or "btc").lower() in ("btc", "bitcoin", "btc15m", "")
    ):
        return {
            "window_minutes": WINDOW_MINUTES_15M,
            "early_no_lock_mins": EARLY_NO_LOCK_MINS_15M,
            "early_window_mins": EARLY_WINDOW_MINS_15M,
            "late_window_mins": LATE_WINDOW_MINS_15M,
            "late_min_p": LATE_MIN_P_15M,
            "late_min_ev": LATE_MIN_EV_15M,
            "late_vol_pct": LATE_VOL_PCT_15M,
            "band_lo": SCORE_BAND_LO,
            "band_hi": SCORE_BAND_HI,
            "min_ev": MIN_EV_CENTS,
        }
    try:
        from backend.config import settings
        return {
            "window_minutes": float(window_minutes or WINDOW_MINUTES_1H),
            "early_no_lock_mins": float(getattr(settings, "EARLY_NO_LOCK_MINS", 10.0)),
            "early_window_mins": float(getattr(settings, "EARLY_WINDOW_MINS", 20.0)),
            "late_window_mins": float(getattr(settings, "LATE_WINDOW_MINS", 15.0)),
            "late_min_p": float(getattr(settings, "LATE_MIN_P_FINISH", 0.70)),
            "late_min_ev": float(getattr(settings, "LATE_MIN_EV_CENTS", 8.0)),
            "late_vol_pct": float(getattr(settings, "LATE_HOURLY_VOL_PCT", 0.40)),
            "band_lo": float(getattr(settings, "PLAYABLE_MID_MIN", 10.0)),
            "band_hi": float(getattr(settings, "PLAYABLE_MID_MAX", 90.0)),
            "min_ev": float(getattr(settings, "MIN_EV_CENTS", 3.0)),
        }
    except Exception:
        return {
            "window_minutes": WINDOW_MINUTES_1H,
            "early_no_lock_mins": 10.0,
            "early_window_mins": 20.0,
            "late_window_mins": 15.0,
            "late_min_p": 0.70,
            "late_min_ev": 8.0,
            "late_vol_pct": 0.40,
            "band_lo": 10.0,
            "band_hi": 90.0,
            "min_ev": 3.0,
        }


def _cents(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v <= 1.0:
        v *= 100.0
    return max(0.0, min(100.0, v))


def paper_lock_score_skip(
    *,
    ticker: Any = None,
    open_price: Any = None,
    side_ask: Any = None,
    direction: Any = None,
) -> Optional[str]:
    """
    Open-gate only for 15m BTC: do not open 99¢ chalk or odds outside 20–80.
    Not the training win. Path P&L grades realized paper dollars.
    ETH 1H is untouched (returns None).
    """
    if not is_btc_15m_ticker(ticker):
        return None
    side = str(direction or "").strip().upper()
    if side in ("WAIT", ""):
        return "wait_skip"
    px = _cents(open_price)
    if px is None:
        px = _cents(side_ask)
    if px is None:
        return "no_entry_odds"
    if px >= CHALK_CENTS or px <= (100.0 - CHALK_CENTS):
        return "chalk_skip"
    if px < SCORE_BAND_LO or px > SCORE_BAND_HI:
        return "band_skip"
    return None


def coinglass_allowed_on_book(
    *,
    ticker: Any = None,
    series: Any = None,
    window_minutes: Any = None,
    asset: Any = None,
) -> bool:
    """CoinGlass 1h/30m is the wrong timeframe for any 15m lock (BTC or ETH)."""
    if is_btc_15m_ticker(ticker) or is_btc_15m_series(series) or is_eth_15m_ticker(ticker):
        return False
    if is_15m_window(window_minutes, ticker, series, asset) and str(asset or "btc").lower() in (
        "btc", "bitcoin", "btc15m", "",
    ):
        return False
    return True


def is_15m_btc_book(market_data: Any = None) -> bool:
    md = market_data if isinstance(market_data, dict) else {}
    return is_15m_window(
        md.get("window_minutes"),
        md.get("ticker") or md.get("kalshi_ticker") or (md.get("kalshi_market") or {}).get("ticker"),
        md.get("series_ticker"),
        md.get("asset"),
    ) and not is_eth_1h_ticker(md.get("ticker") or md.get("kalshi_ticker"))


def goal_short_for(
    *,
    asset: Any = None,
    ticker: Any = None,
    series: Any = None,
    window_minutes: Any = None,
    market_data: Any = None,
) -> str:
    if market_data is not None and is_15m_btc_book(market_data):
        return GOAL_SHORT_15M
    if is_15m_window(window_minutes, ticker, series, asset) and not is_eth_1h_ticker(ticker):
        if str(asset or "btc").lower() in ("btc", "bitcoin", "btc15m", ""):
            return GOAL_SHORT_15M
    from backend.agents.base import ETH_GOAL_CONTRACT_SHORT
    return ETH_GOAL_CONTRACT_SHORT


def momentum_horizons_15m() -> Dict[str, Any]:
    """3m / 8m / 15m — not the 1H 5/15/30 stack."""
    return {
        "bars": (3, 8, 15),
        "full_ret": 0.0008,
        "partial_ret": 0.0004,
        "label": "3/8/15",
    }


def exhaust_thresholds_15m() -> Dict[str, float]:
    """Fade a 15m extension when the last 3m flips. Do not use the 1H 0.9% run."""
    return {
        "run_pct": 0.22,
        "flip_pct": 0.06,
        "run_bars": 15,
        "flip_bars": 3,
    }


def window_label(
    window_minutes: Any = None,
    ticker: Any = None,
    series: Any = None,
    asset: Any = None,
) -> str:
    if is_15m_window(window_minutes, ticker, series, asset) and not is_eth_1h_ticker(ticker):
        return "15M WINDOW"
    return "1H WINDOW"
