import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INTEGRATION_GAP_MS,
  WINDOW_PATH_MS,
  measureWindowPath,
  type WindowPathInput,
} from "./window-path.ts";

const close = Date.UTC(2026, 8, 15, 18, 0, 0);
const open = close - WINDOW_PATH_MS;
const strike = 100;

function input(priceAt: (seconds: number) => number, keep: (seconds: number) => boolean = () => true): WindowPathInput {
  const t: number[] = [];
  const spot: number[] = [];
  for (let seconds = 0; seconds <= 900; seconds += 4) {
    if (!keep(seconds)) continue;
    t.push(seconds);
    spot.push(priceAt(seconds));
  }
  return { t0: open, t, spot, strike, close_time: close };
}

test("a complete monotonic path is measured without inventing missing time", () => {
  const result = measureWindowPath(input((seconds) => 101 + seconds / 900));
  assert.ok(result);
  assert.equal(result.quality, "complete");
  assert.equal(result.strike_crossings, 0);
  assert.equal(result.time_above_s, 900);
  assert.equal(result.time_below_s, 0);
  assert.equal(result.unmeasured_s, 0);
  assert.equal(result.coverage_ratio, 1);
  assert.equal(result.path_efficiency, 1);
  assert.equal(result.minute_down, 0);
  assert.ok(result.minute_up >= 14);
  assert.ok(result.early_move_bps != null);
  assert.ok(result.middle_move_bps != null);
  assert.ok(result.final_move_bps != null);
});

test("strict side changes count once even when a sample lands exactly on strike", () => {
  const result = measureWindowPath(
    input((seconds) => {
      if (seconds < 300) return 99;
      if (seconds === 300) return 100;
      if (seconds < 600) return 101;
      if (seconds === 600) return 100;
      return 99;
    }),
  );
  assert.ok(result);
  assert.equal(result.strike_crossings, 2);
  assert.ok(result.time_above_s > 0);
  assert.ok(result.time_below_s > 0);
});

test("time allocation interpolates a crossing but never across an oversized feed gap", () => {
  const result = measureWindowPath(
    input(
      (seconds) => 99 + seconds / 450,
      (seconds) => seconds < 400 || seconds > 440,
    ),
  );
  assert.ok(result);
  assert.equal(result.quality, "partial");
  assert.ok(result.max_gap_s * 1000 > MAX_INTEGRATION_GAP_MS);
  assert.ok(result.unmeasured_s >= 40);
  assert.ok(result.integrated_s < result.observed_s);
});

test("minute direction changes describe chop without creating more Council votes", () => {
  const result = measureWindowPath(
    input((seconds) => {
      const minute = Math.floor(seconds / 60);
      const inside = (seconds % 60) / 60;
      return minute % 2 === 0 ? 100 + inside : 101 - inside;
    }),
  );
  assert.ok(result);
  assert.ok(result.minute_direction_changes >= 10);
  assert.ok(result.minute_up > 0);
  assert.ok(result.minute_down > 0);
  assert.ok(result.path_efficiency < 0.2);
});

test("largest jump share distinguishes a one-jump path from a smooth path", () => {
  const smooth = measureWindowPath(input((seconds) => 100 + seconds / 900));
  const jump = measureWindowPath(input((seconds) => (seconds < 452 ? 100 : 101)));
  assert.ok(smooth && jump);
  assert.ok(jump.largest_jump_share > 0.95);
  assert.ok(smooth.largest_jump_share < 0.02);
});

test("malformed or mismatched replay columns fail closed", () => {
  assert.equal(
    measureWindowPath({ t0: open, t: [0, 4, 8], spot: [100, 101], strike, close_time: close }),
    null,
  );
  assert.equal(
    measureWindowPath({ t0: open, t: [0, 8, 4], spot: [100, 101, 102], strike, close_time: close }),
    null,
  );
  assert.equal(
    measureWindowPath({ t0: open, t: [0, 4, 8], spot: [100, Number.NaN, 102], strike, close_time: close }),
    null,
  );
  assert.equal(
    measureWindowPath({ t0: open, t: [0, 4, 8], spot: [100, 101, 102], strike: 0, close_time: close }),
    null,
  );
});

test("a replay that begins late is explicitly partial", () => {
  const full = input((seconds) => 100 + seconds / 900, (seconds) => seconds >= 120);
  const result = measureWindowPath(full);
  assert.ok(result);
  assert.equal(result.quality, "partial");
  assert.ok(result.coverage_ratio < 0.9);
  assert.equal(result.early_move_bps, null);
});
