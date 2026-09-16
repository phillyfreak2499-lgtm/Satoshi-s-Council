import assert from "node:assert/strict";
import test from "node:test";
import { gavelLeanOf, gavelPaperOf, toGavelRow } from "../src/lib/desk/gavel.ts";

const base = (extra = {}) => ({
  close_time: "2026-09-16T12:00:00.000Z",
  chair_lean: "WAIT",
  chair_conf: 76,
  score: 0,
  bar: 0.62,
  entry_lean: null,
  entry_cents: null,
  entry_conf: null,
  entry_score: null,
  entry_bar: null,
  settle_cents: null,
  ev_cents: null,
  winner: "UP",
  first_directional_lean: null,
  first_directional_conf: null,
  first_directional_score: null,
  first_directional_bar: null,
  ...extra,
});

test("a booked window uses the actual entry-side Chair receipt", () => {
  const row = toGavelRow(base({
    entry_lean: "UP",
    entry_cents: 82,
    entry_conf: 84,
    entry_score: 0.61,
    entry_bar: 0.55,
    settle_cents: 100,
    ev_cents: 16,
    first_directional_lean: "DOWN",
    first_directional_conf: 70,
  }));
  assert.equal(row.lean, "UP");
  assert.equal(row.paper, "FILLED");
  assert.equal(row.conf, 84);
  assert.equal(row.score, 0.61);
  assert.equal(row.entry, 82);
  assert.equal(row.settle, 100);
  assert.equal(row.ev, 16);
});

test("an unbooked first directional Chair read is shown as SKIPPED, never as paper P&L", () => {
  const row = toGavelRow(base({
    winner: "DOWN",
    first_directional_lean: "DOWN",
    first_directional_conf: 81,
    first_directional_score: -0.59,
    first_directional_bar: 0.54,
    // A known market result and even stray ledger economics must not turn a skip
    // into a paper win/loss when no entry receipt exists.
    settle_cents: 100,
    ev_cents: 12,
  }));
  assert.equal(row.lean, "DOWN");
  assert.equal(row.paper, "SKIPPED");
  assert.equal(row.conf, 81);
  assert.equal(row.score, -0.59);
  assert.equal(row.entry, null);
  assert.equal(row.settle, null);
  assert.equal(row.ev, null);
  assert.equal(row.winner, "DOWN");
});

test("a window with no booked or first-directional read remains the recorded Chair state", () => {
  const source = base({ winner: "UP" });
  assert.equal(gavelPaperOf(source), "NONE");
  assert.equal(gavelLeanOf(source), "WAIT");
  const row = toGavelRow(source);
  assert.equal(row.lean, "WAIT");
  assert.equal(row.paper, "NONE");
  assert.equal(row.settle, null);
  assert.equal(row.ev, null);
});
