import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BENCH_FADE,
  FADE_MIN_N,
  FADE_RATE,
  FADE_SCALE_MAX,
  FADE_SCALE_MIN,
  fadeVerdict,
} from "./fade.ts";

/** A record of `hits` wins in `n` graded calls, newest last. */
function run(hits: number, n = FADE_MIN_N): number[] {
  return [...Array.from({ length: hits }, () => 1), ...Array.from({ length: n - hits }, () => 0)];
}

test("a short bad run cannot reduce authority at all — eight is the minimum", () => {
  for (let n = 0; n < FADE_MIN_N; n++) {
    const v = fadeVerdict(run(0, n), 1);
    assert.equal(v.scale, 1, `${n} misses must not move the weight`);
    assert.equal(v.faded, false);
    assert.equal(v.benched, false);
    assert.equal(v.why, null);
  }
});

test("a bad run NEVER produces opposite-direction evidence", () => {
  // The whole point: no input can make the scale negative. A seat that is wrong
  // gets quieter; it never becomes a working predictor in reverse.
  for (const hits of [0, 1, 2, 3]) {
    for (const fade of [0, 0.25, 0.5, 0.75, 1]) {
      const v = fadeVerdict(run(hits), fade);
      assert.ok(v.scale >= 0, `scale went negative: ${v.scale}`);
      assert.ok(v.scale <= 1, `scale exceeded 1: ${v.scale}`);
    }
  }
  // And for a long cold streak too.
  const v = fadeVerdict(run(0, 40), 1);
  assert.ok(v.scale >= 0 && v.scale <= 1);
});

test("a seat at or above the concern rate is left entirely alone", () => {
  // 4 of 8 is 50%, well clear.
  assert.deepEqual(fadeVerdict(run(4), 1), { scale: 1, faded: false, benched: false, why: null });
  // 3 of 8 is 37.5%, just under the line, so it is faded.
  assert.ok(3 / 8 < FADE_RATE);
  assert.equal(fadeVerdict(run(3), 0).faded, true);
});

test("a faded seat gets quieter the longer it stays cold, and never louder", () => {
  const fresh = fadeVerdict(run(3), 0);
  const cold = fadeVerdict(run(3), 1);
  assert.equal(fresh.scale, FADE_SCALE_MAX);
  assert.equal(cold.scale, FADE_SCALE_MIN);
  assert.ok(cold.scale < fresh.scale, "a persistent fade must be quieter");
  assert.ok(fresh.scale < 1, "a faded seat must lose some authority");
  assert.equal(fresh.benched, false);
  assert.match(String(fresh.why), /faded/);
  // Monotone in fade strength.
  let prev = Number.POSITIVE_INFINITY;
  for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const s = fadeVerdict(run(3), f).scale;
    assert.ok(s <= prev, `scale rose with fade: ${s} after ${prev}`);
    prev = s;
  }
});

test("only a seat that is both very wrong and persistently cold is benched", () => {
  // 1 of 8 but freshly cold: shrunk, not silenced.
  const fresh = fadeVerdict(run(1), 0);
  assert.equal(fresh.benched, false);
  assert.ok(fresh.scale > 0);
  // 1 of 8 and cold for a while: benched to zero weight.
  const done = fadeVerdict(run(1), BENCH_FADE);
  assert.equal(done.benched, true);
  assert.equal(done.scale, 0);
  assert.match(String(done.why), /benched/);
  // Wrong but not catastrophically so stays shrunk even when cold.
  const mid = fadeVerdict(run(3), 1);
  assert.equal(mid.benched, false);
  assert.ok(mid.scale > 0);
});

test("a perfect record is untouched, and junk inputs fail safe", () => {
  assert.equal(fadeVerdict(run(8), 0).scale, 1);
  assert.equal(fadeVerdict([], 1).scale, 1);
  // A nonsense fade strength must not produce a scale outside [0,1].
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 99]) {
    const v = fadeVerdict(run(3), bad);
    assert.ok(v.scale >= 0 && v.scale <= 1, `${bad} gave ${v.scale}`);
  }
});

test("only the last eight calls count, so a seat recovers as soon as its record does", () => {
  // Eight misses then eight hits: judged on the recent eight, so it is clean.
  const recovered = [...run(0), ...run(8)];
  assert.equal(fadeVerdict(recovered, 1).scale, 1);
  // The reverse is faded.
  const fading = [...run(8), ...run(0)];
  assert.equal(fadeVerdict(fading, 0).faded, true);
});
