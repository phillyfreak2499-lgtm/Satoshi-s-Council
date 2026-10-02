import { test } from "node:test";
import assert from "node:assert/strict";
import { replayCoverage, replayRuns } from "./replay-coverage.ts";

test("price fills cannot bridge a restart outage", () => {
  assert.deepEqual(replayRuns([0, 4, 8, 500, 504], 4000), [
    [0, 1, 2],
    [3, 4],
  ]);
});

test("production restart leaves an explicit 6:38 gap on the original market clock", () => {
  const close = Date.parse("2026-10-01T19:15:00Z");
  const result = replayCoverage(1790881598150, [0, 4, 8, 501.9, 524.3], close, 4000);
  assert.deepEqual(result.gaps[0], { from: 0, to: 398.15 });
  assert.equal(result.startSeconds, 398.15);
  assert.equal(result.endSeconds, 406.15); // Post-close observations do not claim pre-close coverage.
});
test("interior outages and missing tails are distinguished from normal cadence", () => {
  const close = 2_000_000;
  assert.deepEqual(replayCoverage(close - 900_000, [0, 4, 8, 40, 44], close, 4000).gaps, [
    { from: 8, to: 40 },
    { from: 44, to: 900 },
  ]);
  assert.deepEqual(
    replayCoverage(
      close - 900_000,
      Array.from({ length: 226 }, (_, i) => i * 4),
      close,
      4000,
    ).gaps,
    [],
  );
});
