import { test } from "node:test";
import assert from "node:assert/strict";
import { normCdf } from "./clock.ts";
import {
  brier,
  calibrated,
  freshCalib,
  learn,
  probit,
  scorePreds,
  strike2Groups,
  strike2Predictions,
  strike2WalkForward,
  SHRINK_K,
  Z_BUCKET,
  Z_MAX,
  zBucket,
  type Strike2Row,
} from "./strike2.ts";

/** A window at a given fair value. `up` is the outcome, `market` the price charged. */
function row(i: number, fairYes: number, up: boolean, market = fairYes, extra: Partial<Strike2Row> = {}): Strike2Row {
  return { t: i * 900_000, fair_yes: fairYes, market_yes: market, up, ...extra };
}

test("probit inverts the desk's own normal CDF", () => {
  // The desk writes Phi(z) to the ledger; probit has to hand back the same z, or
  // every bucket is mislabelled. Tolerance is set by normCdf's own approximation.
  for (const z of [-2.5, -1.5, -0.7, -0.25, 0, 0.25, 0.7, 1.5, 2.5]) {
    const p = normCdf(z);
    assert.ok(Math.abs(probit(p) - z) < 1e-4, `z=${z} round-tripped to ${probit(p)}`);
  }
});

test("probit is signed, monotone, and zero at even money", () => {
  assert.equal(probit(0.5), 0);
  assert.ok(probit(0.7) > 0);
  assert.ok(probit(0.3) < 0);
  let last = -Infinity;
  for (const p of [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
    const z = probit(p);
    assert.ok(z > last, `not monotone at ${p}`);
    last = z;
  }
});

test("probit refuses impossible probabilities instead of returning Infinity", () => {
  // A fair value of 0 or 100 would otherwise produce an infinite z and poison a bucket.
  for (const bad of [0, 1, -0.2, 1.4, NaN, Infinity]) assert.equal(probit(bad), 0);
});

test("in-the-money and out-of-the-money never share a bucket", () => {
  assert.notEqual(zBucket(0.4), zBucket(-0.4));
  assert.equal(zBucket(0.4), -zBucket(-0.4));
  // Straddling zero is the one place a symmetric bucket is allowed: +-0.1 sigma
  // is genuinely the same proposition.
  assert.equal(zBucket(0.05), zBucket(-0.05));
});

test("buckets clamp past Z_MAX instead of sprawling into singletons", () => {
  const end = zBucket(Z_MAX);
  assert.equal(zBucket(4), end);
  assert.equal(zBucket(99), end);
  assert.equal(zBucket(-99), -end);
  assert.equal(end, Math.round(Z_MAX / Z_BUCKET));
});

test("a thin bucket stays at the prior; a heavy one is allowed to disagree", () => {
  const prior = 0.6;
  const thin = freshCalib();
  learn(thin, 0.5, true);
  learn(thin, 0.5, true);
  // Two windows, both hits, and the estimate has barely left the model.
  assert.ok(Math.abs(calibrated(thin, 0.5, prior) - prior) < 0.07);

  const heavy = freshCalib();
  for (let i = 0; i < 200; i++) learn(heavy, 0.5, true);
  // Two hundred windows of hits, and now it has earned the right to say so.
  assert.ok(calibrated(heavy, 0.5, prior) > 0.94);
});

test("shrinkage weight matches the stated pseudo-count", () => {
  // At n = SHRINK_K the empirical rate and the prior carry equal weight.
  const t = freshCalib();
  for (let i = 0; i < SHRINK_K; i++) learn(t, 1, i < SHRINK_K / 2); // empirical 0.5
  assert.ok(Math.abs(calibrated(t, 1, 0.9) - 0.7) < 1e-9);
});

test("calibrated probabilities never reach 0 or 1", () => {
  const t = freshCalib();
  for (let i = 0; i < 5000; i++) learn(t, 2, true);
  const p = calibrated(t, 2, 0.999999);
  assert.ok(p <= 0.999 && p > 0.99);
  const t2 = freshCalib();
  for (let i = 0; i < 5000; i++) learn(t2, -2, false);
  assert.ok(calibrated(t2, -2, 0.000001) >= 0.001);
});

test("a forecast cannot be changed by a window that had not happened yet", () => {
  // The whole claim of the module. Build a prefix, then append windows after it,
  // and every forecast in the prefix must come back byte-identical.
  const prefix: Strike2Row[] = [];
  for (let i = 0; i < 40; i++) prefix.push(row(i, 55 + (i % 7) * 4, i % 3 !== 0));
  const later: Strike2Row[] = [];
  for (let i = 40; i < 120; i++) later.push(row(i, 55 + (i % 7) * 4, true)); // all hits, maximally tempting
  const short = strike2Predictions(prefix);
  const long = strike2Predictions([...prefix, ...later]);
  assert.equal(long.preds.length, short.preds.length + later.length);
  for (let i = 0; i < short.preds.length; i++) {
    assert.deepEqual(long.preds[i], short.preds[i], `forecast ${i} moved when the future was appended`);
  }
});

test("rows handed over out of order are still walked in time order", () => {
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 30; i++) rows.push(row(i, 60, i < 15));
  const inOrder = strike2Predictions(rows);
  const shuffled = strike2Predictions([...rows].reverse());
  assert.deepEqual(
    shuffled.preds.map((p) => [p.t, p.p]),
    inOrder.preds.map((p) => [p.t, p.p]),
  );
});

test("the first window is pure prior and says so", () => {
  const w = strike2Predictions([row(0, 72, true), row(1, 72, true)]);
  assert.equal(w.preds[0]!.bucket_n, 0);
  assert.equal(w.preds[0]!.p, 0.72);
  // The second window sees exactly one piece of evidence, no more.
  assert.equal(w.preds[1]!.bucket_n, 1);
});

test("Brier rewards the confident and correct and punishes the confident and wrong", () => {
  assert.equal(brier(1, true), 0);
  assert.equal(brier(0, true), 1);
  assert.ok(Math.abs(brier(0.5, true) - 0.25) < 1e-12);
  assert.ok(brier(0.8, true) < brier(0.6, true));
  assert.ok(brier(0.8, false) > brier(0.6, false));
});

test("a calibrated model beats a biased prior on a biased world", () => {
  // A world where the prior is systematically 20 points too high. Calibration
  // should learn that; the raw prior cannot.
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 400; i++) rows.push(row(i, 80, i % 10 < 6, 80)); // truth is 60%, model says 80%
  const rep = strike2WalkForward(rows);
  assert.equal(rep.n, 400);
  assert.ok(Math.abs(rep.base_rate! - 0.6) < 0.02);
  assert.ok(rep.model.brier! < rep.prior.brier!, "calibration failed to correct a known bias");
  assert.equal(rep.beats_prior, true);
  // And on the windows where it had real evidence it should be close to the truth.
  assert.ok(Math.abs(rep.model_informed.mean_p! - 0.6) < 0.06);
});

test("a sharper market is reported as beating the model, not hidden", () => {
  // The market knows the truth; the desk's prior does not. An honest report says so.
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 200; i++) rows.push(row(i, 80, i % 10 < 6, 60));
  const rep = strike2WalkForward(rows);
  assert.ok(rep.market.brier! < rep.model.brier!);
  assert.equal(rep.beats_market, false);
});

test("market comparison is made on the windows the market actually priced", () => {
  // Half the windows have no usable market price. Comparing Brier across different
  // window sets would be meaningless, so those windows are excluded from both sides.
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 100; i++) rows.push(row(i, 70, i % 2 === 0, i % 2 === 0 ? 70 : 0));
  const rep = strike2WalkForward(rows);
  assert.equal(rep.n, 100);
  assert.equal(rep.market.n, 50);
  assert.equal(typeof rep.beats_market, "boolean");
});

test("unusable windows are counted, never quietly folded in", () => {
  const rows = [
    row(0, 70, true),
    row(1, 0, true),
    row(2, 100, false),
    row(3, NaN, true),
    row(4, 65, false),
  ];
  const rep = strike2WalkForward(rows);
  assert.equal(rep.n, 2);
  assert.equal(rep.skipped, 3);
});

test("an empty sample reports nothing rather than a flattering zero", () => {
  const rep = strike2WalkForward([]);
  assert.equal(rep.n, 0);
  assert.equal(rep.base_rate, null);
  assert.equal(rep.model.brier, null);
  assert.equal(rep.beats_market, null);
  assert.equal(rep.beats_prior, null);
  assert.deepEqual(rep.buckets, []);
});

test("buckets expose their own record for inspection", () => {
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 20; i++) rows.push(row(i, 75, i < 12));
  const rep = strike2WalkForward(rows);
  const b = rep.buckets.find((x) => x.n === 20);
  assert.ok(b, "the single populated bucket is missing");
  assert.equal(b!.hits, 12);
  assert.equal(b!.empirical, 0.6);
  assert.ok(b!.z > 0, "a 75c fair value must land in a positive-z bucket");
});

test("groups are a view on forecasts already made, not a re-run per group", () => {
  // If groups re-ran the walk, a regime's own later windows would train the table
  // used to forecast its earlier ones. The forecasts must be the same objects.
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push(row(i, 60 + (i % 5) * 5, i % 3 !== 0, 60 + (i % 5) * 5, { regime: i % 2 ? "US_MID" : "ASIA_LATE" }));
  }
  const walk = strike2Predictions(rows);
  const groups = strike2Groups(walk.preds, (p) => p.regime ?? null);
  assert.equal(groups.length, 2);
  assert.equal(groups.reduce((a, g) => a + g.n, 0), walk.preds.length);
  // Each group's mean forecast must equal the mean of that group's original forecasts.
  for (const g of groups) {
    const mine = walk.preds.filter((p) => p.regime === g.key);
    assert.equal(g.model.mean_p, scorePreds(mine).mean_p);
  }
});

test("grouping drops rows the key cannot name rather than bucketing them as empty", () => {
  const walk = strike2Predictions([
    row(0, 70, true, 70, { regime: "US_MID" }),
    row(1, 70, false, 70),
  ]);
  const groups = strike2Groups(walk.preds, (p) => p.regime ?? null);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.n, 1);
});

test("lean accuracy ignores forecasts that lean nowhere", () => {
  // A 50/50 call is not a right call, and must not be scored as one.
  const s = scorePreds([
    { p: 0.5, up: true },
    { p: 0.5, up: false },
  ]);
  assert.equal(s.hit_rate, 0);
  assert.equal(s.brier, 0.25);
});

test("samples inside one window cannot teach each other the answer they share", () => {
  // The replay arm feeds many samples per window. They share one outcome, so if a
  // later sample learned from an earlier one it would be reading the answer off
  // its own window. With known_at set to the close, none of them is evidence until
  // the window is over, so every sample in the window forecasts the pure prior.
  const close = 900_000;
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ t: close - 900_000 + i * 25_000, fair_yes: 70, market_yes: 70, up: true, known_at: close, window: "W1" });
  }
  const w = strike2Predictions(rows);
  assert.equal(w.preds.length, 30);
  assert.equal(w.windows, 1);
  for (const pr of w.preds) {
    assert.equal(pr.bucket_n, 0, "a sample learned from its own window");
    assert.equal(pr.p, 0.7);
  }
});

test("a window becomes evidence once it has closed, and not before", () => {
  const a = 900_000;
  const b = 1_800_000;
  const rows: Strike2Row[] = [
    { t: a - 300_000, fair_yes: 70, market_yes: 70, up: true, known_at: a, window: "W1" },
    { t: a - 100_000, fair_yes: 70, market_yes: 70, up: true, known_at: a, window: "W1" },
    { t: b - 300_000, fair_yes: 70, market_yes: 70, up: false, known_at: b, window: "W2" },
  ];
  const w = strike2Predictions(rows);
  assert.equal(w.preds[0]!.bucket_n, 0);
  assert.equal(w.preds[1]!.bucket_n, 0, "the second sample of W1 saw W1");
  // By the time W2 is sampled, W1 has settled: two pieces of evidence, both hits.
  assert.equal(w.preds[2]!.bucket_n, 2);
  assert.ok(w.preds[2]!.p > 0.7, "settled evidence was ignored");
  assert.equal(w.windows, 2);
});

test("the deferred rows still land in the published bucket counts", () => {
  // The tail teaches nothing, but a report that hid it would understate its own
  // sample size. Every usable row must appear in the buckets.
  const rows: Strike2Row[] = [];
  for (let i = 0; i < 12; i++) rows.push({ t: i * 1000, fair_yes: 70, market_yes: 70, up: i < 9, known_at: 99_000_000, window: "W1" });
  const rep = strike2WalkForward(rows);
  assert.equal(rep.n, 12);
  const total = rep.buckets.reduce((a, b) => a + b.n, 0);
  assert.equal(total, 12);
  assert.equal(rep.buckets.reduce((a, b) => a + b.hits, 0), 9);
  // And none of them was allowed to inform a forecast.
  assert.equal(rep.model_informed.n, 0);
  assert.equal(rep.model.mean_p, 0.7);
});

test("correlated rows are reported as correlated", () => {
  // n and windows diverging is the warning label. A study on 600 samples from 20
  // windows has 20 independent observations, and the report must not hide that.
  const rows: Strike2Row[] = [];
  for (let wi = 0; wi < 20; wi++) {
    for (let i = 0; i < 30; i++) {
      rows.push({
        t: wi * 900_000 + i * 25_000,
        fair_yes: 65,
        market_yes: 65,
        up: wi % 2 === 0,
        known_at: (wi + 1) * 900_000,
        window: `W${wi}`,
      });
    }
  }
  const rep = strike2WalkForward(rows);
  assert.equal(rep.n, 600);
  assert.equal(rep.windows, 20);
});

test("without known_at each row is treated as its own settled window", () => {
  // The desk_samples arm is one row per window, so the default has to keep working.
  const w = strike2Predictions([row(0, 70, true), row(1, 70, true), row(2, 70, true)]);
  assert.deepEqual(w.preds.map((p) => p.bucket_n), [0, 1, 2]);
  assert.equal(w.windows, 3);
});

test("groups count their own independent windows", () => {
  const rows: Strike2Row[] = [];
  for (let wi = 0; wi < 6; wi++) {
    for (let i = 0; i < 5; i++) {
      rows.push({
        t: wi * 900_000 + i * 25_000,
        fair_yes: 70,
        market_yes: 70,
        up: true,
        known_at: (wi + 1) * 900_000,
        window: `W${wi}`,
        regime: wi < 3 ? "US_MID" : "ASIA_MID",
      });
    }
  }
  const groups = strike2Groups(strike2Predictions(rows).preds, (p) => p.regime ?? null);
  for (const g of groups) {
    assert.equal(g.n, 15);
    assert.equal(g.windows, 3);
  }
});
