import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLUSTER_MS,
  FOLLOW_MS,
  IMPACT_MS,
  LARGE_PCTILE,
  MIN_DISTRIBUTION,
  MIN_LARGE,
  RESPONSE_CENTS,
  cluster,
  midAt,
  readPrint,
  sizePercentile,
  whaleReport,
  type MidPoint,
  type Print,
  type PrintRead,
} from "./whale2.ts";

const mids = (pairs: [number, number][]): MidPoint[] => pairs.map(([t, mid]) => ({ t, mid }));
/** A flat midpoint series every second for `secs`, starting at `mid`. */
const flat = (mid: number, secs = 60, t0 = 0): MidPoint[] =>
  Array.from({ length: secs }, (_, i) => ({ t: t0 + i * 1000, mid }));
/** A series that walks `per` cents a second from `mid`. */
const walk = (mid: number, per: number, secs = 60, t0 = 0): MidPoint[] =>
  Array.from({ length: secs }, (_, i) => ({ t: t0 + i * 1000, mid: mid + per * i }));

const many = (n: number, size: number) => Array.from({ length: n }, () => size);

test("absolute size means nothing: a print is ranked against recent prints", () => {
  const recent = many(MIN_DISTRIBUTION, 10);
  assert.equal(sizePercentile(50, recent), 100);
  assert.equal(sizePercentile(5, recent), 0);
  // The same 50 lots is unremarkable in a market that trades 100s.
  assert.equal(sizePercentile(50, many(MIN_DISTRIBUTION, 500)), 0);
});

test("a percentile is withheld until there is a distribution to rank against", () => {
  assert.equal(sizePercentile(50, many(MIN_DISTRIBUTION - 1, 10)), null);
  assert.equal(sizePercentile(0, many(50, 10)), null);
});

test("one order sliced into ten is one decision, not ten", () => {
  // The classic way to mistake one trader for a crowd.
  const ps: Print[] = Array.from({ length: 10 }, (_, i) => ({ t: i * 200, side: "UP", size: 5, mid: 50 }));
  const c = cluster(ps);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.size, 50);
  assert.equal(c[0]!.prints, 10);
  // And it is timestamped when the decision STARTED.
  assert.equal(c[0]!.t, 0);
});

test("prints on opposite sides are never clustered, however close", () => {
  const c = cluster([
    { t: 0, side: "UP", size: 5, mid: 50 },
    { t: 100, side: "DOWN", size: 5, mid: 50 },
  ]);
  assert.equal(c.length, 2);
});

test("a gap longer than the cluster window starts a new decision", () => {
  const c = cluster([
    { t: 0, side: "UP", size: 5, mid: 50 },
    { t: CLUSTER_MS + 1, side: "UP", size: 5, mid: 50 },
  ]);
  assert.equal(c.length, 2);
});

test("clustering walks the prints in time order even when handed them shuffled", () => {
  const ps: Print[] = [
    { t: 400, side: "UP", size: 1, mid: 50 },
    { t: 0, side: "UP", size: 1, mid: 50 },
    { t: 200, side: "UP", size: 1, mid: 50 },
  ];
  const c = cluster(ps);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.t, 0);
  assert.equal(c[0]!.size, 3);
});

test("impact is signed the aggressor's way on both sides", () => {
  const recent = many(50, 1);
  // A buyer lifts and the midpoint rises: positive.
  const up = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, walk(50, 1), recent);
  assert.ok(up.impact! > 0);
  // A seller hits and the midpoint falls: also positive, in their favour.
  const down = readPrint({ t: 0, side: "DOWN", size: 100, mid: 50 }, walk(50, -1), recent);
  assert.ok(down.impact! > 0, "a seller's impact must be positive when price falls");
  // And a move against the aggressor is negative on both sides.
  assert.ok(readPrint({ t: 0, side: "DOWN", size: 100, mid: 50 }, walk(50, 1), recent).impact! < 0);
});

test("impact per unit separates a thin market from a thick one", () => {
  const recent = many(50, 1);
  const small = readPrint({ t: 0, side: "UP", size: 20, mid: 50 }, walk(50, 1.5), recent);
  const big = readPrint({ t: 0, side: "UP", size: 200, mid: 50 }, walk(50, 1.5), recent);
  // Same 3¢ move; the market that needed 200 lots for it is ten times thicker.
  assert.equal(small.impact, big.impact);
  assert.ok(small.impact_per_100! > big.impact_per_100! * 5);
});

test("continuation and reversal are one comparison with two names, never both", () => {
  const recent = many(50, 1);
  const kept = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, walk(50, 0.2), recent);
  assert.equal(kept.continued, true);
  assert.equal(kept.reversed, false);
  const came = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, walk(50, -0.2), recent);
  assert.equal(came.continued, false);
  assert.equal(came.reversed, true);
});

test("a move inside the noise floor is neither continuation nor reversal", () => {
  const recent = many(50, 1);
  const mids = [...flat(50, 40), { t: FOLLOW_MS, mid: 50 + RESPONSE_CENTS / 2 }];
  const r = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, mids, recent);
  assert.equal(r.continued, false);
  assert.equal(r.reversed, false);
});

test("absorption is size crossing with no response, and only for a large print", () => {
  // The state a volume proxy cannot see.
  const recent = many(50, 1);
  const big = readPrint({ t: 0, side: "UP", size: 500, mid: 50 }, flat(50), recent);
  assert.equal(big.large, true);
  assert.equal(big.absorbed, true, "a top-decile print that moved nothing is absorption");
  // A small print meeting no response is just a small print.
  const tiny = readPrint({ t: 0, side: "UP", size: 1, mid: 50 }, flat(50), many(50, 100));
  assert.equal(tiny.large, false);
  assert.equal(tiny.absorbed, false);
});

test("a large print that does move the price is not absorption", () => {
  const r = readPrint({ t: 0, side: "UP", size: 500, mid: 50 }, walk(50, 0.3), many(50, 1));
  assert.equal(r.large, true);
  assert.equal(r.absorbed, false);
});

test("an unreachable horizon is null, not a zero move", () => {
  // A print near the end of a window has no 30s future. Recording that as "no
  // move" would count every late print as absorption.
  const r = readPrint({ t: 0, side: "UP", size: 500, mid: 50 }, flat(50, 5), many(50, 1));
  assert.equal(r.follow, null);
  assert.equal(r.continued, false);
  assert.equal(r.reversed, false);
  assert.equal(r.absorbed, false, "a missing future must not be read as absorption");
});

test("the midpoint is read at or after the horizon, never before it", () => {
  const series = mids([[0, 50], [1000, 51], [5000, 60]]);
  assert.equal(midAt(series, 1000), 51);
  assert.equal(midAt(series, 900), 51, "the first mark at or after the moment");
  assert.equal(midAt(series, 4000, 500), null, "nothing within the tolerance");
  assert.equal(midAt(series, 900, 50), null);
});

test("impact and follow read their own horizons", () => {
  // A print that pops and fades: up at 2s, back by 30s.
  const series = [...walk(50, 1, 5), ...flat(49, 40, 5000)];
  const r = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, series, many(50, 1));
  assert.ok(r.impact! > 0, `impact at ${IMPACT_MS}ms should be positive`);
  assert.ok(r.follow! < 0, `follow at ${FOLLOW_MS}ms should have faded`);
  assert.equal(r.reversed, true);
});

test("replenishment is unknown rather than false when the book could not say", () => {
  const unknown = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, flat(50), many(50, 1));
  assert.equal(unknown.replenished, null);
  const seen = readPrint({ t: 0, side: "UP", size: 100, mid: 50 }, flat(50), many(50, 1), true);
  assert.equal(seen.replenished, true);
});

function reads(n: number, over: Partial<PrintRead> = {}): PrintRead[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 1000, side: "UP" as const, size: 100, prints: 1, pctile: 95, large: true,
    impact: 1, impact_per_100: 1, follow: 2, continued: true, reversed: false,
    absorbed: false, replenished: null, ...over,
  }));
}

test("large prints are always reported against small ones as a control", () => {
  const r = whaleReport([...reads(40), ...reads(60, { pctile: 20, large: false, impact_per_100: 0.2 })], 100);
  assert.equal(r.large.n, 40);
  assert.equal(r.small.n, 60);
  assert.match(r.verdict, /against 0\.2¢ for the rest/);
});

test("nothing is said about large prints below the floor", () => {
  const r = whaleReport(reads(MIN_LARGE - 1), 29);
  assert.match(r.verdict, new RegExp(`Only ${MIN_LARGE - 1} large prints`));
  assert.ok(!/kept going/.test(r.verdict));
});

test("unranked prints are counted rather than dropped", () => {
  const r = whaleReport([...reads(10), ...reads(5, { pctile: null, large: false })], 15);
  assert.equal(r.unranked, 5);
  assert.equal(r.clusters, 15);
});

test("the aggressor split is reported, because buying and selling need not behave alike", () => {
  const r = whaleReport([...reads(30), ...reads(20, { side: "DOWN" })], 50);
  assert.equal(r.large_up.n, 30);
  assert.equal(r.large_down.n, 20);
});

test("the verdict refuses to become a signal", () => {
  const r = whaleReport(reads(40), 40);
  assert.match(r.verdict, /Descriptive and prospective-only/);
  assert.match(r.verdict, /no seat reads them/);
  assert.match(r.verdict, /incumbent/);
  assert.match(r.verdict, /hypothesis to test on prints recorded afterwards/);
});

test("the incumbent's record is never pooled: this module knows nothing about candles", () => {
  // A proxy and a measurement that disagree are two pieces of evidence. Pooling
  // their histories would destroy both.
  assert.equal(LARGE_PCTILE, 90);
  assert.equal(MIN_DISTRIBUTION, 20);
  const r = whaleReport(reads(40), 40);
  assert.ok(!("volume" in r), "the report must not carry a volume-proxy field");
});
