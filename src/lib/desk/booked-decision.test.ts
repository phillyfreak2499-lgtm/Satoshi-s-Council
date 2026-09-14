import assert from "node:assert/strict";
import { test } from "node:test";
import { bookedDecisionAtGrade, sanitizeBookedDecisionState } from "./booked-decision.ts";

const ticker = "KXBTC15M-26SEP131900-00";
const close = Date.parse("2026-09-13T23:00:00Z");
const sha = "e7a6b79073958334628c293e27b3a6005c0baa0f";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    lean: "UP",
    regime: "US_PM",
    secs_left: 173.4,
    conf: 86,
    score: 0.72,
    bar: 0.61,
    fair_yes: 88.2,
    spread_cents: 2,
    leftover_cents: 1,
    touch_size: 44,
    fee_cents: 1.7,
    build_sha: sha,
    ...overrides,
  };
}

test("a deployment round-trip preserves the exact booked decision", () => {
  const calls = JSON.parse(
    JSON.stringify([{ ticker, close_time: close, lean: "UP", cents: 84 }]),
  );
  const restored = sanitizeBookedDecisionState(
    JSON.parse(JSON.stringify({ [`${ticker}:${close}`]: entry() })),
  );
  const got = bookedDecisionAtGrade(calls, ticker, close, restored[`${ticker}:${close}`]);
  assert.deepEqual(got, {
    lean: "UP",
    cents: 84,
    conf: 86,
    score: 0.72,
    bar: 0.61,
    build_sha: sha,
  });
});

test("an older in-flight entry still uses the canonical call side", () => {
  const restored = sanitizeBookedDecisionState({ k: entry({ lean: undefined, build_sha: undefined }) });
  const got = bookedDecisionAtGrade(
    [{ ticker, close_time: close, lean: "DOWN", cents: 81 }],
    ticker,
    close,
    restored.k,
  );
  assert.equal(got?.lean, "DOWN");
  assert.equal(got?.build_sha, null);
  assert.equal(got?.conf, 86);
});

test("a neighbouring window cannot donate a booked decision", () => {
  const calls = [{ ticker, close_time: close + 15 * 60_000, lean: "UP" as const, cents: 84 }];
  assert.equal(bookedDecisionAtGrade(calls, ticker, close, sanitizeBookedDecisionState({ k: entry() }).k), null);
});

test("entry state without a held call is not a mirror grade", () => {
  assert.equal(bookedDecisionAtGrade([], ticker, close, sanitizeBookedDecisionState({ k: entry() }).k), null);
});

test("malformed deployment provenance is withheld", () => {
  const restored = sanitizeBookedDecisionState({
    k: entry({ build_sha: "not-a-commit", conf: undefined }),
  });
  assert.equal(restored.k?.build_sha, "");
  assert.equal(restored.k?.conf, null);
});
