/**
 * S2-5 decision-snapshot semantics (pure; no clock, no DB, no feed).
 *
 * The desk re-reads the market every brain tick, and the Chair's finalized
 * `(snap, chair)` pair IS the decision-time state for that tick. S2-5 persists
 * AT MOST TWO of those pairs per exact window, and this module is the whole of
 * the decision about WHICH two:
 *
 *   OPENING            the FIRST finalized Chair read for the window, whatever
 *                      its lean -- UP, DOWN, or WAIT. Immutable.
 *   FIRST_DIRECTIONAL  the first LATER UP/DOWN read, and only if OPENING was
 *                      WAIT. A directional OPENING is already the window's first
 *                      directional read, so no second row is written for it.
 *
 * Deliberately NOT a Chair-state event log. A later UP->DOWN, ->WAIT, or any
 * subsequent flip is OUT OF SCOPE: replay and path-parity already carry the
 * high-frequency path, and S2-5 exists only to answer "what did the market look
 * like when this Chair read first existed?".
 *
 * Pure on purpose. It decides from four facts the caller already holds, so the
 * rule is testable without a database -- and the database's UNIQUE
 * (ticker, close_time, snapshot_kind) stays the final authority on idempotence.
 * Nothing here reads a fill, a grade, a replay point, or a current quote.
 */
import { measureHigherTimeframeContext, type HigherTimeframeContext } from "./higher-timeframe-context.ts";
import type { ChairResult, Lean, Snapshot } from "./types";

export type SnapshotKind = "OPENING" | "FIRST_DIRECTIONAL";

/** Stamped on every row. Bumped by hand only when the measurement itself changes. */
export const DECISION_RESEARCH_VERSION = "decision-2";

/** What the caller already knows about an exact window before this tick. */
export type DecisionWindowFacts = {
  /** Whether an OPENING row is already known (cached, or read back from the DB). */
  openingExists: boolean;
  /** The persisted OPENING lean once known; null until `openingExists` is true. */
  openingLean: Lean | null;
  /** Whether a FIRST_DIRECTIONAL row is already known. */
  firstDirectionalExists: boolean;
  /** This tick's finalized Chair lean. */
  currentLean: Lean;
};

export type DecisionSnapshotPlan = {
  insertOpening: boolean;
  insertFirstDirectional: boolean;
};

const NONE: DecisionSnapshotPlan = { insertOpening: false, insertFirstDirectional: false };

function isDirectional(l: Lean): boolean {
  return l === "UP" || l === "DOWN";
}

/**
 * Decide which S2-5 rows (if any) this tick should attempt to persist.
 *
 * At most ONE of the two flags is ever true for a single tick: OPENING when no
 * opening is known yet (WAIT included), otherwise FIRST_DIRECTIONAL, and only
 * when the opening read was WAIT and this tick is the first directional turn.
 */
export function decisionSnapshotEvents(f: DecisionWindowFacts): DecisionSnapshotPlan {
  // OPENING is the FIRST finalized read, full stop. If none exists yet, this
  // tick is it -- a WAIT opening is as real as a directional one. Nothing else
  // can be the opening, so a directional first tick becomes OPENING, never a
  // same-tick FIRST_DIRECTIONAL duplicate.
  if (!f.openingExists) {
    return { insertOpening: true, insertFirstDirectional: false };
  }
  // OPENING already stands. FIRST_DIRECTIONAL is the first UP/DOWN read, but
  // ONLY when the opening read was WAIT: a directional opening already counts as
  // the window's first directional read and is never duplicated.
  if (!f.firstDirectionalExists && f.openingLean === "WAIT" && isDirectional(f.currentLean)) {
    return { insertOpening: false, insertFirstDirectional: true };
  }
  return NONE;
}

/**
 * The facts a single S2-5 row carries, captured from one finalized decision
 * tick's `(snap, chair)` pair. Flat and server-agnostic so the tick can build it
 * synchronously and hand FACTS (never a live object) to the async writer.
 *
 * Every input is already present at the decision tick. Timestamps are raw
 * epoch ms here; the writer converts to timestamptz. `snapshot_kind` is NOT part
 * of this type -- the writer decides the kind from the event plan above, so the
 * same captured pair can become OPENING or FIRST_DIRECTIONAL without rebuilding.
 *
 * Classification of every field is in the migration and the PR body:
 * OBSERVED / DERIVED / CHAIR_OUTPUT / CLOCK.
 */
export type DecisionSnapshotRow = {
  // identity + clocks
  ticker: string;
  close_time_ms: number;
  /** CLOCK: the tick's own decision clock (snap.as_of). Never a fill/insert/settle time. */
  decision_at_ms: number;
  /** CLOCK: time left in the window at the read. */
  secs_left: number | null;
  /** CLOCK: quote freshness at the read. */
  quote_age_s: number | null;
  quote_seq: number | null;
  /** CLOCK: print freshness at the read. */
  print_age_s: number | null;
  /**
   * CLOCK: the quote's last-change time (snap.quote_ts). Named for what it is --
   * a last-change clock, NOT a provider-origin receipt. S2-5 never labels a
   * last-change time as provider time (the live observation carries it truthfully
   * as ObsStamp.quote_last_change_at).
   */
  quote_last_change_ms: number | null;

  // CHAIR_OUTPUT
  chair_lean: Lean;
  chair_confidence: number | null;
  chair_score: number | null;
  chair_bar: number | null;
  chair_sit_mass: number | null;
  chair_hard_fail: boolean;
  chair_quorum_up: number | null;
  chair_quorum_down: number | null;
  chair_quorum_wait: number | null;
  chair_size: number | null;
  chair_gates: unknown;
  chair_hypothesis: string;
  chair_evidence: unknown;
  chair_counter: string;
  chair_decision: string;
  chair_invalidate_if: string;

  // OBSERVED (the book and spot that actually fed the Chair)
  spot: number | null;
  spot_source: string;
  strike: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  no_bid: number | null;
  no_ask: number | null;
  yes_bid_size: number | null;
  no_bid_size: number | null;
  kalshi_taker_yes: number | null;
  kalshi_trade_n: number | null;

  // DERIVED (computed upstream by liveSnap from this same tick; S2-5 invents nothing)
  fair_yes: number | null;
  lab_fair_yes: number | null;
  yes_mid: number | null;
  spread_cents: number | null;
  combined_ask_cents: number | null;
  leftover_cents: number | null;
  edge_up: number | null;
  edge_down: number | null;
  fee_yes: number | null;
  fee_no: number | null;
  regime_key: string;
  clock_key: string;
  atr: number | null;
  imbalance: number | null;
  range_pos: number | null;

  // LAB_DERIVED (numeric context only; measurement authority, never a Chair input)
  higher_context: HigherTimeframeContext;
};

/** Finite number, or null. Postgres integer columns reject NaN; doubles keep it, but a
 *  research row is cleaner with an explicit null than a stored NaN. */
function fin(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Finite integer, or null. */
function finInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Capture one decision tick's `(snap, chair)` pair into a flat research row.
 *
 * PURE: it reads only the already-finalized snap and chair. It does not re-read
 * the market and does not consult a fill or a grade. Ordinary DERIVED fields
 * are values liveSnap already computed for this tick.
 * `higher_context` is the one LAB_DERIVED payload: a pure summary of this same
 * tick's already-captured hourly candles and returns, explicitly non-voting.
 */
export function buildDecisionSnapshotRow(snap: Snapshot, chair: ChairResult): DecisionSnapshotRow {
  // Unknown-freshness sentinels must not become apparent measurements. From
  // live.ts: quote_ts is `?? 0` and quote_age_s is `quote_ts > 0 ? real : 999`
  // (so 999 iff there is no quote clock); quote_seq is `?? 0` and the feed treats
  // `> 0` as "has a sequence"; print_age_s is `trade_ts ? real : 999`, and a
  // carried-forward unknown only grows from 999. So an absent clock/sequence/print
  // is stored as NULL, never as epoch 1970, a fake 999 age, or a fake seq 0.
  const qts = Number(snap.quote_ts);
  const hasQuoteClock = Number.isFinite(qts) && qts > 0;
  const qseq = Number(snap.quote_seq);
  const pa = Number(snap.print_age_s);
  return {
    ticker: snap.ticker,
    close_time_ms: Number(snap.close_time),
    decision_at_ms: Number(snap.as_of),
    secs_left: fin(snap.secs_left),
    quote_age_s: hasQuoteClock ? fin(snap.quote_age_s) : null,
    quote_seq: Number.isFinite(qseq) && qseq > 0 ? Math.round(qseq) : null,
    print_age_s: Number.isFinite(pa) && pa < 999 ? pa : null,
    quote_last_change_ms: hasQuoteClock ? Math.round(qts) : null,

    chair_lean: chair.lean,
    chair_confidence: fin(chair.confidence),
    chair_score: fin(chair.score),
    chair_bar: fin(chair.bar),
    chair_sit_mass: fin(chair.sit_mass),
    chair_hard_fail: chair.hard_fail === true,
    chair_quorum_up: finInt(chair.quorum?.up),
    chair_quorum_down: finInt(chair.quorum?.down),
    chair_quorum_wait: finInt(chair.quorum?.wait),
    chair_size: finInt(chair.size),
    chair_gates: chair.gates ?? [],
    chair_hypothesis: chair.hypothesis ?? "",
    chair_evidence: chair.evidence ?? [],
    chair_counter: chair.counter ?? "",
    chair_decision: chair.decision ?? "",
    chair_invalidate_if: chair.invalidate_if ?? "",

    spot: fin(snap.spot),
    spot_source: snap.spot_source ?? "",
    strike: fin(snap.strike),
    yes_bid: fin(snap.yes_bid),
    yes_ask: fin(snap.yes_ask),
    no_bid: fin(snap.no_bid),
    no_ask: fin(snap.no_ask),
    yes_bid_size: fin(snap.yes_bid_size),
    no_bid_size: fin(snap.no_bid_size),
    kalshi_taker_yes: fin(snap.kalshi_taker_yes),
    kalshi_trade_n: finInt(snap.kalshi_trade_n),

    fair_yes: fin(snap.fair_yes),
    lab_fair_yes: snap.lab_fair_yes == null ? null : fin(snap.lab_fair_yes),
    yes_mid: fin(snap.yes_mid),
    spread_cents: fin(snap.spread_cents),
    combined_ask_cents: fin(snap.combined_ask_cents),
    leftover_cents: fin(snap.leftover_cents),
    edge_up: fin(snap.edge_up),
    edge_down: fin(snap.edge_down),
    fee_yes: fin(snap.fee_yes),
    fee_no: fin(snap.fee_no),
    regime_key: snap.regime_key ?? "",
    clock_key: snap.clock_key ?? "",
    atr: fin(snap.atr),
    imbalance: fin(snap.imbalance),
    range_pos: fin(snap.range_pos),
    higher_context: measureHigherTimeframeContext({
      as_of_ms: Number(snap.as_of),
      spot: Number(snap.spot),
      ret_15m: Number(snap.ret15),
      ret_30m: Number(snap.ret30),
      ret_1h: Number(snap.ret1h),
      candles_1h: snap.candles_1h ?? [],
    }),
  };
}
