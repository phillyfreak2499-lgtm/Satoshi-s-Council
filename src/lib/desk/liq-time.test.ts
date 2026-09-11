import assert from "node:assert/strict";
import { test } from "node:test";
import { holdLiqLastT, liqAgeSeconds, trustedLiqLastT } from "./liq-time.ts";

test("1 fresh dated event: last_t is the provider stamp", () => {
  assert.equal(trustedLiqLastT([{ provider_t: 1_700_000_000_000 }]), 1_700_000_000_000);
});

test("2 old dated fallback: last_t stays the old provider time", () => {
  const old = Date.now() - 45 * 60_000;
  assert.equal(trustedLiqLastT([{ provider_t: old }]), old);
});

test("3 no events: last_t is 0 and age is null", () => {
  assert.equal(trustedLiqLastT([]), 0);
  assert.equal(liqAgeSeconds(0, Date.now()), null);
});

test("4 undated contributor: trusted last_t is 0, not now", () => {
  const now = Date.now();
  assert.equal(trustedLiqLastT([{ provider_t: 0 }]), 0);
  assert.equal(trustedLiqLastT([{}]), 0);
  assert.notEqual(trustedLiqLastT([{ provider_t: 0 }]), now);
});

test("5 mixed dated + undated selected: last_t is 0", () => {
  assert.equal(
    trustedLiqLastT([{ provider_t: 1_700_000_000_000 }, { provider_t: 0 }]),
    0,
  );
});

test("6 multiple valid: last_t is max original provider time", () => {
  assert.equal(
    trustedLiqLastT([{ provider_t: 100 }, { provider_t: 300 }, { provider_t: 200 }]),
    300,
  );
});

test("7 out-of-order input still reports max valid provider time", () => {
  assert.equal(
    trustedLiqLastT([{ provider_t: 9 }, { provider_t: 1 }, { provider_t: 5 }]),
    9,
  );
});

test("8 empty poll holds previous last_t; age grows with as_of", () => {
  const prev = 1_700_000_000_000;
  const held = holdLiqLastT(0, 99, prev);
  assert.equal(held, prev);
  const a1 = liqAgeSeconds(held, prev + 5_000);
  const a2 = liqAgeSeconds(held, prev + 15_000);
  assert.equal(a1, 5);
  assert.equal(a2, 15);
  assert.ok(a2! > a1!);
});

test("9 future provider timestamp yields negative age, not clamped", () => {
  const asOf = 1_700_000_000_000;
  const future = asOf + 8_000;
  assert.equal(trustedLiqLastT([{ provider_t: future }]), future);
  assert.equal(liqAgeSeconds(future, asOf), -8);
});

test("live pack n>0 uses the new last_t even when that last_t is 0", () => {
  assert.equal(holdLiqLastT(3, 0, 1_700_000_000_000), 0);
  assert.equal(holdLiqLastT(3, 42, 1), 42);
});

test("unknown age is null, never 0 or 999", () => {
  assert.equal(liqAgeSeconds(0, 1_700_000_000_000), null);
  assert.equal(liqAgeSeconds(Number.NaN, 1), null);
});
