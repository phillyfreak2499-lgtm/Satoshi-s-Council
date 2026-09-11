import assert from "node:assert/strict";
import test from "node:test";
import {
  HORIZONS,
  legacyMove,
  legacyRead,
  legacySpanMs,
  moveOver,
  normalise,
  parity,
  sanitise,
  type PathPoint,
} from "./path-time.ts";

const T0 = Date.parse("2026-09-11T15:00:00Z");
/** A point `s` seconds after T0. */
const at = (s: number, px: number, source: "candle" | "tick" = "candle"): PathPoint => ({
  t: T0 + s * 1000,
  px,
  source,
});

/** 1-minute candles, which is what the feed actually delivers. */
function candles(prices: number[]): PathPoint[] {
  return prices.map((px, i) => at(i * 60, px, "candle"));
}
/** The ~4s per-tick fallback. */
function ticks(prices: number[]): PathPoint[] {
  return prices.map((px, i) => at(i * 4, px, "tick"));
}
/** The bare array production reads today. */
const bare = (pts: PathPoint[]) => pts.map((p) => p.px);

// ---------------------------------------------------------------------------
// THE FINDING, made concrete.
// ---------------------------------------------------------------------------

test("the three index offsets imply three different sample intervals", () => {
  // Careful with the arithmetic: `path[last] - path[last - back]` anchors at index
  // `length - back` while the newest is `length - 1`, so `back` slots back crosses
  // `back - 1` GAPS, not `back`. The implied interval is therefore ms/(back-1):
  // 30/3 = 10s, 60/5 = 12s, 120/9 = 13.33s. Three different intervals either way,
  // but the off-by-one gap matters for every span claimed below.
  const implied = HORIZONS.map((h) => Math.round((h.ms / 1000 / (h.legacy_back - 1)) * 100) / 100);
  assert.deepEqual(implied, [10, 12, 13.33]);
  assert.equal(new Set(implied).size, 3, "one function cannot have three sample intervals");
  // And the naive reading of the offset - dividing by `back` - is wrong in the other
  // direction, which is how the error got into the prose describing this defect.
  assert.notDeepEqual(
    HORIZONS.map((h) => h.ms / 1000 / h.legacy_back),
    implied,
  );
});

test("with 1-minute candles the labels are materially different horizons", () => {
  // The usual case: period_interval=1 over 960s gives ~16 one-minute points, so
  // live.ts's `length >= 4` branch is taken and each slot is a MINUTE.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  assert.equal(legacySpanMs(pts, 4), 180_000, `"d30" spans 3 minutes between those two points`);
  assert.equal(legacySpanMs(pts, 6), 300_000, `"d60" spans 5 minutes`);
  assert.equal(legacySpanMs(pts, 10), 540_000, `"d120" spans 9 minutes`);
  // 6x, 5x and 4.5x their names respectively - several times over, not merely off.
  assert.deepEqual(
    HORIZONS.map((h) => legacySpanMs(pts, h.legacy_back)! / h.ms),
    [6, 5, 4.5],
  );
});

test("with ~4s ticks the same offsets are far too SHORT", () => {
  // The rare fallback path. Same code, opposite error — which is why one named
  // quantity ranges ~15x depending on which branch ran.
  const pts = ticks([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  assert.equal(legacySpanMs(pts, 4), 12_000, `"d30" spans 12 seconds`);
  assert.equal(legacySpanMs(pts, 6), 20_000, `"d60" spans 20 seconds`);
  assert.equal(legacySpanMs(pts, 10), 36_000, `"d120" spans 36 seconds`);
  // 300_000 / 20_000 = 15x between the candle and tick readings of "d60".
  const candleSpan = legacySpanMs(candles([70, 71, 72, 73, 74, 75, 76]), 6)!;
  assert.equal(candleSpan / legacySpanMs(pts, 6)!, 15);
});

// ---------------------------------------------------------------------------
// moveOver: elapsed time, and null rather than an approximation.
// ---------------------------------------------------------------------------

test("the anchor is the tightest point at least the horizon old", () => {
  // Ticks every 4s. For 30s we want the newest point whose age is >= 30s: that is
  // t=+32s back from the newest, not the oldest available point.
  const pts = ticks([50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60]); // 0..40s
  const m = moveOver(pts, 30_000);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  assert.equal(m.span_ms, 32_000, "the tightest honest span at or beyond 30s");
  // Newest (60c at 40s) minus the anchor (52c at 8s), which is the latest point
  // that is at least 30s old. Not the oldest point: that would be a 40s span.
  assert.equal(m.delta, 8);
  assert.equal(m.from_t, T0 + 8_000);
  assert.equal(m.want_ms, 30_000);
});

test("insufficient coverage returns null rather than the oldest point", () => {
  // Taking the oldest available point would silently widen the horizon — the
  // original bug wearing a different costume.
  const pts = ticks([50, 51, 52]); // spans 8s
  const m = moveOver(pts, 60_000);
  assert.equal(m.ok, false);
  if (m.ok) return;
  assert.equal(m.why, "not-enough-history");
  assert.equal(m.available_ms, 8_000, "the shortfall is quantified, not hidden");
  assert.equal(m.want_ms, 60_000);
});

test("an empty path says so", () => {
  const m = moveOver([], 60_000);
  assert.equal(m.ok, false);
  if (m.ok) return;
  assert.equal(m.why, "empty");
  assert.equal(m.available_ms, 0);
});

test("a point exactly the horizon old is usable", () => {
  const pts = [at(0, 70), at(60, 78)];
  const m = moveOver(pts, 60_000);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  assert.equal(m.span_ms, 60_000);
  assert.equal(m.delta, 8);
});

test("the same elapsed question gets the same answer at any density", () => {
  // 60 seconds of +6c, sampled every 4s and every 60s. An index-based reading would
  // give wildly different answers; an elapsed-time reading cannot.
  const dense: PathPoint[] = [];
  for (let s = 0; s <= 120; s += 4) dense.push(at(s, 70 + s * 0.1, "tick"));
  const coarse: PathPoint[] = [];
  for (let s = 0; s <= 120; s += 60) coarse.push(at(s, 70 + s * 0.1, "candle"));

  const a = moveOver(dense, 60_000);
  const b = moveOver(coarse, 60_000);
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.delta, 6, "0.1c/s over 60s");
  assert.equal(b.delta, 6, "the same 60 seconds, two samples");
  assert.equal(a.span_ms, 60_000);
  assert.equal(b.span_ms, 60_000);
});

// ---------------------------------------------------------------------------
// Irregular, mixed and duplicated input.
// ---------------------------------------------------------------------------

test("mixed candle and tick sources are handled and reported", () => {
  // A realistic transition: candles, then the feed drops to per-tick mid.
  const pts = [at(0, 70, "candle"), at(60, 72, "candle"), at(124, 75, "tick"), at(128, 76, "tick")];
  const m = moveOver(pts, 60_000);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  assert.equal(m.from_source, "candle");
  assert.equal(m.to_source, "tick");
  assert.equal(m.span_ms, 68_000, "the real gap, not a nominal 60s");
  const rows = parity(bare(pts), pts);
  assert.equal(rows[0]!.source_mix, "candle+tick");
});

test("irregular gaps do not shift the anchor to a nominal slot", () => {
  // A 5-minute hole in the middle. The 60s question must be answered from the
  // points that exist, or refused.
  const pts = [at(0, 70), at(20, 71), at(320, 90), at(324, 91)];
  const m = moveOver(pts, 60_000);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  assert.equal(m.from_t, T0 + 20_000, "the only point 60s+ old is across the hole");
  assert.equal(m.span_ms, 304_000);
  // And the span is reported, so a consumer could later reject a 304s answer to a
  // 60s question on its own terms.
  assert.ok(m.span_ms > m.want_ms * 4);
});

test("duplicate timestamps collapse to the last value, never an average", () => {
  const pts = [at(0, 70), at(60, 72), at(60, 74), at(120, 80)];
  const n = normalise(pts);
  assert.equal(n.length, 3, "one point per instant");
  assert.equal(n[1]!.px, 74, "the later reading wins");
  assert.notEqual(n[1]!.px, 73, "two readings for one moment must not invent a third price");
});

test("out-of-order input is sorted, and junk is dropped", () => {
  const pts: PathPoint[] = [
    at(120, 80),
    at(0, 70),
    { t: Number.NaN, px: 99, source: "tick" },
    { t: T0 + 60_000, px: 0, source: "tick" },
    { t: T0 + 90_000, px: Number.NaN, source: "tick" },
    at(60, 75),
  ];
  const n = normalise(pts);
  assert.deepEqual(
    n.map((p) => p.px),
    [70, 75, 80],
    "sorted ascending, zero and NaN discarded",
  );
});

// ---------------------------------------------------------------------------
// The legacy reading, reproduced exactly.
// ---------------------------------------------------------------------------

test("legacyMove reproduces production, including its zero", () => {
  // bots.ts/tape.ts/dsl.ts all return 0 when the path is too short. A comparison
  // that substituted null would not be comparing against what the desk reads.
  assert.equal(legacyMove([70, 71, 72, 73, 74, 75, 76], 6), 76 - 71);
  assert.equal(legacyMove([70, 71], 6), 0, "too short yields the zero production sees");
  assert.equal(legacyMove([], 6), 0);
});

test("legacyMove reproduces production's NaN, which reads downstream as 'no move'", () => {
  // Production is `path[last] - path[last - back]` with no finite guard, so a NaN
  // in either slot propagates. Only the two slots actually used matter: a NaN
  // elsewhere in the path is irrelevant.
  assert.equal(legacyMove([70, Number.NaN, 72, 73, 74, 75], 6), 5, "the NaN is not on a slot used");
  assert.ok(Number.isNaN(legacyMove([Number.NaN, 71, 72, 73, 74, 75], 6)), "anchor slot NaN propagates");
  assert.ok(Number.isNaN(legacyMove([70, 71, 72, 73, 74, Number.NaN], 6)), "newest slot NaN propagates");

  // And this is why it matters: the seat gate is `Math.abs(d60) >= 8`, which a NaN
  // makes FALSE. The desk reads "no meaningful move" when the truth is "unknown".
  const nan = legacyMove([Number.NaN, 71, 72, 73, 74, 75], 6);
  assert.equal(Math.abs(nan) >= 8, false, "a NaN silently passes as a quiet tape");

  // parity records it rather than storing a NaN in the shadow row.
  const pts = [at(0, 70), at(60, 71), at(120, 72), at(180, 73), at(240, 74), at(300, 75)];
  const rows = parity([Number.NaN, 71, 72, 73, 74, 75], pts);
  const d60 = rows.find((r) => r.horizon === "d60")!;
  assert.equal(d60.legacy_finite, false);
  assert.equal(d60.legacy_delta, null);
  assert.equal(d60.signed_divergence, null, "there is no difference from a non-number");
  assert.equal(d60.true_delta, 1, "the true reading is still available and recorded");
});

// ---------------------------------------------------------------------------
// Parity: both numbers plus the coverage facts.
// ---------------------------------------------------------------------------

test("parity records both readings, the divergence and whether it was measurable", () => {
  // 1-minute candles rising 1c/min for 11 minutes.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const rows = parity(bare(pts), pts);
  assert.equal(rows.length, 3);

  const d60 = rows.find((r) => r.horizon === "d60")!;
  // Legacy: 6 slots back = 5 minutes of a 1c/min rise = 5c.
  assert.equal(d60.legacy_delta, 5);
  // True 60s: one minute of a 1c/min rise = 1c.
  assert.equal(d60.true_delta, 1);
  assert.equal(d60.signed_divergence, -4, "the old reading overstated the move by 4c");
  assert.equal(d60.abs_divergence, 4);
  assert.equal(d60.span_ms, 60_000);
  assert.equal(d60.coverage_ok, true);
  assert.equal(d60.available_ms, 600_000);
  assert.equal(d60.source_mix, "candle");
  assert.equal(d60.legacy_back, 6);
});

test("parity marks coverage false without inventing a true value", () => {
  // Only 8 seconds of history: no horizon is measurable, but the legacy reading
  // still produced its zero, and that asymmetry is the point.
  const pts = ticks([70, 71, 72]);
  const rows = parity(bare(pts), pts);
  for (const r of rows) {
    assert.equal(r.coverage_ok, false, `${r.horizon} cannot be measured in 8s`);
    assert.equal(r.true_delta, null);
    assert.equal(r.signed_divergence, null);
    assert.equal(r.abs_divergence, null);
    assert.equal(r.span_ms, null);
    assert.equal(r.available_ms, 8_000);
  }
  assert.equal(rows.find((r) => r.horizon === "d30")!.legacy_delta, 0, "legacy still returns 0");
});

test("parity on an empty path is reportable, not a crash", () => {
  const rows = parity([], []);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.coverage_ok, false);
    assert.equal(r.legacy_delta, 0);
    assert.equal(r.source_mix, "none");
  }
});

test("the horizons are frozen to what the consumers actually use", () => {
  assert.deepEqual(
    HORIZONS.map((h) => [h.name, h.ms, h.legacy_back]),
    [
      ["d30", 30_000, 4],
      ["d60", 60_000, 6],
      ["d120", 120_000, 10],
    ],
  );
  assert.throws(() => {
    (HORIZONS as unknown as { push: (x: unknown) => void }).push({});
  });
});

// ---------------------------------------------------------------------------
// Every outcome is named. A shadow row must never collapse 0, null and NaN.
// ---------------------------------------------------------------------------

test("legacyRead separates the short-path zero from a genuinely flat tape", () => {
  // Both produce the number 0. Only one of them is a measurement, and consumers
  // cannot tell them apart today - which is exactly why the state is stored.
  const tooShort = legacyRead([70, 71], 6);
  assert.equal(tooShort.value, 0);
  assert.equal(tooShort.state, "short-path");

  const flat = legacyRead([70, 70, 70, 70, 70, 70], 6);
  assert.equal(flat.value, 0, "a flat tape is also zero");
  assert.equal(flat.state, "numeric", "but it is a real measurement");

  assert.equal(tooShort.value, flat.value, "the numbers are identical");
  assert.notEqual(tooShort.state, flat.state, "the meanings are not");
});

test("legacyRead names the non-finite state instead of hiding it in a number", () => {
  const nan = legacyRead([Number.NaN, 71, 72, 73, 74, 75], 6);
  assert.equal(nan.state, "non-finite");
  assert.ok(Number.isNaN(nan.value), "the raw value stays faithful to production");
});

test("parity keeps the three legacy outcomes in three different buckets", () => {
  const pts = candles([70, 71, 72, 73, 74, 75, 76]);

  // 1. numeric
  const numeric = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(numeric.legacy_state, "numeric");
  assert.equal(numeric.legacy_delta, 5);
  assert.equal(numeric.divergence_state, "measured");

  // 2. short-path: production hands consumers a 0 that is not a measurement.
  const short = parity([70, 71], pts).find((r) => r.horizon === "d60")!;
  assert.equal(short.legacy_state, "short-path");
  assert.equal(short.legacy_delta, 0, "stored as the 0 consumers actually see");
  assert.equal(short.legacy_finite, true, "0 is finite; it is just not informative");
  assert.equal(short.divergence_state, "measured", "the 0 is real input, so it is comparable");
  assert.equal(short.signed_divergence, 1, "true says +1c where the old path said nothing");

  // 3. non-finite. The NaN must land on a slot the offset actually reads: on a
  // 7-element path, `length - 6` is index 1, so a NaN at index 0 is never touched.
  const nan = parity([70, Number.NaN, 72, 73, 74, 75, 76], pts).find((r) => r.horizon === "d60")!;
  assert.equal(nan.legacy_state, "non-finite");
  assert.equal(nan.legacy_delta, null);
  assert.equal(nan.divergence_state, "legacy-non-finite");
  assert.equal(nan.signed_divergence, null);

  const states = [numeric.legacy_state, short.legacy_state, nan.legacy_state];
  assert.equal(new Set(states).size, 3, "three outcomes, three states");
});

test("parity separates an empty path from one that is merely too short", () => {
  const none = parity([], [])[1]!;
  assert.equal(none.true_state, "empty");
  assert.equal(none.coverage_ok, false);
  assert.equal(none.points_used, 0);

  const tooShort = parity(bare(ticks([70, 71, 72])), ticks([70, 71, 72]))[1]!;
  assert.equal(tooShort.true_state, "no-coverage", "points exist, none old enough");
  assert.equal(tooShort.coverage_ok, false);
  assert.equal(tooShort.points_used, 3);

  assert.notEqual(none.true_state, tooShort.true_state);
});

test("parity names both-unavailable rather than reporting one cause", () => {
  const row = parity([Number.NaN, 71, 72, 73, 74, 75], [])[1]!;
  assert.equal(row.divergence_state, "both-unavailable");
  assert.equal(row.legacy_delta, null);
  assert.equal(row.true_delta, null);
});

// ---------------------------------------------------------------------------
// Non-finite INPUT is a feed defect, distinct from a short path.
// ---------------------------------------------------------------------------

test("sanitise counts what it dropped instead of discarding quietly", () => {
  const pts: PathPoint[] = [
    at(0, 70),
    { t: Number.NaN, px: 71, source: "candle" },
    { t: T0 + 60_000, px: Number.NaN, source: "candle" },
    { t: T0 + 120_000, px: 0, source: "candle" },
    { t: T0 + 180_000, px: -5, source: "candle" },
    at(240, 74),
    at(240, 75),
  ];
  const out = sanitise(pts);
  assert.equal(out.dropped_non_finite, 2, "a NaN timestamp and a NaN price");
  assert.equal(out.dropped_non_positive, 2, "0c and -5c are not tradeable mids");
  assert.equal(out.collapsed_duplicate, 1);
  assert.equal(out.points.length, 2);
  assert.equal(out.points[1]!.px, 75, "the later duplicate wins");
});

test("parity surfaces dropped input so a thin true reading is explainable", () => {
  const pts: PathPoint[] = [
    at(0, 70),
    { t: T0 + 60_000, px: Number.NaN, source: "candle" },
    { t: T0 + 120_000, px: Number.NaN, source: "candle" },
    at(180, 73),
  ];
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.points_dropped_non_finite, 2);
  assert.equal(row.points_used, 2);
  assert.equal(row.true_state, "numeric", "the surviving points still span 180s");
  assert.equal(row.span_ms, 180_000, "honest: the nearest anchor is 180s back, not 60s");
});

test("the legacy span is recorded next to the divergence it explains", () => {
  // The finding in one assertion: the offset named d60 covered FIVE minutes - six
  // slots back crosses five gaps - against a sixty-second label.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.legacy_span_ms, 300_000, "6 slots back over 1-minute candles");
  assert.equal(row.span_ms, 60_000, "what 60s actually is");
  assert.equal(row.legacy_span_ms! / row.span_ms!, 5);
});

// ---------------------------------------------------------------------------
// HORIZON OVERSHOOT. A true-time reading is still not the number on the label:
// the anchor is a real sample, so the span is whatever the grid allows. Every one
// of these asserts on span_ms/overshoot_ms, never on want_ms.
// ---------------------------------------------------------------------------

test("requested 30s on 1-minute candles measures 60s, and says so", () => {
  // The case that matters most for interpretation: on the desk's normal feed a 30s
  // horizon CANNOT produce a 30s observation. The nearest anchor at or beyond 30s
  // old is a full minute back.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const m = moveOver(pts, 30_000);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  assert.equal(m.span_ms, 60_000, "the grid offers 60s, not 30s");
  assert.notEqual(m.span_ms, m.want_ms, "span must never be assumed equal to the request");

  const row = parity(bare(pts), pts).find((r) => r.horizon === "d30")!;
  assert.equal(row.coverage_ok, true, "it IS a numeric result - just not a 30s one");
  assert.equal(row.true_delta, 1, "one minute of a 1c/min rise");
  assert.equal(row.span_ms, 60_000);
  assert.equal(row.want_ms, 30_000);
  // The figure that decides whether a 30s label is supportable from this source.
  assert.equal(row.overshoot_ms, 30_000, "100%: 30s is not exactly representable here");
  assert.equal(row.overshoot_ms / row.want_ms, 1);
});

test("requested 60s on 1-minute candles measures 60s, with no overshoot", () => {
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.span_ms, 60_000);
  assert.equal(row.overshoot_ms, 0, "the grid lands exactly on 60s, so d60 IS supportable");
});

test("requested 120s on 1-minute candles measures 120s, with no overshoot", () => {
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d120")!;
  assert.equal(row.span_ms, 120_000);
  assert.equal(row.overshoot_ms, 0);
  assert.equal(row.true_delta, 2, "two minutes of a 1c/min rise");
});

test("overshoot is recorded for all three horizons at once, candle feed", () => {
  // One table, so the interpretation is not assembled from three separate reads.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const rows = parity(bare(pts), pts);
  assert.deepEqual(
    rows.map((r) => [r.horizon, r.want_ms, r.span_ms, r.overshoot_ms]),
    [
      ["d30", 30_000, 60_000, 30_000],
      ["d60", 60_000, 60_000, 0],
      ["d120", 120_000, 120_000, 0],
    ],
  );
  // And the headline finding, per horizon: what the INDEX offset really spans.
  // `back` slots back crosses `back - 1` gaps, so these are 3, 5 and 9 minutes.
  assert.deepEqual(
    rows.map((r) => [r.horizon, r.legacy_span_ms, r.legacy_overshoot_ms]),
    [
      ["d30", 180_000, 150_000], // 4 back = 3 gaps = 3 minutes against a 30s label
      ["d60", 300_000, 240_000], // 6 back = 5 gaps = 5 minutes against a 60s label
      ["d120", 540_000, 420_000], // 10 back = 9 gaps = 9 minutes against a 120s label
    ],
  );
});

test("overshoot is never negative: the helper overshoots rather than undershooting", () => {
  // An undershoot would mean the anchor was younger than the request, i.e. the
  // reading covered LESS time than it claims - the one direction that would let a
  // row overstate a short move as a long one.
  for (const pts of [
    candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]),
    ticks([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
      91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102]),
    [at(0, 70), at(7, 71), at(23, 72), at(61, 73), at(95, 74), at(151, 75)],
  ]) {
    for (const r of parity(bare(pts), pts)) {
      if (!r.coverage_ok) continue;
      assert.ok(r.overshoot_ms! >= 0, `${r.horizon} undershot by ${r.overshoot_ms}ms`);
      assert.equal(r.overshoot_ms, r.span_ms! - r.want_ms, "overshoot is span minus request");
    }
  }
});

test("the ~4s tick feed is the branch where the labels nearly hold", () => {
  // 4s spacing: the nearest anchor at or beyond 60s is 60s exactly when 60 divides
  // the spacing, and this is the contrast that makes the 15x range concrete.
  const pts = ticks(Array.from({ length: 40 }, (_, i) => 70 + i * 0.1));
  const rows = parity(bare(pts), pts);
  const d60 = rows.find((r) => r.horizon === "d60")!;
  assert.equal(d60.span_ms, 60_000, "4s grid lands on 60s exactly");
  assert.equal(d60.overshoot_ms, 0);
  // But the INDEX offset on this same feed spans 20 seconds, not 60.
  assert.equal(d60.legacy_span_ms, 20_000);
  assert.equal(d60.legacy_overshoot_ms, -40_000, "the old reading covers a THIRD of its label");
  // Which is the whole point: the same offset spans 300s on candles and 20s here. The
  // bare array must be the aligned one — an empty array would (correctly) trip the
  // alignment guard and report no span at all.
  const cPts = candles([70, 71, 72, 73, 74, 75, 76]);
  const candleRow = parity(bare(cPts), cPts).find((r) => r.horizon === "d60")!;
  assert.equal(candleRow.legacy_span_aligned, true);
  assert.equal(candleRow.legacy_span_ms! / 20_000, 15);
});

test("irregular spacing records the span actually chosen, not a nominal one", () => {
  // Deliberately uneven: 0, 7, 23, 61, 95, 151s. A 60s request cannot land on 60.
  const pts = [at(0, 70), at(7, 71), at(23, 72), at(61, 73), at(95, 74), at(151, 75)];
  const m = moveOver(pts, 60_000);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  // Newest is 151s. Points at or beyond 60s old: 0, 7, 23, 61 (age 151, 144, 128, 90).
  // The LATEST of those is 61s, so the span is 90s.
  assert.equal(m.from_t, T0 + 61_000);
  assert.equal(m.span_ms, 90_000);
  assert.equal(m.delta, 75 - 73);

  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.span_ms, 90_000, "the real span, not 60_000");
  assert.equal(row.overshoot_ms, 30_000);
  assert.notEqual(row.span_ms, row.want_ms);
});

test("a gap straddling the horizon reports the whole gap as the span", () => {
  // 0, 20s, then a 5-minute hole, then 324s. A 60s request must cross the hole and
  // say the span was 304s - silently calling that "60 seconds of movement" would be
  // the original defect in a new place.
  const pts = [at(0, 70), at(20, 71), at(324, 90), at(328, 91)];
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.span_ms, 308_000, "from the 20s point to the 328s point");
  assert.equal(row.overshoot_ms, 248_000, "over four minutes past the label");
  assert.ok(row.overshoot_ms! > row.want_ms * 4, "the overshoot dwarfs the horizon");
  assert.equal(row.coverage_ok, true, "it is a real reading - of the wrong interval");
});

// ---------------------------------------------------------------------------
// END-STALENESS. The reading ends at the newest SAMPLE, not at now.
// ---------------------------------------------------------------------------

test("a stale newest candle is visible, not hidden inside the reading", () => {
  // Candles ending at 600s, but the decision tick is at 655s: the newest sample is
  // 55 seconds old, so a "last 60 seconds" reading really describes 540s-600s, a
  // window that ended almost a minute before the decision.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const now = T0 + 655_000;
  const rows = parity(bare(pts), pts, now);
  for (const r of rows) {
    assert.equal(r.newest_t, T0 + 600_000);
    assert.equal(r.newest_age_ms, 55_000, `${r.horizon} must expose the end-staleness`);
  }
  const d60 = rows.find((r) => r.horizon === "d60")!;
  assert.equal(d60.decision_fidelity, "end-shifted", "the interval does not end at as_of");
  // The measured interval ended before the decision moment, and both ends are known.
  assert.equal(d60.newest_t! - d60.span_ms!, T0 + 540_000);
  assert.equal(now - (d60.newest_t! - d60.span_ms!), 115_000, "115s of real age at the tick");
});

test("a fresh tick feed shows near-zero end-staleness", () => {
  const pts = ticks([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86]);
  const now = T0 + 64_000 + 800; // 800ms after the newest tick at 64s
  const row = parity(bare(pts), pts, now).find((r) => r.horizon === "d60")!;
  assert.equal(row.newest_age_ms, 800);
  assert.equal(row.decision_fidelity, "end-shifted", "800ms is still not zero");
  // And when the newest point IS the tick - which is what live.ts stamps on the
  // per-tick fallback - the reading genuinely ends at the decision moment.
  const atTick = parity(bare(pts), pts, T0 + 64_000).find((r) => r.horizon === "d60")!;
  assert.equal(atTick.newest_age_ms, 0);
  assert.equal(atTick.decision_fidelity, "decision-aligned");
});

test("end-staleness is null rather than zero when no clock was supplied", () => {
  // A missing clock must not read as "perfectly fresh".
  const pts = candles([70, 71, 72, 73, 74, 75, 76]);
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.newest_age_ms, null);
  assert.equal(row.newest_t, T0 + 360_000, "the timestamp itself is still known");
});

test("a clock before the newest sample yields a negative age rather than a clamp", () => {
  // Clock skew between the feed's stamp and the tick's own is a fact worth seeing,
  // not something to floor at zero.
  const pts = candles([70, 71, 72]);
  const row = parity(bare(pts), pts, T0 + 100_000).find((r) => r.horizon === "d60")!;
  assert.equal(row.newest_age_ms, -20_000);
});

test("an empty path has no newest sample to be stale", () => {
  const row = parity([], [], T0)[1]!;
  assert.equal(row.newest_t, null);
  assert.equal(row.newest_age_ms, null);
  assert.equal(row.overshoot_ms, null, "no span, so no overshoot");
});

// ---------------------------------------------------------------------------
// Faithfulness, proved rather than argued: the rounding in legacyMove is a no-op
// on every price shape the desk can actually produce.
// ---------------------------------------------------------------------------

test("legacyMove's rounding cannot change a value production would have produced", () => {
  // Candle prices come from cents(), which returns WHOLE cents (Math.round). Tick
  // prices are (yes_bid + yes_ask) / 2 on integer cents, so multiples of 0.5. Both
  // are already multiples of 0.1, so Math.round(d * 10) / 10 is the identity - the
  // comparator cannot round a value across a threshold that production would not.
  const shapes = [
    [70, 71, 72, 73, 74, 75, 76], // whole cents, candles
    [70.5, 71, 71.5, 72, 72.5, 73, 73.5], // half cents, tick mids
    [0.5, 1, 99, 99.5, 50, 50.5, 7.5],
  ];
  for (const path of shapes) {
    for (const back of [4, 6, 10]) {
      if (path.length < back) continue;
      const raw = path[path.length - 1]! - path[path.length - back]!;
      assert.equal(legacyMove(path, back), raw, `rounding altered ${raw} at back=${back}`);
    }
  }
  // And the threshold that matters most: a half-cent value just under a bar is not
  // nudged over it. 77.5 - 70 = 7.5, which must stay under the 8c bar the seats use.
  assert.equal(legacyMove([70, 71, 72, 73, 74, 77.5], 6), 7.5);
  assert.equal(Math.abs(legacyMove([70, 71, 72, 73, 74, 77.5], 6)) >= 8, false);
  // Exactly 8 still reads as 8, so the no-op cuts both ways.
  assert.equal(Math.abs(legacyMove([70, 71, 72, 73, 74, 78], 6)) >= 8, true);
});

// ---------------------------------------------------------------------------
// The legacy span is only answerable when the two arrays line up slot-for-slot.
// ---------------------------------------------------------------------------

test("an unaligned timestamped path yields no legacy span rather than a wrong one", () => {
  // The real failure mode: eleven candles were priced and used by production, but one
  // had an unreadable timestamp, so the timestamped path is ten long. Slot i of the
  // bare array is no longer slot i of the points, so a span measured from the points
  // would describe a DIFFERENT pair of slots than legacy_delta subtracted.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79]); // 10 timestamped
  const path = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]; // 11 priced
  const row = parity(path, pts).find((r) => r.horizon === "d60")!;

  assert.equal(row.legacy_span_aligned, false);
  assert.equal(row.legacy_span_ms, null, "no honest span exists, so none is reported");
  assert.equal(row.legacy_overshoot_ms, null);
  // The legacy VALUE is still recorded - it is what production read.
  assert.equal(row.legacy_delta, 80 - 75);
  assert.equal(row.legacy_state, "numeric");
  // And the true reading is unaffected: it only ever used the timestamped points.
  assert.equal(row.true_delta, 1);
  assert.equal(row.span_ms, 60_000);
});

test("a collapsed duplicate makes the arrays unaligned, and that is reported", () => {
  // Two readings for one instant: production's bare array keeps both, sanitise keeps
  // one. Same length mismatch, same refusal to guess a span.
  const pts: PathPoint[] = [
    at(0, 70),
    at(60, 71),
    at(120, 72),
    at(180, 73),
    at(240, 74),
    at(300, 75),
    at(300, 76),
  ];
  const path = [70, 71, 72, 73, 74, 75, 76];
  const row = parity(path, pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.points_collapsed_duplicate, 1);
  assert.equal(row.legacy_span_aligned, false);
  assert.equal(row.legacy_span_ms, null);
});

test("the aligned case still reports the span, so the guard is not a blanket null", () => {
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.legacy_span_aligned, true);
  assert.equal(row.legacy_span_ms, 300_000);
  assert.equal(row.legacy_overshoot_ms, 240_000);
});

// ---------------------------------------------------------------------------
// DECISION-HORIZON FIDELITY. `span_ms = 60_000, overshoot_ms = 0` is satisfied
// identically by "the last 60 seconds" and by "a 60-second interval that ended a
// minute ago". These must be distinguishable, or a zero span overshoot will later be
// read as proof of exact horizon coverage.
// ---------------------------------------------------------------------------

test("a shifted 60s interval is distinguishable from a genuinely fresh one", () => {
  // CASE A — shifted. as_of = 120s, newest point = 60s, anchor = 0s, requested 60s.
  // A valid 60-second move, but it describes 0s..60s, i.e. as_of-120s .. as_of-60s.
  const shifted = parity(
    [70, 71],
    [at(0, 70), at(60, 71)],
    T0 + 120_000,
  ).find((r) => r.horizon === "d60")!;

  assert.equal(shifted.span_ms, 60_000);
  assert.equal(shifted.overshoot_ms, 0, "the span is exactly the requested interval");
  assert.equal(shifted.newest_age_ms, 60_000, "but its END is a minute before the decision");
  assert.equal(shifted.anchor_age_ms, 120_000, "and its START is two minutes before");
  assert.equal(shifted.decision_overshoot_ms, 60_000, "a whole minute of shift");
  assert.equal(shifted.decision_fidelity, "end-shifted");

  // CASE B — genuinely fresh. as_of = 120s, newest = 120s, anchor = 60s.
  const fresh = parity(
    [70, 71],
    [at(60, 70), at(120, 71)],
    T0 + 120_000,
  ).find((r) => r.horizon === "d60")!;

  assert.equal(fresh.span_ms, 60_000);
  assert.equal(fresh.overshoot_ms, 0);
  assert.equal(fresh.newest_age_ms, 0, "the interval ends AT the decision");
  assert.equal(fresh.anchor_age_ms, 60_000, "and starts exactly one horizon back");
  assert.equal(fresh.decision_overshoot_ms, 0);
  assert.equal(fresh.decision_fidelity, "decision-aligned");

  // THE POINT: identical on span coverage, opposite on decision fidelity.
  assert.equal(shifted.span_ms, fresh.span_ms);
  assert.equal(shifted.overshoot_ms, fresh.overshoot_ms);
  assert.notEqual(shifted.anchor_age_ms, fresh.anchor_age_ms);
  assert.notEqual(shifted.decision_overshoot_ms, fresh.decision_overshoot_ms);
  assert.notEqual(shifted.decision_fidelity, fresh.decision_fidelity);
});

test("the three questions are answered independently, not collapsed", () => {
  // (1) span coverage, (2) endpoint freshness, (3) decision-horizon fidelity. A reading
  // can pass one and fail another, so each must be readable on its own.
  const pts = candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]); // ends at 600s
  const row = parity(bare(pts), pts, T0 + 645_000).find((r) => r.horizon === "d60")!;

  // (1) PASSES: a real anchor existed exactly 60s behind the newest point.
  assert.equal(row.true_state, "numeric");
  assert.equal(row.coverage_ok, true);
  assert.equal(row.overshoot_ms, 0);

  // (2) FAILS: the newest point was 45 seconds old at the decision.
  assert.equal(row.newest_age_ms, 45_000);

  // (3) FAILS: the interval covered is as_of-105s .. as_of-45s, not as_of-60s .. as_of.
  assert.equal(row.anchor_age_ms, 105_000);
  assert.equal(row.decision_overshoot_ms, 45_000);
  assert.equal(row.decision_fidelity, "end-shifted");

  // Spelled out as absolute instants, so the shift is unambiguous.
  assert.equal(row.anchor_t, T0 + 540_000);
  assert.equal(row.newest_t, T0 + 600_000);
});

test("the decision-geometry identities hold across every feed shape", () => {
  // Documented in the module header and relied on by any reader doing arithmetic on
  // stored rows, so they are asserted rather than asserted-in-prose.
  const shapes = [
    candles([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]),
    ticks(Array.from({ length: 40 }, (_, i) => 70 + i * 0.1)),
    [at(0, 70), at(7, 71), at(23, 72), at(61, 73), at(95, 74), at(151, 75)],
    [at(0, 70), at(20, 71), at(324, 90), at(328, 91)],
  ];
  for (const pts of shapes) {
    const newest = pts[pts.length - 1]!.t;
    for (const now of [newest, newest + 1_000, newest + 45_000, newest - 5_000]) {
      for (const r of parity(bare(pts), pts, now)) {
        if (!r.coverage_ok) continue;
        assert.equal(
          r.anchor_age_ms,
          r.newest_age_ms! + r.span_ms!,
          "anchor_age_ms = newest_age_ms + span_ms",
        );
        assert.equal(
          r.decision_overshoot_ms,
          r.newest_age_ms! + r.overshoot_ms!,
          "decision_overshoot_ms = newest_age_ms + overshoot_ms",
        );
        // And the stored instants agree with the stored ages.
        assert.equal(now - r.anchor_t!, r.anchor_age_ms);
        assert.equal(now - r.newest_t!, r.newest_age_ms);
      }
    }
  }
});

test("a clock ahead of the feed is named end-ahead, not folded into staleness", () => {
  const pts = candles([70, 71, 72, 73, 74, 75, 76]); // ends at 360s
  const row = parity(bare(pts), pts, T0 + 300_000).find((r) => r.horizon === "d60")!;
  assert.equal(row.newest_age_ms, -60_000, "the newest stamp is ahead of the tick");
  assert.equal(row.decision_fidelity, "end-ahead");
  assert.equal(row.anchor_age_ms, 0, "still the identity: -60_000 + 60_000");
});

test("no decision clock means the fidelity question is unanswered, not passed", () => {
  const pts = candles([70, 71, 72, 73, 74, 75, 76]);
  const row = parity(bare(pts), pts).find((r) => r.horizon === "d60")!;
  assert.equal(row.decision_fidelity, "unknown");
  assert.equal(row.anchor_age_ms, null);
  assert.equal(row.decision_overshoot_ms, null);
  // Span coverage is still answerable without a clock - the questions are independent.
  assert.equal(row.coverage_ok, true);
  assert.equal(row.span_ms, 60_000);
  assert.equal(row.anchor_t, T0 + 300_000, "the instant is known even with no clock");
});

test("d30 on candles fails span coverage AND decision fidelity, separately", () => {
  // The softened claim, made precise: 30s is not exactly representable on a 1-minute
  // grid. A coarse historical approximation exists; it is just not a 30-second
  // decision-time measurement. Both failures are visible and distinct.
  const pts = candles([70, 71, 72, 73, 74, 75, 76]); // ends at 360s
  const row = parity(bare(pts), pts, T0 + 400_000).find((r) => r.horizon === "d30")!;
  assert.equal(row.coverage_ok, true, "something WAS computed - it is not unavailable");
  assert.equal(row.span_ms, 60_000, "but over 60s, not 30s");
  assert.equal(row.overshoot_ms, 30_000, "(1) span overshoot: 100% of the request");
  assert.equal(row.newest_age_ms, 40_000, "(2) endpoint 40s stale");
  assert.equal(row.decision_overshoot_ms, 70_000, "(3) start sits 70s past the label");
  assert.equal(row.anchor_age_ms, 100_000);
  assert.equal(row.decision_fidelity, "end-shifted");
});
