/**
 * The seat review's next exposure, and what its scalp floor actually demands.
 *
 * WHY THIS EXISTS. `reviewSeats` (learner.ts) runs every REVIEW_EVERY (500)
 * calls after FULL_N (700) and requires a seat's rolling 20-leg scalp average to
 * hold EDGE_FLOOR (15¢). Failing it re-zeroes the seat's calibration (debt =
 * seat_n) and `rethinkSeat` benches the seat's lowest-EV LIVE card; the huddle
 * later un-benches that card to SHADOW, and with AUTO_SKILL_PROMOTION_ENABLED
 * false nothing returns it to LIVE. The result is a one-way ratchet. This
 * module reads the learner and says, per seat, when the next review fires,
 * what the scalp average is now, whether it would fail, and which LIVE cards
 * are exposed. It changes nothing and never writes.
 *
 * WHAT "scalp_avg" MEASURES (from scalp.ts). Each seat runs a virtual one-
 * contract leg: it buys its own side at the ask when it leans, sells at that
 * side's current cents when it flips or goes WAIT inside the same window, and
 * settles at 100/0 if still held at the close. A leg's P&L is exit − entry −
 * both fees. The average is over the last 20 legs, mixed across windows,
 * horizons and prices. It is not the paper book and not a HOLD-only number.
 *
 * Pure module: no clock, no state, no database.
 */
import { EDGE_FLOOR, FULL_N, REVIEW_EVERY } from "./math.ts";
import { readScalp, scalpAvg } from "./scalp.ts";
import { SEATS } from "./seats.ts";
import { DEFAULT_FEE_ENGINE, allInCostCents, type FeeEngineId } from "./fee-engine.ts";
import type { Learner, SeatId } from "./types";

export type ReviewExposureRow = {
  seat: SeatId;
  calls: number;
  /** The call count at which the next review fires (seat_review_at, else FULL_N). */
  due_at: number;
  calls_until_review: number;
  scalp_legs: number;
  scalp_avg: number | null;
  /** True when the review, fired now, would demote: ≥ 8 legs and avg < EDGE_FLOOR. */
  would_demote: boolean;
  /** Thin book: < 8 legs holds the seat without judging it. */
  would_hold_thin: boolean;
  live_cards: string[];
  /** The LIVE card `rethinkSeat` would bench first (lowest EV). */
  first_to_bench: string | null;
  calib_debt: number;
  seat_n: number;
};

export function reviewExposure(learner: Learner): ReviewExposureRow[] {
  const rows: ReviewExposureRow[] = [];
  for (const s of SEATS) {
    if (s.id === "WARDEN") continue;
    const calls = learner.seat_calls?.[s.id] ?? 0;
    let due = learner.seat_review_at?.[s.id] ?? FULL_N;
    if (due <= calls) due = calls + 1; // a review already owed fires on the next call
    const st = readScalp(learner, s.id);
    const avg = scalpAvg(st.legs);
    const live = Object.values(learner.skills).filter((c) => c.owner === s.id && c.status === "LIVE").sort((a, b) => a.ev - b.ev);
    rows.push({
      seat: s.id, calls, due_at: due, calls_until_review: Math.max(0, due - calls),
      scalp_legs: st.legs.length, scalp_avg: avg == null ? null : Math.round(avg * 100) / 100,
      would_demote: avg != null && st.legs.length >= 8 && avg < EDGE_FLOOR,
      would_hold_thin: avg == null || st.legs.length < 8,
      live_cards: live.map((c) => c.id), first_to_bench: live[0]?.id ?? null,
      calib_debt: learner.seat_calib_debt?.[s.id] ?? 0, seat_n: learner.seat_n?.[s.id] ?? 0,
    });
  }
  return rows.sort((a, b) => a.calls_until_review - b.calls_until_review);
}

/**
 * The win rate a HOLD leg at `ask` needs for its average to reach `floor`:
 * p(100 − cost) − (1 − p)·cost = floor  ⇒  p = (floor + cost) / 100.
 * At 80¢ that is 97%; at 84¢ 100%; above 84¢ more than 100%. A rolling scalp
 * average mixes earlier exits, so this is the HOLD illustration, not the code's
 * exact population.
 */
export function scalpFloorWinRateNeededPct(ask: number, floor = EDGE_FLOOR, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number {
  return Math.round((floor + allInCostCents(ask, engine)) * 10) / 10;
}

export const REVIEW_CONSTANTS = Object.freeze({ EDGE_FLOOR, FULL_N, REVIEW_EVERY });
