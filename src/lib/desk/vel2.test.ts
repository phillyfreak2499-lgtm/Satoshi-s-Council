import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expectedCentsPerDollar,
  expectedYesMoveCents,
  leadLag,
  normPdf,
  vel2Features,
  vel2Residual,
  type Vel2Sample,
} from "./vel2.ts";

/** A straight path: n samples a second apart, spot and yes moving linearly. */
function path(opts: {
  n: number;
  spot0: number;
  dSpotPerStep: number;
  yes0: number;
  dYesPerStep: number;
  dist: number;
  sigma: number;
  t0?: number;
}): Vel2Sample[] {
  const out: Vel2Sample[] = [];
  for (let i = 0; i < opts.n; i++) {
    out.push({
      t: (opts.t0 ?? 0) + i * 1000,
      spot: opts.spot0 + i * opts.dSpotPerStep,
      yes: opts.yes0 + i * opts.dYesPerStep,
      dist: opts.dist,
      sigma: opts.sigma,
    });
  }
  return out;
}

test("the contract is most sensitive at the money and insensitive far from it", () => {
  const sigma = 100;
  const atMoney = expectedCentsPerDollar(0, sigma);
  const near = expectedCentsPerDollar(50, sigma);
  const far = expectedCentsPerDollar(400, sigma);
  assert.ok(atMoney > near, "at the money must be the most sensitive");
  assert.ok(near > far, "sensitivity must fall as the strike moves away");
  assert.ok(far < atMoney / 100, `deep out of the money should be nearly insensitive, got ${far}`);
  // Symmetric: it does not matter which side of the strike you are on.
  assert.equal(expectedCentsPerDollar(50, sigma), expectedCentsPerDollar(-50, sigma));
  // At the money, 100·φ(0)/σ.
  assert.ok(Math.abs(atMoney - (100 * normPdf(0)) / sigma) < 1e-9);
});

test("the same BTC move means more when less time is left", () => {
  // σ shrinks as the window runs out, so the same $20 move matters more.
  const early = expectedYesMoveCents(0, 200, 20);
  const late = expectedYesMoveCents(0, 40, 20);
  assert.ok(late > early, `late ${late} should exceed early ${early}`);
  // This is the thing a fixed basis-points-to-cents rate cannot express: it
  // would have returned the same number for both.
  assert.ok(late / early > 3, "the difference should be large, not marginal");
});

test("sensitivity degrades safely rather than producing nonsense", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(expectedCentsPerDollar(0, bad), 0, `sigma ${bad}`);
  }
  assert.equal(expectedCentsPerDollar(Number.NaN, 100), 0);
  assert.equal(expectedYesMoveCents(0, 100, Number.NaN), 0);
  assert.equal(normPdf(Number.NaN), 0);
});

test("a YES move exactly as large as the underlying justified leaves no residual", () => {
  const sigma = 100;
  const dist = 0;
  const cpd = expectedCentsPerDollar(dist, sigma); // cents per dollar
  // Move spot $2 per step for 10 steps, and move YES by exactly what that implies.
  const samples = path({
    n: 11,
    spot0: 77_000,
    dSpotPerStep: 2,
    yes0: 50,
    dYesPerStep: 2 * cpd,
    dist,
    sigma,
  });
  const r = vel2Residual(samples, 10_000, 10);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.residual) < 0.01, `residual should vanish, got ${r.residual}`);
  assert.ok(Math.abs(r.d_spot - 20) < 1e-6);
  assert.ok(Math.abs(r.expected_yes - 20 * cpd) < 0.01);
});

test("a contract that moved more than the underlying justified shows a positive residual", () => {
  const sigma = 100;
  const cpd = expectedCentsPerDollar(0, sigma);
  const samples = path({
    n: 11,
    spot0: 77_000,
    dSpotPerStep: 1,
    yes0: 50,
    dYesPerStep: 3 * cpd, // three times the justified move
    dist: 0,
    sigma,
  });
  const r = vel2Residual(samples, 10_000, 10);
  assert.ok(r.residual > 0, `expected a positive residual, got ${r.residual}`);
  assert.ok(r.d_yes > r.expected_yes);
  // And the mirror case is negative.
  const lagging = path({ n: 11, spot0: 77_000, dSpotPerStep: 1, yes0: 50, dYesPerStep: 0, dist: 0, sigma });
  assert.ok(vel2Residual(lagging, 10_000, 10).residual < 0, "a contract that did not move should lag");
});

test("sensitivity is taken from the start of the horizon, not the end", () => {
  // Distance changes across the window. Using the END state would let where the
  // move finished inform what was expected of it, which is a quiet leak.
  const samples: Vel2Sample[] = [
    { t: 0, spot: 77_000, yes: 50, dist: 0, sigma: 100 },
    { t: 1_000, spot: 77_010, yes: 54, dist: 400, sigma: 100 },
  ];
  const r = vel2Residual(samples, 1_000, 5);
  // Start state is at the money, so expected is large; had it used the end
  // state (deep out of the money) expected would be ~0 and the residual ~+4.
  // Reported to three decimals, so compare at that resolution.
  assert.ok(Math.abs(r.cents_per_dollar - expectedCentsPerDollar(0, 100)) < 1e-3);
  assert.ok(r.residual < 4, `residual ${r.residual} suggests the end state was used`);
  assert.equal(r.z, 0);
});

test("a horizon without enough samples reports that rather than guessing zero", () => {
  const r = vel2Residual([{ t: 0, spot: 77_000, yes: 50, dist: 0, sigma: 100 }], 0, 5);
  assert.equal(r.ok, false);
  assert.equal(r.secs, 5);
  assert.equal(r.residual, 0);
  assert.equal(vel2Residual([], 0, 5).ok, false);
});

test("lead and lag are measured, not assumed — all four verdicts are reachable", () => {
  const sigma = 100;
  const base = { dist: 0, sigma };
  // Spot moves at step 1, YES only at step 4: spot leads.
  const spotFirst: Vel2Sample[] = [
    { t: 0, spot: 77_000, yes: 50, ...base },
    { t: 1_000, spot: 77_030, yes: 50, ...base },
    { t: 2_000, spot: 77_030, yes: 50, ...base },
    { t: 3_000, spot: 77_030, yes: 50, ...base },
    { t: 4_000, spot: 77_030, yes: 53, ...base },
  ];
  assert.equal(leadLag(spotFirst, 4_000, 30, 10).leader, "SPOT");

  // YES moves first: Kalshi leads. The incumbent's name assumes this never happens.
  const yesFirst: Vel2Sample[] = [
    { t: 0, spot: 77_000, yes: 50, ...base },
    { t: 1_000, spot: 77_000, yes: 55, ...base },
    { t: 2_000, spot: 77_030, yes: 55, ...base },
  ];
  assert.equal(leadLag(yesFirst, 2_000, 30, 10).leader, "KALSHI");

  // Both cross on the same sample.
  const together: Vel2Sample[] = [
    { t: 0, spot: 77_000, yes: 50, ...base },
    { t: 1_000, spot: 77_030, yes: 55, ...base },
  ];
  assert.equal(leadLag(together, 1_000, 30, 10).leader, "SIMULTANEOUS");

  // Neither crosses its floor: say so, do not default to SPOT.
  const quiet: Vel2Sample[] = [
    { t: 0, spot: 77_000, yes: 50, ...base },
    { t: 1_000, spot: 77_001, yes: 50.1, ...base },
  ];
  const q = leadLag(quiet, 1_000, 30, 10);
  assert.equal(q.leader, "NONE");
  assert.equal(q.spot_at, null);
  assert.equal(q.yes_at, null);
  // The floors used are reported so the verdict can be audited.
  assert.equal(q.spot_floor, 10);
  assert.equal(q.yes_floor, 0.5);
});

test("no reading can consult a sample that has not happened yet", () => {
  const sigma = 100;
  const samples = path({ n: 11, spot0: 77_000, dSpotPerStep: 1, yes0: 50, dYesPerStep: 0.1, dist: 0, sigma });
  const atTen = vel2Features(samples, 10_000, 10);
  // Append a violent future move and re-ask about t = 10_000.
  const withFuture = [
    ...samples,
    { t: 11_000, spot: 99_000, yes: 99, dist: 0, sigma },
    { t: 12_000, spot: 55_000, yes: 1, dist: 0, sigma },
  ];
  assert.deepEqual(vel2Features(withFuture, 10_000, 10), atTen, "a future sample leaked into a past reading");
});

test("every horizon is reported together, thin ones flagged rather than hidden", () => {
  const sigma = 100;
  const samples = path({ n: 20, spot0: 77_000, dSpotPerStep: 1, yes0: 50, dYesPerStep: 0.2, dist: 0, sigma });
  const f = vel2Features(samples, 19_000, 10);
  assert.equal(f.h5.secs, 5);
  assert.equal(f.h15.secs, 15);
  assert.equal(f.h30.secs, 30);
  assert.equal(f.h60.secs, 60);
  assert.ok(f.h5.ok && f.h15.ok, "short horizons have samples");
  assert.equal(f.n, 20);
  // The 60s horizon only holds what exists; it does not invent samples.
  assert.ok(f.h60.ok);
  assert.ok(Math.abs(f.h60.d_spot - 19) < 1e-6);
  // Every number finite.
  for (const h of [f.h5, f.h15, f.h30, f.h60]) {
    for (const [k, v] of Object.entries(h)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} not finite`);
    }
  }
});
