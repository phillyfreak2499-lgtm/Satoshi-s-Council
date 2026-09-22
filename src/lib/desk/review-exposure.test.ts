import assert from "node:assert/strict";
import test from "node:test";
import { EDGE_FLOOR, FULL_N } from "./math.ts";
import { REVIEW_CONSTANTS, reviewExposure, scalpFloorWinRateNeededPct } from "./review-exposure.ts";
import type { Learner, SkillCard } from "./types";

/** A seat past FULL_N calls whose 20 rolling legs average +2.4¢ (STRIKE's live legs on 2026-09-22). */
function fixture(calls = 700): Learner {
  const card = { id: "STRIKE.itm_time", owner: "STRIKE", status: "LIVE", n: 1284, hits: 1219, ev_n: 1284, ev_sum: 1836, ev: 1.43, wilson: 0.936, last20: Array(20).fill(1), pocket: {} } as unknown as SkillCard;
  const shadow = { id: "STRIKE.rethink_yr6z", owner: "STRIKE", status: "SHADOW", n: 829, hits: 773, ev: 1.41, ev_n: 829, last20: [], pocket: {} } as unknown as SkillCard;
  return {
    skills: { "STRIKE.itm_time": card, "STRIKE.rethink_yr6z": shadow },
    seat_calls: { STRIKE: calls }, seat_n: { STRIKE: 210 }, seat_hits: { STRIKE: 175 }, seat_review_at: {}, seat_calib_debt: {},
    seat_scalp: { STRIKE: { open: null, legs: [1, -19, 21, 16, 2, 16, 3, 14, -1, 9, 10, 4, -11, -15, 10, -32, -21, 9, 14, 9] } },
  } as unknown as Learner;
}

test("the constants this module reads are the review's real constants", () => {
  assert.deepEqual(REVIEW_CONSTANTS, { EDGE_FLOOR: 15, FULL_N: 700, REVIEW_EVERY: 500 });
});

test("15¢ scalp floor as a HOLD illustration: 97% at 80¢, 100% at 84¢, over 100% above", () => {
  assert.equal(scalpFloorWinRateNeededPct(80), 97);
  assert.equal(scalpFloorWinRateNeededPct(84), 100);
  assert.equal(scalpFloorWinRateNeededPct(85), 101);
  assert.equal(scalpFloorWinRateNeededPct(70), 87);
});

test("exposure names the seat, the due call, the scalp average and the card that would be benched, before the review fires", () => {
  const learner = fixture(680);
  const row = reviewExposure(learner).find((r) => r.seat === "STRIKE")!;
  assert.equal(row.due_at, FULL_N);
  assert.equal(row.calls_until_review, 20);
  assert.equal(row.scalp_avg, 1.95);
  assert.equal(row.would_demote, true);
  assert.deepEqual(row.live_cards, ["STRIKE.itm_time"]);
  assert.equal(row.first_to_bench, "STRIKE.itm_time");
});

test("a thin book (< 8 legs) is held, not judged; a passing average would not demote; an owed review fires on the next call", () => {
  const thin = fixture(700);
  thin.seat_scalp.STRIKE = { open: null, legs: [1, 2, 3] };
  const t = reviewExposure(thin).find((r) => r.seat === "STRIKE")!;
  assert.equal(t.would_hold_thin, true);
  assert.equal(t.would_demote, false);
  assert.equal(t.calls_until_review, 1, "seat_review_at unset and calls ≥ FULL_N: the review is owed on the next call");
  const rich = fixture(700);
  rich.seat_scalp.STRIKE = { open: null, legs: Array(20).fill(EDGE_FLOOR + 1) };
  assert.equal(reviewExposure(rich).find((r) => r.seat === "STRIKE")!.would_demote, false);
  const reviewed = fixture(1703);
  reviewed.seat_review_at.STRIKE = 2200;
  assert.equal(reviewExposure(reviewed).find((r) => r.seat === "STRIKE")!.calls_until_review, 497);
});
