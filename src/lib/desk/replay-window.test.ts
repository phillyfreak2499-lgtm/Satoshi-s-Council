import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SAMPLES, openSlot, REPLAY_STEP_MS, seriesKey, STALE_MS, WindowStore } from "./replay-window.ts";

// ---------------------------------------------------------------------------
// The ticker-reuse SHAPE, reproduced.
//
// On 2026-09-10 nine consecutive closes carried ONE ticker. Keyed by ticker alone,
// under that shape: IF a series for the reused ticker remained in memory, later
// closes would resolve to that same series, blending their samples and their timing
// into the earlier window's.
//
// Whether that blending actually happened on 2026-09-10 is UNDETERMINED — no
// desk_replay row exists for that ticker at all, and a restart, the short-series
// guard or a failed write are each equally consistent with the absence. These tests
// pin what the code does, not what the history was.
//
// The fixture is the real ticker and the first two real closes from that date,
// because a regression test should be shaped like the condition it guards against.
// ---------------------------------------------------------------------------

const T = "KXBTC15M-26SEP100300-00";
const C1 = Date.parse("2026-09-10T07:00:00Z");
const C2 = Date.parse("2026-09-10T07:15:00Z"); // the next close, same ticker

type Cols = { t0: number; t: number[]; spot: number[] };
const makeCols = (t0: number): Cols => ({ t0, t: [], spot: [] });

function store() {
  return new WindowStore<Cols>();
}

/** One sample, the way noteReplay takes one: open the slot, then push. */
function sample(st: WindowStore<Cols>, ticker: string, closeMs: number, asOfMs: number, spot = 1): boolean {
  const slot = openSlot(st, ticker, closeMs, asOfMs, 78_100, makeCols);
  if (!slot) return false;
  slot.series.cols.t.push(slot.offset);
  slot.series.cols.spot.push(spot);
  return true;
}

test("two different windows never produce one key", () => {
  assert.notEqual(seriesKey(T, C1), seriesKey(T, C2));
  assert.equal(seriesKey(T, C1), seriesKey(T, C1), "and the same window always does");
  // A close is always digits, so the only collision shape would be a ticker ending
  // in "|" plus digits. Real tickers are KXBTC15M-…; pinned so a future separator
  // change cannot quietly introduce one.
  assert.notEqual(seriesKey("A|1", 2), seriesKey("A", 12));
  assert.doesNotMatch(T, /\|/, "a Kalshi ticker carries no separator");
});

test("1 · repeated samples for one window append to one series", () => {
  const st = store();
  const b = C1 - 600_000;
  assert.equal(sample(st, T, C1, b, 11), true);
  assert.equal(sample(st, T, C1, b + REPLAY_STEP_MS, 12), true);
  const s = st.get(T, C1);
  assert.ok(s);
  assert.equal(st.size, 1, "one series, not two");
  assert.deepEqual(s.cols.t, [0, 4]);
  assert.deepEqual(s.cols.spot, [11, 12]);
  assert.equal(s.close_time, C1);
  assert.equal(s.cols.t0, b);
  // A sample too soon is skipped, not misfiled.
  assert.equal(sample(st, T, C1, b + REPLAY_STEP_MS + 500), false);
  assert.equal(s.cols.t.length, 2);
});

test("2 · one ticker with two closes makes two series, neither holding the other's samples", () => {
  const st = store();
  const b1 = C1 - 600_000;
  const b2 = C2 - 600_000;
  sample(st, T, C1, b1, 11);
  sample(st, T, C1, b1 + REPLAY_STEP_MS, 12);
  sample(st, T, C2, b2, 21);
  sample(st, T, C2, b2 + REPLAY_STEP_MS, 22);

  const s1 = st.get(T, C1);
  const s2 = st.get(T, C2);
  assert.ok(s1 && s2);
  assert.equal(st.size, 2, "two windows, two series");
  assert.notEqual(s1, s2);

  assert.deepEqual(s1.cols.spot, [11, 12], "the first kept only its own samples");
  assert.deepEqual(s2.cols.spot, [21, 22], "and so did the second");
  assert.equal(s1.close_time, C1);
  assert.equal(s2.close_time, C2);
  assert.equal(s1.cols.t0, b1);
  assert.equal(s2.cols.t0, b2);
  assert.notEqual(s1.cols.t0, s2.cols.t0);
});

test("3 · taking one window consumes only that window", () => {
  const st = store();
  sample(st, T, C1, C1 - 600_000, 11);
  sample(st, T, C2, C2 - 600_000, 21);

  const got = st.take(T, C1);
  assert.ok(got);
  assert.equal(got.close_time, C1, "the window asked for");
  assert.equal(st.get(T, C1), null, "consumed");
  assert.ok(st.get(T, C2), "the other close sharing the ticker is untouched");
  assert.equal(st.size, 1);

  const second = st.take(T, C2);
  assert.ok(second);
  assert.equal(second.close_time, C2, "and it can be taken in its turn");
  assert.equal(st.size, 0);
});

test("4 · taking the later window first leaves the earlier one untouched", () => {
  const st = store();
  sample(st, T, C1, C1 - 600_000, 11);
  sample(st, T, C1, C1 - 600_000 + REPLAY_STEP_MS, 12);
  sample(st, T, C2, C2 - 600_000, 21);

  const later = st.take(T, C2);
  assert.equal(later?.close_time, C2);
  const s1 = st.get(T, C1);
  assert.ok(s1, "the earlier window still exists");
  assert.equal(s1.close_time, C1, "unmutated");
  assert.deepEqual(s1.cols.spot, [11, 12], "with its own samples intact");
});

test("5 · a later window's sample is never timed from the earlier window's t0", () => {
  const st = store();
  const b1 = C1 - 600_000;
  const b2 = C2 - 600_000; // a full window later
  sample(st, T, C1, b1);
  sample(st, T, C2, b2);

  const s2 = st.get(T, C2);
  assert.ok(s2);
  assert.equal(s2.cols.t[0], 0, "measured from its OWN t0");
  assert.equal(s2.cols.t0, b2);
  const crossWindow = (b2 - b1) / 1000;
  assert.ok(crossWindow >= 900, "the fixture really straddles a window");
  assert.ok(
    s2.cols.t.every((x) => x < crossWindow),
    "no offset is measured from the first window's clock",
  );
  // And the step guard is per series: the second window's first sample is never
  // rejected because the first window sampled recently.
  assert.equal(st.get(T, C1)?.cols.t.length, 1);
});

test("6 · a capped first window does not stop the next close collecting its own", () => {
  // Keyed by ticker alone, a reused ticker would fill ONE series to the cap and then
  // silently drop everything after it — so a later window could be recorded as
  // nothing at all. That is what the old keying permitted, here held shut.
  const st = store();
  const b1 = C1 - 2_000_000;
  let taken = 0;
  for (let i = 0; i < MAX_SAMPLES + 20; i++) if (sample(st, T, C1, b1 + i * REPLAY_STEP_MS)) taken += 1;
  assert.equal(taken, MAX_SAMPLES, "the first window stops at the cap");
  assert.equal(st.get(T, C1)?.cols.t.length, MAX_SAMPLES);

  const b2 = C2 - 600_000;
  assert.equal(sample(st, T, C2, b2, 21), true, "the next close still opens a series");
  assert.equal(sample(st, T, C2, b2 + REPLAY_STEP_MS, 22), true);
  assert.deepEqual(st.get(T, C2)?.cols.spot, [21, 22]);
  assert.equal(st.get(T, C1)?.cols.t.length, MAX_SAMPLES, "without adding to the capped one");
});

test("7 · an unknown window takes nothing and deletes nothing", () => {
  const st = store();
  sample(st, T, C1, C1 - 600_000, 11);
  const before = st.get(T, C1);

  assert.equal(st.take(T, C2), null, "no fallback to the ticker's other window");
  assert.equal(st.take(`${T}-other`, C1), null, "nor to another ticker");
  assert.equal(st.take(T, C1 + 1), null, "off by a millisecond is a different window");
  assert.equal(st.get(T, C1), before, "the real window survives, same object");
  assert.deepEqual(st.get(T, C1)?.cols.spot, [11], "and unmodified");
  assert.equal(st.size, 1);
});

test("8 · the live lookup is exact, and a wrong close is null rather than a neighbour", () => {
  const st = store();
  sample(st, T, C1, C1 - 600_000);
  sample(st, T, C2, C2 - 600_000);
  assert.equal(st.get(T, C1)?.close_time, C1, "the window asked for");
  assert.equal(st.get(T, C2)?.close_time, C2, "and the other one");
  assert.equal(st.get(T, C1 + 1), null);
  assert.equal(st.get(T, 0), null);
  assert.equal(st.get("", C1), null);
  assert.equal(st.get(`${T}x`, C1), null);
});

test("stale series are forgotten when a new window opens, and only then", () => {
  // Unchanged retention: one hour past a close. The difference is reachability —
  // keyed by ticker alone, once a ticker-keyed series existed, subsequent closes
  // sharing that ticker would not enter the new-key branch, so rollover itself could
  // not trigger stale pruning. A composite key makes each close a new key.
  const st = store();
  sample(st, T, C1, C1 - 600_000);
  assert.equal(st.size, 1);

  // A sample for the SAME window does not prune, however late.
  sample(st, T, C1, C1 + STALE_MS + 600_000);
  assert.equal(st.size, 1, "the window being sampled is never pruned out from under itself");
  assert.ok(st.get(T, C1));

  // A new window, long after, prunes the old one as it opens. The threshold is a
  // strict >, unchanged from before this module existed, so the fixture clears it
  // rather than sitting exactly on it.
  const far = C1 + STALE_MS + 1_800_000;
  const farSampleAt = far - 600_000;
  assert.ok(farSampleAt - C1 > STALE_MS, "the fixture is past the threshold, not on it");
  sample(st, T, far, farSampleAt);
  assert.equal(st.get(T, C1), null, "the stale series is gone");
  assert.ok(st.get(T, far), "and the new one is here");
  assert.equal(st.size, 1);
});

test("a series' close_time is fixed at creation and never rewritten", () => {
  const st = store();
  sample(st, T, C1, C1 - 600_000);
  const s = st.get(T, C1);
  assert.ok(s);
  // Sampling again, with any clock, cannot move the window it belongs to.
  sample(st, T, C1, C1 - 600_000 + REPLAY_STEP_MS);
  sample(st, T, C1, C1 + 300_000);
  assert.equal(st.get(T, C1)?.close_time, C1);
  assert.equal(st.get(T, C1), s, "the same series throughout");
});
