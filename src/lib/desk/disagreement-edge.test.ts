import test from "node:test";
import assert from "node:assert/strict";
import { buildDisagreementEdgeReport } from "./disagreement-edge.ts";

test("disagreement edge scores only healthy specialist reads opposite the same-time market favorite", () => {
  const report = buildDisagreementEdgeReport([
    {
      ticker: "KXBTC15M-TEST",
      close_time: 900_000,
      horizon: 450,
      winner: "DOWN",
      market_p: 0.61,
      quotes: { yes_bid: 60, yes_ask: 62, no_bid: 38, no_ask: 40 },
      seats: [
        { seat: "WICK", lean: "DOWN", health: "LIVE", heard: true },
        { seat: "DRIFT", lean: "UP", health: "LIVE", heard: true },
        { seat: "TAPE", lean: "DOWN", health: "DOWN", heard: false },
      ],
    },
    {
      ticker: "KXBTC15M-TEST",
      close_time: 900_000,
      horizon: 300,
      winner: "DOWN",
      market_p: 0.31,
      quotes: { yes_bid: 30, yes_ask: 32, no_bid: 68, no_ask: 70 },
      seats: [
        { seat: "WICK", lean: "UP", health: "LIVE", heard: false },
        { seat: "DRIFT", lean: "DOWN", health: "LIVE", heard: true },
      ],
    },
  ]);

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
  assert.equal(t300.heard_n, 0);
  assert.ok(t300.seat_net_cents < 0);
  assert.ok(t300.market_net_cents > 0);

  assert.equal(report.seats.some((row) => row.seat === "DRIFT"), false, "market-agreeing reads are deliberately ignored");
  assert.equal(report.seats.some((row) => row.seat === "TAPE"), false, "unhealthy reads are deliberately ignored");
});

test("disagreement edge ignores tied market probabilities, unsupported horizons and invalid asks", () => {
  const report = buildDisagreementEdgeReport([
    {
      ticker: "tie",
      close_time: 900_000,
      horizon: 450,
      winner: "UP",
      market_p: 0.5,
      quotes: { yes_bid: 49, yes_ask: 51, no_bid: 49, no_ask: 51 },
      seats: [{ seat: "WICK", lean: "UP", health: "LIVE", heard: true }],
    },
    {
      ticker: "bad",
      close_time: 1_800_000,
      horizon: 450,
      winner: "DOWN",
      market_p: 0.7,
      quotes: { yes_bid: 99, yes_ask: 100, no_bid: 0, no_ask: 1 },
      seats: [{ seat: "WICK", lean: "DOWN", health: "LIVE", heard: true }],
    },
    {
      ticker: "other",
      close_time: 2_700_000,
      horizon: 120,
      winner: "DOWN",
      market_p: 0.7,
      quotes: { yes_bid: 60, yes_ask: 61, no_bid: 39, no_ask: 40 },
      seats: [{ seat: "WICK", lean: "DOWN", health: "LIVE", heard: true }],
    },
  ]);
  assert.equal(report.seats.length, 0);
  assert.equal(report.windows, 0);
});
