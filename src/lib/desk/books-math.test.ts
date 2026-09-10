import { test } from "node:test";
import assert from "node:assert/strict";
import { breakevenPct, mergeShelves, shelfOf } from "./books-math.ts";

test("a book of 70¢ favourites held to settlement needs 72 in 100", () => {
  // 70¢ pays 28¢ after its 2¢ fee when it wins and loses 72¢ when it doesn't.
  assert.equal(breakevenPct(28, 72, 72), 72);
  // No losses yet: charged what a loss would have cost.
  assert.equal(breakevenPct(28, null, 72), 72);
  // No wins yet: paid what a win would have paid.
  assert.equal(breakevenPct(null, 72, 72), 72);
  assert.equal(breakevenPct(null, null, null), null);
  assert.equal(breakevenPct(null, null, 72), 72);
});

test("on decided calls, clearing breakeven is the same thing as a net at or above zero", () => {
  // Mixed sets, including the old ledger's cut prices (a loss that did not go to zero).
  const sets = [
    [28, -72, 28, 28],
    [28, -72, -72, 28],
    [5.4, 5.4, 5.4, -33.6],
    [6, 6, -94, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
    [38, -91],
    [-57, -74, 7, 14, 28],
  ];
  for (const evs of sets) {
    const wins = evs.filter((v) => v > 0);
    const losses = evs.filter((v) => v <= 0);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const be = breakevenPct(wins.length ? avg(wins) : null, losses.length ? -avg(losses) : null, 74);
    const net = evs.reduce((a, b) => a + b, 0);
    const won = (100 * wins.length) / evs.length;
    assert.ok(be != null);
    assert.equal(won >= be, net >= 0, `${JSON.stringify(evs)}: won ${won.toFixed(1)} vs needs ${be.toFixed(1)}, net ${net}`);
  }
});

test("a scratch is neither a win nor a loss, so a set with only scratches to its name is charged a real loss", () => {
  // Fifteen 94¢ winners and one flat settle: no cents were ever lost, so the
  // realized loss is not zero — it is what a loss would have cost. Needs
  // stays near the price plus fee instead of collapsing to 0%.
  const be = breakevenPct(5.7, null, 94.6);
  assert.ok(be != null && be > 94 && be < 95, `needs ${be}`);
});

test("the thin ends fold into one shelf each, in price order", () => {
  assert.equal(shelfOf(0), 0);
  assert.equal(shelfOf(4), 0);
  assert.equal(shelfOf(5), 5);
  assert.equal(shelfOf(8), 8);
  assert.equal(shelfOf(9), 9);
  const shelves = mergeShelves([
    { b: 9, n: 5, wins: 5, losses: 0, avg_entry: 94, win_avg: 5, loss_avg: null, cost_avg: 95, net: 25 },
    { b: 1, n: 1, wins: 0, losses: 1, avg_entry: 19, win_avg: null, loss_avg: 21, cost_avg: 21, net: -21 },
    { b: 7, n: 10, wins: 7, losses: 3, avg_entry: 73.5, win_avg: 24.5, loss_avg: 75.5, cost_avg: 75.5, net: -55 },
    { b: 4, n: 3, wins: 1, losses: 2, avg_entry: 43.5, win_avg: 54.5, loss_avg: 45.5, cost_avg: 45.5, net: -36.5 },
  ]);
  assert.deepEqual(
    shelves.map((s) => [s.lo, s.hi, s.n, s.wins]),
    [
      [0, 50, 4, 1],
      [70, 80, 10, 7],
      [90, 100, 5, 5],
    ],
  );
  // 70s: 7 of 10 won (70%) against needs 75.5 — short, as the net says.
  assert.equal(shelves[1].breakeven, 75.5);
  // 90s with no losses yet: charged what a loss would cost, so needs 95.
  assert.equal(shelves[2].breakeven, 95);
});

test("a merged shelf's price and breakeven are weighted by count, not averaged", () => {
  const [low] = mergeShelves([
    { b: 1, n: 1, wins: 0, losses: 1, avg_entry: 20, win_avg: null, loss_avg: 22, cost_avg: 22, net: -22 },
    { b: 4, n: 3, wins: 1, losses: 2, avg_entry: 40, win_avg: 58, loss_avg: 42, cost_avg: 42, net: -26 },
  ]);
  // (20·1 + 40·3) / 4 = 35, not (20 + 40) / 2 = 30.
  assert.equal(low.avg_entry, 35);
  assert.equal(low.n, 4);
  assert.equal(low.wins, 1);
  assert.equal(low.net, -48);
  // Losses: 22, 42, 42 → 35.33 avg; one win of 58 → needs 35.33 / 93.33 = 37.9.
  assert.equal(low.breakeven, 37.9);
  assert.equal((100 * low.wins) / low.n < low.breakeven, low.net < 0);
});
