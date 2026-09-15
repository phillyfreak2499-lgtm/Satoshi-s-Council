import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOK_MIN_SPEAKING, paperBookTeamOk } from "./book-floor.ts";

const team = (
  over: Partial<{
    hard_fail: boolean;
    score: number;
    bar: number;
    up: number;
    down: number;
    wait: number;
  }> = {},
) => ({
  hard_fail: over.hard_fail ?? false,
  score: over.score ?? 0.8,
  bar: over.bar ?? 0.59,
  quorum: { up: over.up ?? 3, down: over.down ?? 0, wait: over.wait ?? 15 },
});

test("BOOK_MIN_SPEAKING is two", () => {
  assert.equal(BOOK_MIN_SPEAKING, 2);
});

test("3-0 cleared bar fills UP", () => {
  assert.equal(paperBookTeamOk(team({ up: 3, down: 0 }), "UP"), true);
});

test("3-0 cleared bar fills DOWN", () => {
  assert.equal(paperBookTeamOk(team({ up: 0, down: 3, score: -0.8 }), "DOWN"), true);
});

test("7:15 empty floor 0-0 does not fill", () => {
  assert.equal(paperBookTeamOk(team({ up: 0, down: 0 }), "UP"), false);
});

test("7:50 0-1 does not fill", () => {
  assert.equal(paperBookTeamOk(team({ up: 0, down: 1 }), "UP"), false);
});

test("7:30 1-1 does not fill", () => {
  assert.equal(paperBookTeamOk(team({ up: 1, down: 1 }), "UP"), false);
});

test("one seat is not a team", () => {
  assert.equal(paperBookTeamOk(team({ up: 1, down: 0 }), "UP"), false);
});

test("2-1 majority fills", () => {
  assert.equal(paperBookTeamOk(team({ up: 2, down: 1 }), "UP"), true);
});

test("under bar does not fill", () => {
  assert.equal(paperBookTeamOk(team({ up: 3, down: 0, score: 0.5, bar: 0.59 }), "UP"), false);
});

test("hard_fail blocks", () => {
  assert.equal(paperBookTeamOk(team({ hard_fail: true }), "UP"), false);
});

test("DOWN is not rescued by UP quorum", () => {
  assert.equal(paperBookTeamOk(team({ up: 4, down: 0, score: -0.8 }), "DOWN"), false);
});
