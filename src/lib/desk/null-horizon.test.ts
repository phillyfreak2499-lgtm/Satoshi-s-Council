import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNullHorizonReport,
  renderNullHorizonTable,
  takerFeeAt,
  type NullHorizonArm,
  type NullHorizonReplayRow,
  type NullHorizonReport,
} from "./null-horizon.ts";

const CLOSE = 900_000; // ms; a window opens 15 minutes before its close and t is seconds since open
const T = [450, 720, 840, 885]; // 7:30, 3:00, 1:00 and 0:15 before close

type Quote = { bid: number; ask: number };

function row(opts: {
  close?: number;
  winner: "UP" | "DOWN";
  fair?: (number | null)[];
  quote?: Quote | Quote[];
  seats?: Record<string, number[]>;
}): NullHorizonReplayRow {
  const q = opts.quote;
  const quotes: Quote[] = Array.isArray(q) ? q : T.map(() => q ?? { bid: 84, ask: 85 });
  const close = opts.close ?? CLOSE;
  return {
    close_time: close,
    winner: opts.winner,
    strike: 76_000,
    cols: {
      t0: close - CLOSE,
      t: T,
      spot: T.map(() => 76_000),
      yes_bid: quotes.map((q) => q.bid),
      yes_ask: quotes.map((q) => q.ask),
      fair: opts.fair ?? T.map(() => null),
      seats: opts.seats ?? {},
    },
  };
}

function cell(report: NullHorizonReport, arm: NullHorizonArm, seconds: number) {
  const found = report.cells.find((c) => c.arm === arm && c.seconds === seconds);
  assert.ok(found, `${arm}:${seconds} cell exists`);
  return found;
}

test("the taker fee is the desk's whole-cent Kalshi formula", () => {
  assert.equal(takerFeeAt(80), 2);
  assert.equal(takerFeeAt(85), 1);
  assert.equal(takerFeeAt(50), 2);
  assert.equal(takerFeeAt(95), 1);
  assert.equal(takerFeeAt(Number.NaN), 0);
});

test("NULL books the recorded fair when it clears the ask, the fee and the edge bar", () => {
  const report = buildNullHorizonReport([
    row({ winner: "UP", fair: [95, 95, 95, 95], quote: { bid: 84, ask: 85 } }),
  ]);
  assert.equal(report.windows, 1);
  for (const seconds of [450, 180, 60, 15]) {
    const c = cell(report, "NULL", seconds);
    assert.equal(c.eligible, 1);
    assert.equal(c.taken, 1);
    assert.equal(c.hits, 1);
    assert.equal(c.net_cents, 14); // 100 − 85 ask − 1 fee
    assert.equal(c.net_extra_cost_cents, 13);
    assert.equal(c.max_dd_cents, 0);
    assert.ok(Math.abs(c.brier! - 0.0025) < 1e-9);
    assert.ok(Math.abs(c.market_brier! - (1 - 0.845) ** 2) < 1e-9);
    assert.ok(Math.abs(c.hit_minus_market! - 0.155) < 1e-9);
  }
  // No seat spoke, so every vote arm sits rather than inventing a read.
  for (const arm of ["HEARD", "RAW", "HORIZON"] as const) {
    assert.equal(cell(report, arm, 450).taken, 0);
    assert.equal(cell(report, arm, 450).missing, 0);
  }
});

test("a DOWN read pays 100 minus the yes bid, and losses drive the drawdown", () => {
  const report = buildNullHorizonReport([
    row({ close: CLOSE, winner: "UP", fair: [5, 5, 5, 5], quote: { bid: 10, ask: 12 } }),
    row({ close: CLOSE * 2, winner: "DOWN", fair: [5, 5, 5, 5], quote: { bid: 10, ask: 12 } }),
  ]);
  const c = cell(report, "NULL", 450);
  assert.equal(c.taken, 2);
  assert.equal(c.hits, 1);
  // Loss: −(90 ask + 1 fee). Win: 100 − 90 − 1.
  assert.equal(c.net_cents, -91 + 9);
  assert.equal(c.max_dd_cents, -91);
});

test("the booking rule sits on a sub-floor ask, a capped ask, a wide spread or thin edge", () => {
  const cases: { name: string; quote: Quote; fair: number }[] = [
    { name: "below the 80¢ floor", quote: { bid: 78, ask: 79 }, fair: 95 },
    { name: "above the 98¢ cap", quote: { bid: 98, ask: 99 }, fair: 99 },
    { name: "spread wider than 2¢", quote: { bid: 82, ask: 85 }, fair: 95 },
    { name: "edge under 3¢ after the fee", quote: { bid: 84, ask: 85 }, fair: 88 },
  ];
  for (const k of cases) {
    const report = buildNullHorizonReport([row({ winner: "UP", fair: T.map(() => k.fair), quote: k.quote })]);
    const c = cell(report, "NULL", 450);
    assert.equal(c.eligible, 1, k.name);
    assert.equal(c.taken, 0, k.name);
    assert.equal(c.missing, 0, k.name);
  }
  const missing = buildNullHorizonReport([row({ winner: "UP", fair: [null, null, null, null] })]);
  assert.equal(cell(missing, "NULL", 450).missing, 1);
  assert.equal(cell(missing, "NULL", 450).taken, 0);
});

test("vote arms are walk-forward: a seat earns a voice only from its prior graded reads", () => {
  // ALPHA speaks with conviction at every horizon and is always right.
  const rows = Array.from({ length: 21 }, (_, i) =>
    row({ close: CLOSE * (i + 1), winner: "UP", seats: { ALPHA: [2, 2, 2, 2] } }),
  );
  const report = buildNullHorizonReport(rows);
  assert.equal(report.windows, 21);
  for (const seconds of [450, 180, 60, 15]) {
    // The pooled record gathers four reads per window, so it clears the
    // 20-read minimum after five windows: 16 of 21 windows are bookable.
    assert.equal(cell(report, "HEARD", seconds).eligible, 21);
    assert.equal(cell(report, "HEARD", seconds).taken, 16);
    assert.equal(cell(report, "HEARD", seconds).hits, 16);
    assert.equal(cell(report, "RAW", seconds).taken, 16);
    // The per-horizon record gathers one read per window at that horizon, so
    // HORIZON can only speak in the twenty-first window.
    assert.equal(cell(report, "HORIZON", seconds).taken, 1);
    assert.equal(cell(report, "HORIZON", seconds).hits, 1);
  }
  assert.equal(cell(report, "NULL", 450).missing, 21);
});

test("a later horizon never sees the current window's outcome through an earlier horizon", () => {
  // Twenty prior windows: ALPHA reads only at 7:30 and is always right.
  const prior = Array.from({ length: 20 }, (_, i) =>
    row({ close: CLOSE * (i + 1), winner: "UP", quote: { bid: 89, ask: 90 }, seats: { ALPHA: [2, 0, 0, 0] } }),
  );
  // Window 21: ALPHA says UP at 7:30 and 3:00; the window finishes DOWN.
  const last = row({ close: CLOSE * 21, winner: "DOWN", quote: { bid: 89, ask: 90 }, seats: { ALPHA: [2, 2, 0, 0] } });
  const report = buildNullHorizonReport([...prior, last]);
  // At 7:30 the 20/20 record clears the bar (95.5¢ vs 90¢ ask + 1¢ fee) and loses.
  assert.equal(cell(report, "HEARD", 450).taken, 1);
  assert.equal(cell(report, "HEARD", 450).hits, 0);
  // At 3:00 the record must still be 20/20. Had the 7:30 miss already been
  // booked, the read would fall to 91.3¢ and sit — hiding the second loss.
  assert.equal(cell(report, "HEARD", 180).taken, 1);
  assert.equal(cell(report, "HEARD", 180).hits, 0);
});

test("rows are sorted oldest-first and unreadable rows are skipped without changing the sample", () => {
  const good = row({ close: CLOSE * 2, winner: "UP", fair: [95, 95, 95, 95] });
  const older = row({ close: CLOSE, winner: "DOWN", fair: [5, 5, 5, 5], quote: { bid: 10, ask: 12 } });
  const broken = { ...row({ close: CLOSE * 3, winner: "UP" }), cols: { t0: 0, t: T } } as unknown as NullHorizonReplayRow;
  const report = buildNullHorizonReport([broken, good, older]);
  assert.equal(report.windows, 2);
  assert.deepEqual(report.horizons.map((h) => h.sampled_windows), [2, 2, 2, 2]);
  assert.equal(cell(report, "NULL", 450).taken, 2);
  assert.equal(cell(report, "NULL", 450).hits, 2);
});

test("the gate stays closed while HORIZON has no graded calls, and the table names the study", () => {
  const report = buildNullHorizonReport([row({ winner: "UP", fair: [95, 95, 95, 95] })]);
  assert.equal(report.study, "NULL_HORIZON_V1");
  assert.equal(report.authority, "none");
  assert.equal(report.gate.cleared, false);
  assert.equal(report.gate.horizon_beats_null_brier_450, null);
  assert.equal(report.gate.horizon_beats_null_net_450, false);
  assert.match(report.gate.note, /not cleared/i);
  const table = renderNullHorizonTable(report);
  assert.match(table, /^NULL_HORIZON_V1 {2}authority=none {2}windows=1/);
  assert.match(table, /NULL {5}450/);
});
