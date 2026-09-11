import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDLE_PERIOD_MS,
  candleTs,
  emptyTally,
  tally,
  type CandleTs,
} from "./candle-time.ts";

const NOW = Date.parse("2026-09-11T15:08:00Z");
/** Epoch SECONDS, which is what Kalshi sends. */
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// ---------------------------------------------------------------------------
// Units: seconds in, milliseconds out, UTC throughout.
// ---------------------------------------------------------------------------

test("epoch seconds become epoch milliseconds", () => {
  const got = candleTs({ end_period_ts: secs("2026-09-11T15:07:00Z") }, NOW);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.t, Date.parse("2026-09-11T15:07:00Z"));
  assert.equal(got.field, "end_period_ts");
  assert.equal(got.kind, "end");
});

test("a value already in milliseconds is not multiplied again", () => {
  // Defensive: if the API ever switches units, the reader must not land in year 58000.
  const ms = Date.parse("2026-09-11T15:07:00Z");
  const got = candleTs({ end_period_ts: ms }, NOW);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.t, ms);
});

test("a string timestamp parses, like the *_dollars prices already do", () => {
  const got = candleTs({ end_period_ts: String(secs("2026-09-11T15:07:00Z")) }, NOW);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.t, Date.parse("2026-09-11T15:07:00Z"));
});

test("epoch timestamps carry no timezone to convert", () => {
  // The market TICKER encodes Eastern wall-clock and needs conversion; a candle
  // timestamp is absolute. Proving it: the same instant written three ways reads
  // identically, so no local-time assumption can creep in.
  const t = Date.parse("2026-09-11T15:07:00Z");
  const a = candleTs({ end_period_ts: t / 1000 }, NOW);
  const b = candleTs({ end_period_ts: Date.parse("2026-09-11T11:07:00-04:00") / 1000 }, NOW);
  const c = candleTs({ end_period_ts: Date.parse("2026-09-11T17:07:00+02:00") / 1000 }, NOW);
  assert.equal(a.ok && b.ok && c.ok, true);
  if (!a.ok || !b.ok || !c.ok) return;
  assert.equal(a.t, b.t);
  assert.equal(b.t, c.t);
});

// ---------------------------------------------------------------------------
// A close belongs to the END of its period.
// ---------------------------------------------------------------------------

test("end fields win over start fields when both are present", () => {
  const end = secs("2026-09-11T15:07:00Z");
  const start = secs("2026-09-11T15:06:00Z");
  const got = candleTs({ start_period_ts: start, end_period_ts: end }, NOW);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.t, end * 1000);
  assert.equal(got.kind, "end");
});

test("a start-only row is moved forward one period, and says so", () => {
  // Using a start timestamp as-is would date every close 60s early - a systematic
  // shift of exactly the size this work exists to detect.
  const start = secs("2026-09-11T15:06:00Z");
  const got = candleTs({ start_period_ts: start }, NOW);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.t, start * 1000 + CANDLE_PERIOD_MS);
  assert.equal(got.t, Date.parse("2026-09-11T15:07:00Z"));
  assert.equal(got.kind, "start-adjusted", "never silently merged with an end reading");
});

// ---------------------------------------------------------------------------
// Failure is named, never guessed around.
// ---------------------------------------------------------------------------

test("an unknown field shape reports absent rather than inventing a time", () => {
  const got = candleTs({ price: { close_dollars: "0.62" } }, NOW);
  assert.equal(got.ok, false);
  if (got.ok) return;
  assert.equal(got.why, "absent");
});

test("a seconds value misread as milliseconds is rejected, not accepted as 1970", () => {
  // 1.78e9 ms is January 1970. If the band did not catch it, every point would be
  // dated 56 years ago and the whole true-time reading would be silently useless.
  const got = candleTs({ end_period_ts: 1_000_000 }, NOW);
  assert.equal(got.ok, false);
  if (got.ok) return;
  assert.equal(got.why, "implausible");
  assert.equal(got.raw, 1_000_000);
});

test("a millisecond value misread as seconds is rejected, not accepted as year 58000", () => {
  const got = candleTs({ end_period_ts: Date.parse("2026-09-11T15:07:00Z") * 1000 }, NOW);
  assert.equal(got.ok, false);
  if (got.ok) return;
  assert.equal(got.why, "implausible");
});

test("a non-numeric value is unparseable, which is not the same as absent", () => {
  const got = candleTs({ end_period_ts: "not-a-time" }, NOW);
  assert.equal(got.ok, false);
  if (got.ok) return;
  assert.equal(got.why, "unparseable");
  assert.equal(got.field, "end_period_ts");
});

test("a present-but-bad field is reported over a bare absent", () => {
  // Knowing the field exists and is broken is far more actionable than "absent",
  // which would send someone hunting for the wrong field name.
  const got = candleTs({ end_period_ts: 12 }, NOW);
  assert.equal(got.ok, false);
  if (got.ok) return;
  assert.equal(got.field, "end_period_ts");
  assert.notEqual(got.why, "absent");
});

test("null, undefined and empty string are skipped so a later field can match", () => {
  const got = candleTs(
    { end_period_ts: null, period_end_ts: "", end_ts: secs("2026-09-11T15:07:00Z") },
    NOW,
  );
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.field, "end_ts");
});

test("a non-object row fails cleanly", () => {
  for (const row of [null, undefined, 7, "x"]) {
    const got = candleTs(row, NOW);
    assert.equal(got.ok, false, `${String(row)} is not a candle`);
  }
});

test("a candle cannot close meaningfully in the future", () => {
  const got = candleTs({ end_period_ts: secs("2026-09-11T16:00:00Z") }, NOW);
  assert.equal(got.ok, false, "52 minutes ahead of now");
  // The forming candle's own end, a minute out, is still accepted.
  const forming = candleTs({ end_period_ts: secs("2026-09-11T15:08:30Z") }, NOW);
  assert.equal(forming.ok, true, "the period in progress is legitimate");
});

// ---------------------------------------------------------------------------
// The tally, which is how a thin timestamped path gets explained.
// ---------------------------------------------------------------------------

test("the tally records which field matched, so a wrong guess is visible in the data", () => {
  const t = emptyTally();
  const rows: CandleTs[] = [
    candleTs({ end_period_ts: secs("2026-09-11T15:05:00Z") }, NOW),
    candleTs({ end_period_ts: secs("2026-09-11T15:06:00Z") }, NOW),
    candleTs({ start_period_ts: secs("2026-09-11T15:06:00Z") }, NOW),
    candleTs({ price: {} }, NOW),
    candleTs({ end_period_ts: "nope" }, NOW),
    candleTs({ end_period_ts: 5 }, NOW),
  ];
  for (const r of rows) tally(t, r);
  assert.equal(t.rows_timed, 3);
  assert.deepEqual(t.fields, ["end_period_ts", "start_period_ts"]);
  assert.equal(t.start_adjusted, 1);
  assert.equal(t.absent, 1);
  assert.equal(t.unparseable, 1);
  assert.equal(t.implausible, 1);
  assert.equal(t.rows_priced, 0, "priced is counted by the caller, not here");
});

test("the tally does not repeat a field name", () => {
  const t = emptyTally();
  for (let i = 0; i < 5; i++) {
    tally(t, candleTs({ end_period_ts: secs("2026-09-11T15:0" + i + ":00Z") }, NOW));
  }
  assert.deepEqual(t.fields, ["end_period_ts"]);
  assert.equal(t.rows_timed, 5);
});
