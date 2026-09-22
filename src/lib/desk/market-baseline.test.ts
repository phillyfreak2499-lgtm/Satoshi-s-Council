import assert from "node:assert/strict";
import test from "node:test";
import { MARKET_BASELINE, assertBaseline, blindFloor, brierByHorizon, chalkAdjustedWait, cheapFirstTouch, firstTouch, jumpChase, type QuotePath } from "./market-baseline.ts";

const path = (winner: "UP" | "DOWN", ticks: Array<[number, number, number]>, ticker = "T"): QuotePath => ({ ticker, close_ms: 1_790_000_000_000, winner, precision: "whole_cent", ticks: ticks.map(([secs_left, yes_ask, yes_bid]) => ({ secs_left, yes_ask, yes_bid })) });

test("a blind floor result is typed MARKET_BASELINE and can never be presented as a Chair backtest", () => {
  const s = blindFloor([path("UP", [[500, 85, 84]])], 80, 180, 600);
  assert.equal(s.kind, MARKET_BASELINE);
  assert.equal(s.rule, "blind_first_touch_floor_80_180-600s");
  assertBaseline(s);
  assert.throws(() => assertBaseline({ ...s, kind: "CHAIR_BACKTEST" as unknown as typeof MARKET_BASELINE }));
});

test("first touch is one fill per window, inside the band only, YES before NO, never chalk", () => {
  const p = path("DOWN", [[700, 85, 84], [500, 70, 69], [450, 99, 98], [400, 30, 12], [300, 60, 59]]);
  assert.deepEqual(firstTouch(p, 80, 180, 600), { side: "DOWN", ask: 88, secs_left: 400 }, "NO ask = 100 − yes_bid = 88 at 400 s; the 99 at 450 s is chalk and the 85 at 700 s is outside the band");
  assert.equal(firstTouch(p, 95, 180, 600), null);
  const s = blindFloor([p, p], 80, 180, 600);
  assert.equal(s.fills, 2, "two windows, one fill each");
  assert.equal(s.net_cents, 2 * (100 - 88 - 1));
});

test("cheap first touch honours the band and the price range and reports its index", () => {
  const p = path("UP", [[320, 40, 39], [280, 42, 41], [200, 44, 43]]);
  assert.deepEqual(cheapFirstTouch(p, 30, 45, 120, 300), { side: "UP", ask: 42, secs_left: 280, index: 1 });
  assert.equal(cheapFirstTouch(p, 30, 40, 120, 300), null);
});

test("jump chase fires once per window on a ≥2¢ rise inside 60 s", () => {
  const p = path("UP", [[400, 60, 59], [370, 61, 60], [340, 63, 62], [300, 70, 69]]);
  const s = jumpChase([p]);
  assert.equal(s.fills, 1);
  assert.equal(s.avg_ask, 63);
});

test("Brier by horizon reads the last tick inside the grace and counts chalk", () => {
  const p = path("UP", [[190, 60, 58], [178, 70, 68], [60, 99, 98]]);
  const h = brierByHorizon([p], [180, 60]);
  assert.equal(h[0]!.n, 1);
  assert.equal(h[0]!.brier_market, Math.round((0.69 - 1) ** 2 * 10_000) / 10_000);
  assert.equal(h[1]!.chalk_pct, 100);
});

test("chalk-adjusted WAIT keeps both denominators", () => {
  const r = chalkAdjustedWait([{ chair_wait: true, max_ask: 99 }, { chair_wait: true, max_ask: 85 }, { chair_wait: false, max_ask: 85 }, { chair_wait: true, max_ask: 99 }]);
  assert.deepEqual(r, { n: 4, wait_raw_pct: 75, non_chalk_n: 2, wait_ex_chalk_pct: 50, chalk_n: 2 });
});
