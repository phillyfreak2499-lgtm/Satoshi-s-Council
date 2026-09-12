import { test } from "node:test";
import assert from "node:assert/strict";
import { paperBookEdgeOk } from "./book-floor.ts";

/**
 * S2-10 — the paper book's final edge guard.
 *
 * `paperBookEdgeOk` is the pure predicate the live book boundary (server-engine
 * `noteCall`) calls before recording any paper fill: a fill may be booked only when
 * the CURRENT snapshot edge for the side being booked is finite and strictly
 * positive. It reads the same `snap.edge_up` / `snap.edge_down` the Chair's own edge
 * gate reads — no second fair/fee formula.
 *
 * The INTEGRATION — that `noteCall` calls this on `decideChair`'s post-`stickLean`
 * `chair.lean`, after the WAIT early-return and before `noteShadowFill` / `bookable`
 * / `noteEntryState` / the call-log write — is pinned structurally in
 * scripts/desk-safety-rails.test.mjs, because the strip-types runner cannot load
 * server-engine.ts's import graph. These are the executable decision cases.
 */

/** A minimal snapshot slice: the two current-edge fields the guard reads. */
const sides = (edge_up: number, edge_down: number) => ({ edge_up, edge_down });

// 1 — UP + positive current edge → eligible (guard does not block; the book path runs)
test("UP with positive current edge is eligible to fill", () => {
  assert.equal(paperBookEdgeOk(sides(5, -9), "UP"), true);
  assert.equal(paperBookEdgeOk(sides(0.1, -50), "UP"), true);
});

// 2 — DOWN + positive current edge → eligible
test("DOWN with positive current edge is eligible to fill", () => {
  assert.equal(paperBookEdgeOk(sides(-9, 5), "DOWN"), true);
  assert.equal(paperBookEdgeOk(sides(-50, 0.1), "DOWN"), true);
});

// Side selection: UP reads edge_up, DOWN reads edge_down — never the other side's edge.
test("the guard reads the booking side's own edge, not the other side's", () => {
  assert.equal(paperBookEdgeOk(sides(-1, 40), "UP"), false, "UP must not be rescued by a healthy edge_down");
  assert.equal(paperBookEdgeOk(sides(40, -1), "DOWN"), false, "DOWN must not be rescued by a healthy edge_up");
});

// 3 — UP + edge == 0 → no fill
test("UP with edge exactly 0 does not fill", () => {
  assert.equal(paperBookEdgeOk(sides(0, -9), "UP"), false);
});

// 4 — UP + edge < 0 → no fill
test("UP with negative edge does not fill", () => {
  assert.equal(paperBookEdgeOk(sides(-1.6, -9), "UP"), false);
});

// 5 — DOWN + edge == 0 → no fill
test("DOWN with edge exactly 0 does not fill", () => {
  assert.equal(paperBookEdgeOk(sides(-9, 0), "DOWN"), false);
});

// 6 — DOWN + edge < 0 → no fill
test("DOWN with negative edge does not fill", () => {
  assert.equal(paperBookEdgeOk(sides(-9, -3.2), "DOWN"), false);
});

// 7 — non-finite current edge → fail closed
test("a non-finite current edge fails closed (no fill)", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(paperBookEdgeOk(sides(bad, 5), "UP"), false, `UP ${bad}`);
    assert.equal(paperBookEdgeOk(sides(5, bad), "DOWN"), false, `DOWN ${bad}`);
  }
});

// 8 — a sticky / post-stick directional lean cannot bypass the guard.
// The predicate is indifferent to HOW chair.lean became UP/DOWN (fresh, holdScore,
// or the post-runChair stickLean): given a held UP whose current edge is non-positive
// it blocks exactly as for a fresh UP. That noteCall feeds decideChair's post-stick
// chair.lean into this predicate, before any book write, is pinned by the rail.
test("a sticky directional lean cannot bypass the guard — only the current edge decides", () => {
  assert.equal(paperBookEdgeOk(sides(-1.6, -9), "UP"), false, "held UP, edge < 0");
  assert.equal(paperBookEdgeOk(sides(-0.1, -9), "UP"), false, "held UP, edge just below 0");
  assert.equal(paperBookEdgeOk(sides(0, -9), "UP"), false, "held UP, edge exactly 0");
});

// 9 — WAIT unchanged: the predicate's type admits only UP/DOWN, and noteCall returns
// on WAIT before reaching the guard (pinned by the rail). A confirmed side still resolves.
test("the guard is only consulted for a confirmed UP/DOWN side", () => {
  assert.equal(paperBookEdgeOk(sides(5, 5), "UP"), true);
  assert.equal(paperBookEdgeOk(sides(5, 5), "DOWN"), true);
});

// Regression fixture — KXBTC15M-26SEP110445-45: UP, fair 80.4, cents 80, fee 2 → edge_up -1.6.
// The production defect let this book. Expected now: no live (or shadow) fill.
test("regression KXBTC15M-26SEP110445-45: UP edge_up -1.6 is refused", () => {
  assert.equal(paperBookEdgeOk({ edge_up: -1.6, edge_down: -98.0 }, "UP"), false);
});

// Positive-edge held-lean fixture — shape of KXBTC15M-26SEP121830-30: UP, edge_up +12.6.
// The lean was hysteresis-held past the confluence bar, but the CURRENT edge was
// genuinely positive, so the fill stays eligible; the guard must not touch it.
test("held-lean KXBTC15M-26SEP121830-30: UP edge_up +12.6 stays eligible", () => {
  assert.equal(paperBookEdgeOk({ edge_up: 12.6, edge_down: -14.6 }, "UP"), true);
});
