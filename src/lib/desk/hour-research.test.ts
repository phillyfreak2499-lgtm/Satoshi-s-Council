/**
 * Hour Research v1 — the model's own tests.
 *
 * The hourly research is shadow-only, so these tests are about honesty rather
 * than profit: missing data becomes WAIT, a missing ask is never a midpoint, one
 * hour yields at most one candidate, the ladder respects strike ordering, the
 * fee matches the repository's paper convention, and a frozen snapshot can only
 * ever produce the same read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOUR_CHECKPOINTS,
  HOUR_CHECKPOINT_BAND_S,
  HOUR_MODEL,
  HOUR_RESEARCH_AUTHORITY,
  HOUR_WAIT_REASONS,
  brier,
  checkpointFor,
  distanceBaselineP,
  edgeCents,
  expectedSettlement,
  horizonSigma,
  hourRead,
  ladderInversions,
  ladderRungs,
  marketBaselineP,
  marketImpliedYes,
  monotoneImplied,
  normCdf,
  pUncertainty,
  pYes,
  readLadder,
  shadowScore,
  type HourFeatures,
  type HourRung,
  type HourShadowRow,
} from "./hour-research.ts";
import {
  buildHourResearchBrief,
  calibrationBuckets,
  checkpointScores,
  checkpointTimeline,
  evidenceBoard,
  ladderView,
  type HourCheckpointRow,
  type HourGradedPrediction,
} from "./hour-research-brief.ts";
import { parseHourTicker, quoteCents, takerFee } from "./hour.ts";
import { takerFeeCents } from "./clock.ts";

// A fixed hour to freeze every test against: 2026-09-18 15:00 America/New_York.
const CLOSE_MS = parseHourTicker("KXBTCD-26SEP1815-T78249.99")!.close_ms;

const rung = (strike: number, over: Partial<HourRung> = {}): HourRung => ({
  ticker: `KXBTCD-26SEP1815-T${strike}`,
  strike,
  yes_bid: null,
  yes_ask: null,
  no_bid: null,
  no_ask: null,
  yes_size: null,
  no_size: null,
  ...over,
});

const FEATURES: HourFeatures = {
  index: 100_000,
  index_age_s: 5,
  spot: 99_990,
  spot_age_s: 3,
  basis: 10,
  basis_spread: null,
  sigma_hour: 0.004,
  vol_source: "realized-1m-log",
  ret5: 0.001,
  ret15: 0.002,
  ret30: 0.003,
  ret60: 0.004,
  ret4h: null,
  ret24h: null,
  range_pos: 0.6,
};

/** A healthy ladder around $100,000 with two-sided quotes on every rung. */
function healthyLadder(): HourRung[] {
  return [99_000, 99_500, 100_000, 100_500, 101_000].map((k, i) => {
    const yesAsk = 90 - i * 20; // falls as the strike rises, as a real ladder does
    return rung(k, { yes_bid: yesAsk - 2, yes_ask: yesAsk, no_bid: 96 - yesAsk, no_ask: 98 - yesAsk });
  });
}

const clock = (secsLeft: number) => ({
  event_ticker: "KXBTCD-26SEP1815",
  close_ms: CLOSE_MS,
  as_of_ms: CLOSE_MS - secsLeft * 1000,
  secs_left: secsLeft,
});

// ---------------------------------------------------------------------------

test("checkpoints are deterministic instants, never ambiguous between two", () => {
  for (const cp of HOUR_CHECKPOINTS) {
    assert.equal(checkpointFor(cp * 60), cp);
    assert.equal(checkpointFor(cp * 60 + HOUR_CHECKPOINT_BAND_S - 1), cp);
    assert.equal(checkpointFor(cp * 60 - HOUR_CHECKPOINT_BAND_S + 1), cp);
  }
  // The band is narrower than half the smallest gap, so nothing sits in two.
  assert.ok(HOUR_CHECKPOINT_BAND_S * 2 < 5 * 60);
  assert.equal(checkpointFor(40 * 60), null, "between checkpoints is null, not a nearest guess");
  assert.equal(checkpointFor(Number.NaN), null);
  assert.equal(checkpointFor(-1), null);
  // A whole hour, second by second, claims each checkpoint at most once per band.
  const claimed = new Map<number, number>();
  for (let s = 0; s <= 3600; s++) {
    const cp = checkpointFor(s);
    if (cp != null) claimed.set(cp, (claimed.get(cp) ?? 0) + 1);
  }
  assert.deepEqual([...claimed.keys()].sort((a, b) => b - a), [...HOUR_CHECKPOINTS]);
});

test("the fee is the repository's existing paper convention, cent for cent", () => {
  for (let c = 1; c <= 99; c++) assert.equal(takerFee(c), takerFeeCents(c), `fee parity at ${c}¢`);
});

test("P(settlement >= strike) is a real distribution: monotone in strike, and it never reads as certainty", () => {
  const sigma = horizonSigma(FEATURES.sigma_hour, 1800)!;
  let prev = 1;
  for (const k of [98_000, 99_000, 100_000, 101_000, 102_000]) {
    const p = pYes(100_000, k, sigma);
    assert.ok(p <= prev + 1e-12, "p must not rise as the strike rises");
    prev = p;
    assert.ok(p >= HOUR_MODEL.p_floor && p <= HOUR_MODEL.p_ceil, "clamped away from 0 and 1");
  }
  assert.ok(Math.abs(pYes(100_000, 100_000, sigma) - 0.5) < 1e-6, "at the money is a coin flip");
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
  // Uncertainty widens as the volatility estimate matters more.
  assert.ok(pUncertainty(100_000, 100_400, sigma) > 0);
});

test("a missing ask is unavailable — a midpoint is never substituted for it", () => {
  assert.equal(edgeCents(0.8, null), null, "no ask, no edge");
  assert.equal(edgeCents(0.8, 0), null);
  assert.equal(edgeCents(0.8, 100), null);
  const ask = 60;
  assert.equal(edgeCents(0.8, ask), 0.8 * 100 - ask - takerFee(ask));
  // A rung quoted on one side only has no honest mid either.
  assert.equal(marketImpliedYes(rung(100_000, { yes_ask: 40 })), null);
  assert.equal(marketImpliedYes(rung(100_000, { yes_bid: 38, yes_ask: 40 })), 0.39);
  // And the model refuses to name it a candidate.
  const rungs = healthyLadder().map((r) => ({ ...r, yes_ask: null, no_ask: null }));
  const read = hourRead({ clock: clock(1800), rungs, features: FEATURES, ladderComplete: true });
  assert.equal(read.decision, "WAIT");
  assert.equal(read.wait_reason, "no_usable_ask");
});

test("the implied curve respects strike ordering, and a crossed ladder is refused rather than smoothed into a call", () => {
  const good = healthyLadder();
  assert.equal(ladderInversions(good), 0);
  // One stale rung is a single inversion and is tolerated; a ladder whose YES
  // prices climb with the strike across several pairs is not.
  const oneStale = [...good];
  oneStale[2] = rung(100_000, { yes_bid: 92, yes_ask: 94, no_bid: 4, no_ask: 6 });
  assert.ok(ladderInversions(oneStale) <= HOUR_MODEL.max_inversions);
  const crossed = good.map((r, i) => rung(r.strike, { yes_bid: 10 + i * 18, yes_ask: 12 + i * 18, no_bid: 86 - i * 18, no_ask: 88 - i * 18 }));
  assert.ok(ladderInversions(crossed) > HOUR_MODEL.max_inversions);
  assert.equal(ladderInversions([...crossed].reverse()), ladderInversions(crossed), "the count describes the ladder, not the feed's order");
  const read = hourRead({ clock: clock(1800), rungs: crossed, features: FEATURES, ladderComplete: true });
  assert.equal(read.decision, "WAIT");
  assert.equal(read.wait_reason, "ladder_inconsistent");

  // The monotone fit smooths observed rungs only and never invents a missing one.
  const sparse = [rung(99_000, { yes_bid: 70, yes_ask: 72 }), rung(99_500), rung(100_000, { yes_bid: 80, yes_ask: 82 })];
  const fit = monotoneImplied(sparse);
  assert.equal(fit.length, 3);
  assert.equal(fit[1], null, "an unpriced rung is never interpolated into existence");
  assert.ok(fit[0]! >= fit[2]!, "the fit is non-increasing in strike");
});

test("missing or stale data becomes a structured WAIT, never a fabricated number", () => {
  const rungs = healthyLadder();
  const cases: Array<[Partial<HourFeatures>, string]> = [
    [{ index: null, spot: null }, "stale_spot"],
    [{ index: null, index_age_s: null, spot: 99_990, spot_age_s: 9_999 }, "stale_spot"],
    [{ sigma_hour: null }, "model_unavailable"],
  ];
  for (const [over, reason] of cases) {
    const read = hourRead({ clock: clock(1800), rungs, features: { ...FEATURES, ...over }, ladderComplete: true });
    assert.equal(read.decision, "WAIT", `${reason} must WAIT`);
    assert.ok(HOUR_WAIT_REASONS.includes(read.wait_reason!), "the reason is one of the structured set");
    assert.equal(read.candidate, null, "a WAIT never carries a candidate");
    assert.match(read.explanation, /^WAIT with /);
  }
  const incomplete = hourRead({ clock: clock(1800), rungs, features: FEATURES, ladderComplete: false });
  assert.equal(incomplete.wait_reason, "incomplete_ladder");
  const offCheckpoint = hourRead({ clock: clock(40 * 60), rungs, features: FEATURES, ladderComplete: true });
  assert.equal(offCheckpoint.wait_reason, "outside_checkpoint");
  // No expected settlement at all: still a WAIT, with nothing invented.
  const blind = hourRead({
    clock: clock(1800),
    rungs,
    features: { ...FEATURES, index: null, spot: null, basis: null },
    ladderComplete: true,
  });
  assert.equal(blind.expected_settlement, null);
  assert.equal(blind.decision, "WAIT");
});

test("a thin edge is a WAIT, and the floor is never lowered to manufacture a call", () => {
  // Price every rung at exactly the model's own probability: no edge anywhere.
  const sigma = horizonSigma(FEATURES.sigma_hour, 1800)!;
  const rungs = [99_500, 100_000, 100_500].map((k) => {
    const p = pYes(100_000, k, sigma);
    const yesAsk = Math.round(p * 100);
    return rung(k, { yes_bid: yesAsk - 1, yes_ask: yesAsk, no_bid: 99 - yesAsk, no_ask: 100 - yesAsk });
  });
  const read = hourRead({ clock: clock(1800), rungs, features: FEATURES, ladderComplete: true });
  assert.equal(read.decision, "WAIT");
  assert.equal(read.wait_reason, "insufficient_edge");
  assert.equal(HOUR_MODEL.min_edge_cents, 4, "the edge floor is frozen with the version");
});

test("at most one candidate comes out of one read, chosen by the largest after-fee edge", () => {
  // The model expects $100,000; a ladder mispriced low on YES gives several
  // rungs an edge, and exactly one of them may be selected.
  const rungs = [99_000, 99_200, 99_400, 99_600].map((k) => rung(k, { yes_bid: 8, yes_ask: 10, no_bid: 88, no_ask: 90 }));
  const read = hourRead({ clock: clock(600), rungs, features: FEATURES, ladderComplete: true });
  assert.notEqual(read.decision, "WAIT");
  assert.ok(read.candidate, "a candidate exists");
  assert.equal(read.rungs.length, 4, "the whole ladder is still scored for calibration");
  const withEdge = read.rungs.filter((r) => (r.best_edge ?? -1) >= HOUR_MODEL.min_edge_cents);
  assert.ok(withEdge.length > 1, "several rungs qualified");
  const best = Math.max(...withEdge.map((r) => r.best_edge!));
  assert.equal(read.candidate!.edge_cents, best, "the single candidate is the best of them");
  assert.equal(read.candidate!.side, "YES");
  assert.equal(read.candidate!.fee, takerFee(read.candidate!.ask));
});

test("scoring the whole ladder never turns one hour into dozens of independent fills", () => {
  const rows: HourShadowRow[] = [
    {
      close_time: "2026-09-18T19:00:00.000Z",
      checkpoint: 30,
      decision: "YES",
      wait_reason: null,
      ticker: "A",
      strike: 99_000,
      side: "YES",
      ask: 40,
      fee: takerFee(40),
      p_model: 0.7,
      p_market: 0.4,
      edge_cents: 25,
      explanation: "",
      result: "YES",
      official_value: 99_500,
      ev_cents: 100 - 40 - takerFee(40),
    },
    {
      close_time: "2026-09-18T20:00:00.000Z",
      checkpoint: 15,
      decision: "WAIT",
      wait_reason: "insufficient_edge",
      ticker: null,
      strike: null,
      side: null,
      ask: null,
      fee: null,
      p_model: null,
      p_market: null,
      edge_cents: null,
      explanation: "",
      result: "NO",
      official_value: 98_000,
      ev_cents: null,
    },
  ];
  const s = shadowScore(rows);
  assert.equal(s.windows, 2, "two graded hours");
  assert.equal(s.calls, 1, "one call");
  assert.equal(s.waits, 1, "a WAIT is a sit, never a loss");
  assert.equal(s.losses, 0);
  assert.equal(s.wins, 1);
  assert.ok(s.brier_model != null && s.brier_market != null);
  assert.ok(s.brier_model! < s.brier_market!, "Brier is scored on the side actually taken");
  // An ungraded book scores zero windows, not a zero record.
  const ungraded = shadowScore(rows.map((r) => ({ ...r, result: null })));
  assert.equal(ungraded.windows, 0);
  assert.equal(ungraded.win_rate, null);
  assert.equal(shadowScore([]).windows, 0);
});

test("a frozen snapshot can only ever produce the same read — no clock, no feed, no future", () => {
  const rungs = healthyLadder();
  const a = hourRead({ clock: clock(900), rungs, features: FEATURES, ladderComplete: true });
  const b = hourRead({ clock: clock(900), rungs: [...rungs].reverse(), features: { ...FEATURES }, ladderComplete: true });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), "same snapshot, same read");
  // Nothing in the read depends on data after the decision instant: the read at
  // 30 minutes left is unchanged by what the ladder does at 5 minutes left.
  const later = healthyLadder().map((r) => rung(r.strike, { yes_bid: 1, yes_ask: 2, no_bid: 97, no_ask: 98 }));
  const early = hourRead({ clock: clock(1800), rungs, features: FEATURES, ladderComplete: true });
  const earlyAgain = hourRead({ clock: clock(1800), rungs, features: FEATURES, ladderComplete: true });
  assert.deepEqual(early, earlyAgain);
  assert.notDeepEqual(early.rungs, hourRead({ clock: clock(300), rungs: later, features: FEATURES, ladderComplete: true }).rungs);
  // The read carries no settlement field at all: an outcome cannot leak into it.
  assert.equal("result" in a, false);
  assert.equal("official_value" in a, false);
  assert.equal(a.authority, HOUR_RESEARCH_AUTHORITY);
  assert.equal(a.authority, "none");
});

test("expected settlement prefers the official index, and says which source it used", () => {
  assert.deepEqual(expectedSettlement(FEATURES), { value: 100_000, source: "index" });
  assert.deepEqual(expectedSettlement({ ...FEATURES, index_age_s: 9_999 }), { value: 100_000, source: "spot+basis" });
  assert.deepEqual(expectedSettlement({ ...FEATURES, index: null, basis: null }), { value: 99_990, source: "spot" });
  assert.deepEqual(expectedSettlement({ ...FEATURES, index: null, spot: null }), { value: null, source: "none" });
  assert.equal(horizonSigma(0.004, 3600), 0.004);
  assert.equal(horizonSigma(null, 3600), null);
  assert.equal(horizonSigma(0.004, 0), null);
});

test("the ladder is priced against real observed quotes only, and baselines exist to beat", () => {
  const reads = readLadder(healthyLadder(), FEATURES, 1800);
  assert.equal(reads.length, 5);
  for (const r of reads) {
    assert.ok(r.p_yes + r.p_no > 0.999 && r.p_yes + r.p_no < 1.001, "YES and NO are complements");
    if (r.yes_ask == null) assert.equal(r.edge_yes, null);
  }
  const two = rung(100_000, { yes_bid: 38, yes_ask: 40, no_bid: 58, no_ask: 60 });
  assert.equal(marketBaselineP(two), marketImpliedYes(two), "the market baseline is the market's own implied probability");
  assert.equal(marketBaselineP(rung(100_000, { yes_ask: 40 })), null, "a one-sided rung has no market baseline");
  assert.ok(distanceBaselineP(99_990, 100_000, 1800)! > 0);
  assert.equal(distanceBaselineP(null, 100_000, 1800), null);
  assert.equal(brier(1, 1), 0);
  assert.equal(brier(0, 1), 1);
});

test("the ladder parser keeps only the 'at or above' rungs of the hour it was asked for", () => {
  const rows = [
    { ticker: "KXBTCD-26SEP1815-T99000", floor_strike: 99_000, yes_bid_dollars: "0.40", yes_ask_dollars: "0.42" },
    { ticker: "KXBTCD-26SEP1816-T99000", floor_strike: 99_000 }, // a different hour
    { ticker: "KXBTCD-26SEP1815-B99000", floor_strike: 99_000 }, // a between bucket
    { ticker: "NOTAKXBTCD-THING", floor_strike: 1 },
  ];
  const out = ladderRungs(rows, CLOSE_MS, parseHourTicker, quoteCents);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.strike, 99_000);
  assert.equal(out[0]!.yes_ask, 42, "dollar quotes are read as cents");
});

// ---------------------------------------------------------------------------
// The public read model
// ---------------------------------------------------------------------------

test("the ladder view keeps the model's own choice and marks the rung nearest expected settlement", () => {
  const rungs = Array.from({ length: 40 }, (_, i) => rung(98_000 + i * 200, { yes_bid: 8, yes_ask: 10, no_bid: 88, no_ask: 90 }));
  const read = hourRead({ clock: clock(600), rungs, features: FEATURES, ladderComplete: true });
  const view = ladderView(read, 15);
  assert.ok(view.length <= 15);
  assert.equal(view.filter((r) => r.anchor).length, 1, "exactly one anchor");
  assert.equal(view.filter((r) => r.selected).length, read.candidate ? 1 : 0, "at most one selected rung");
  for (let i = 1; i < view.length; i++) assert.ok(view[i]!.strike < view[i - 1]!.strike, "drawn high strike first");
  assert.deepEqual(ladderView({ ...read, rungs: [] }), []);
});

test("the evidence board reports six families and says which could not be read", () => {
  const read = hourRead({ clock: clock(900), rungs: healthyLadder(), features: FEATURES, ladderComplete: true });
  const cards = evidenceBoard(FEATURES, read.quality, read.expected_settlement, read.expected_source, read.sigma_horizon, 900, 100_000);
  assert.equal(cards.length, 6);
  assert.ok(cards.every((c) => c.ok), "a healthy snapshot reads as usable");
  const blind: HourFeatures = { ...FEATURES, index: null, spot: null, basis: null, sigma_hour: null, ret5: null, ret15: null, ret30: null, ret60: null, ret4h: null, ret24h: null };
  const blindRead = hourRead({ clock: clock(900), rungs: healthyLadder(), features: blind, ladderComplete: true });
  const blindCards = evidenceBoard(blind, blindRead.quality, null, "none", null, 900, null);
  assert.ok(blindCards.filter((c) => !c.ok).length >= 4, "missing feeds are reported as unusable");
  assert.ok(blindCards.every((c) => c.value.length > 0), "every card still prints something honest");
});

test("the checkpoint timeline shows all six, and a checkpoint with no stored row is never hidden", () => {
  const stored: HourCheckpointRow[] = [
    { checkpoint: 45, decision: "WAIT", wait_reason: "insufficient_edge", ticker: null, strike: null, side: null, ask: null, p_model: null, edge_cents: null, as_of: "2026-09-18T18:15:00.000Z" },
    { checkpoint: 30, decision: "YES", wait_reason: null, ticker: "A", strike: 99_000, side: "YES", ask: 40, p_model: 0.7, edge_cents: 25, as_of: "2026-09-18T18:30:00.000Z" },
  ];
  const rows = checkpointTimeline(stored, 12 * 60);
  assert.equal(rows.length, HOUR_CHECKPOINTS.length);
  assert.deepEqual(rows.map((r) => r.checkpoint), [...HOUR_CHECKPOINTS]);
  assert.equal(rows.find((r) => r.checkpoint === 45)!.state, "done");
  assert.equal(rows.find((r) => r.checkpoint === 20)!.state, "missed", "a passed checkpoint with no row is shown, not dropped");
  assert.equal(rows.find((r) => r.checkpoint === 10)!.state, "ahead");
  assert.equal(rows.find((r) => r.checkpoint === 5)!.decision, null);
});

test("calibration and per-checkpoint Brier come from graded rows only, and an empty bucket stays empty", () => {
  const graded: HourGradedPrediction[] = [
    { checkpoint: 30, p_model: 0.05, p_market: 0.1, p_baseline_dist: 0.2, outcome_yes: 0 },
    { checkpoint: 30, p_model: 0.95, p_market: 0.9, p_baseline_dist: 0.8, outcome_yes: 1 },
    { checkpoint: 15, p_model: 0.55, p_market: 0.5, p_baseline_dist: 0.5, outcome_yes: 1 },
    { checkpoint: 15, p_model: null, p_market: null, p_baseline_dist: null, outcome_yes: 1 },
    { checkpoint: 15, p_model: 0.4, p_market: 0.4, p_baseline_dist: 0.4, outcome_yes: null },
  ];
  const buckets = calibrationBuckets(graded);
  assert.equal(buckets.length, 10);
  assert.equal(buckets[0]!.n, 1);
  assert.equal(buckets[9]!.n, 1);
  assert.equal(buckets[5]!.n, 1);
  assert.equal(buckets[2]!.n, 0);
  assert.equal(buckets[2]!.hit_rate, null, "an empty bucket never borrows a neighbour's rate");
  const scores = checkpointScores(graded);
  assert.equal(scores.length, HOUR_CHECKPOINTS.length);
  assert.equal(scores.find((s) => s.checkpoint === 45)!.n, 0);
  assert.equal(scores.find((s) => s.checkpoint === 45)!.brier_model, null);
  assert.equal(scores.find((s) => s.checkpoint === 30)!.n, 2);
  assert.ok(scores.find((s) => s.checkpoint === 30)!.brier_model! < scores.find((s) => s.checkpoint === 30)!.brier_baseline!);
});

test("the brief prints authority none, keeps the live rule false, and marks unreadable storage as unavailable", () => {
  const read = hourRead({ clock: clock(900), rungs: healthyLadder(), features: FEATURES, ladderComplete: true });
  const brief = buildHourResearchBrief({
    now: CLOSE_MS - 900_000,
    hour: { event_ticker: "KXBTCD-26SEP1815", close_ms: CLOSE_MS, secs_left: 900 },
    read,
    features: FEATURES,
    stored: [],
    shadow: [],
    graded: [],
  });
  assert.equal(brief.authority, "none");
  assert.equal(brief.live_rule, false);
  assert.equal(brief.storage_unavailable, false);
  assert.equal(brief.record.windows, 0);
  assert.match(brief.copy.shadow, /SHADOW READ — NOT A LIVE HOURLY RULE/);
  assert.equal(brief.evidence.length, 6);
  assert.deepEqual([...brief.checkpoints], [...HOUR_CHECKPOINTS]);
  assert.ok(brief.snapshot);

  const dark = buildHourResearchBrief({ now: CLOSE_MS, hour: null, read: null, features: null, stored: null, shadow: null, graded: null });
  assert.equal(dark.storage_unavailable, true, "a table that cannot be read is not a zero record");
  assert.equal(dark.record.windows, 0);
  assert.deepEqual(dark.ladder, []);
  assert.deepEqual(dark.evidence, []);
  assert.equal(dark.hour, null);
  assert.equal(dark.snapshot, null);
});
