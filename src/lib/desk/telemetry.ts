/**
 * MEASUREMENT-ONLY telemetry — pure builders. Authority: NONE.
 *
 * This module turns an already-computed (snapshot, votes, ChairResult) triple —
 * the exact objects the live Chair produced this tick — into flat, append-only
 * research rows. It reads those objects and never mutates them, never calls a
 * decider, a booker, a learner writer, or any actuator. Removing every caller of
 * this file would leave Chair behaviour byte-identical (proven by the invariant
 * tests). The DB writer lives in telemetry.server.ts; this half is pure so it can
 * be unit-tested without a database.
 *
 * Design intent (research director spec): capture enough to reconstruct the whole
 * seat -> aggregation -> Chair-gating pipeline, with every important number stored
 * as its own numeric field rather than parsed out of a human string.
 */
// Runtime deps are LEAF modules only (math.ts, seats.ts) so this pure module —
// and its unit tests — load under the plain `node --test` runner. Everything else
// is a type-only import, which strips away at runtime.
import { SPEAK_CONF } from "./math.ts";
import { CHAIR_NON_VOTER_IDS, RETIRED_SEAT_IDS } from "./seats.ts";
import type { ChairResult, Gate, Learner, Lean, SeatRow, Snapshot, Vote } from "./types.ts";

const NON_VOTERS: ReadonlySet<string> = new Set<string>(CHAIR_NON_VOTER_IDS);
const RETIRED: ReadonlySet<string> = new Set<string>(RETIRED_SEAT_IDS);

/**
 * Why a seat's read did NOT reach the Chair as a directional vote — one binding
 * cause per seat, never collapsed into a generic "forced_sit". Every value is
 * derived structurally/numerically (seat role, feed health, bench window, and
 * raw_conf vs the speak threshold), not by parsing reasoning strings.
 */
export const SUPPRESSION_REASONS = [
  "spoke", // reached the Chair as a directional vote
  "feed_down", // health DOWN — bot silent, no trustworthy read
  "non_voter", // WARDEN/ORBIT/WIRE — pit crew, never aggregated
  "retired", // ODDS/CHEAP/FADE — retired from paper-call votes
  "coach_bench", // COACH bench window active
  "below_speak_conf", // directional raw read, raw_conf < effective speak bar
  "eligibility_hold", // directional raw read at/above bar, held by regime/authority eligibility
  "no_skill_fired", // no LIVE skill fired (skill_used === "SIT")
  "raw_wait", // a skill fired but its own read was WAIT (saw nothing)
  "feed_stale", // health STALE and not otherwise categorised
  "other", // unclassified — should be ~0; a non-zero rate is a bug to chase
] as const;

export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

function isDir(l: Lean | undefined | null): l is "UP" | "DOWN" {
  return l === "UP" || l === "DOWN";
}

/** Effective per-seat speak bar: the hard 52 plus COACH's per-seat offset. */
export function effectiveSpeakBar(learner: Learner, seat: string): { bar: number; offset: number } {
  const offset = learner.knobs?.[seat]?.speak_offset ?? 0;
  return { bar: SPEAK_CONF + offset, offset };
}

/** True when this seat can, in principle, contribute a directional vote to the Chair. */
export function isEligibleVoter(seat: string): boolean {
  return !NON_VOTERS.has(seat) && !RETIRED.has(seat);
}

/**
 * Classify the one binding reason a seat's read did or did not reach the Chair.
 * Pure: reads the Vote plus the learner's bench/offset state; mutates nothing.
 */
export function classifySuppression(vote: Vote, learner: Learner, asOfMs: number): SuppressionReason {
  const rawLean = (vote.raw_lean ?? vote.lean) as Lean;
  const rawDir = isDir(rawLean);
  const spoke = isDir(vote.lean) && vote.forced_sit !== true;
  const { bar } = effectiveSpeakBar(learner, vote.seat);
  const rawConf = vote.raw_conf ?? vote.confidence;

  if (vote.health === "DOWN") return "feed_down";
  if (NON_VOTERS.has(vote.seat)) return "non_voter";
  if (RETIRED.has(vote.seat)) return "retired";
  if ((learner.knobs?.[vote.seat]?.benched_until ?? 0) > asOfMs && vote.forced_sit) return "coach_bench";
  if (spoke) return "spoke";
  // Gag by the speak bar is classified BEFORE feed_stale so stale-but-gagged
  // directional reads stay visible to the near-threshold (48–52) analysis.
  if (vote.forced_sit && rawDir && rawConf < bar) return "below_speak_conf";
  if (vote.forced_sit && rawDir && rawConf >= bar) return "eligibility_hold";
  // A stale feed taints the read; once past the structural and gag causes above,
  // staleness is the binding reason (health is also stored as its own field).
  if (vote.health === "STALE") return "feed_stale";
  if (vote.skill_used === "SIT") return "no_skill_fired";
  if (!rawDir) return "raw_wait";
  return "other";
}

export type SeatReadRow = {
  ticker: string;
  close_time: string; // ISO
  as_of: string; // ISO
  seat: string;
  phase: string;
  mins_left: number;
  secs_left: number;
  eligible_voter: boolean;
  active_skill: string;
  skill_status: string;
  raw_lean: Lean;
  raw_conf: number;
  speak_offset: number;
  effective_speak_threshold: number;
  passed_speak: boolean;
  final_lean: Lean;
  final_conf: number;
  forced_sit: boolean;
  suppression_reason: SuppressionReason;
  seat_weight: number | null;
  seat_status: string | null;
  contribution: number | null;
  health: string;
  feed_age_s: number;
  shadow_lean: Lean | null;
};

export type ChairEvalRow = {
  ticker: string;
  close_time: string; // ISO
  as_of: string; // ISO
  phase: string;
  mins_left: number;
  secs_left: number;
  raw_score: number;
  abs_score: number;
  dir_mass: number;
  sit_total_mass: number;
  sit_mass: number;
  eligible_voter_count: number;
  speaker_count: number;
  up_speakers: number;
  down_speakers: number;
  silent_count: number;
  // bar breakdown (each modifier as its own numeric field)
  bar_base: number;
  bar_quiet: number;
  bar_weekend: number;
  bar_phase: number;
  bar_law_miss1: number;
  bar_calib_tax: number;
  bar_sit_mass: number;
  bar_knn: number;
  bar_pre_clamp: number;
  bar_final: number;
  aggressiveness: number;
  time_factor: number;
  vs_bar: number;
  diversity: number;
  categories_agree: number;
  conflict: boolean;
  conflict_frac: number;
  hard_fail: boolean;
  raw_chair_lean: Lean;
  final_lean: Lean;
  final_differs_from_raw: boolean;
  confidence: number;
  size: number;
  wait_reason: string;
  gates: Gate[]; // stored as jsonb — pass/fail/value preserved verbatim
};

const iso = (ms: number): string => new Date(ms).toISOString();

/** One row per seat for this tick. `chair` supplies aggregation weight/status/contribution. */
export function buildSeatReadRows(
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  learner: Learner,
): SeatReadRow[] {
  const rowBySeat = new Map<string, SeatRow>(chair.rows.map((r) => [r.seat, r]));
  return votes.map((v) => {
    const rawLean = (v.raw_lean ?? v.lean) as Lean;
    const rawConf = v.raw_conf ?? v.confidence;
    const { bar, offset } = effectiveSpeakBar(learner, v.seat);
    const row = rowBySeat.get(v.seat) ?? null;
    return {
      ticker: snap.ticker,
      close_time: iso(snap.close_time),
      as_of: iso(snap.as_of),
      seat: v.seat,
      phase: v.phase ?? snap.phase,
      mins_left: snap.mins_left,
      secs_left: snap.secs_left ?? snap.mins_left * 60,
      eligible_voter: isEligibleVoter(v.seat),
      active_skill: v.skill_used,
      skill_status: String(v.skill_status),
      raw_lean: rawLean,
      raw_conf: rawConf,
      speak_offset: offset,
      effective_speak_threshold: bar,
      passed_speak: isDir(rawLean) && rawConf >= bar,
      final_lean: v.lean,
      final_conf: v.confidence,
      forced_sit: v.forced_sit === true,
      suppression_reason: classifySuppression(v, learner, snap.as_of),
      seat_weight: row ? row.weight : null,
      seat_status: row ? String(row.status) : null,
      contribution: row ? row.contribution : null,
      health: String(v.health),
      feed_age_s: v.feed_age_s ?? 0,
      shadow_lean: v.shadow?.lean ?? null,
    };
  });
}

/** The structured binding reason a WAIT was WAIT (empty string when directional). */
export function chairWaitReason(chair: ChairResult): string {
  if (isDir(chair.lean)) return "";
  const hardFail = chair.gates.find((g) => g.hard && !g.pass);
  if (hardFail) return `hard:${hardFail.id}`;
  const conflict = chair.gates.find((g) => g.id === "top3" && !g.pass);
  if (conflict) return "conflict";
  if (chair.vs_bar < chair.bar) return "below_bar";
  return "other";
}

/**
 * One row for the Chair's aggregation/gating this tick. `raw` is the canonical
 * runChair output (carries the bar breakdown and gates); `final` is what was
 * presented after entry-mode/sticky, so a WAIT introduced downstream is visible.
 */
export function buildChairEvalRow(
  snap: Snapshot,
  votes: Vote[],
  raw: ChairResult,
  final: ChairResult,
): ChairEvalRow {
  let up = 0;
  let down = 0;
  let eligible = 0;
  let speakers = 0;
  for (const v of votes) {
    if (!isEligibleVoter(v.seat)) continue;
    eligible += 1;
    if (isDir(v.lean) && v.forced_sit !== true) {
      speakers += 1;
      if (v.lean === "UP") up += 1;
      else down += 1;
    }
  }
  const b = raw.bar_breakdown;
  const conflictGate = raw.gates.find((g) => g.id === "top3");
  return {
    ticker: snap.ticker,
    close_time: iso(snap.close_time),
    as_of: iso(snap.as_of),
    phase: snap.phase,
    mins_left: snap.mins_left,
    secs_left: snap.secs_left ?? snap.mins_left * 60,
    raw_score: raw.score,
    abs_score: Math.abs(raw.score),
    dir_mass: raw.dir_mass,
    sit_total_mass: raw.sit_total_mass,
    sit_mass: raw.sit_mass,
    eligible_voter_count: eligible,
    speaker_count: speakers,
    up_speakers: up,
    down_speakers: down,
    silent_count: eligible - speakers,
    bar_base: b.base,
    bar_quiet: b.quiet,
    bar_weekend: b.weekend,
    bar_phase: b.phase,
    bar_law_miss1: b.law_miss1,
    bar_calib_tax: b.calib_tax,
    bar_sit_mass: b.sit_mass,
    bar_knn: b.knn,
    bar_pre_clamp: b.pre_clamp,
    bar_final: b.final,
    aggressiveness: raw.aggressiveness,
    time_factor: raw.time_factor,
    vs_bar: raw.vs_bar,
    diversity: raw.diversity,
    categories_agree: raw.categories_agree,
    conflict: conflictGate ? !conflictGate.pass : false,
    conflict_frac: raw.conflict_frac,
    hard_fail: raw.hard_fail,
    raw_chair_lean: raw.lean,
    final_lean: final.lean,
    final_differs_from_raw: raw.lean !== final.lean,
    confidence: final.confidence,
    size: final.size,
    wait_reason: chairWaitReason(final),
    gates: raw.gates,
  };
}
