import { test } from "node:test";
import assert from "node:assert/strict";
import { takerFeeCentsExact } from "./clock.ts";
import {
  HEADLINE_PCTILE,
  HEADLINE_RESPONSE,
  MIN_PROSPECTIVE,
  PCTILE_BANDS,
  RESPONSE_BANDS,
  absorptionReport,
  cells,
  control,
  feeAt,
  isAbsorbed,
  priceTest,
  zOf,
  type AbsorptionRow,
} from "./absorption.ts";

function row(over: Partial<AbsorptionRow> = {}): AbsorptionRow {
  return {
    t: 0,
    era: "post-qty-fix",
    side: "UP",
    cluster_n: 1,
    size: 500,
    size_pctile: 95,
    size_vs_touch: 3,
    size_vs_depth: 0.4,
    impact_2s: 0,
    impact_per_100: 0,
    move_5s: 0,
    move_15s: 0,
    move_30s: 0,
    move_60s: 0,
    btc_5s: 0,
    btc_15s: 0,
    btc_30s: 0,
    btc_60s: 0,
    ofi_norm: 0,
    replenished: null,
    spread: 2,
    depth: 1200,
    dist: 50,
    sigma: 100,
    secs_left: 400,
    market_prob_up: 60,
    fair_yes: 60,
    vel_resid: 0,
    drift_ev: 0,
    cascade_ev: 0,
    regime: "US_AM_MID",
    winner: "UP",
    ...over,
  };
}

/** n events at an implied probability, with `ups` of them settling UP. */
function events(n: number, impliedUp: number, ups: number, over: Partial<AbsorptionRow> = {}): AbsorptionRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ t: i * 1000, market_prob_up: impliedUp, winner: i < ups ? "UP" : "DOWN", ...over }),
  );
}

test("the fee is the desk's exact schedule, not a second copy of the formula", () => {
  // A research edge is measured against Kalshi's published schedule to the
  // centicent. The whole-cent version is conservative paper bookkeeping and
  // would make a real edge look smaller than it is.
  for (const p of [10, 30, 50, 70, 90, 99]) {
    assert.equal(feeAt(p), takerFeeCentsExact(p), `fee at ${p}¢ is not the exact schedule`);
  }
});

test("absorption needs both a large print and a measured non-response", () => {
  assert.equal(isAbsorbed(row({ size_pctile: 95, move_30s: 0.2 }), 90, 1), true);
  assert.equal(isAbsorbed(row({ size_pctile: 50, move_30s: 0.2 }), 90, 1), false, "a small print is not absorption");
  assert.equal(isAbsorbed(row({ size_pctile: 95, move_30s: 3 }), 90, 1), false, "the price did respond");
  assert.equal(isAbsorbed(row({ size_pctile: null, move_30s: 0 }), 90, 1), false, "unranked size cannot be large");
});

test("a print with no measured future is never absorption", () => {
  // The trap: prints near the close have no 30s future, and reading that as "the
  // price did not move" would make absorption look strongest exactly where it
  // means least.
  assert.equal(isAbsorbed(row({ size_pctile: 99, move_30s: null }), 90, 1), false);
});

test("the benchmark is the price, not whether the call would have won", () => {
  // 100 events where the market said 60% UP and UP happened 60% of the time.
  // Every "UP call" won 60 times — and there is no information here at all.
  const t = priceTest(events(100, 60, 60));
  assert.equal(t.realized_up, 60);
  assert.equal(t.implied_up, 60);
  assert.equal(t.diff, 0);
  assert.equal(t.beyond_price, false);
  assert.equal(t.favours, null);
});

test("a deviation is only called when the interval excludes the implied probability", () => {
  // 60 events, market said 60%, UP happened 35% — well outside.
  const strong = priceTest(events(60, 60, 21));
  assert.equal(strong.beyond_price, true);
  assert.equal(strong.favours, "DOWN");
  assert.ok(strong.diff! < 0);
  // The same direction on a handful of events is not a deviation.
  const weak = priceTest(events(8, 60, 3));
  assert.ok(weak.diff! < 0, "the point estimate leans the same way");
  assert.equal(weak.beyond_price, false, "8 events cannot exclude anything");
});

test("BUY absorption pointing DOWN is the hypothesis, and it is not assumed", () => {
  // Aggressive buying absorbed: someone is selling into it, so UP should happen
  // LESS than the price says. The module reports the direction it finds.
  const t = priceTest(events(80, 70, 40, { side: "UP" }));
  assert.equal(t.favours, "DOWN");
  // And the mirror is measured independently, not assumed to be the reverse.
  const s = priceTest(events(80, 30, 40, { side: "DOWN" }));
  assert.equal(s.favours, "UP");
});

test("the edge is reported after the fee, on the side the deviation favours", () => {
  const t = priceTest(events(60, 60, 21)); // implied 60, realized 35 → favours DOWN
  // Taking DOWN at 40¢ when it wins 65% of the time.
  const price = 40;
  const want = 65 - price - takerFeeCentsExact(price);
  assert.ok(Math.abs(t.edge_after_fee! - want) < 0.05, `${t.edge_after_fee} vs ${want}`);
  assert.ok(t.edge_after_fee! > 0);
});

test("a real deviation smaller than the fee is reported as negative, not as an edge", () => {
  // Market says 50, UP happens 56% on a large sample: a genuine 6-point
  // deviation that a 1.75¢ fee at 50¢ eats most of... and then some.
  const t = priceTest(events(2000, 50, 1120));
  assert.equal(t.beyond_price, true);
  assert.ok(t.edge_after_fee! < t.diff!, "the fee must be taken out");
});

test("ungraded events are excluded from the test but counted as occurrences", () => {
  const rows = [...events(40, 60, 24), ...events(10, 60, 0, { winner: null })];
  const t = priceTest(rows);
  assert.equal(t.n, 40);
});

test("nothing graded means no test rather than a zero", () => {
  const t = priceTest(events(10, 60, 0, { winner: null }));
  assert.equal(t.n, 0);
  assert.equal(t.implied_up, null);
  assert.equal(t.beyond_price, false);
});

test("the grid reports every frozen band pair, both sides, both shapes", () => {
  const c = cells(events(20, 60, 12));
  assert.equal(c.length, PCTILE_BANDS.length * RESPONSE_BANDS.length * 2 * 2);
  // No single band is privileged in the grid.
  for (const p of PCTILE_BANDS) assert.ok(c.some((x) => x.pctile === p));
  for (const r of RESPONSE_BANDS) assert.ok(c.some((x) => x.response === r));
});

test("single and clustered absorption are never pooled", () => {
  const rows = [
    ...events(40, 60, 20, { cluster_n: 1 }),
    ...events(40, 60, 36, { cluster_n: 5 }),
  ];
  const grid = cells(rows).filter((c) => c.pctile === HEADLINE_PCTILE && c.response === HEADLINE_RESPONSE && c.side === "UP");
  const single = grid.find((c) => c.shape === "single")!;
  const clustered = grid.find((c) => c.shape === "clustered")!;
  assert.equal(single.test.n, 40);
  assert.equal(clustered.test.n, 40);
  assert.notEqual(single.test.realized_up, clustered.test.realized_up);
});

test("a control finds the effect in more than one band, or calls it the same thing", () => {
  // Effect present in two price bands: independent of price.
  const both = [
    ...events(60, 40, 12, { market_prob_up: 40 }),
    ...events(60, 70, 21, { market_prob_up: 70 }),
  ];
  const c = control("market probability", both, (r) => (r.market_prob_up < 55 ? "low" : "high"));
  assert.equal(c.readable, 2);
  assert.equal(c.survives_in, 2);
  assert.equal(c.independent, true);

  // Effect in one band only: it IS that variable.
  const one = [
    ...events(60, 40, 24, { market_prob_up: 40 }),
    ...events(60, 70, 21, { market_prob_up: 70 }),
  ];
  const d = control("market probability", one, (r) => (r.market_prob_up < 55 ? "low" : "high"));
  assert.equal(d.survives_in, 1);
  assert.equal(d.independent, false);
});

test("a control ignores rows it cannot band rather than lumping them together", () => {
  const rows = [...events(40, 60, 20, { regime: "US_AM_MID" }), ...events(10, 60, 5, { regime: "" })];
  const c = control("regime", rows, (r) => r.regime || null);
  assert.equal(c.strata.length, 1);
  assert.equal(c.strata[0]!.test.n, 40);
});

test("below the floor every falsification line is withheld, including 'no effect'", () => {
  // A thin sample cannot establish absence any more than presence.
  const r = absorptionReport(events(MIN_PROSPECTIVE - 1, 60, 5), 0, []);
  assert.equal(r.falsification.undecided, true);
  assert.equal(r.falsification.no_value, false);
  assert.equal(r.falsification.survives_all, false);
  assert.match(r.falsification.lines[0]!, new RegExp(`${MIN_PROSPECTIVE} is the floor`));
  assert.match(r.falsification.lines[0]!, /including "no effect"/);
});

test("no effect on a sufficient sample is stated as the answer", () => {
  const r = absorptionReport(events(120, 60, 72), 0, []);
  assert.equal(r.falsification.undecided, false);
  assert.equal(r.falsification.no_value, true);
  assert.equal(r.falsification.survives_all, false);
  assert.match(r.falsification.lines.join(" "), /no effect to explain/);
});

test("an effect that lives in one band of price is named as reading the price", () => {
  const rows = [
    ...events(60, 40, 24, { market_prob_up: 40 }),
    ...events(60, 70, 21, { market_prob_up: 70 }),
  ];
  const c = control("market probability", rows, (r) => (r.market_prob_up < 55 ? "low" : "high"));
  const r = absorptionReport(rows, 0, [c]);
  assert.equal(r.falsification.tracks_extreme_price, true);
  assert.equal(r.falsification.survives_all, false);
  assert.match(r.falsification.lines.join(" "), /reading the price, not adding to it/);
});

test("an effect that survives every control says so, and still does not promote", () => {
  const rows = [
    ...events(80, 40, 16, { market_prob_up: 40, regime: "US_AM_MID", dist: 10, secs_left: 700 }),
    ...events(80, 70, 28, { market_prob_up: 70, regime: "ASIA_MID", dist: 300, secs_left: 100 }),
  ];
  const cs = [
    control("market probability", rows, (r) => (r.market_prob_up < 55 ? "low" : "high")),
    control("regime", rows, (r) => r.regime),
    control("distance to strike", rows, (r) => (Math.abs(r.dist ?? 0) < 100 ? "near" : "far")),
    control("seconds remaining", rows, (r) => ((r.secs_left ?? 0) < 300 ? "late" : "early")),
  ];
  const r = absorptionReport(rows, 0, cs);
  assert.equal(r.falsification.survives_all, true);
  assert.match(r.falsification.lines.join(" "), /earns more sample and a conversation, not a promotion/);
});

test("pre-fix occurrences are counted and never added in", () => {
  const r = absorptionReport(events(40, 60, 24), 9137, []);
  assert.equal(r.n, 40);
  assert.equal(r.discarded_pre_fix, 9137);
  assert.match(r.note, /discarded, not pooled/);
  assert.match(r.note, /floating-point residue/);
});

test("BUY and SELL are reported apart at every level", () => {
  const rows = [...events(40, 60, 10, { side: "UP" }), ...events(40, 60, 30, { side: "DOWN" })];
  const r = absorptionReport(rows, 0, []);
  assert.equal(r.buy.n, 40);
  assert.equal(r.sell.n, 40);
  assert.notEqual(r.buy.realized_up, r.sell.realized_up);
  assert.equal(r.buy_single.n + r.buy_clustered.n, 40);
});

test("the standardised distance comes from what was stored, or not at all", () => {
  assert.equal(zOf(row({ dist: 50, sigma: 100 })), 0.5);
  assert.equal(zOf(row({ dist: 50, sigma: 0 })), null);
  assert.equal(zOf(row({ dist: null })), null);
  assert.equal(zOf(row({ sigma: null })), null);
});

test("the report says in its own payload that no threshold from it is in production", () => {
  const r = absorptionReport(events(40, 60, 24), 0, []);
  assert.match(r.note, /Bands were frozen before any of this outcome data existed/);
  assert.match(r.note, /no threshold from it is in production/);
});
