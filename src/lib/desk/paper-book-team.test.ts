import { test } from "node:test";
import assert from "node:assert/strict";
import { paperBookTeamOk } from "./book-floor.ts";

/**
 * S2-11 — the paper book's vote floor at pay time.
 *
 * `paperBookTeamOk` is the pure predicate `noteCall` must call before recording
 * a paper fill. Price floor and edge guard stay separate. This one answers:
 * is the TEAM still on this side, on THIS tick, hard enough to pay 80¢?
 *
 * Receipts that proved the hole:
 *   KXBTC15M-26SEP150815-15  0 speaking, booked UP 80¢ → 0  (7:15 empty floor)
 *   KXBTC15M-26SEP150830-30  1–1 / under bar, booked UP 82¢ → 0
 *   KXBTC15M-26SEP150900-00  under bar at 7:50:45, later 0 agree / 1 against
 */

type ChairSlice = {
  hard_fail: boolean;
  score: number;
  bar: number;
  quorum: { up: number; down: number; wait: number };
};

const team = (
  up: number,
  down: number,
  extra: Partial<ChairSlice> = {},
): ChairSlice => ({
  hard_fail: false,
  score: 0.8,
  bar: 0.59,
  quorum: { up, down, wait: 13 },
  ...extra,
});

test("0 agree / 0 against does not fill (7:15 empty floor)", () => {
  assert.equal(paperBookTeamOk(team(0, 0), "UP"), false);
  assert.equal(paperBookTeamOk(team(0, 0), "DOWN"), false);
});

test("0 agree / 1 against does not fill (7:50 screenshot)", () => {
  assert.equal(paperBookTeamOk(team(0, 1), "UP"), false);
});

test("1 agree / 1 against does not fill (7:30 split)", () => {
  assert.equal(paperBookTeamOk(team(1, 1), "UP"), false);
  assert.equal(paperBookTeamOk(team(1, 1), "DOWN"), false);
});

test("1 agree / 0 against does not fill — need two speaking seats", () => {
  assert.equal(paperBookTeamOk(team(1, 0), "UP"), false);
});

test("2 agree / 0 against and bar cleared is eligible", () => {
  assert.equal(paperBookTeamOk(team(2, 0), "UP"), true);
  assert.equal(paperBookTeamOk(team(0, 2), "DOWN"), true);
});

test("3 agree / 1 against and bar cleared is eligible", () => {
  assert.equal(paperBookTeamOk(team(3, 1), "UP"), true);
});

test("3 agree / 0 against but score under the bar does not fill (8:00 at 7:50)", () => {
  assert.equal(
    paperBookTeamOk(team(3, 0, { score: 0.19, bar: 0.55 }), "UP"),
    false,
  );
});

test("hard_fail blocks even a 3–0 room", () => {
  assert.equal(paperBookTeamOk(team(3, 0, { hard_fail: true }), "UP"), false);
});

test("non-finite quorum or bar fails closed", () => {
  assert.equal(
    paperBookTeamOk(team(2, 0, { bar: Number.NaN }), "UP"),
    false,
  );
  assert.equal(
    paperBookTeamOk(team(2, 0, { score: Number.POSITIVE_INFINITY }), "UP"),
    false,
  );
});

test("the booked side's count is what matters, not the other side's crowd", () => {
  assert.equal(paperBookTeamOk(team(0, 4), "UP"), false);
  assert.equal(paperBookTeamOk(team(4, 0), "DOWN"), false);
  assert.equal(paperBookTeamOk(team(0, 4), "DOWN"), true);
});
