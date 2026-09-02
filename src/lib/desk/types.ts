export type Lean = "UP" | "DOWN" | "WAIT";
export type Phase = "ENTRY" | "MID" | "FINAL";
export type FeedHealth = "LIVE" | "STALE" | "DOWN";
export type SkillStatus = "SHADOW" | "LIVE" | "BENCH" | "CANDIDATE";
export type CmpOp = "gte" | "lte" | "gt" | "lt" | "eq" | "neq" | "abs_gte" | "abs_lte";
export type Pred = {
  feat: string;
  op: CmpOp;
  value?: number | string | boolean;
  thresh?: string;
};
export type SkillRule = {
  all?: Pred[];
  any?: Pred[];
  none?: Pred[];
  lean: string;
  edge?: string;
  cap?: number;
};
export type FeatMap = Record<string, number>;
export type ThreshUse = { id: string; x: number; t: number };
export type ThreshPocket = { value: number; samples: { x: number; hit: number }[] };
export type ThreshState = { value: number; by_regime: Record<string, ThreshPocket> };
export type ThreshBook = Record<string, ThreshState>;
export type SeatStatus =
  | "LIVE"
  | "MUTED"
  | "FADED"
  | "INVERT"
  | "FOLDED"
  | "VETO"
  | "DOWN"
  | "UNCALIBRATED";
export type DataSource = "demo" | "live";
export type LearnPhase = "EXPLORE" | "CALIBRATE" | "EXPLOIT";
export type SessionName = "ASIA" | "EUROPE" | "US_AM" | "US_PM";
export type TabId =
  | "satoshi"
  | "structure"
  | "tape"
  | "derivs"
  | "book"
  | "context"
  | "settings";

export type SeatId =
  | "WICK"
  | "DRIFT"
  | "STREAK"
  | "EXHAUST"
  | "PULSE"
  | "TAPE"
  | "WHALE"
  | "VEL"
  | "CARRY"
  | "CHAIN"
  | "CASCADE"
  | "VOLT"
  | "ODDS"
  | "STRIKE"
  | "CHEAP"
  | "FADE"
  | "ORBIT"
  | "CLOCK"
  | "WIRE"
  | "WARDEN";

export const SEAT_IDS: SeatId[] = [
  "WICK",
  "DRIFT",
  "STREAK",
  "EXHAUST",
  "PULSE",
  "TAPE",
  "WHALE",
  "VEL",
  "CARRY",
  "CHAIN",
  "CASCADE",
  "VOLT",
  "ODDS",
  "STRIKE",
  "CHEAP",
  "FADE",
  "ORBIT",
  "CLOCK",
  "WIRE",
  "WARDEN",
];

export type SeatTab = "structure" | "tape" | "derivs" | "book" | "context";

export type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

export type HealthMap = {
  spot_ok: boolean;
  kalshi_ok: boolean;
  derivs_ok: boolean;
  derivs_source: string;
  spot: FeedHealth;
  kalshi: FeedHealth;
  derivs: FeedHealth;
};

export type WindowMemory = {
  prior_settles: Lean[];
  path_since_entry: number[];
  streak_n: number;
  streak_side: Lean | null;
  entry_spot: number;
  entry_lean: Lean | null;
};

export type Snapshot = {
  as_of: number;
  phase: Phase;
  mins_left: number;
  secs_left: number;
  close_time: number;
  ticker: string;
  spot: number;
  spot_source: string;
  spot_age_s: number;
  candles_1m: Candle[];
  candles_5m: Candle[];
  candles_15m: Candle[];
  candles_1h: Candle[];
  strike: number;
  strike_source: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  leftover_cents: number;
  combined_ask_cents: number;
  spread_cents: number;
  quote_age_s: number;
  yes_mid: number;
  yes_mid_path: number[];
  funding_rate: number;
  funding_history: number[];
  open_interest: number;
  oi_history: number[];
  oi_delta_3m: number;
  oi_delta_10m: number;
  oi_delta_1h: number;
  liq_long_usd: number;
  liq_short_usd: number;
  force_n: number;
  cascade_proxy: boolean;
  fear_greed: number;
  fear_greed_label: string;
  fng_history: number[];
  health: HealthMap;
  window_memory: WindowMemory;
  regime_key: string;
  clock_key: string;
  session: SessionName;
  demo: boolean;
  ret5: number;
  ret15: number;
  ret30: number;
  ret1h: number;
  atr: number;
  atr_pct: number;
  vol_median: number;
  vol_last: number;
  vol_percentile: number;
  location: "HIGH" | "LOW" | "MID";
  range_pos: number;
  imbalance: number;
  imbalance_hist: number[];
  yes_bid_size: number;
  no_bid_size: number;
  spot_lead_bps: number;
  chalk: boolean;
};

export type ShadowLean = {
  id: string;
  lean: Lean;
  confidence: number;
};

export type PaperLean = {
  id: string;
  lean: Lean;
  confidence: number;
  status: SkillStatus;
};

export type Vote = {
  seat: SeatId;
  lean: Lean;
  confidence: number;
  features: Record<string, number | string | boolean>;
  reasoning: string;
  skill_used: string;
  skill_status: SkillStatus | "SIT";
  shadow: ShadowLean | null;
  paper: PaperLean[];
  thresh_used: ThreshUse[];
  skill_n: number;
  skill_hits: number;
  skill_wilson: number;
  hypothesis: string;
  evidence: string[];
  counter: string;
  invalidate_if: string;
  health: FeedHealth;
  feed_age_s: number;
  eyes: string;
  phase: Phase;
};

export type Gate = {
  id: string;
  label: string;
  pass: boolean;
  hard: boolean;
  value: string;
};

export type ChairResult = {
  lean: Lean;
  confidence: number;
  score: number;
  bar: number;
  aggressiveness: number;
  diversity: number;
  sit_mass: number;
  conflict_frac: number;
  fade_fold: string;
  invert_cap: string;
  tax: string;
  tax_applied: boolean;
  law_dimmer: string;
  full_conf_raw: number;
  calc: string;
  gates: Gate[];
  hard_fail: boolean;
  hypothesis: string;
  evidence: string[];
  counter: string;
  decision: string;
  invalidate_if: string;
  huddle_line: string;
  last_settle: string;
  quorum: { up: number; down: number; wait: number };
  rows: SeatRow[];
  categories_agree: number;
  size: 1 | 2 | 3;
  size_note: string;
};

export type SeatRow = {
  rank: number;
  wilson_rank: number;
  contrib_rank: number;
  seat: SeatId;
  callsign: string;
  lean: Lean;
  conf: number;
  skill_used: string;
  base_w: number;
  listen: number;
  health: FeedHealth;
  signed: number;
  contribution: number;
  shadow_lean: Lean | null;
  why: string;
  status: SeatStatus;
  folded: boolean;
};

export type SkillCard = {
  id: string;
  owner: SeatId;
  question: string;
  eyes: string;
  fire_when: string;
  vote: string;
  conf_formula: string;
  invalidate_if: string;
  status: SkillStatus;
  n: number;
  hits: number;
  wait_good: number;
  wait_miss: number;
  wilson: number;
  brier_sum: number;
  brier_n: number;
  brier: number;
  ev_sum: number;
  ev_n: number;
  ev: number;
  streak_wrong: number;
  last20: number[];
  pocket: Record<string, { n: number; hits: number }>;
  rule?: SkillRule;
};

export type ConfBin = { n: number; hits: number };

export type PatternStat = {
  n: number;
  hits: number;
  wilson: number;
  ev_sum: number;
  ev_n: number;
  ev: number;
  last20: number[];
};

export type CandidateCard = {
  id: string;
  owner: SeatId;
  question: string;
  fire_when: string;
  vote: string;
  created_at: number;
  dismissed: boolean;
  rule?: SkillRule;
};

export type Learner = {
  skills: Record<string, SkillCard>;
  seat_n: Record<string, number>;
  seat_hits: Record<string, number>;
  seat_recent: Record<string, number[]>;
  seat_w: Record<string, number>;
  fade_strength: Record<string, number>;
  conf_bins: Record<string, ConfBin>;
  graded_windows: number;
  learn_phase: LearnPhase;
  settle_tape: string[];
  huddle_log: string[];
  window_memory: WindowMemory;
  law_wrongs: number;
  lockdown_until: number;
  lockdown: boolean;
  lockdown_windows_left: number;
  candidate: CandidateCard | null;
  last_huddle: number;
  last_huddle_n: number;
  chair_recent: number[];
  chair_ev_sum: number;
  chair_ev_n: number;
  thresholds: ThreshBook;
  last_feats: FeatMap;
  last_regime: string;
  pattern_book: Record<string, PatternStat>;
  window_patterns: { kind: string; lean: Lean }[];
};

export type Settings = {
  poll_ms: number;
  source: DataSource;
  bar_override: number | null;
  adaptive_bar: boolean;
  mutes: SeatId[];
  show_faded: boolean;
  show_shadow: boolean;
  tz: string;
  beast: boolean;
};

export type LiveBundle = {
  as_of: number;
  spot: number | null;
  spot_source: string;
  spot_age_s: number;
  klines_1m: Candle[];
  klines_5m: Candle[];
  klines_15m: Candle[];
  klines_1h: Candle[];
  kalshi: {
    ticker: string;
    strike: number;
    close_time: number;
    yes_bid: number;
    yes_ask: number;
    no_bid: number;
    no_ask: number;
    yes_bid_size: number;
    no_bid_size: number;
    quote_age_s: number;
    ok: boolean;
  } | null;
  funding_rate: number | null;
  funding_history: number[];
  open_interest: number | null;
  oi_history: number[];
  fear_greed: number | null;
  fear_greed_label: string;
  fng_history: number[];
  errors: Record<string, string>;
};
