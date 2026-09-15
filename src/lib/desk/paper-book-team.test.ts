import { test } from "node:test";
import assert from "node:assert/strict";
import { paperBookTeamOk } from "./book-floor.ts";

/**
 * Pay-time vote floor — the paper book may not pay unless the CURRENT chair
 * still has a team on that side. Integration (noteCall calls this after
 * paperBookEdgeOk and before noteShadowFill / bookable / call-log write)
 * is pinned structurally in scripts/desk-safety-rails.test.mjs.
 */

const team = (
  up: number,
  down: number,
  extra: Partial<{ hard_fail: boolean; score: number; bar: number; wait: number }> = {},
) => ({
  hard_fail: extra.hard_fail ?? false,
  score: extra.score ?? 0.8,
  bar: extra.bar ?? 0.5,
  quorum: { up, down, wait: extra.wait ?? 15 },
});

test("2+ speaking on UP and net > 0 is eligible", () => {
  assert.equal(paperBookTeamOk(team(2, 0), "UP"), true);
  assert.equal(paperBookTeamOk(team(3, 1), "UP"), true);
  assert.equal(paperBookTeamOk(team(0, 2, { score: -0.8 }), "DOWN"), true);
});

test("empty floor (0-0) does not fill — 7:15 AM 2026-09-15", () => {
  assert.equal(paperBookTeamOk(team(0, 0, { score: 0.1, bar: 0.59 }), "UP"), false);
});

test("0 agree / 1 against does not fill — 7:50 AM 2026-09-15 screenshot", () => {
  assert.equal(paperBookTeamOk(team(0, 1), "UP"), false);
});

test("1-1 split does not fill — 7:30 AM 2026-09-15", () => {
  assert.equal(paperBookTeamOk(team(1, 1), "UP"), false);
});

test("a single speaking seat is not a team", () => {
  assert.equal(paperBookTeamOk(team(1, 0), "UP"), false);
  assert.equal(paperBookTeamOk(team(0, 1), "DOWN"), false);
});

test("hard_fail blocks even a 7-0 room", () => {
  assert.equal(paperBookTeamOk(team(0, 7, { hard_fail: true, score: -0.8 }), "DOWN"), false);
});

test("score under the bar now does not fill — sticky lean cannot pay", () => {
  assert.equal(paperBookTeamOk(team(3, 0, { score: 0.2, bar: 0.59 }), "UP"), false);
  assert.equal(paperBookTeamOk(team(3, 0, { score: 0.59 * 0.35, bar: 0.59 }), "UP"), false);
});

test("non-finite score or bar fails closed", () => {
  assert.equal(paperBookTeamOk(team(3, 0, { score: NaN }), "UP"), false);
  assert.equal(paperBookTeamOk(team(3, 0, { bar: Infinity }), "UP"), false);
});

test("12:15 AM 2026-09-15 7-0 DOWN still eligible", () => {
  assert.equal(paperBookTeamOk(team(0, 7, { score: -0.8, bar: 0.4 }), "DOWN"), true);
});
