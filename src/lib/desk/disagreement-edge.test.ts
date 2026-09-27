import test from "node:test";
import assert from "node:assert/strict";
import { buildDisagreementEdgeReport } from "./disagreement-edge.ts";

test("disagreement edge scores only specialist reads opposite the same-time market favorite", () => {
  const report = buildDisagreementEdgeReport([{
    close_time: 900_000,
    winner: "DOWN",
    cols: {
      t0: 0,
      t: [450, 600, 720],
      yes_bid: [60, 30, 55],
      yes_ask: [62, 32, 57],
      seats: {
        WICK: [-2, 2, 0],
        DRIFT: [2, -2, 0],
      },
    },
  }]);

  assert.equal(report.windows, 1);
  const wick = report.seats.find((row) => row.seat === "WICK");
  assert.ok(wick);
  assert.equal(wick.disagreements, 2);

  const t450 = wick.cells.find((cell) => cell.seconds === 450)!;
  assert.equal(t450.disagreement_n, 1);
  assert.equal(t450.seat_hits, 1);
  assert.equal(t450.market_hits, 0);
  assert.equal(t450.seat_wr_pct, 100);
  assert.equal(t450.market_wr_pct, 0);
  assert.ok(t450.seat_net_cents > 0);
  assert.ok(t450.market_net_cents < 0);
  assert.ok(t450.net_delta_cents > 0);
  assert.equal(t450.heard_n, 1);

  const t300 = wick.cells.find((cell) => cell.seconds === 300)!;
  assert.equal(t300.disagreement_n, 1);
  assert.equal(t300.seat_hits, 0);
  assert.equal(t300.market_hits, 1);
  assert.ok(t300.seat_net_cents < 0);
  assert.ok(t300.market_net_cents > 0);

  assert.equal(report.seats.some((row) => row.seat === "DRIFT"), false, "market-agreeing reads are deliberately ignored");
});

test("disagreement edge ignores tied market mids and invalid quotes", () => {
  const report = buildDisagreementEdgeReport([{
    close_time: 900_000,
    winner: "UP",
    cols: {
      t0: 0,
      t: [450, 600, 720],
      yes_bid: [49, 0, 80],
      yes_ask: [51, 20, 79],
      seats: { WICK: [2, -2, -2] },
    },
  }]);
  assert.equal(report.seats.length, 0);
});
