import { test } from "node:test";
import assert from "node:assert/strict";
import { takerFeeCents } from "./clock.ts";
import {
  MIN_CELL_N,
  buildCube,
  confBand,
  cubeDim,
  lookElsewhere,
  marginBand,
  minsBand,
  priceBand,
  spreadBand,
  touchBand,
  wilson,
  type CubeRow,
} from "./cube.ts";

function row(over: Partial<CubeRow> = {}): CubeRow {
  return {
    close_time: 0,
    side: "UP",
    legs: 1,
    settled: true,
    winner: "UP",
    entry: 80,
    ev: 18,
    conf: 75,
    score: 0.5,
    bar: 0.4,
    regime: "US_AM_MID",
    secs_left: 300,
    fair_yes: 85,
    spread: 2,
    leftover: -2,
    touch: 100,
    fee: 2,
    seats: {},
    ...over,
  };
}

/** n calls at one price, `wins` of them won. */
function book(n: number, wins: number, entry = 80, fee = 2): CubeRow[] {
  const out: CubeRow[] = [];
  for (let i = 0; i < n; i++) {
    const won = i < wins;
    out.push(row({ close_time: i * 900_000, winner: won ? "UP" : "DOWN", entry, fee, ev: won ? 100 - entry - fee : -(entry + fee) }));
  }
  return out;
}

test("Wilson brackets the rate and never leaves [0, 1]", () => {
  const mid = wilson(5, 10);
  assert.ok(mid.lo < 0.5 && mid.hi > 0.5);
  // The case the textbook interval gets wrong: everything won, small n.
  const all = wilson(8, 8);
  assert.ok(all.hi <= 1, "upper bound left the unit interval");
  assert.ok(all.lo > 0.5 && all.lo < 1, `8/8 should not imply certainty, got ${all.lo}`);
  const none = wilson(0, 8);
  assert.ok(none.lo >= 0 && none.hi < 0.5);
  // More evidence, tighter interval.
  assert.ok(wilson(80, 100).hi - wilson(80, 100).lo < all.hi - all.lo);
});

test("Wilson on nothing admits it knows nothing", () => {
  assert.deepEqual(wilson(0, 0), { lo: 0, hi: 1 });
});

test("a cell reports its interval, not just its rate", () => {
  const d = cubeDim("one", book(10, 8), () => "cell");
  const c = d.cells[0]!;
  assert.equal(c.calls, 10);
  assert.equal(c.wins, 8);
  assert.equal(c.hit, 80);
  // 8 of 10 is 80% and also plausibly 49%. Printing 80 alone would be the lie.
  assert.ok(c.lo! < 55, `lower bound ${c.lo} is too confident for 8 of 10`);
  assert.ok(c.hi! > 90);
});

test("net cents is the verdict and cannot disagree with the win rate", () => {
  // A high rate on rich contracts that still loses money. The cube must show both
  // and the net must be the one that decides.
  const d = cubeDim("rich", book(20, 15, 95, 1), () => "cell");
  const c = d.cells[0]!;
  assert.equal(c.hit, 75);
  assert.ok(c.needs! > 95, `needs ${c.needs} should reflect the 95¢ price`);
  assert.ok(c.margin! < 0, "a 75% rate at 95¢ must read as short of its bar");
  assert.ok(c.net < 0, `net ${c.net} should be negative`);
  assert.equal(c.clears, false);
});

test("breakeven is the price plus its fee, and matches the desk's own fee", () => {
  const d = cubeDim("p", book(12, 6, 70, takerFeeCents(70)), () => "cell");
  assert.ok(Math.abs(d.cells[0]!.needs! - (70 + takerFeeCents(70))) < 0.05);
});

test("a cell clears only when its whole interval beats its own breakeven", () => {
  // 9 of 10 at 80¢ looks superb; the interval runs down near 60, under the ~82
  // it needed. A point estimate would call this a win. It is not one.
  const flashy = cubeDim("a", book(10, 9), () => "cell").cells[0]!;
  assert.ok(flashy.hit! > flashy.needs!, "the headline rate does beat breakeven");
  assert.equal(flashy.clears, false, "a 10-call cell must not clear on its point estimate");
  // The same rate on real evidence does clear.
  const solid = cubeDim("b", book(200, 180), () => "cell").cells[0]!;
  assert.equal(solid.clears, true);
});

test("a thin cell is shown and never counted as a finding", () => {
  const d = cubeDim("thin", book(MIN_CELL_N - 1, MIN_CELL_N - 1), () => "cell");
  const c = d.cells[0]!;
  assert.equal(c.thin, true);
  assert.equal(c.clears, false, "a perfect thin cell must not clear");
  assert.equal(d.readable, 0);
  assert.equal(d.clearing, 0);
});

test("rows the cut cannot name are counted, not silently dropped", () => {
  const rows = [...book(4, 2), ...book(3, 1).map((r) => ({ ...r, regime: null }))];
  const d = cubeDim("regime", rows, (r) => r.regime);
  assert.equal(d.unknown, 3);
  assert.equal(d.cells.reduce((a, c) => a + c.n, 0), 4);
});

test("windows the book never filled count toward n but not toward the rate", () => {
  // WAIT is honest, and a cut that quietly dropped the WAITs would flatter every
  // rate by hiding how rarely the desk actually pays.
  const rows = [...book(10, 7), ...Array.from({ length: 30 }, () => row({ side: null, entry: null, ev: null }))];
  const c = cubeDim("x", rows, () => "cell").cells[0]!;
  assert.equal(c.n, 40);
  assert.equal(c.calls, 10);
  assert.equal(c.hit, 70);
});

test("the look-elsewhere count states how many chances were taken", () => {
  // Forty readable cells, one clearing. One is roughly what forty chances buy.
  const dims = [
    cubeDim("a", book(200, 180), () => "good"),
    ...Array.from({ length: 39 }, (_, i) => cubeDim(`d${i}`, book(20, 10), () => `c${i}`)),
  ];
  const le = lookElsewhere(dims);
  assert.equal(le.tested, 40);
  assert.equal(le.found, 1);
  assert.equal(le.expected_by_chance, 1);
  assert.match(le.verdict, /not a finding|number of chances/i);
});

test("finding nothing is reported as the answer, not as a gap", () => {
  const le = lookElsewhere([cubeDim("a", book(20, 8), () => "cell")]);
  assert.equal(le.found, 0);
  assert.match(le.verdict, /honest answer/i);
});

test("with nothing readable the cube says so instead of implying a null result", () => {
  const le = lookElsewhere([cubeDim("a", book(3, 3), () => "cell")]);
  assert.equal(le.tested, 0);
  assert.match(le.verdict, /Nothing here is a result/i);
});

test("many clearing cells are still only worth watching, never a rule change", () => {
  const dims = Array.from({ length: 12 }, (_, i) => cubeDim(`d${i}`, book(200, 180), () => `c${i}`));
  const le = lookElsewhere(dims);
  assert.ok(le.found > le.expected_by_chance * 2);
  assert.match(le.verdict, /WATCHING prospectively/);
  assert.match(le.verdict, /not worth changing a rule for/i);
});

test("the cube carries the undivided book, so a cell can be read against it", () => {
  const rows = book(40, 30);
  const c = buildCube(rows, [cubeDim("side", rows, (r) => r.side)]);
  assert.equal(c.n, 40);
  assert.equal(c.calls, 40);
  assert.equal(c.overall.hit, 75);
  assert.equal(c.overall.net, c.dims[0]!.cells[0]!.net);
});

test("a dimension that cannot be cut yet is named, not omitted", () => {
  const c = buildCube(book(5, 3), [], [{ name: "spread", why: "stored from 2026-09-11; 3 graded windows carry it" }]);
  assert.equal(c.not_yet.length, 1);
  assert.match(c.not_yet[0]!.why, /3 graded windows/);
});

test("the bands cover their whole range and never share a value", () => {
  assert.equal(priceBand(59.9), "<60¢");
  assert.equal(priceBand(60), "60-69¢");
  assert.equal(priceBand(69.9), "60-69¢");
  assert.equal(priceBand(70), "70-79¢");
  assert.equal(priceBand(80), "80-89¢");
  assert.equal(priceBand(90), "90¢+");
  assert.equal(priceBand(null), null);
  assert.equal(priceBand(0), null);

  assert.equal(confBand(59), "<60");
  assert.equal(confBand(80), "80+");
  assert.equal(marginBand(0.3, 0.4), "under bar");
  assert.equal(marginBand(0.45, 0.4), "0-0.1 over");
  assert.equal(marginBand(-0.8, 0.4), "0.25+ over", "margin must read the size of the score, not its sign");
  assert.equal(minsBand(59), "<2m");
  assert.equal(minsBand(900), "12m+");
  assert.equal(spreadBand(1), "1¢");
  assert.equal(spreadBand(4.5), "5¢+");
  assert.equal(touchBand(0), "empty");
  assert.equal(touchBand(200), "200+");
  for (const b of [confBand, minsBand, spreadBand, touchBand]) assert.equal(b(null), null);
});

test("a win is money made, not a side that matched", () => {
  // A scalp exited at a profit while the window later went the other way. Judged
  // by side it is a loss; judged by cents it is the win it actually was.
  const scalp = row({ legs: 3, settled: false, side: null, winner: "DOWN", entry: 60, ev: 8 });
  const c = cubeDim("x", [scalp], () => "cell").cells[0]!;
  assert.equal(c.calls, 1);
  assert.equal(c.wins, 1);
  assert.equal(c.net, 8);
});

test("a call with no recoverable side still counts its cents", () => {
  // The retired scalp era lost the most money. A cube that dropped those rows
  // because it could not name their side would flatter the book by 118¢.
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row({ close_time: i * 900_000, legs: 4, settled: false, side: null, entry: 65, ev: -20 })),
    ...book(6, 6),
  ];
  const c = cubeDim("x", rows, () => "cell").cells[0]!;
  assert.equal(c.calls, 12, "side-less calls were dropped");
  assert.equal(c.net, round1(-120 + 6 * 18));
  // And they are still visible as their own cut.
  const d = cubeDim("style", rows, (r) => (r.settled ? "held" : "scalp"));
  assert.equal(d.cells.length, 2);
  assert.equal(d.cells.find((x) => x.key === "scalp")!.net, -120);
});

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

test("the side cut names what it cannot place instead of guessing", () => {
  const rows = [...book(8, 5), ...Array.from({ length: 4 }, () => row({ legs: 5, settled: false, side: null }))];
  const d = cubeDim("side", rows, (r) => r.side);
  assert.equal(d.unknown, 4);
  assert.equal(d.cells.reduce((a, c) => a + c.calls, 0), 8);
});

test("the retired era is reported once and never pooled into a cut", () => {
  // Nearly all of the real loss sits in the retired rows. Pooling them does not
  // add noise — it drags every cut of the current book down by a fixed amount.
  const current = book(20, 16);
  const retired = Array.from({ length: 6 }, (_, i) =>
    row({ close_time: i * 900_000, legs: 4, settled: false, side: null, entry: 65, ev: -20 }),
  );
  const c = buildCube(current, [cubeDim("side", current, (r) => r.side)], [], retired);
  assert.equal(c.n, 20, "the retired rows must not be counted in n");
  assert.equal(c.calls, 20);
  const currentNet = current.reduce((a, r) => a + (r.ev ?? 0), 0);
  assert.equal(c.overall.net, currentNet, "the current book carries only its own cents");
  // The whole point: pooling would move this by the retired era's 120¢, which is
  // three times the current book's own result. (16 of 20 at 80¢ is itself a
  // small loss — 80% against the 82% that price needs — and that is the honest
  // number, not the −160 a pooled cube would print.)
  const pooled = buildCube([...current, ...retired], []);
  assert.equal(pooled.overall.net, currentNet - 120);
  assert.ok(Math.abs(c.overall.net) < Math.abs(pooled.overall.net), "separating the eras must change the answer");
  // The retired rows are present, complete, and separate.
  assert.ok(c.retired_era);
  assert.equal(c.retired_era!.cell.calls, 6);
  assert.equal(c.retired_era!.cell.net, -120);
  assert.match(c.retired_era!.why, /different game/);
  // And they appear in no dimension.
  assert.equal(c.dims[0]!.cells.reduce((a, x) => a + x.calls, 0), 20);
});

test("with no retired rows the block is absent rather than an empty shell", () => {
  const rows = book(12, 9);
  const c = buildCube(rows, []);
  assert.equal(c.retired_era, null);
});

test("an unfilled window belongs to the current book, not to the retired one", () => {
  // The chair was reading it under today's rules and declined to pay. Counting
  // it as retired would understate how often the current desk sits.
  const rows = [...book(5, 4), ...Array.from({ length: 10 }, () => row({ side: null, entry: null, ev: null }))];
  const c = buildCube(rows, []);
  assert.equal(c.n, 15);
  assert.equal(c.calls, 5);
});
