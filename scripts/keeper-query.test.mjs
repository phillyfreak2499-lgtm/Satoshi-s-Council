/**
 * The Process Scorecard's query, run for real.
 *
 * This exists because the scorecard shipped all zeros to production and nothing
 * caught it. The SQL was fine to read and invalid to run: the floor comparison
 * interpolated two untyped parameters inside a CASE, Postgres resolved them as
 * text, `double precision >= text` threw, and a catch turned that into a zeroed
 * card. The page then stated that the chair had sat 0% of 0 windows directly
 * beside totals showing a hundred fills.
 *
 * A test that mocked the database would have passed. So this one takes the
 * actual query text out of books.server.ts, binds it exactly as the tagged
 * template does, and executes it against a real Postgres over a ledger holding
 * both pre-trial 70¢ fills and post-trial 80¢ fills.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** The floor constants, read from the source so the test cannot drift from it. */
function floorConstants() {
  const src = read("src/lib/desk/book-floor.ts");
  const num = (name) => {
    const m = src.match(new RegExp(`export const ${name} = (\\d+(?:\\.\\d+)?);`));
    assert.ok(m, `${name} not found in book-floor.ts`);
    return Number(m[1]);
  };
  const since = src.match(/export const FLOOR_LIVE_SINCE = "([^"]+)";/);
  assert.ok(since, "FLOOR_LIVE_SINCE not found");
  return { live: num("FLOOR_LIVE_CENTS"), shadow: num("FLOOR_SHADOW_CENTS"), since: since[1] };
}

/**
 * Pull the keeper query out of books.server.ts and bind it the way the `Sql`
 * tagged template does: every `${expr}` becomes the next positional parameter.
 */
function keeperQuery() {
  const src = read("src/lib/desk/books.server.ts");
  const start = src.indexOf("const [k] = await db<Record<string, number | null>>`");
  assert.ok(start > 0, "keeper query not found — did it move?");
  const open = src.indexOf("`", start);
  const close = src.indexOf("`", open + 1);
  assert.ok(close > open, "keeper query template not terminated");
  const tpl = src.slice(open + 1, close);
  assert.match(tpl, /as n_all/, "that template is not the keeper query");

  const c = floorConstants();
  const byName = {
    FLOOR_LIVE_SINCE: c.since,
    FLOOR_LIVE_CENTS: c.live,
    FLOOR_SHADOW_CENTS: c.shadow,
  };
  const params = [];
  const text = tpl.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name) => {
    assert.ok(name in byName, `the query interpolates ${name}, which this test does not know how to bind`);
    params.push(byName[name]);
    return `$${params.length}`;
  });
  assert.ok(params.length >= 4, `expected the floor CASE to be parameterised, got ${params.length}`);
  return { text, params, ...c };
}

/**
 * The ledger surface the scorecard actually reads.
 *
 * This file hand-rolls a minimal schema rather than applying migrations/, and that
 * is how it drifted: the scorecard moved onto the desk_ledger_research view (which
 * carries the known-invalid-window exclusion) and these fixtures still only had
 * the bare table. Keeping the view beside the table here means the query under
 * test runs against the same shape it runs against in production.
 *
 * scripts/migrations-apply.test.mjs is what proves the real schema; this is only
 * enough of it for the query to be exercised.
 */
async function ledgerSurface(pg) {
  await pg.exec(
    [
      "create table desk_ledger (",
      "  id serial primary key,",
      "  close_time timestamptz not null,",
      "  winner text,",
      "  chair_lean text,",
      "  score double precision,",
      "  bar double precision,",
      "  entry_cents double precision,",
      "  ev_cents double precision,",
      "  research_quality text not null default 'valid',",
      "  research_quality_rule text",
      ")",
    ].join("\n"),
  );
  await pg.exec(`create view desk_ledger_research as
    select * from desk_ledger where research_quality = 'valid'`);
}

/** A ledger spanning both floors: two eras, a sit, and a window under each floor. */
async function seeded(since) {
  const pg = new PGlite();
  await ledgerSurface(pg);
  const t = Date.parse(since);
  const min = (n) => new Date(t + n * 60_000).toISOString();
  // Pre-trial: a 70¢ fill (kept the old floor), a 72¢ fill (kept it), and a sit.
  // Post-trial: an 81¢ fill and an 84¢ fill (both keep the new floor), and a sit.
  await pg.query(
    `insert into desk_ledger (close_time, winner, chair_lean, score, bar, entry_cents, ev_cents) values
      ($1,'UP','WAIT',0.52,0.50,70,28),
      ($2,'DOWN','WAIT',0.44,0.50,72,-74),
      ($3,'UP','WAIT',0.10,0.50,null,null),
      ($4,'DOWN','WAIT',0.55,0.60,81,-83),
      ($5,'DOWN','WAIT',0.58,0.60,84,15),
      ($6,'UP','WAIT',0.05,0.60,null,null)`,
    [min(-120), min(-90), min(-60), min(15), min(30), min(45)],
  );
  return pg;
}

test("the scorecard query runs against a real Postgres and counts every graded window", async () => {
  const q = keeperQuery();
  const pg = await seeded(q.since);
  try {
    const { rows } = await pg.query(q.text, q.params);
    const k = rows[0];
    assert.ok(k, "the query returned no row");

    // Every graded window is counted — both eras, not only the trial.
    assert.equal(k.n_all, 6, "all six graded windows must be in the scorecard");
    assert.equal(k.booked_all, 4, "four fills across both floors");
    assert.equal(k.wait_all, 2, "two sits");
    // Sits plus fills account for every window: a booked window is not a sit.
    assert.equal(k.wait_all + k.booked_all, k.n_all);

    // Floor kept is judged against the floor in force at each close, so all
    // four fills honoured their own era's floor.
    assert.equal(k.floor_all, 4, "70¢ and 72¢ kept the old floor; 81¢ and 84¢ keep the new one");

    assert.equal(k.wins_all, 2);
    assert.equal(Math.round(Number(k.net_all)), -114);
    assert.ok(Number(k.entry_all) > 70 && Number(k.entry_all) < 85, `avg entry was ${k.entry_all}`);
    assert.ok(Number(k.conf_all) > 0, "confluence must be computed");
  } finally {
    await pg.close();
  }
});

test("the week scope is computed independently of all-time", async () => {
  const q = keeperQuery();
  const pg = await seeded(q.since);
  try {
    // This case requires six recent windows. The historical floor date ages
    // out of the seven-day scope, so pin this fixture relative to DB time.
    await pg.exec("update desk_ledger set close_time = now() - interval '1 day' + id * interval '15 minutes'");
    const { rows } = await pg.query(q.text, q.params);
    const k = rows[0];
    // Everything seeded sits inside the last seven days, so week mirrors all —
    // but it must be computed, not cloned or left at zero.
    assert.equal(k.n_week, k.n_all);
    assert.equal(k.booked_week, k.booked_all);
    assert.equal(k.wait_week, k.wait_all);
    assert.equal(k.floor_week, k.floor_all);
    assert.ok(Number(k.n_week) > 0, "week must not be empty while all-time has rows");
    assert.equal(k.wait_week + k.booked_week, k.n_week);
  } finally {
    await pg.close();
  }
});

test("an old fill under the new floor still counts as having kept its own floor", async () => {
  const q = keeperQuery();
  const pg = new PGlite();
  try {
    await ledgerSurface(pg);
    const t = Date.parse(q.since);
    // A 71¢ fill from before the trial: under 80, but it kept the 70 that applied.
    await pg.query(
      `insert into desk_ledger (close_time, winner, chair_lean, score, bar, entry_cents, ev_cents)
       values ($1,'UP','WAIT',0.5,0.5,71,27)`,
      [new Date(t - 60 * 60_000).toISOString()],
    );
    const { rows } = await pg.query(q.text, q.params);
    assert.equal(rows[0].booked_all, 1);
    assert.equal(rows[0].floor_all, 1, "a pre-trial fill must not be marked down by the new floor");

    // And a pre-trial fill that broke even the old floor does not count.
    await pg.query(
      `insert into desk_ledger (close_time, winner, chair_lean, score, bar, entry_cents, ev_cents)
       values ($1,'UP','WAIT',0.5,0.5,64,34)`,
      [new Date(t - 30 * 60_000).toISOString()],
    );
    const after = await pg.query(q.text, q.params);
    assert.equal(after.rows[0].booked_all, 2);
    assert.equal(after.rows[0].floor_all, 1, "64¢ kept neither floor");
  } finally {
    await pg.close();
  }
});

test("zeros appear only when the ledger is genuinely empty", async () => {
  const q = keeperQuery();
  const pg = new PGlite();
  try {
    await ledgerSurface(pg);
    const { rows } = await pg.query(q.text, q.params);
    assert.equal(rows[0].n_all, 0);
    assert.equal(rows[0].booked_all, 0);
    assert.equal(rows[0].wait_all, 0);
    assert.equal(rows[0].floor_all, 0);
  } finally {
    await pg.close();
  }
});
