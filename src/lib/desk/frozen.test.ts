/**
 * Guards on the two values this desk has frozen by decision, not by accident.
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
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAKER_DEADBAND, TAKER_FROZEN_AT, TAKER_FULL_AT, TAKER_MIN_TRADES, takerSignal } from "./taker.ts";
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
