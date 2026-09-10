import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedSideOf, chairDecisionOf } from "./booked-side.ts";

test("a booked call that lost is the opposite of the winner", () => {
  // The window that started this: booked UP at 70c, settled DOWN -> settle 0.
  assert.equal(bookedSideOf(0, "DOWN"), "UP");
  assert.equal(bookedSideOf(0, "UP"), "DOWN");
});

test("a booked call that won is the winner's side", () => {
  assert.equal(bookedSideOf(100, "UP"), "UP");
  assert.equal(bookedSideOf(100, "DOWN"), "DOWN");
});

test("nothing booked or not yet graded -> null", () => {
  assert.equal(bookedSideOf(null, "UP"), null);
  assert.equal(bookedSideOf(undefined, "DOWN"), null);
  assert.equal(bookedSideOf(70, null), null);
  assert.equal(bookedSideOf(0, null), null);
});

test("the 50c boundary counts as a win for the booked side", () => {
  assert.equal(bookedSideOf(50, "UP"), "UP");
  assert.equal(bookedSideOf(49, "UP"), "DOWN");
});

test("a held position is never counted as a sit, even after its lean decayed", () => {
  // The real shape of today's ledger: chair_lean decayed to WAIT by the grade
  // frame while the desk held a position all the way to settlement.
  assert.equal(chairDecisionOf("WAIT", 100, "UP"), "UP");
  assert.equal(chairDecisionOf("WAIT", 0, "UP"), "DOWN");
  assert.equal(chairDecisionOf("WAIT", 100, "DOWN"), "DOWN");
  assert.equal(chairDecisionOf("WAIT", 0, "DOWN"), "UP");
});

test("a genuine sit is a sit, and a read the floor declined stays directional", () => {
  // Nothing booked, so no settlement to recover a side from.
  assert.equal(chairDecisionOf("WAIT", null, "UP"), "WAIT");
  assert.equal(chairDecisionOf(null, null, null), "WAIT");
  assert.equal(chairDecisionOf("", null, "DOWN"), "WAIT");
  // Leaned a side, book never filled: still the chair's read.
  assert.equal(chairDecisionOf("UP", null, "DOWN"), "UP");
  assert.equal(chairDecisionOf("DOWN", null, "UP"), "DOWN");
});

test("an ungraded window falls back to the lean and resolves at the close", () => {
  assert.equal(chairDecisionOf("UP", null, null), "UP");
  assert.equal(chairDecisionOf("WAIT", null, null), "WAIT");
});

test("the decision agrees with the booked side whenever there is one", () => {
  for (const settle of [0, 19, 49, 50, 61, 100]) {
    for (const winner of ["UP", "DOWN"] as const) {
      const booked = bookedSideOf(settle, winner);
      assert.equal(chairDecisionOf("WAIT", settle, winner), booked, `settle ${settle} winner ${winner}`);
    }
  }
});
