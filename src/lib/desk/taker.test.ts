import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TAKER_DEADBAND,
  TAKER_MIN_TRADES,
  takerEvCents,
  takerReport,
  type TakerRow,
  takerSignal,
} from "./taker.ts";

const fee = () => 1; // fixed 1¢ fee, so EV maths is easy to check

// --- the frozen signal ---

test("too few taker prints is ineligible — no call", () => {
  const s = takerSignal(0.9, TAKER_MIN_TRADES - 1);
  assert.equal(s.eligible, false);
  assert.equal(s.lean, "WAIT");
  assert.equal(s.conf, 0);
});

test("flow inside the deadband is eligible but WAIT", () => {
  const s = takerSignal(0.5 + TAKER_DEADBAND - 0.01, 40);
  assert.equal(s.eligible, true);
  assert.equal(s.lean, "WAIT");
  assert.equal(s.conf, 0);
});

test("clear YES flow calls UP, clear NO flow calls DOWN", () => {
  assert.equal(takerSignal(0.72, 40).lean, "UP");
  assert.equal(takerSignal(0.28, 40).lean, "DOWN");
});

test("confidence scales with imbalance and saturates at 100", () => {
  const weak = takerSignal(0.5 + TAKER_DEADBAND + 0.001, 40); // just past the deadband
  const strong = takerSignal(0.95, 40); // well past saturation
  assert.ok(weak.conf >= 50 && weak.conf < 60, `weak conf ${weak.conf}`);
  assert.equal(strong.conf, 100);
  assert.ok(strong.conf > weak.conf);
});

test("a directional call always carries at least 50 confidence, WAIT carries 0", () => {
  assert.ok(takerSignal(0.66, 40).conf >= 50);
  assert.equal(takerSignal(0.5, 40).conf, 0);
});

test("garbage inputs default to no clear side", () => {
  assert.equal(takerSignal(NaN, 40).lean, "WAIT");
  assert.equal(takerSignal(0.9, NaN).eligible, false);
});

// --- EV grading (same rule the desk uses) ---

test("EV after fees: a winning UP fill, a losing one, and WAIT", () => {
  assert.equal(takerEvCents("UP", 60, "UP", fee), 100 - 60 - 1); // +39
  assert.equal(takerEvCents("UP", 60, "DOWN", fee), -60 - 1); // -61
  assert.equal(takerEvCents("WAIT", null, "UP", fee), 0);
  assert.equal(takerEvCents("DOWN", 45, "DOWN", fee), 100 - 45 - 1); // +54
});

// --- the experiment read-out ---

const row = (o: Partial<TakerRow>): TakerRow => ({
  eligible: true,
  lean: "UP",
  conf: 70,
  regime: "trend",
  winner: "UP",
  ev_cents: 30,
  chair_lean: "WAIT",
  ...o,
});

test("counts separate eligible observations from actual directional calls", () => {
  const rows = [
    row({ eligible: false, lean: "WAIT", conf: 0 }), // not eligible
    row({ eligible: true, lean: "WAIT", conf: 0 }), // eligible, no side
    row({ eligible: true, lean: "UP" }), // a call
    row({ eligible: true, lean: "DOWN", winner: "UP", ev_cents: -50 }), // a call (wrong)
  ];
  const r = takerReport(rows);
  assert.equal(r.n_sampled, 4);
  assert.equal(r.n_eligible, 3);
  assert.equal(r.n_calls, 2);
  assert.equal(r.n_graded_calls, 2);
  assert.equal(r.raw_accuracy, 0.5); // one right, one wrong
});

test("net EV and per-call EV are after fees, calls only", () => {
  const rows = [row({ lean: "UP", winner: "UP", ev_cents: 40 }), row({ lean: "DOWN", winner: "UP", ev_cents: -60 })];
  const r = takerReport(rows);
  assert.equal(r.net_ev_cents, -20);
  assert.equal(r.ev_per_call, -10);
});

test("calibration buckets split hits by confidence", () => {
  const rows = [
    row({ conf: 55, winner: "UP", lean: "UP" }), // 50-59 hit
    row({ conf: 95, winner: "DOWN", lean: "UP" }), // 90-100 miss
    row({ conf: 92, winner: "UP", lean: "UP" }), // 90-100 hit
  ];
  const r = takerReport(rows);
  const b90 = r.calibration.find((b) => b.bucket === "90-100");
  assert.equal(b90?.n, 2);
  assert.equal(b90?.hit_rate, 0.5);
  assert.equal(r.calibration.find((b) => b.bucket === "50-59")?.hit_rate, 1);
});

test("performance splits by regime and when the chair waited", () => {
  const rows = [
    row({ regime: "trend", chair_lean: "WAIT", lean: "UP", winner: "UP", ev_cents: 30 }),
    row({ regime: "chop", chair_lean: "UP", lean: "UP", winner: "DOWN", ev_cents: -70 }),
    row({ regime: "trend", chair_lean: "WAIT", lean: "DOWN", winner: "DOWN", ev_cents: 20 }),
  ];
  const r = takerReport(rows);
  const trend = r.by_regime.find((x) => x.regime === "trend");
  assert.equal(trend?.n, 2);
  assert.equal(trend?.hit_rate, 1);
  assert.equal(r.when_chair_wait.n, 2); // the two windows where the chair sat
  assert.equal(r.when_chair_wait.hit_rate, 1);
  assert.equal(r.when_chair_wait.ev, 50);
});

test("incremental value: taker on windows where the Council waited or was wrong", () => {
  const rows = [
    row({ chair_lean: "WAIT", lean: "UP", winner: "UP", ev_cents: 30 }), // chair sat, taker right
    row({ chair_lean: "DOWN", lean: "UP", winner: "UP", ev_cents: 30 }), // chair wrong, taker right
    row({ chair_lean: "UP", lean: "UP", winner: "UP", ev_cents: 30 }), // chair right — not in the gap set
  ];
  const r = takerReport(rows);
  assert.equal(r.incremental.n_chair_wait_or_wrong, 2);
  assert.equal(r.incremental.taker_hit_rate, 1);
  // vs-chair tallies (only windows where both made a directional call)
  assert.equal(r.vs_chair.taker_right_chair_wrong, 1);
  assert.equal(r.vs_chair.both_right, 1);
});

test("empty history yields nulls, never NaN — nothing to judge yet", () => {
  const r = takerReport([]);
  assert.equal(r.n_calls, 0);
  assert.equal(r.raw_accuracy, null);
  assert.equal(r.ev_per_call, null);
  assert.equal(r.vs_chair.agree_rate, null);
});
