"""
Satoshi’s Council – Configuration
Dual-table: Bitcoin 15m (Satoshi) + Ethereum 15m (Vitalik).
Both run a full 15m retrain — BTC on KXBTC15M, ETH on KXETH15M.
ETH moved off hourly KXETHD once a real 15m ETH market existed + BTC 15m settled.
Tuned for Render ~2 CPU / 4 GB — responsive dual without thrashing.
"""
from pydantic_settings import BaseSettings
from pydantic import ConfigDict
from typing import Dict
import os
from pathlib import Path


def _load_dotenv_into_environ() -> None:
    """
    Put .env values into os.environ for local runs.

    Settings(env_file=".env") only populates *this model's* fields. The
    secrets (COUNCIL_ADMIN_PASSWORD, COUNCIL_ACCESS_PASSWORD, FOLLOWER_
    PASSWORD_2/3, COINGLASS_API_KEY) are read by backend.data.secrets
    straight from os.environ and are not Settings fields, so without this
    a .env file would silently do nothing for them.

    Real environment variables always win — on Render the dashboard values
    are already in os.environ and this is a no-op.
    """
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    try:
        from dotenv import dotenv_values
    except ImportError:
        return
    try:
        for key, val in dotenv_values(env_path).items():
            if val is not None and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


_load_dotenv_into_environ()


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Satoshi’s Council"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Dual-table flags
    ENABLE_ETH_TABLE: bool = True
    DUAL_SEQUENTIAL: bool = True  # analyze BTC then ETH (recommended)

    # Council → engine gate. When the Round Table does not reach confluence,
    # optionally hold the trade engine back. "off" = advisory only (the council
    # decision is attached for measurement but never changes trades — safe
    # default). "hard" = force WAIT and drop NEW directional path legs on a
    # council stand-down (existing legs still cut/flip normally).
    COUNCIL_GATE_MODE: str = "off"  # off | hard

    # Data sources — BTC 15m + ETH hourly
    BINANCE_FUTURES_BASE: str = "https://fapi.binance.com"
    KALSHI_BASE: str = "https://external-api.kalshi.com/trade-api/v2"
    # Legacy single-table defaults (BTC 15m brain)
    SERIES_TICKER: str = "KXBTC15M"
    SYMBOL: str = "BTCUSDT"
    # Explicit per-table. ETH now runs the real 15m KXETH15M book (was KXETHD).
    SERIES_BTC: str = "KXBTC15M"
    SERIES_BTC_1H: str = "KXBTCD"
    SERIES_ETH: str = "KXETH15M"
    SYMBOL_BTC: str = "BTCUSDT"
    SYMBOL_ETH: str = "ETHUSDT"

    # Polling / analysis cadence — dual hourly on 2 CPU / 4 GB
    ANALYSIS_INTERVAL: float = 2.0          # fallback / single-table
    ANALYSIS_INTERVAL_BTC: float = 2.0
    ANALYSIS_INTERVAL_ETH: float = 2.0
    # Adaptive cadence (quality > frequency)
    ADAPTIVE_INTERVAL: bool = True
    ANALYSIS_INTERVAL_QUIET: float = 3.5   # both WAIT + calm
    ANALYSIS_INTERVAL_ACTIVE: float = 2.0  # near lock / late hour

    HTTP_TIMEOUT: float = 4.0
    KLINE_LIMIT: int = 90
    ANALYSIS_INTERVAL_FLAT: float = 3.5
    ANALYSIS_INTERVAL_HOT: float = 1.5
    BEAST_MODE: bool = False                # dual default: balanced, not max burn
    DUAL_SPOT: bool = True
    PARALLEL_AGENTS: bool = True
    PARALLEL_AGENT_LIMIT: int = 5           # cap concurrency per table
    KALSHI_MAX_QUOTE_AGE_S: float = 25.0  # no ENTRY lock if quote older than this
    KALSHI_ORDERBOOK_EVERY: int = 4
    KALSHI_ORDERBOOK_DEPTH: int = 10  # ask Kalshi for sized levels (orderbook_fp)
    SLOW_METRICS_TTL: float = 45.0

    # Agent base weights (sum ~1.0, Leader normalizes). Expanded roster for 15m factors.
    BASE_WEIGHTS: Dict[str, float] = {
        "candle": 0.10,          # legacy Pattern Seer — remapped on load
        "candle_btc": 0.10,      # Bitcoin Pattern Specialist (WICK)
        "candle_eth": 0.07,      # Ethereum Pattern Specialist — own prior, not a BTC clone
        "volume": 0.07,
        "momentum": 0.07,
        "orderflow": 0.06,
        "funding": 0.06,
        "regime": 0.05,
        "volatility": 0.07,
        "oi_pressure": 0.06,
        "streak": 0.06,
        "odds": 0.09,
        "strike": 0.11,
        "session_tod": 0.07,
        "whale": 0.08,
        "quorum": 0.07,
        "panic": 0.12,      # research: panic_fade dominant on KXBTC15M
        "cheap": 0.10,      # buy soft side / recovery
        "spotlag": 0.10,    # CEX velocity vs Kalshi lag
        "exhaust": 0.09,    # fade after 1h run + 5m flip
        "guardian": 0.02,  # health only
    }

    # Top-N ranks must agree for a FULL call; else HOLD/WAIT
    TOP_N_AGREEMENT: int = 3
    # After a path-hit win, block same-direction re-call for this many seconds
    POST_HIT_COOLDOWN_SEC: float = 75.0   # shorter so scalps can re-enter faster
    # After a miss, require higher confluence for this many seconds
    POST_MISS_PENALTY_SEC: float = 180.0
    POST_MISS_CONFLUENCE_BUMP: float = 0.12
    # Flip penalty: opposite-side re-entry is expensive
    FLIP_MIN_GAP_SEC: float = 150.0
    FLIP_CONFLUENCE_BUMP: float = 0.15

    # Nightly huddle (3:00–3:15 AM CT)
    HUDDLE_REBUILD_LIMIT: int = 400

    # Hierarchy: how hard the Chair listens by rank (1 = top)
    # Rank 1 gets full weight; each step down multiplies listen factor.
    RANK_LISTEN_DECAY: float = 0.82
    RANK_MIN_LISTEN: float = 0.12
    # Extra mute when win-rate is bad with enough samples
    HIERARCHY_MUTE_WR: float = 0.42
    HIERARCHY_MUTE_MIN_N: int = 8
    HIERARCHY_MUTE_FACTOR: float = 0.35
    # Conditional fade: reliably wrong bots contribute the OPPOSITE direction
    FADE_MIN_N: int = 20                 # need this many graded calls
    FADE_WR_THRESHOLD: float = 0.40      # invert when WR below this (tightened)
    FADE_FULL_AT_WR: float = 0.28        # full fade strength at/below this WR
    FADE_MAX_WEIGHT_SHARE: float = 0.10  # inverted bots can't dominate score (was 0.18)
    # Hard mute: chronic losers with enough samples get almost zero voice
    HARD_MUTE_MIN_N: int = 40
    HARD_MUTE_WR: float = 0.40           # WR below this + enough samples → near-zero listen
    HARD_MUTE_LISTEN: float = 0.04       # residual listen so invert can still matter slightly
    # Near-certain learning: do not fully train on freebies
    NEAR_CERTAIN_LEARN_CREDIT: float = 0.25   # 25% weight update when entry was already high
    NEAR_CERTAIN_ENTRY_BAR: float = 88.0      # open_price >= this → reduced credit
    # Anti-correlated pairs: when two bots disagree, boost historically stronger side
    ANTI_MIN_TRIES: int = 15
    ANTI_WIN_RATE: float = 0.62
    ANTI_MAX_BONUS: float = 0.12
    ANTI_SOFT_FADE: float = 0.55  # scale down weaker side of active anti-pair

    # Leader confluence / WAIT bias (base). Adaptive Chair loosens as lifetime edge proves out.
    # Loosened for more scalp calls — lower bars = the Chair leans more often.
    MIN_CONFLUENCE_SCORE: float = 0.36          # start loose — learn by calling, then tighten
    MIN_DIRECTIONAL_CONFIDENCE: int = 46        # start loose conf floor; edge adapts up/down
    CROSS_CATEGORY_BONUS: float = 0.12          # extra weight when different categories agree
    WAIT_DEFAULT_CONFIDENCE: int = 72
    # 1/4 HOLD scalp band — weaker confluence still produces a partial call
    HOLD_CONFLUENCE_RATIO: float = 0.40         # easier 1/4 HOLD early for more scalp samples
    HOLD_CONFIDENCE_FLOOR: int = 40
    # Adaptive anti-WAIT bounds
    CONFLUENCE_FLOOR: float = 0.24              # never more aggressive than this
    CONFLUENCE_CEILING: float = 0.72            # tighten hard if recent edge is bad
    DIR_CONF_FLOOR: int = 40
    DIR_CONF_CEILING: int = 68
    ADAPT_WAIT_MIN_SAMPLES: int = 8             # start adapting sooner
    # Cold-start: even looser for first N settles so hierarchy gets data fast
    COLD_START_SAMPLES: int = 15
    COLD_START_CONFLUENCE: float = 0.30
    COLD_START_DIR_CONF: int = 42

    # Scalp path grading on KALSHI odds (percentage points), not BTC $
    # Full UP/DOWN: Kalshi side moves >= PATH_WIN_PCT pts after entry
    # 1/4 HOLD: Kalshi side moves >= PATH_WIN_PCT * HOLD_FRACTION pts
    # Path scalp target (Kalshi percentage points). 7 is more realistic than 10 for 15m.
    PATH_WIN_PCT: float = 7.0
    # Partial credit: path >= this but < PATH_WIN_PCT → still a win (smaller paper $)
    PATH_PARTIAL_PCT: float = 4.0
    # Near-certain: entry or peak side >= this → auto-win (90→100 rule)
    PATH_NEAR_CERTAIN_PCT: float = 90.0
    # Research-backed seats
    PANIC_THRESHOLD_PTS: float = 4.0      # Kalshi mid pts in ~30–60s to trigger fade
    CHEAP_SIDE_MAX: float = 42.0          # ≤ this ¢ = "cheap" side
    CHEAP_FAIR_BAND: float = 8.0
    SPOTLAG_BPS: float = 8.0              # spot move in bps to follow
    EXHAUST_1H_PCT: float = 0.9
    EXHAUST_5M_FLIP: float = 0.12
    EXHAUST_YES_HIGH: float = 68.0
    EXHAUST_YES_LOW: float = 32.0
    # Chair gates from research — time-in-window is highest-ROI accuracy lever
    LATE_WINDOW_MIN: float = 2.8          # last ~3 min: force high bar / mostly WAIT
    EARLY_WINDOW_MIN: float = 55.0        # first ~5m of hourly window: force high bar
    HARD_EARLY_MIN: float = 13.7          # > this mins left → near-hard WAIT (noise)
    HARD_LATE_MIN: float = 2.2           # < this mins left → near-hard WAIT (no path left)
    MID_WINDOW_BOOST: float = 0.10        # stronger loosen in 4–10m sweet spot
    EARLY_DAMPEN: float = 0.78           # aggressiveness multiplier early
    LATE_DAMPEN: float = 0.72            # aggressiveness multiplier late
    HARD_ZONE_DAMPEN: float = 0.55       # extreme dampen in hard do-nothing zones
    SPREAD_MAX_CENTS: float = 6.0         # if bid-ask wider → WAIT bias
    # Paper trading journal (not real execution)
    PAPER_STAKE_DEFAULT: float = 25.0          # hard-max clamp + ETH 1H flat ticket
    PAPER_STAKE_HOLD: float = 10.0             # $ per 1/4 HOLD call (ETH / legacy)
    # BTC 15m Chair path book uses size_for_leader(). These are clamps, not targets.
    DYNAMIC_SIZING: bool = True
    DYNAMIC_SIZING_MIN: float = 5.0
    DYNAMIC_SIZING_MAX: float = 25.0
    DYNAMIC_SIZING_UNIT: float = 10.0
    # Path-scaled scalp P&L (not full binary settlement)
    PAPER_USE_KALSHI_PAYOFF: bool = False
    PAPER_PATH_SCALED: bool = True
    HOLD_FRACTION: float = 0.25
    MIN_CALL_REENTRY_SEC: float = 60.0   # loosened so the desk can call more often
    # ETH 1H only. BTC 15m path book ignores this — no irreversible one-call lock.
    # Same-side refresh does not count as a new ETH call; opposite revisions disabled when =1.
    MAX_CALLS_PER_WINDOW: int = 1
    CALL_MAX_AGE_SEC: float = 15 * 60  # BTC 15m window (ETH uses 1H via window_minutes)
    # Only lock a directional call when the chosen side’s Kalshi mid is under this %.
    # Protects edge / best-odds rule (never lock into near-certain low-payout markets).
    MAX_ENTRY_ODDS_PCT: float = 90.0
    # Soft preferred label only. Paper playable band is 10–90¢ + leftover after vig.
    # Do NOT shrink the hard band to 45–55. Council shadow 45–60 is diagnostic.
    # 99¢ / 1¢ wall stays a hard no. Does not loosen Follower / live gates.
    PREFERRED_ENTRY_ODDS_MIN: float = 40.0
    PREFERRED_ENTRY_ODDS_MAX: float = 65.0
    NEVER_LOCK_CENTS: float = 99.0           # never lock ≥99¢ / one-sided 100¢
    # Next-layer edge gates
    ANTI_CHASE_PTS: float = 3.0          # if side mid jumped this many ¢ recently → WAIT (don't lock the jump)
    ANTI_CHASE_LOOKBACK_S: float = 90.0
    MAX_SPREAD_CENTS: float = 5.0        # no ENTRY if bid-ask wider than this
    TWO_STAGE_HOLD_S: float = 12.0       # lean must hold this long before hard LOCK
    DUAL_CORRELATION_VETO: bool = True   # demote weaker table when both lean same weakly
    # P(finish) + EV gate (paper pricing only — never a live order)
    MIN_P_FINISH: float = 0.55
    MIN_EV_CENTS: float = 3.0
    # ETH 1H: no lock first 10 minutes of the hour.
    # BTC 15m uses EARLY_NO_LOCK_MINS_15M in backend.learning.btc15m (3m, not 10m).
    EARLY_NO_LOCK_MINS: float = 10.0
    PLAYABLE_MID_MIN: float = 10.0  # Zach hard band — two-sided, not 45–55
    PLAYABLE_MID_MAX: float = 90.0  # 10–90 does not drop EV ≥ 0 after half-spread
    LATE_HOURLY_VOL_PCT: float = 0.40
    P_FINISH_COLD_N: int = 15
    P_FINISH_WARM_N: int = 40
    CHAIR_HOT_BIN: float = 90.0
    CHAIR_HOT_BIN_MIN_N: int = 15  # fade 90%+ until this many actually settled hours
    ETH_RELIABILITY_MIN_N: int = 8  # no ETH paper lock until this many finish-graded ETH hours
    # Explore paper locks (PAPER only — never arm Follower / live)
    EXPLORE_RELIABILITY_N: int = 20  # explore path while reliability_n < this
    EXPLORE_PAPER_MIN_P: float = 0.55
    EXPLORE_PAPER_MIN_EV: float = 0.0  # EV ≥ 0 after half-spread
    PAPER_LOCKS_PER_DAY: int = 5  # a few paper locks, not 20/day, not 1/48h
    BTC_LEAD_IMPULSE_PCT: float = 0.15
    BTC_LEAD_STRONG_PCT: float = 0.25
    # Official Kalshi hourly settle: 60s CFB BRTI / ETHUSD_RTI (ERTI) average
    CFB_INDEX_BTC: str = "BRTI"
    CFB_INDEX_ETH: str = "ETHUSD_RTI"
    # CoinGlass v4 — key from env or /etc/secrets/COINGLASS_API_KEY (never in git)
    # Startup: try 30m then 1h (never 1m). Funding is an 8h clock (display only).
    COINGLASS_BASE: str = "https://open-api-v4.coinglass.com"
    COINGLASS_EXCHANGE: str = "Binance"
    COINGLASS_INTERVAL: str = "30m"
    COINGLASS_TTL: float = 60.0
    # Top-of-book depth: known thin size → WAIT (spread still hard-gated above)
    MIN_BOOK_SIZE: float = 5.0
    # Time-to-expiry EV hurdles (hourly official window)
    EARLY_WINDOW_MINS: float = 20.0      # first ~20 min → patient
    LATE_WINDOW_MINS: float = 15.0       # last ~15 min → strong misprice only
    EARLY_EV_MULT: float = 1.5
    LATE_MIN_P_FINISH: float = 0.70
    LATE_MIN_EV_CENTS: float = 8.0
    # Odds-band calibration: tighten the band that loses money
    CALIB_BAND_MIN_N: int = 8
    CALIB_MISS_GAP: float = 0.08
    CALIB_P_TIGHTEN: float = 0.05
    CALIB_EV_TIGHTEN: float = 2.0

    # Hourly timing (minutes left)
    HOURLY_HARD_EARLY_MIN: float = 45.0   # very early → strong WAIT
    HOURLY_EARLY_MIN: float = 35.0
    HOURLY_LATE_MIN: float = 20.0
    HOURLY_HARD_LATE_MIN: float = 8.0
    # ETH uses a thinner specialist set. Append VOLT + EXHAUST only — not ORBIT/STREAK/VEL/WIRE.
    ETH_CORE_AGENTS: str = "candle_eth,volume,momentum,orderflow,odds,strike,session_tod,quorum,cheap,panic,whale,funding,oi_pressure,liq,volatility,exhaust"
    # ETH-only priors for the new seats. Not Satoshi's BTC BASE_WEIGHTS (0.07 / 0.09).
    # Stay quiet until each seat has its own graded ETH hours.
    ETH_QUIET_PRIORS: Dict[str, float] = {
        "volatility": 0.018,
        "exhaust": 0.016,
        "candle_eth": 0.022,  # Ethereum Pattern Specialist — not a copy of BTC 0.10
    }

    # Side Table arcade — paper default, never Follower, never auto-bets
    SIDE_TABLE_MAX_STAKE: float = 25.0
    SIDE_TABLE_HOURLY_LOSS_CAP: float = 75.0
    SIDE_TABLE_LIVE: bool = False
    SIDE_TABLE_KILL: bool = False
    SIDE_TABLE_ARM_DELAY_S: float = 8.0
    SIDE_TABLE_CUTOFF_SEC: float = 60.0
    SIDE_TABLE_ARM_PHRASE: str = "LIVE SIDE TABLE"

    # THE FRONT — daily highs. Paper default. Never Follower. Never auto-bets.
    FRONT_MAX_STAKE: float = 25.0
    FRONT_DAILY_LOSS_CAP: float = 50.0
    FRONT_LIVE: bool = False
    FRONT_KILL: bool = False
    FRONT_ARM_DELAY_S: float = 8.0
    FRONT_ARM_PHRASE: str = "LIVE THE FRONT"

    # Quiet-period directional confidence floor (used by Leader adaptive path)
    QUIET_MIN_DIRECTIONAL_CONF: int = 80


    # Learning
    REWEIGHT_EVERY_N_SIGNALS: int = 40
    ROLLING_WINDOW: int = 80
    MAX_WEIGHT: float = 0.28
    MIN_WEIGHT: float = 0.04
    LEARNING_RATE: float = 0.11
    # Regime-split weights: share of local regime weight when samples exist
    REGIME_WEIGHT_BLEND: float = 0.55
    REGIME_MIN_SAMPLES: int = 4                 # stronger continuous learning
    LEARNING_RATE_COLD: float = 0.16            # faster weight moves while collecting samples
    # Continuous improvement — longer run = stronger
    RECENT_FORM_WINDOW: int = 20               # last N agent grades for form factor
    RECENT_FORM_BLEND: float = 0.35            # how hard recent form pulls weight vs lifetime
    EXPLOIT_SAMPLES: int = 80                  # after this many Chair grades → exploit phase
    CALIBRATE_SAMPLES: int = 20               # after cold → calibrate until exploit
    LEARN_SAVE_EVERY: int = 1                 # persist brain every N learn batches
    WEIGHT_MOMENTUM: float = 0.08             # inertia so one fluke doesn't yank ranks

    # Regime aggressiveness
    HIGH_VOL_THRESHOLD: float = 0.0045          # ~0.45% ATR-like on 1m scale
    LOW_EDGE_HOURS_UTC: list = [3, 4, 5, 6, 7]  # example low activity

    # Storage — on Render attach a disk and set DATABASE_URL to that path
    # On Render: mount disk at /opt/render/project/src/data and set DATA_DIR
    DATA_DIR: str = os.environ.get("DATA_DIR", "./data")
    DATABASE_URL: str = os.environ.get(
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{os.path.join(os.environ.get('DATA_DIR', './data'), 'council.db')}",
    )

    # Optional keys (not required for public data)
    KALSHI_API_KEY: str = ""
    KALSHI_PRIVATE_KEY_PATH: str = ""

    # CORS — comma-separated; * ok for paper dashboard
    CORS_ORIGINS: str = "*"

    # Free personal-workspace journal cap; membership unlocks full history.
    FREE_JOURNAL_LIMIT: int = 10

    model_config = ConfigDict(
        env_file=".env",
        extra="ignore",
    )


settings = Settings()


def eth_core_agent_set() -> set:
    raw = str(getattr(settings, "ETH_CORE_AGENTS", "") or "")
    core = {x.strip().lower() for x in raw.split(",") if x.strip()}
    core |= {"guardian", "law"}
    return core


def prior_weight(asset: str, name: str) -> float:
    """Per-table prior. ETH VOLT/EXHAUST use quiet ETH numbers, not Satoshi's."""
    asset = (asset or "btc").lower()
    name = (name or "").lower()
    if asset == "eth":
        quiet = getattr(settings, "ETH_QUIET_PRIORS", None) or {}
        if name in quiet:
            return float(quiet[name])
    if asset in ("btc", "btc15m", "bitcoin"):
        from backend.learning.btc15m import BTC_15M_QUIET_CG
        if name in BTC_15M_QUIET_CG:
            return float(BTC_15M_QUIET_CG[name])
    return float(settings.BASE_WEIGHTS.get(name, 0.1))


def effective(section: str, key: str, fallback: float | int | bool | str | None = None):
    """Prefer runtime Settings-tab knobs, else static Settings defaults."""
    try:
        from backend.services.runtime_settings import runtime_settings
        return runtime_settings.knobs(section, key, fallback)
    except Exception:
        return fallback
