import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_MIN_REGIME_N,
  bestRegimeN,
  isGated,
  promoteEligible,
  promoteHeldReason,
  regimeN,
  voteEligible,
  voteHeldReason,
} from "./skill-gate.ts";

/** A card shaped like the learner's, with only the fields the gate reads. */
function card(over: Record<string, unknown> = {}) {
  return { n: 0, pocket: {} as Record<string, { n: number; hits: number }>, ...over } as never;
}

test("an ungated card is never held — every existing skill keeps its behaviour", () => {
  const plain = card({ n: 0, pocket: {} });
  assert.equal(voteHeldReason(plain, "US_PM_MID"), null);
  assert.equal(voteEligible(plain, "US_PM_MID"), true);
  assert.equal(promoteEligible(plain), true);
  assert.equal(isGated(plain), false);
});

test("a manual hold is never released by a threshold", () => {
  const held = card({
    n: 10_000,
    pocket: { US_PM_MID: { n: 9_999, hits: 9_999 } },
    manual_hold: true,
    min_regime_n: 24,
    held_why: "new microstructure feature, release by hand",
  });
  assert.equal(voteHeldReason(held, "US_PM_MID"), "new microstructure feature, release by hand");
  assert.equal(voteEligible(held, "US_PM_MID"), false);
  assert.equal(promoteEligible(held), false);
  assert.equal(isGated(held), true);
});

test("a walk-forward minimum holds the card until it has the observations", () => {
  const thin = card({ n: 7, min_walkforward_n: 40 });
  assert.equal(voteHeldReason(thin, "ASIA_MID"), "7/40 graded");
  assert.equal(voteEligible(thin, "ASIA_MID"), false);
  const ready = card({ n: 40, min_walkforward_n: 40 });
  assert.equal(voteEligible(ready, "ASIA_MID"), true);
  assert.equal(promoteEligible(ready), true);
});

test("a regime minimum is judged in the regime being traded, not in total", () => {
  // INDEX as the ledger actually holds it today: a perfect record spread thin.
  const index = card({
    n: 20,
    pocket: {
      US_PM_MID: { n: 9, hits: 9 },
      ASIA_MID: { n: 5, hits: 5 },
      US_AM_MID: { n: 4, hits: 4 },
      EUROPE_MID: { n: 2, hits: 2 },
    },
    min_regime_n: INDEX_MIN_REGIME_N,
  });
  assert.equal(regimeN(index, "US_PM_MID"), 9);
  assert.equal(bestRegimeN(index), 9);
  // 20 for 20 overall is not permission to steer any single regime.
  assert.equal(voteHeldReason(index, "US_PM_MID"), "9/24 in US_PM_MID");
  assert.equal(voteEligible(index, "US_PM_MID"), false);
  assert.equal(voteEligible(index, "ASIA_MID"), false);
  // An unseen regime has zero, not the benefit of the doubt.
  assert.equal(voteHeldReason(index, "WEEKEND_QUIET"), "0/24 in WEEKEND_QUIET");
  // And it cannot be promoted to LIVE either.
  assert.equal(promoteHeldReason(index), "9/24 in its best regime");
  assert.equal(promoteEligible(index), false);
});

test("a regime minimum releases only the regime that earned it", () => {
  const c = card({
    n: 30,
    pocket: { US_PM_MID: { n: 24, hits: 16 }, ASIA_MID: { n: 6, hits: 4 } },
    min_regime_n: INDEX_MIN_REGIME_N,
  });
  assert.equal(voteEligible(c, "US_PM_MID"), true, "the regime with 24 is released");
  assert.equal(voteEligible(c, "ASIA_MID"), false, "a thin regime stays held");
  // Promotion reads the best bucket, so 24 somewhere clears the promotion bar.
  assert.equal(promoteEligible(c), true);
});

test("a perfect small record clears nothing — the bar is sample, not percentage", () => {
  const perfect = card({ n: 17, pocket: { US_PM_MID: { n: 17, hits: 17 } }, min_regime_n: 24 });
  assert.equal(voteEligible(perfect, "US_PM_MID"), false, "17 for 17 is still 17");
  assert.equal(promoteEligible(perfect), false);
});

test("both bars must clear, and the tighter one is reported first", () => {
  const c = card({ n: 5, pocket: { US_PM_MID: { n: 5, hits: 3 } }, min_walkforward_n: 40, min_regime_n: 24 });
  assert.equal(voteHeldReason(c, "US_PM_MID"), "5/40 graded");
  const mid = card({ n: 40, pocket: { US_PM_MID: { n: 12, hits: 7 } }, min_walkforward_n: 40, min_regime_n: 24 });
  assert.equal(voteHeldReason(mid, "US_PM_MID"), "12/24 in US_PM_MID");
});

test("a missing or malformed pocket counts as zero, never as unknown-so-fine", () => {
  assert.equal(regimeN(card({ pocket: {} }), "X"), 0);
  assert.equal(bestRegimeN(card({ pocket: {} })), 0);
  const weird = card({ n: 50, pocket: { X: { n: Number.NaN, hits: 0 } }, min_regime_n: 24 });
  assert.equal(voteEligible(weird, "X"), false);
});

test("INDEX's bar is 24", () => {
  assert.equal(INDEX_MIN_REGIME_N, 24);
});
