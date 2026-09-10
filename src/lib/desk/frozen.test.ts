/**
 * Guards on the two values this desk has frozen by decision, not by accident.
 *
 * TAKER v1 is a prospective experiment: tuning any of its constants mid-flight
 * destroys the out-of-sample record it exists to produce. The chair's paper
 * book fills at 70¢ or better, and that floor is only to move on out-of-sample
 * evidence with the owner's sign-off — never because a recent slice of history
 * made a different number look good.
 *
 * If a change makes one of these fail, the change is wrong unless the owner
 * has explicitly signed off on moving the line. Editing this file to match new
 * values is not sign-off.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAKER_DEADBAND, TAKER_FROZEN_AT, TAKER_FULL_AT, TAKER_MIN_TRADES, takerSignal } from "./taker.ts";
import { CHAIR_FLOOR_SINCE_ISO, CHAIR_MIN_ASK_CENTS, bookable } from "./book-floor.ts";

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

test("the chair's paper-book floor is still 70¢", () => {
  assert.equal(CHAIR_MIN_ASK_CENTS, 70);
  assert.equal(CHAIR_FLOOR_SINCE_ISO, "2026-09-08T20:47:00.000Z");
});

test("bookable() fills at the floor and refuses under it, at any researched slice", () => {
  assert.equal(bookable(69.9), false);
  assert.equal(bookable(70), true);
  assert.equal(bookable(75), true);
  // A research slice at 80¢ must never become the live gate: 70-79¢ still fills.
  assert.equal(bookable(79), true);
  assert.equal(bookable(99.9), true);
  // Not a real price.
  assert.equal(bookable(100), false);
  assert.equal(bookable(0), false);
  assert.equal(bookable(Number.NaN), false);
});
