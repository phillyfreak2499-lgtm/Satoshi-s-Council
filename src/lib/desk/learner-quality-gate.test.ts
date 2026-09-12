/**
 * S2-9 — the online learner's prospective research-quality gate.
 *
 * The gate lives at the learner-update boundary in applyGrade (server-engine.ts):
 *   if (isCountable(snap.close_time)) { gradeWindow(...); settleAll(...); reviewSeats(...); }
 * so a research-invalid window teaches the learner nothing, while the ledger row is
 * still recorded. server-engine.ts and learner.ts cannot be loaded by this pure test
 * runner (deep extensionless import graph), so the "no learner mutation" structure is
 * held by the safety rail (scripts/desk-safety-rails.test.mjs). What is proven HERE is
 * the DECISION the gate makes — the canonical registry verdict on each window class —
 * which is exactly what decides whether the learner is taught.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isCountable } from "./research-quality.ts";
import { QTY_FIX_MS } from "./research-era.ts";

// The registered stale-ticker quarantine is 2026-09-10 07:15:00Z–09:00:00Z. 07:00Z is the
// one legitimate pre-block row (the window the CASCADE×8 / CHAIN×2 credits came from sat
// inside the block).
const VALID_RECENT = "2026-09-12T13:15:00.000Z";
const VALID_PRE_QTY_FIX = "2026-09-08T12:00:00.000Z"; // before QTY_FIX, research-quality-valid
const VALID_AT_0700 = "2026-09-10T07:00:00.000Z"; // legit row just before the block
const INVALID_0800 = "2026-09-10T08:00:00.000Z"; // inside the quarantine block
const INVALID_0830 = "2026-09-10T08:30:00.000Z"; // inside the quarantine block

test("S2-9 #1: a research-quality-valid window is countable → the learner is taught", () => {
  assert.equal(isCountable(VALID_RECENT), true);
  assert.equal(isCountable(VALID_AT_0700), true);
});

test("S2-9 #2-8: a research-invalid (quarantined) window is NOT countable → the learner update is skipped", () => {
  // The gate is `if (isCountable(close_time))`, so false here means gradeWindow / settleAll /
  // reviewSeats never run for this window: no seat_n, seat_hits, seat_recent, skills, fade,
  // scalp/calibration, or graded_windows mutation. (Structure asserted by the S2-9 rail.)
  assert.equal(isCountable(INVALID_0800), false);
  assert.equal(isCountable(INVALID_0830), false);
});

test("S2-9 #9/#10: a valid PRE-QTY_FIX window stays countable — no QTY_FIX cutoff is introduced", () => {
  assert.ok(Date.parse(VALID_PRE_QTY_FIX) < QTY_FIX_MS, "fixture really is pre-QTY_FIX");
  assert.equal(isCountable(VALID_PRE_QTY_FIX), true);
});

test("S2-9: unparseable quality identity follows canonical isCountable semantics (not a permissive fallback)", () => {
  // qualityOf treats an unreadable close time as 'suspect' → not countable → the learner is
  // not taught. No invented permissive fallback.
  assert.equal(isCountable("not-a-date"), false);
  assert.equal(isCountable(null), false);
  assert.equal(isCountable(undefined), false);
});

test("S2-9: the quarantine boundary is exact — windows just outside the block remain countable", () => {
  assert.equal(isCountable("2026-09-10T07:14:59.000Z"), true); // one second before the block
  assert.equal(isCountable("2026-09-10T09:00:00.000Z"), false); // inclusive end of the block
  assert.equal(isCountable("2026-09-10T09:15:00.000Z"), true); // one window after the block
});
