import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeatHorizonReport,
  HORIZON_SAMPLE_TOLERANCE_S,
  type HorizonReplayRow,
} from "./horizon-calibration.ts";

const CLOSE = 900_000;

function row(
  winner: "UP" | "DOWN",
  t: number[],
  seats: Record<string, number[]>,
): HorizonReplayRow {
  return { close_time: CLOSE, winner, cols: { t0: 0, t, seats } };
}

test("grades raw and Chair-heard reads separately at fixed horizons", () => {
  const report = buildSeatHorizonReport([
    row("UP", [0, 450, 720, 840, 885], {
      ALPHA: [0, 2, -1, 1, -2],
    }),
  ]);
  assert.equal(report.windows, 1);
  assert.deepEqual(report.horizons.map((h) => h.sampled_windows), [1, 1, 1, 1]);
  const alpha = report.seats[0]!;
  assert.equal(alpha.seat, "ALPHA");
  assert.deepEqual(alpha.horizons, [
    { seconds: 450, raw_n: 1, raw_hits: 1, heard_n: 1, heard_hits: 1, raw_rate: 1, heard_rate: 1 },
    { seconds: 180, raw_n: 1, raw_hits: 0, heard_n: 0, heard_hits: 0, raw_rate: 0, heard_rate: null },
    { seconds: 60, raw_n: 1, raw_hits: 1, heard_n: 0, heard_hits: 0, raw_rate: 1, heard_rate: null },
    { seconds: 15, raw_n: 1, raw_hits: 0, heard_n: 1, heard_hits: 0, raw_rate: 0, heard_rate: 0 },
  ]);
});

test("uses the nearest recorded sample and rejects one outside tolerance", () => {
  const inside = 450 + HORIZON_SAMPLE_TOLERANCE_S;
  const outside = 720 + HORIZON_SAMPLE_TOLERANCE_S + 0.1;
  const report = buildSeatHorizonReport([
    row("DOWN", [inside, outside], { BETA: [-2, -2] }),
  ]);
  assert.deepEqual(report.horizons.map((h) => h.sampled_windows), [1, 0, 0, 0]);
  const beta = report.seats[0]!;
  assert.equal(beta.horizons[0]!.raw_rate, 1);
  assert.equal(beta.horizons[0]!.heard_rate, 1);
  assert.equal(beta.horizons[1]!.raw_n, 0);
});

test("ignores quiet, malformed, and missing seat values instead of inventing reads", () => {
  const report = buildSeatHorizonReport([
    row("UP", [450, 720, 840, 885], {
      ALPHA: [0, 3, 2],
      BETA: [1, -1, -2, 2],
    }),
  ]);
  const alpha = report.seats.find((x) => x.seat === "ALPHA")!;
  assert.equal(alpha.horizons[0]!.raw_n, 0);
  assert.equal(alpha.horizons[1]!.raw_n, 0);
  assert.equal(alpha.horizons[2]!.heard_n, 1);
  assert.equal(alpha.horizons[3]!.raw_n, 0);
  const beta = report.seats.find((x) => x.seat === "BETA")!;
  assert.deepEqual(beta.horizons.map((x) => x.raw_hits), [1, 0, 0, 1]);
});

test("skips an unreadable replay row without changing the valid sample", () => {
  const bad = row("UP", [450], { BAD: [2] });
  bad.close_time = "not-a-time";
  const report = buildSeatHorizonReport([
    bad,
    row("UP", [450], { GOOD: [2] }),
  ]);
  assert.equal(report.windows, 1);
  assert.deepEqual(report.seats.map((x) => x.seat), ["GOOD"]);
});
