import assert from "node:assert/strict";
import test from "node:test";
import { takerFeeCents, takerFeeCentsExact } from "./clock.ts";
import {
  DEFAULT_FEE_ENGINE, FEE_ENGINES, allInCostCents, edgeCents, feeCents, feeFingerprint, feeTable, holdNetCents,
  neededWinRatePct, realAskCents,
} from "./fee-engine.ts";

test("the fingerprint of the charged engine is frozen", () => {
  assert.equal(feeFingerprint(), "KALSHI_TAKER_7PCT_CEIL_CENT_V1|rate=0.07|ceil_whole_cent|ASSUMED");
  assert.equal(feeFingerprint("KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1"), "KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1|rate=0.07|ceil_centicent|ASSUMED");
  assert.equal(DEFAULT_FEE_ENGINE, "KALSHI_TAKER_7PCT_CEIL_CENT_V1");
  for (const e of Object.values(FEE_ENGINES)) assert.equal(e.provenance, "ASSUMED");
});

test("whole-cent boundaries: 2¢ through 82¢, 1¢ from 83¢, and the engine equals clock.ts exactly", () => {
  const expect: Array<[number, number]> = [[1, 1], [50, 2], [79, 2], [80, 2], [82, 2], [83, 1], [84, 1], [85, 1], [90, 1], [95, 1], [98, 1], [99, 1]];
  for (const [ask, fee] of expect) {
    assert.equal(feeCents(ask), fee, `ask ${ask}`);
    assert.equal(feeCents(ask), takerFeeCents(ask), `parity ${ask}`);
    assert.equal(feeCents(ask, "KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1"), takerFeeCentsExact(ask), `exact parity ${ask}`);
  }
  // The boundary: 7 · 0.82 · 0.18 = 1.0332 → 2¢; 7 · 0.83 · 0.17 = 0.9877 → 1¢.
  assert.equal(feeCents(82), 2);
  assert.equal(feeCents(83), 1);
});

test("unreal asks are rejected rather than priced", () => {
  for (const a of [0, 100, -1, NaN, Infinity]) {
    assert.equal(realAskCents(a), false);
    assert.ok(Number.isNaN(feeCents(a)));
    assert.ok(Number.isNaN(allInCostCents(a)));
    assert.ok(Number.isNaN(holdNetCents(a, true)));
  }
});

test("the HOLD identity: a win pays 100 − ask − fee, a loss costs ask + fee, and needed WR is Σ(ask+fee)/(100n)", () => {
  assert.equal(holdNetCents(85, true), 14);
  assert.equal(holdNetCents(85, false), -86);
  assert.equal(holdNetCents(80, true), 18);
  assert.equal(holdNetCents(80, false), -82);
  assert.equal(neededWinRatePct([80, 80]), 82);
  assert.equal(neededWinRatePct([85]), 86);
  assert.equal(neededWinRatePct([]), null);
  // Weighted: the identity closes exactly on any mix.
  const asks = [80, 85, 92, 81];
  const wins = [true, true, false, true];
  const net = asks.reduce((s, a, i) => s + holdNetCents(a, wins[i]!), 0);
  const cost = asks.reduce((s, a) => s + allInCostCents(a), 0);
  assert.equal(net, 100 * 3 - cost);
});

test("edge charges the fee exactly once and refuses a non-probability", () => {
  assert.equal(edgeCents(0.9, 85), 90 - 85 - 1);
  assert.equal(edgeCents(0.9, 85) + feeCents(85), 90 - 85);
  assert.ok(Number.isNaN(edgeCents(1.2, 85)));
  assert.ok(Number.isNaN(edgeCents(0.9, 100)));
});

test("the fee table covers every real ask once", () => {
  const t = feeTable();
  assert.equal(t.length, 99);
  assert.deepEqual(t[79], { ask: 80, fee: 2, all_in: 82, win_pays: 18 });
  assert.ok(t.every((r) => r.fee >= 1 && r.fee <= 2));
});
