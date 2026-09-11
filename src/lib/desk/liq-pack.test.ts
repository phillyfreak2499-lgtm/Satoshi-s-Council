import assert from "node:assert/strict";
import { test } from "node:test";
import { holdLiqFields, liqAgeS, packLiq, type LiqEvent } from "./liq-pack";
import { readCascade } from "./derivs";
import type { Snapshot } from "./types";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function ev(t: number, usd: number, side: "long" | "short" = "long"): LiqEvent {
  return { t, usd, side, venue: "okx" };
}

function seqClock(values: number[]) {
  const calls: number[] = [];
  const now = () => {
    const v = values[calls.length] ?? values[values.length - 1]!;
    calls.push(v);
    return v;
  };
  return { now, calls };
}

test("1 fresh dated event: last_t is the provider time, USD/n unchanged", () => {
  const t = NOW - 5_000;
  const pack = packLiq([ev(t, 20_000)], "okx", 15 * MIN, () => NOW);
  assert.ok(pack);
  assert.equal(pack.n, 1);
  assert.equal(pack.longUsd, 20_000);
  assert.equal(pack.shortUsd, 0);
  assert.equal(pack.source, "okx");
  assert.equal(pack.last_t, t);
});

test("2 old dated fallback: still selected, last_t stays old, not now", () => {
  const old = NOW - 45 * MIN;
  const pack = packLiq([ev(old, 50_000)], "okx", 15 * MIN, () => NOW);
  assert.ok(pack);
  assert.equal(pack.n, 1);
  assert.equal(pack.longUsd, 50_000);
  assert.equal(pack.last_t, old);
  assert.notEqual(pack.last_t, NOW);
});

test("3 no events: empty pack, last_t would be 0, age null", () => {
  assert.equal(packLiq([], "okx", 15 * MIN, () => NOW), null);
  assert.equal(liqAgeS(0, NOW), null);
});

test("4 undated contributor: behavior still uses clock t; trusted last_t is 0", () => {
  const { now, calls } = seqClock([NOW, NOW + 1]);
  const pack = packLiq([ev(0, 12_000)], "okx", 15 * MIN, now);
  assert.ok(pack);
  assert.equal(pack.n, 1);
  assert.equal(pack.longUsd, 12_000);
  assert.equal(pack.last_t, 0);
  assert.ok(calls.length >= 2, "cutoff now() plus undated now()");
  assert.ok(!calls.includes(pack.last_t) || pack.last_t === 0);
});

test("5 mixed dated + undated selected set: magnitudes keep, last_t = 0", () => {
  const dated = NOW - 2_000;
  const pack = packLiq([ev(dated, 10_000), ev(0, 8_000)], "okx", 15 * MIN, () => NOW);
  assert.ok(pack);
  assert.equal(pack.n, 2);
  assert.equal(pack.longUsd, 18_000);
  assert.equal(pack.last_t, 0);
});

test("6 several valid events: last_t is max selected provider_t", () => {
  const a = NOW - 8_000;
  const b = NOW - 1_000;
  const c = NOW - 4_000;
  const pack = packLiq([ev(a, 1_000), ev(b, 2_000), ev(c, 3_000)], "okx", 15 * MIN, () => NOW);
  assert.ok(pack);
  assert.equal(pack.n, 3);
  assert.equal(pack.last_t, b);
});

test("7 out-of-order input: sort/selection unchanged, last_t is max provider_t", () => {
  const late = NOW - 500;
  const early = NOW - 9_000;
  const pack = packLiq([ev(late, 4_000, "short"), ev(early, 6_000, "long")], "okx", 15 * MIN, () => NOW);
  assert.ok(pack);
  assert.equal(pack.n, 2);
  assert.equal(pack.longUsd, 6_000);
  assert.equal(pack.shortUsd, 4_000);
  assert.equal(pack.last_t, late);
});

test("8 empty poll after live pack: hold USD/n/source/last_t; age grows", () => {
  const last_t = NOW - 20_000;
  const live = {
    liq_long_usd: 40_000,
    liq_short_usd: 0,
    liq_n: 3,
    liq_source: "okx",
    liq_last_t: last_t,
  };
  const empty = {
    liq_long_usd: 0,
    liq_short_usd: 0,
    liq_n: 0,
    liq_source: "DOWN",
    liq_last_t: 0,
  };
  const held = holdLiqFields(empty, live);
  assert.equal(held.liq_n, 3);
  assert.equal(held.liq_long_usd, 40_000);
  assert.equal(held.liq_source, "okx");
  assert.equal(held.liq_last_t, last_t);
  const age1 = liqAgeS(held.liq_last_t, NOW);
  const age2 = liqAgeS(held.liq_last_t, NOW + 8_000);
  assert.equal(age1, 20);
  assert.equal(age2, 28);
});

test("9 future provider timestamp: last_t kept, age negative, not clamped", () => {
  const future = NOW + 12_000;
  const pack = packLiq([ev(future, 9_000)], "okx", 15 * MIN, () => NOW);
  assert.ok(pack);
  assert.equal(pack.last_t, future);
  const age = liqAgeS(pack.last_t, NOW);
  assert.ok(age !== null && age < 0);
  assert.equal(age, -12);
});

test("10 behavior clock: cutoff now() first, then one now() per undated event", () => {
  const { now, calls } = seqClock([1_000, 2_000, 3_000, 4_000]);
  packLiq([ev(0, 1_000), ev(0, 2_000), ev(NOW - 1_000, 3_000)], "okx", 15 * MIN, now);
  assert.deepEqual(calls.slice(0, 3), [1_000, 2_000, 3_000]);
});

function cascadeSnap(over: Partial<Snapshot> = {}): Snapshot {
  const base = {
    vol_median: 100,
    vol_last: 100,
    liq_long_usd: 50_000,
    liq_short_usd: 0,
    liq_n: 2,
    liq_source: "okx",
    liq_last_t: 0,
    force_n: 2,
    ret5: 0.003,
    oi_delta_10m: -1,
    candles_1m: [],
    cascade_proxy: false,
  } as unknown as Snapshot;
  return { ...base, ...over };
}

test("11 decision non-regression: liq_last_t does not change readCascade", () => {
  const a = readCascade(cascadeSnap({ liq_last_t: 0 }));
  const b = readCascade(cascadeSnap({ liq_last_t: NOW - 2_000 }));
  const c = readCascade(cascadeSnap({ liq_last_t: NOW + 5_000 }));
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});
