import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HIGHER_TIMEFRAME_CONTEXT_VERSION,
  measureHigherTimeframeContext,
  type HigherTimeframeCandle,
} from "./higher-timeframe-context.ts";

const HOUR = 60 * 60_000;
const BASE = Date.parse("2026-09-14T00:00:00Z");

function candles(n: number): HigherTimeframeCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: BASE + i * HOUR,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    closed: i < n - 1,
    source: "binance_vision spot",
  }));
}

test("complete 30-bar input records decision-time 4h and 24h context", () => {
  const asOf = BASE + 29.5 * HOUR;
  const got = measureHigherTimeframeContext({
    as_of_ms: asOf,
    spot: 130,
    ret_15m: 0.001,
    ret_30m: 0.002,
    ret_1h: 0.003,
    candles_1h: candles(30),
  });

  assert.equal(got.version, HIGHER_TIMEFRAME_CONTEXT_VERSION);
  assert.equal(got.authority, "measurement");
  assert.equal(got.quality, "complete");
  assert.equal(got.n_1h, 30);
  assert.deepEqual(got.sources, ["binance_vision spot"]);
  assert.equal(got.latest_age_s, 30 * 60);
  assert.equal(got.latest_closed, false);
  assert.equal(got.coverage.h4.bars, 5);
  assert.equal(got.coverage.h4.span_ms, 4.5 * HOUR);
  assert.equal(got.coverage.h4.complete, true);
  assert.equal(got.coverage.h24.bars, 25);
  assert.equal(got.coverage.h24.span_ms, 24.5 * HOUR);
  assert.equal(got.coverage.h24.complete, true);
  assert.ok(Math.abs(got.returns.ret_4h! - 5 / 125) < 1e-12);
  assert.ok(Math.abs(got.returns.ret_24h! - 25 / 105) < 1e-12);
  assert.equal(got.returns.ret_15m, 0.001);
  assert.equal(got.ranges.h4.low, 124);
  assert.equal(got.ranges.h4.high, 131);
  assert.ok(got.ranges.h4.position! >= 0 && got.ranges.h4.position! <= 1);
});

test("future candles are excluded, so the measurement cannot look ahead", () => {
  const asOf = BASE + 29.5 * HOUR;
  const rows = candles(30);
  rows.push({
    t: asOf + HOUR,
    open: 1,
    high: 1_000_000,
    low: 1,
    close: 1_000_000,
    closed: false,
    source: "future",
  });
  const got = measureHigherTimeframeContext({
    as_of_ms: asOf,
    spot: 130,
    ret_15m: 0,
    ret_30m: 0,
    ret_1h: 0,
    candles_1h: rows,
  });
  assert.equal(got.n_1h, 30);
  assert.ok(!got.sources.includes("future"));
  assert.equal(got.ranges.h24.high, 131);
});

test("short hourly history stays partial and never invents a 24h value", () => {
  const got = measureHigherTimeframeContext({
    as_of_ms: BASE + 10.5 * HOUR,
    spot: 111,
    ret_15m: -0.001,
    ret_30m: -0.002,
    ret_1h: -0.003,
    candles_1h: candles(11),
  });
  assert.equal(got.quality, "partial");
  assert.equal(got.coverage.h4.complete, true);
  assert.equal(got.coverage.h24.complete, false);
  assert.equal(got.returns.ret_24h, null);
  assert.deepEqual(got.ranges.h24, { low: null, high: null, position: null });
});

test("gapped or stale history is numeric but explicitly incomplete", () => {
  const rows = candles(30).filter((_, i) => i !== 12);
  const got = measureHigherTimeframeContext({
    as_of_ms: BASE + 31 * HOUR,
    spot: 130,
    ret_15m: 0,
    ret_30m: 0,
    ret_1h: 0,
    candles_1h: rows,
  });
  assert.equal(got.quality, "partial");
  assert.equal(got.latest_age_s, 2 * 60 * 60);
  assert.equal(got.coverage.h4.complete, false, "latest hourly candle is stale");
  assert.equal(got.coverage.h24.complete, false, "history also contains a two-hour gap");
  assert.ok(got.returns.ret_4h != null && got.returns.ret_24h != null);
});

test("invalid decision inputs produce an unavailable, auditable payload", () => {
  const got = measureHigherTimeframeContext({
    as_of_ms: Number.NaN,
    spot: 0,
    ret_15m: Number.NaN,
    ret_30m: 0,
    ret_1h: Number.POSITIVE_INFINITY,
    candles_1h: candles(30),
  });
  assert.equal(got.quality, "unavailable");
  assert.equal(got.n_1h, 0);
  assert.deepEqual(got.returns, {
    ret_15m: null,
    ret_30m: 0,
    ret_1h: null,
    ret_4h: null,
    ret_24h: null,
  });
});

test("the calculator does not mutate or reorder the caller's candles", () => {
  const rows = candles(30).reverse();
  const before = rows.map((c) => c.t);
  measureHigherTimeframeContext({
    as_of_ms: BASE + 29.5 * HOUR,
    spot: 130,
    ret_15m: 0,
    ret_30m: 0,
    ret_1h: 0,
    candles_1h: rows,
  });
  assert.deepEqual(rows.map((c) => c.t), before);
});
