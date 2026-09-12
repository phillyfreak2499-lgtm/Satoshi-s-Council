/**
 * S2-8 — Chair v2 research-quality alignment + training provenance.
 *
 * Chair v2 trains and scores on the research-quality-valid population only, and
 * records truthful, metadata-only provenance about each fit. The population
 * filter itself lives in SQL (the desk_ledger_research join in refitV2 /
 * refreshV2Stats, asserted by the safety rails, since that query cannot run in
 * this pure test runner). What is proven HERE is everything that is pure:
 *
 *   - the registry predicate the SQL view applies (valid kept, invalid dropped,
 *     valid pre-QTY_FIX rows still eligible — no QTY cutoff),
 *   - the two provenance helpers (deterministic features_version, truthful
 *     trained_through),
 *   - that provenance never changes a prediction, and that a model persisted
 *     before S2-8 (no provenance fields) still loads and predicts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  V2_FEATURES,
  V2_MIN_SAMPLES,
  V2_POPULATION,
  newestTrainedMs,
  predictV2,
  v2FeaturesVersion,
  type V2Features,
  type V2Weights,
} from "./chair-v2.ts";
import { isCountable } from "./research-quality.ts";
import { QTY_FIX_MS } from "./research-era.ts";
import type { Snapshot } from "./types.ts";

// A graded, trained model (n past the shrink floor) so predictV2 exercises the
// weights rather than the thin-ledger market prior.
const baseWeights: V2Weights = {
  w: Object.fromEntries(V2_FEATURES.map((k, i) => [k, (i % 3) - 1])),
  b: 0.1,
  n: V2_MIN_SAMPLES + 500,
  fitted_at: 1_700_000_000_000,
  loss: 0.5,
};
const feats: V2Features = Object.fromEntries(V2_FEATURES.map((k, i) => [k, ((i % 5) - 2) / 4]));
const snap = { yes_mid: 57 } as unknown as Snapshot;

// Windows used across the eligibility tests. The 2026-09-10 07:15–09:00Z block is
// the registered ticker-reuse quarantine; 07:00Z is the one legitimate row.
const VALID_PRE_FIX = "2026-09-08T12:00:00.000Z"; // well before QTY_FIX, not excluded
const VALID_POST_FIX = "2026-09-11T18:00:00.000Z";
const VALID_AT_0700 = "2026-09-10T07:00:00.000Z"; // the legit pre-block row
const INVALID_0800 = "2026-09-10T08:00:00.000Z"; // inside the quarantine
const INVALID_0830 = "2026-09-10T08:30:00.000Z"; // inside the quarantine

test("S2-8 #1/#6-9: a research-invalid window is not countable (excluded from training and v2 scoring)", () => {
  assert.equal(isCountable(INVALID_0800), false);
  assert.equal(isCountable(INVALID_0830), false);
});

test("S2-8 #2: a research-valid window is countable (enters training and v2 scoring)", () => {
  assert.equal(isCountable(VALID_POST_FIX), true);
  assert.equal(isCountable(VALID_AT_0700), true);
});

test("S2-8 #3/#15: a valid PRE-QTY_FIX window stays eligible — no QTY_FIX cutoff is applied", () => {
  // The row predates the phantom-size fix but is research-quality-valid, so the
  // registry keeps it. A QTY_FIX cutoff would wrongly discard it.
  assert.ok(Date.parse(VALID_PRE_FIX) < QTY_FIX_MS, "fixture really is pre-QTY_FIX");
  assert.equal(isCountable(VALID_PRE_FIX), true);
});

test("S2-8 #5: filtering by the registry keeps exactly the valid rows, in order — invalid rows never survive to fill a slot", () => {
  // The SQL join filters before LIMIT 3000; this proves the eligibility predicate
  // it applies drops the invalid windows without disturbing the valid ones.
  const windows = [VALID_PRE_FIX, INVALID_0800, VALID_AT_0700, INVALID_0830, VALID_POST_FIX];
  const kept = windows.filter((c) => isCountable(c));
  assert.deepEqual(kept, [VALID_PRE_FIX, VALID_AT_0700, VALID_POST_FIX]);
});

test("S2-8 #11: a V2Weights persisted before S2-8 (no provenance fields) still loads and predicts", () => {
  const legacy: V2Weights = { w: baseWeights.w, b: baseWeights.b, n: baseWeights.n, fitted_at: 1, loss: 0.5 };
  assert.equal(legacy.population, undefined);
  assert.equal(legacy.trained_through, undefined);
  assert.equal(legacy.features_version, undefined);
  const p = predictV2(legacy, feats, snap);
  assert.ok(Number.isFinite(p) && p >= 0 && p <= 1, "a legacy model still yields a valid probability");
});

test("S2-8 #12: provenance fields do not alter predictV2", () => {
  const withProv: V2Weights = {
    ...baseWeights,
    population: V2_POPULATION,
    trained_through: 1_789_000_000_000,
    features_version: v2FeaturesVersion(),
  };
  const bare: V2Weights = { w: baseWeights.w, b: baseWeights.b, n: baseWeights.n, fitted_at: baseWeights.fitted_at, loss: baseWeights.loss };
  for (const voice of [0, 0.5, 1]) {
    assert.equal(predictV2(withProv, feats, snap, voice), predictV2(bare, feats, snap, voice));
  }
});

test("S2-8 #13: newestTrainedMs reports the newest included sample, order-independently", () => {
  const newest = "2026-09-12T09:15:00.000Z";
  const got = newestTrainedMs([VALID_PRE_FIX, newest, VALID_POST_FIX, new Date(VALID_AT_0700)]);
  assert.equal(got, Date.parse(newest));
  // numbers and Dates are accepted; unparseable values are ignored, not counted.
  assert.equal(newestTrainedMs([1000, 2000, 500]), 2000);
  assert.equal(newestTrainedMs(["not-a-date"]), null);
  assert.equal(newestTrainedMs([]), null);
});

test("S2-8 #14: features_version is deterministic and derived from the actual feature roster", () => {
  assert.equal(v2FeaturesVersion(), v2FeaturesVersion(), "same roster ⇒ identical string");
  assert.match(v2FeaturesVersion(), /^fv-\d+-[0-9a-z]+$/, "stable, roster-derived shape");
  assert.ok(v2FeaturesVersion().startsWith(`fv-${V2_FEATURES.length}-`), "it encodes the real roster size");
  assert.ok(!/\d{10,}/.test(v2FeaturesVersion()), "it is not a timestamp");
});
