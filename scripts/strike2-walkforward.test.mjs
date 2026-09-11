/**
 * STRIKE 2.0's walk-forward calibration, checked against a second implementation.
 *
 * A calibration bug does not throw. It produces plausible numbers that are
 * quietly contaminated by the future, and every assertion written against the
 * same code that has the bug agrees with it. So this test does not re-derive the
 * expected answer from strike2.ts. It writes the same calibration a completely
 * different way — as Postgres window functions over the rows in time order,
 * counting only PRECEDING rows — and demands the two agree to the cent.
 *
 * The SQL is also the query that produced the production numbers quoted in the
 * desk's notes, so this pins those numbers to the module as well.
 *
 * Bucket edges are computed from the desk's own normal CDF rather than hardcoded,
 * so changing Z_BUCKET or Z_MAX moves both implementations together.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Constants read from the module, so the two implementations cannot drift apart. */
function constants() {
  const src = readFileSync(join(ROOT, "src/lib/desk/strike2.ts"), "utf8");
  const num = (name) => {
    const m = src.match(new RegExp(`export const ${name} = (\\d+(?:\\.\\d+)?);`));
    assert.ok(m, `${name} not found in strike2.ts`);
    return Number(m[1]);
  };
  return { bucket: num("Z_BUCKET"), max: num("Z_MAX"), k: num("SHRINK_K") };
}

/** The desk's own normal CDF, lifted from clock.ts so the edges match production. */
function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/**
 * Fair-value edges between adjacent buckets, in cents. Bucketing on fair value
 * is equivalent to bucketing on z because Phi is monotone, and it lets the SQL
 * side avoid needing an inverse normal of its own.
 */
function edges({ bucket, max }) {
  const top = Math.round(max / bucket);
  const out = [];
  for (let k = -(top - 1); k <= top; k++) out.push(100 * normCdf((k - 0.5) * bucket));
  return { list: out, top };
}

/** Deterministic pseudo-random rows, shaped like real windows: biased prior, noisy market. */
function makeRows(n, seed = 12345) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const fair = Math.round((1 + rnd() * 98) * 100) / 100;
    // The truth is the prior pulled 10 points toward even money: a real bias a
    // calibrator could in principle find, so the buckets actually diverge.
    const truth = (fair / 100) * 0.8 + 0.1;
    const up = rnd() < truth;
    const mid = Math.max(1, Math.min(99, Math.round((fair + (rnd() - 0.5) * 20) * 100) / 100));
    rows.push({ i, fair_yes: fair, market_yes: mid, up });
  }
  return rows;
}

async function sqlSide(rows, c) {
  const { list, top } = edges(c);
  const db = new PGlite();
  await db.exec(`create table r (i int, fair float8, mid float8, up int)`);
  for (const r of rows) {
    await db.query(`insert into r values ($1,$2,$3,$4)`, [r.i, r.fair_yes, r.market_yes, r.up ? 1 : 0]);
  }
  const arr = `array[${list.map((x) => x.toFixed(10)).join(",")}]::float8[]`;
  const res = await db.query(`
    with u as (
      select i, fair, mid, up, fair/100.0 as prior,
             width_bucket(fair, ${arr}) - ${top} as bkt
      from r where fair > 0 and fair < 100
    ),
    w as (
      select *,
        count(*) over (partition by bkt order by i rows between unbounded preceding and 1 preceding) as pre_n,
        coalesce(sum(up) over (partition by bkt order by i rows between unbounded preceding and 1 preceding), 0) as pre_hits
      from u
    ),
    p as (
      select *, greatest(0.001, least(0.999, (pre_hits + ${c.k}.0*prior)/(pre_n + ${c.k}.0))) as model from w
    )
    select count(*)::int as n,
           avg(up) as base_rate,
           avg((model-up)^2) as model_brier,
           avg((prior-up)^2) as prior_brier,
           avg((mid/100.0-up)^2) as market_brier,
           avg(model) as model_mean,
           count(*) filter (where pre_n >= ${c.k})::int as informed_n,
           avg((model-up)^2) filter (where pre_n >= ${c.k}) as model_informed_brier
    from p
  `);
  const bkts = await db.query(`
    select width_bucket(fair, ${arr}) - ${top} as bkt, count(*)::int as n, sum(up)::int as hits
    from r where fair > 0 and fair < 100 group by 1 order by 1
  `);
  await db.close();
  return { agg: res.rows[0], buckets: bkts.rows };
}

test("the module's walk-forward calibration matches the same calibration written in SQL", async () => {
  const c = constants();
  const { strike2Predictions, strike2Report } = await import("../src/lib/desk/strike2.ts");
  const rows = makeRows(600);
  // One settled window per row, knowable immediately after itself, so both sides
  // see the identical evidence ordering.
  const mapped = rows.map((r) => ({
    t: r.i * 900_000,
    known_at: r.i * 900_000 + 1,
    window: `W${r.i}`,
    fair_yes: r.fair_yes,
    market_yes: r.market_yes,
    up: r.up,
  }));
  const rep = strike2Report(strike2Predictions(mapped));
  const { agg, buckets } = await sqlSide(rows, c);

  const near = (a, b, what) =>
    assert.ok(Math.abs(Number(a) - Number(b)) < 5e-4, `${what}: module ${a} vs SQL ${b}`);

  assert.equal(rep.n, agg.n);
  near(rep.base_rate, agg.base_rate, "base rate");
  near(rep.model.brier, agg.model_brier, "model Brier");
  near(rep.prior.brier, agg.prior_brier, "prior Brier");
  near(rep.market.brier, agg.market_brier, "market Brier");
  near(rep.model.mean_p, agg.model_mean, "model mean forecast");
  assert.equal(rep.model_informed.n, agg.informed_n);
  near(rep.model_informed.brier, agg.model_informed_brier, "informed model Brier");

  // And the bucket table itself, cell by cell.
  const mine = new Map(rep.buckets.map((b) => [Math.round(b.z / c.bucket), b]));
  assert.equal(mine.size, buckets.length);
  for (const b of buckets) {
    const m = mine.get(Number(b.bkt));
    assert.ok(m, `bucket ${b.bkt} missing from the module's table`);
    assert.equal(m.n, b.n, `bucket ${b.bkt} count`);
    assert.equal(m.hits, b.hits, `bucket ${b.bkt} hits`);
  }
});

test("deferring evidence to the close changes the answer, so the guard is doing work", async () => {
  // If known_at were ignored, samples inside a window would train on their own
  // outcome and the Brier would improve. It must not.
  const { strike2Predictions, strike2Report } = await import("../src/lib/desk/strike2.ts");
  const base = makeRows(40);
  const perWindow = 20;
  const deferred = [];
  const leaky = [];
  base.forEach((r, wi) => {
    for (let j = 0; j < perWindow; j++) {
      const t = wi * 900_000 + j * 40_000;
      const row = { t, window: `W${wi}`, fair_yes: r.fair_yes, market_yes: r.market_yes, up: r.up };
      deferred.push({ ...row, known_at: (wi + 1) * 900_000 });
      leaky.push({ ...row, known_at: t });
    }
  });
  const honest = strike2Report(strike2Predictions(deferred));
  const cheating = strike2Report(strike2Predictions(leaky));
  assert.equal(honest.n, base.length * perWindow);
  assert.equal(honest.windows, base.length);
  // Reading its own answer makes a model look better. That is the whole hazard.
  assert.ok(
    cheating.model.brier < honest.model.brier,
    `leaking did not help (honest ${honest.model.brier} vs leaky ${cheating.model.brier}) — the fixture is not exercising the guard`,
  );
});
