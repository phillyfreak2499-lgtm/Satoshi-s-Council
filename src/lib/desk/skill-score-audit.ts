/** Read-only receipts for the two skills named in the September 15 audit.
 * No receipt is a probability model, a new grade, or input to a voting rule. */
import { centsOf, takerFeeCents } from "./clock.ts";
import type { Learner, Lean, SkillCard, Snapshot, Vote } from "./types";

export const SCORE_AUDIT_VERSION = "SKILL_SCORE_AUDIT_V1";
export const SCORE_AUDIT_START = Date.parse("2026-09-15T15:45:00.000Z");
export const SCORE_AUDIT_SKILLS = ["DRIFT.pullback_in_trend", "PULSE.vol_lag_5m"] as const;
const counterNames = ["n", "hits", "brier_n", "brier_sum", "ev_n", "ev_sum"] as const;
type Counters = Record<(typeof counterNames)[number], number | null>;
type Direction = "UP" | "DOWN";
const finite = (n: unknown): number | null => typeof n === "number" && Number.isFinite(n) ? n : null;
const directional = (s: Lean | undefined): s is Direction => s === "UP" || s === "DOWN";

function counters(card: SkillCard | undefined): Counters | null {
  if (!card) return null;
  return Object.fromEntries(counterNames.map(k => [k, finite(card[k])])) as Counters;
}

export type SkillScoreObservation = {
  path: "selected" | "gagged" | "paper";
  side: Direction;
  confidence: number | null;
  confidence_kind: "signal_strength_not_calibrated_probability";
  legacy_input: number | null;
  hit: 0 | 1;
  legacy_squared_error: number | null;
  ask_cents: number | null;
  fee_cents: number | null;
  hypothetical_net_cents: number | null;
  legacy_net_cents: number | null;
  legacy_quote_fallback: boolean;
  market_side_midpoint: number | null;
  market_squared_error: number | null;
  credited: boolean;
};

export type SkillScoreAudit = {
  version: typeof SCORE_AUDIT_VERSION;
  authority: "none";
  scope: "last_grading_input_not_booked_entry";
  ticker: string;
  close_time: number;
  input_at: number;
  graded_at: number;
  seconds_to_close: number;
  input_before_close: boolean;
  build_sha: string | null;
  source: string;
  outcome: Direction;
  credit_skip_reason: string | null;
  market: { yes_bid: number | null; yes_ask: number | null; no_ask: number | null; yes_mid: number | null; main_fair_yes: number | null; index_fair_yes: number | null; phase: string };
  skills: {
    id: string;
    status_at_input: string;
    before: Counters | null;
    after: Counters | null;
    observations: SkillScoreObservation[];
    check: "PENDING" | "MATCH" | "MISMATCH" | "MISSING";
  }[];
};

/** Capture BEFORE gradeWindow/reviewSeats can change counters or skill status. */
export function beginSkillScoreAudit(
  learner: Learner, snap: Snapshot, votes: Vote[], outcome: Direction,
  options: { countable: boolean; source: string; build_sha: string | null; graded_at: number },
): SkillScoreAudit | null {
  if (!Number.isFinite(snap.as_of) || snap.as_of < SCORE_AUDIT_START ||
      !Number.isFinite(snap.close_time) || !snap.ticker) return null;
  const skip = !options.countable ? "research-quality exclusion"
    : snap.chalk || snap.leftover_cents > 12 ? "chalk or phantom book"
    : snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN" ? "both feeds down" : null;
  const beforeClose = snap.as_of < snap.close_time;
  const probability = finite(snap.yes_mid);
  const validMid = probability != null && probability >= 0 && probability <= 100;
  const observation = (path: SkillScoreObservation["path"], side: Direction, confidence: number): SkillScoreObservation => {
    const conf = finite(confidence);
    // Reproduce the EXISTING grader's input; do not assert that it is calibrated.
    const input = conf == null ? null : Math.max(0, Math.min(1, conf / 100));
    const hit = side === outcome ? 1 : 0;
    const rawAsk = finite(side === "UP" ? snap.yes_ask : snap.no_ask);
    const ask = rawAsk != null && rawAsk > 0 && rawAsk < 100 ? rawAsk : null;
    const fee = ask == null ? null : takerFeeCents(ask);
    const market = validMid ? (side === "UP" ? probability! / 100 : 1 - probability! / 100) : null;
    return {
      path, side, confidence: conf, confidence_kind: "signal_strength_not_calibrated_probability",
      legacy_input: input, hit, legacy_squared_error: input == null ? null : (input - hit) ** 2,
      ask_cents: ask, fee_cents: fee,
      hypothetical_net_cents: ask == null || fee == null ? null : hit * 100 - ask - fee,
      legacy_net_cents: finite(centsOf(side, snap, outcome)),
      legacy_quote_fallback: !(rawAsk != null && rawAsk > 0),
      market_side_midpoint: market,
      market_squared_error: beforeClose && market != null ? (market - hit) ** 2 : null,
      credited: skip == null,
    };
  };
  return {
    version: SCORE_AUDIT_VERSION, authority: "none", scope: "last_grading_input_not_booked_entry",
    ticker: snap.ticker, close_time: snap.close_time, input_at: snap.as_of, graded_at: options.graded_at,
    seconds_to_close: (snap.close_time - snap.as_of) / 1000, input_before_close: beforeClose,
    build_sha: options.build_sha, source: options.source, outcome, credit_skip_reason: skip,
    market: { yes_bid: finite(snap.yes_bid), yes_ask: finite(snap.yes_ask), no_ask: finite(snap.no_ask),
      yes_mid: finite(snap.yes_mid), main_fair_yes: finite(snap.fair_yes), index_fair_yes: finite(snap.lab_fair_yes), phase: snap.phase },
    skills: SCORE_AUDIT_SKILLS.map(id => {
      const card = learner.skills[id];
      const observations: SkillScoreObservation[] = [];
      if (card) for (const v of votes) {
        if (v.seat === "WARDEN") continue;
        if (v.skill_used === id) {
          if (directional(v.lean)) observations.push(observation("selected", v.lean, v.confidence));
          else if (v.forced_sit && directional(v.raw_lean)) observations.push(observation("gagged", v.raw_lean, v.raw_conf ?? v.confidence));
        }
        for (const p of v.paper ?? []) {
          if (p.id === id && p.id !== v.skill_used && directional(p.lean)) observations.push(observation("paper", p.lean, p.confidence));
        }
      }
      return { id, status_at_input: card?.status ?? "MISSING", before: counters(card), after: null, observations, check: "PENDING" };
    }),
  };
}

/** Check the actual counter increments immediately AFTER gradeWindow.
 * This does not assign anything to learner or attempt to repair a discrepancy. */
export function finishSkillScoreAudit(audit: SkillScoreAudit | null, learner: Learner): SkillScoreAudit | null {
  if (!audit) return null;
  return { ...audit, skills: audit.skills.map(skill => {
    const after = counters(learner.skills[skill.id]);
    const rows = skill.observations.filter(r => r.credited);
    const complete = rows.every(r => r.legacy_squared_error != null && r.legacy_net_cents != null);
    const expected: Counters = { n: rows.length, hits: rows.reduce((s, r) => s + r.hit, 0), brier_n: rows.length,
      brier_sum: complete ? rows.reduce((s, r) => s + r.legacy_squared_error!, 0) : null,
      ev_n: rows.length, ev_sum: complete ? rows.reduce((s, r) => s + r.legacy_net_cents!, 0) : null };
    const known = after && skill.before && counterNames.every(k => after[k] != null && skill.before![k] != null && expected[k] != null);
    const matches = known && counterNames.every(k => Math.abs(after[k]! - skill.before![k]! - expected[k]!) < 1e-8);
    return { ...skill, after, check: !known ? "MISSING" : matches ? "MATCH" : "MISMATCH" };
  }) };
}

/** Old durable outbox rows have no receipt. Keep them writable as NULL. */
export function withSkillAuditColumn(values: unknown[]): unknown[] {
  return values.length === 41 ? [...values, null] : values;
}
