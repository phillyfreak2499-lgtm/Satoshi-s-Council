/**
 * Guards on the values this desk has frozen by decision, not by accident.
 *
 * TAKER v1 is a prospective experiment: tuning any of its constants mid-flight
 * destroys the out-of-sample record it exists to produce. It is frozen, full
 * stop.
 *
 * The paper book's floor is a different kind of commitment. It is on a
 * deliberate, owner-signed, time-boxed trial at 80¢ with the old 70¢ kept as a
 * shadow book, and the revert is one constant. What this file pins is the
 * SHAPE of that arrangement: that exactly one constant decides live fills,
 * that the shadow floor cannot book, and that the two are not quietly the same
 * number. A floor change is a decision for the owner to make and is expected
 * to come with an update here; TAKER's constants changing is simply a bug.
 *
 * PHASE 2 RESEARCH IS FROZEN AS OF 2026-09-11, for the same reason TAKER is.
 *
 * Every Phase 2 study produced a first reading on data that already existed,
 * and those readings are now known. Moving a bucket edge, a minimum sample, a
 * shrinkage weight or a verdict threshold AFTER seeing them turns a prospective
 * study into a retrospective one: whatever the next sample says, the definition
 * that produced it was chosen partly because of how the last sample looked. The
 * evidence would then be worth nothing, and worse, it would look like evidence.
 *
 * So these constants are pinned here and may change only for a PROVEN
 * CORRECTNESS BUG — a formula that computes something other than what its name
 * and doc say. "A different bucket edge would read better" is not a bug. When a
 * genuine bug is fixed, the record gathered under the old definition has to be
 * discarded or reported separately; it cannot be pooled.
 *
 * Adding a NEW comparison (a benchmark column, another breakdown) is not a
 * change to a frozen definition and is allowed. Changing what an existing number
 * means is not.
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAKER_DEADBAND, TAKER_FROZEN_AT, TAKER_FULL_AT, TAKER_MIN_TRADES, takerSignal } from "./taker.ts";
import { MIN_CELL_N, priceBand, confBand, marginBand, minsBand, spreadBand, touchBand, wilson } from "./cube.ts";
import { MEANINGFUL_CENTS, markOf } from "./excursion.ts";
import { DUPLICATE_PCT, MIN_SWINGS } from "./redundancy.ts";
import { MIN_AGAINST, marketSide } from "./seat-signal.ts";
import { SHRINK_K, Z_BUCKET, Z_MAX, calibrated, freshCalib, zBucket } from "./strike2.ts";
import { MAX_EVENTS, PERSIST_MS, REPLENISH_MS } from "./tape2.ts";
import { VEL2_HORIZONS } from "./vel2.ts";
import {
  CHAIR_FLOOR_SINCE_ISO,
  CHAIR_MIN_ASK_CENTS,
  FLOOR_LIVE_CENTS,
  FLOOR_LIVE_SINCE,
  FLOOR_SHADOW_CENTS,
  bookable,
  bookableShadow,
  floorBreakevenPct,
} from "./book-floor.ts";

test("TAKER v1 constants are exactly as frozen", () => {
  assert.equal(TAKER_FROZEN_AT, "2026-09-09");
  assert.equal(TAKER_MIN_TRADES, 8);
  assert.equal(TAKER_DEADBAND, 0.06);
  assert.equal(TAKER_FULL_AT, 0.25);
});

test("the TAKER signal's eligibility, deadband and confidence rules are unchanged", () => {
  // Too little flow to read: ineligible, whatever the imbalance looks like.
  const thin = takerSignal(0.9, 7);
  assert.equal(thin.eligible, false);
  assert.equal(thin.lean, "WAIT");
  assert.equal(thin.conf, 0);
  assert.ok(Math.abs(thin.imbalance - 0.4) < 1e-9, `imbalance was ${thin.imbalance}`);
  // Eligible but inside the deadband: a real WAIT, not a weak lean.
  const flat = takerSignal(0.55, 20);
  assert.equal(flat.eligible, true);
  assert.equal(flat.lean, "WAIT");
  assert.equal(flat.conf, 0);
  // Past the deadband: a side, with confidence scaling to saturation at TAKER_FULL_AT.
  const up = takerSignal(0.75, 20);
  assert.equal(up.lean, "UP");
  assert.equal(up.conf, 100);
  const down = takerSignal(0.25, 20);
  assert.equal(down.lean, "DOWN");
  assert.equal(down.conf, 100);
  // Just past the deadband is the confidence floor, not a full-strength call.
  const weak = takerSignal(0.5 + TAKER_DEADBAND + 0.001, 20);
  assert.equal(weak.lean, "UP");
  assert.ok(weak.conf >= 50 && weak.conf < 60, `weak conf was ${weak.conf}`);
});

test("the live floor is the trial's 80¢ and the shadow floor is the old 70¢", () => {
  assert.equal(FLOOR_LIVE_CENTS, 80);
  assert.equal(FLOOR_SHADOW_CENTS, 70);
  assert.ok(FLOOR_LIVE_CENTS > FLOOR_SHADOW_CENTS, "the shadow book must be the looser one");
  // Every label on the desk follows the live floor through this one alias, so
  // the trial cannot show 70¢ in a tooltip while booking at 80¢.
  assert.equal(CHAIR_MIN_ASK_CENTS, FLOOR_LIVE_CENTS);
  // The trial has a start, so its record is separable from what motivated it.
  assert.match(FLOOR_LIVE_SINCE, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(FLOOR_LIVE_SINCE) > Date.parse(CHAIR_FLOOR_SINCE_ISO), "the trial starts after the 70¢ era");
  assert.equal(CHAIR_FLOOR_SINCE_ISO, "2026-09-08T20:47:00.000Z", "the 70¢ era's start is history and does not move");
});

test("only the live floor books; the shadow floor never does", () => {
  // The trial's band: a 70-79¢ read is still a read, and still grades seats,
  // but the live book does not pay for it.
  for (const ask of [70, 72, 75, 79, 79.9]) {
    assert.equal(bookable(ask), false, `${ask}¢ must not book live`);
    assert.equal(bookableShadow(ask), true, `${ask}¢ is exactly what the shadow book counts`);
  }
  // At and above the live floor both books fill.
  for (const ask of [80, 85, 99.9]) {
    assert.equal(bookable(ask), true, `${ask}¢ must book live`);
    assert.equal(bookableShadow(ask), true);
  }
  // Under both floors, neither books.
  for (const ask of [1, 50, 69.9]) {
    assert.equal(bookable(ask), false);
    assert.equal(bookableShadow(ask), false);
  }
  // Not a real price, on either book.
  for (const bad of [100, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(bookable(bad), false, `${bad} is not a price`);
    assert.equal(bookableShadow(bad), false, `${bad} is not a price`);
  }
});

test("the trial's bargain is priced honestly: a higher floor needs a higher win rate", () => {
  // 80¢ pays ~18¢ after its fee and loses ~81¢, so the book needs ~82 in 100.
  const live = floorBreakevenPct(FLOOR_LIVE_CENTS);
  const shadow = floorBreakevenPct(FLOOR_SHADOW_CENTS);
  assert.ok(live > 81 && live < 83, `80¢ breakeven was ${live}`);
  assert.ok(shadow > 71 && shadow < 73, `70¢ breakeven was ${shadow}`);
  assert.ok(live > shadow, "the trial buys a better hit rate with a higher bar");
  assert.equal(floorBreakevenPct(0), 0);
  assert.equal(floorBreakevenPct(Number.NaN), 0);
});

test("reverting the trial is one constant: nothing else encodes the live floor", async () => {
  const src = await (await import("node:fs/promises")).readFile("src/lib/desk/book-floor.ts", "utf8");
  // bookable() must read the constant, never a literal.
  assert.match(src, /cents >= FLOOR_LIVE_CENTS/);
  assert.ok(!/cents >= 80\b/.test(src), "the live floor must not be a literal in the gate");
});

/* ---------------------------------------------------------------------------
 * Phase 2, frozen 2026-09-11. See the note at the top of this file for why a
 * post-hoc edit to any of these would void the evidence it is meant to gather.
 * ------------------------------------------------------------------------ */

test("STRIKE 2.0's calibration constants are exactly as frozen", () => {
  assert.equal(Z_BUCKET, 0.25);
  assert.equal(Z_MAX, 3);
  assert.equal(SHRINK_K, 10);
  // And the shrinkage itself: at n = SHRINK_K the bucket and the prior weigh
  // equally. Changing the blend without changing the constant would be the
  // quietest way to move the answer.
  const t = freshCalib();
  for (let i = 0; i < SHRINK_K; i++) calibrated(t, 1, 0.5); // no-op reads
  const table = freshCalib();
  table.set(zBucket(1), { n: SHRINK_K, hits: SHRINK_K });
  assert.ok(Math.abs(calibrated(table, 1, 0.5) - 0.75) < 1e-9, "the 50/50 blend at n = K moved");
  // Buckets are signed and clamp at Z_MAX / Z_BUCKET.
  assert.equal(zBucket(Z_MAX), 12);
  assert.equal(zBucket(-99), -12);
});

test("the cube's cell rules are exactly as frozen", () => {
  assert.equal(MIN_CELL_N, 10);
  // Wilson at 95%, not 90 or 99: widening the interval would make every cell
  // fail to clear, narrowing it would manufacture findings.
  const w = wilson(8, 10);
  assert.ok(Math.abs(w.lo - 0.4901) < 1e-3 && Math.abs(w.hi - 0.9432) < 1e-3, `interval moved: ${w.lo}-${w.hi}`);
  // Every band edge. These decide which calls are compared with which.
  assert.deepEqual(
    [59.99, 60, 69.99, 70, 79.99, 80, 89.99, 90].map(priceBand),
    ["<60¢", "60-69¢", "60-69¢", "70-79¢", "70-79¢", "80-89¢", "80-89¢", "90¢+"],
  );
  assert.deepEqual([59, 60, 69, 70, 79, 80].map(confBand), ["<60", "60-69", "60-69", "70-79", "70-79", "80+"]);
  assert.deepEqual(
    [[0.3, 0.4], [0.45, 0.4], [0.6, 0.4], [0.7, 0.4]].map(([sc, b]) => marginBand(sc!, b!)),
    ["under bar", "0-0.1 over", "0.1-0.25 over", "0.25+ over"],
  );
  assert.deepEqual([59, 120, 300, 600, 720].map(minsBand), ["<2m", "2-4m", "4-8m", "8-12m", "12m+"]);
  assert.deepEqual([1, 2, 4, 5].map(spreadBand), ["1¢", "2¢", "3-4¢", "5¢+"]);
  assert.deepEqual([0, 49, 199, 200].map(touchBand), ["empty", "<50", "50-199", "200+"]);
});

test("MAE/MFE's threshold and marking side are exactly as frozen", () => {
  assert.equal(MEANINGFUL_CENTS, 5);
  // Marked at the bid on the side held. Switching to the ask would add the
  // spread to every MFE and make every exit rule look better than it is.
  const m = { t: 0, yes_bid: 78, yes_ask: 82 };
  assert.equal(markOf("UP", m), 78);
  assert.equal(markOf("DOWN", m), 18);
});

test("the redundancy study's thresholds are exactly as frozen", () => {
  assert.equal(MIN_SWINGS, 10);
  assert.equal(DUPLICATE_PCT, 90);
});

test("the seat-signal study's threshold and market rule are exactly as frozen", () => {
  assert.equal(MIN_AGAINST, 15);
  // The market's side and its implied probability — the benchmark every seat is
  // judged against. An even price favours nobody.
  assert.deepEqual(marketSide(85), { side: "UP", prob: 85 });
  assert.deepEqual(marketSide(15), { side: "DOWN", prob: 85 });
  assert.equal(marketSide(50), null);
});

test("TAPE 2.0 and VEL 2.0 measurement windows are exactly as frozen", () => {
  // The horizons define what "persistent" and "a residual" mean. Sliding them
  // after seeing a result is the same error as moving a bucket edge.
  assert.deepEqual(PERSIST_MS, [5000, 15000, 30000, 60000]);
  assert.deepEqual(VEL2_HORIZONS, [5, 15, 30, 60]);
  assert.equal(REPLENISH_MS, 10_000);
  assert.equal(MAX_EVENTS, 4000);
});

test("the frozen-as-of date is stated in the file that does the freezing", () => {
  // A frozen definition with no date cannot be audited: there is no way to say
  // which records were gathered under it.
  const src = readFileSync(new URL("./frozen.test.ts", import.meta.url), "utf8");
  assert.match(src, /PHASE 2 RESEARCH IS FROZEN AS OF 2026-09-11/);
  assert.match(src, /PROVEN\n \* CORRECTNESS BUG/);
});
