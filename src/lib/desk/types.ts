import type { HistPoint } from "./hist";

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

export type CallLogRow = {
  id: string;
  t: number;
  ticker: string;
  close_time: number;
  lean: "UP" | "DOWN";
  cents: number;
  settle: number | null;
  flipped: boolean;
};
export type TabId =
  | "satoshi"
  | "arena"
  | "books"
  | "crew"
  | "atelier"
  | "structure"
  | "tape"
  | "derivs"
  | "book"
  | "context"
  | "board"
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
  | "INDEX"
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
  "INDEX",
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
  /** USD notional traded in the bar (quote volume). */
  volume: number;
  closed: boolean;
  receipt_ts: number;
  source: string;
};

export type GapStatus = "ok" | "gap" | "reconnect" | "held";

/** Every live observation carries these. No timestamp, no row. */
export type ObsStamp = {
  provider_ts: number;
  receipt_ts: number;
  last_ok_ts: number;
  seq: number;
  gap: GapStatus;
  source: string;
  ticker: string;
};

export type OfficialSettle = {
  ticker: string;
  close_time: number;
  lean: "UP" | "DOWN";
  provider_ts: number;
  receipt_ts: number;
  source: string;
  /** Kalshi's expiration_value: the settled 60s BRTI average, when present. */
  value?: number;
};

export type HealthMap = {
  spot_ok: boolean;
  kalshi_ok: boolean;
  derivs_ok: boolean;
  derivs_source: string;
  spot: FeedHealth;
  kalshi: FeedHealth;
  derivs: FeedHealth;
  spot_divergent: boolean;
  basis_wide: boolean;
};

export type TapeRow = {
  v: number[];
  finish: "UP" | "DOWN";
  t: number;
};
export type WfRow = { hit: number; cents: number };

export type WindowMemory = {
  prior_settles: Lean[];
  path_since_entry: number[];
  streak_n: number;
  streak_side: Lean | null;
  entry_spot: number;
  entry_lean: Lean | null;
  tapes: TapeRow[];
};

export type Snapshot = {
  as_of: number;
  phase: Phase;
  mins_left: number;
  secs_left: number;
  close_time: number;
  ticker: string;
  kalshi_host: string;
  kalshi_trade_n: number;
  kalshi_taker_yes: number;
  official_settles: OfficialSettle[];
  spot: number;
  spot_source: string;
  spot_age_s: number;
  spot_backup: number;
  spot_backup_source: string;
  spot_div_bps: number;
  perp: number;
  perp_source: string;
  index_px: number;
  basis_bps: number;
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
  quote_ts: number;
  quote_seq: number;
  print_age_s: number;
  last_trade_id: string;
  obs: ObsStamp;
  yes_mid: number;
  yes_mid_path: number[];
  funding_rate: number;
  funding_apr: number;
  funding_time: number;
  funding_history: number[];
  funding_series: HistPoint[];
  open_interest: number;
  oi_usd: number;
  oi_history: number[];
  oi_series: HistPoint[];
  oi_usd_series: HistPoint[];
  oi_delta_3m: number;
  oi_delta_10m: number;
  oi_delta_1h: number;
  oi_usd_delta_10m: number;
  liq_long_usd: number;
  liq_short_usd: number;
  liq_n: number;
  liq_source: string;
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
  fair_yes: number;
  edge_up: number;
  edge_down: number;
  fee_yes: number;
  fee_no: number;
  /** The lab's settlement-rule fair value for YES, in cents (BRTI-anchored); null when the lab is dark. Server only. */
  lab_fair_yes: number | null;
  /** Final-minute settlement prints already locked into the average, 0–60. */
  lab_locked: number;
  /** Age of that fair value in seconds (999 when the lab is dark). */
  lab_age_s: number;
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
  /** WAIT printed by the sub-52-conf filter, not by the seat's own read. */
  forced_sit?: boolean;
  /** The seat's own read before the whisper filter — what Chair v2 scores. */
  raw_lean?: Lean;
  raw_conf?: number;
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
  time_factor: number;
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
  knn_note: string;
  wait_note: string;
  walk: {
    n: number;
    train_n: number;
    test_n: number;
    train_hit: number;
    train_ev: number;
    test_hit: number;
    test_ev: number;
  } | null;
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
  scalp_avg: number | null;
  scalp_n: number;
  calib_n: number;
  calib: number;
  calls: number;
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

/** A seat's tunables. COACH is the only writer; nothing in the admin UI touches them. */
export type SeatKnobs = {
  /** Multiplies the rulebook's edge before it becomes confidence (0.8–1.2). */
  edge_mult: number;
  /** Added to the 52 speaking bar for this seat (−6…+6). */
  speak_offset: number;
  /** The offset before the last move, so a bad move can be reverted. */
  prev_offset: number | null;
  /** While in the future, the seat is force-sat (graded, never heard). */
  benched_until: number;
  updated_at: number;
  reason: string;
};

export type Learner = {
  skills: Record<string, SkillCard>;
  knobs: Record<string, SeatKnobs>;
  seat_n: Record<string, number>;
  seat_hits: Record<string, number>;
  seat_calls: Record<string, number>;
  seat_calib_debt: Record<string, number>;
  seat_review_at: Record<string, number>;
  seat_recent: Record<string, number[]>;
  seat_w: Record<string, number>;
  seat_scalp: Record<string, { open: { lean: "UP" | "DOWN"; cents: number; ticker: string; close_time: number } | null; legs: number[] }>;
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
  chair_wait_n: number;
  chair_wait_good: number;
  wf_chair: WfRow[];
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
  receipt_ts: number;
  spot: number | null;
  spot_source: string;
  spot_age_s: number;
  spot_backup: number | null;
  spot_backup_source: string;
  perp: number | null;
  perp_source: string;
  index_px: number | null;
  klines_1m: Candle[];
  klines_5m: Candle[];
  klines_15m: Candle[];
  klines_1h: Candle[];
  kalshi: {
    ticker: string;
    host: string;
    strike: number;
    close_time: number;
    yes_bid: number;
    yes_ask: number;
    no_bid: number;
    no_ask: number;
    yes_bid_size: number;
    no_bid_size: number;
    quote_age_s: number;
    quote_ts: number;
    quote_seq: number;
    trade_ts: number;
    last_trade_id: string;
    receipt_ts: number;
    ok: boolean;
    trade_n: number;
    taker_yes: number;
    yes_path: number[];
    settles: OfficialSettle[];
  } | null;
  funding_rate: number | null;
  funding_time: number | null;
  funding_history: number[];
  funding_series: HistPoint[];
  open_interest: number | null;
  oi_usd: number | null;
  oi_history: number[];
  oi_series: HistPoint[];
  oi_usd_series: HistPoint[];
  liq_long_usd: number;
  liq_short_usd: number;
  liq_n: number;
  liq_source: string;
  fear_greed: number | null;
  fear_greed_label: string;
  fng_history: number[];
  errors: Record<string, string>;
};
