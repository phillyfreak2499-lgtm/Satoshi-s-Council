import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedSideOf } from "./booked-side.ts";

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
