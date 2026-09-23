/** Native PostgreSQL, two independent writers plus a lock observer.
 * Run only against the disposable localhost service in shadow-receipt-race.yml.
 * No application modules, env files, DATABASE_URL or production credentials.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

if (process.env.DATABASE_URL?.trim()) throw new Error("Refusing DATABASE_URL before loading a database client");
if (!process.argv.includes("--disposable-local-postgres")) throw new Error("Explicit --disposable-local-postgres acknowledgement required");
const { default: pg } = await import("pg");
const config = {
  host: "127.0.0.1", port: 5432, database: "shadow_receipt_ci", user: "shadow_receipt_ci",
  password: "disposable-local-fixture", ssl: false, connectionTimeoutMillis: 5000,
  statement_timeout: 10_000, query_timeout: 12_000, application_name: "shadow-receipt-ci",
};
const schema = `shadow_receipt_test_${randomBytes(8).toString("hex")}`;
assert.match(schema, /^shadow_receipt_test_[a-f0-9]{16}$/);
const root = new URL("../", import.meta.url);
const baseline = readFileSync(new URL("migrations/0057_desk_shadow_lab.sql", root), "utf8");
const migration = readFileSync(new URL("migrations/0060_desk_shadow_receipt_decisions.sql", root), "utf8");
const admin = new pg.Client(config), a = new pg.Client(config), b = new pg.Client(config);
const clients = [admin, a, b];
let created = false, passes = 0;
const ok = (label) => { passes++; console.log(`PASS ${passes}: ${label}`); };
const economic = (key) => ["RACE_FIXTURE", "ARM", key, "2026-10-01T15:00:00Z"];

// The old and current application INSERT's predicate shape, with the same
// economic/primary keys. The trigger must protect even legacy unguarded calls.
const write = (client, key, kind, guarded = kind === "no_fill", ask = null) => client.query(`
  insert into desk_shadow_receipts (experiment,arm,ticker,close_time,kind,decided_at,fee_engine,ask_cents)
  select $1,$2,$3,$4::timestamptz,$5,'2026-10-01T14:57:00Z'::timestamptz,'fixture',$7
  where not $6::boolean or not exists (
    select 1 from desk_shadow_receipts e where e.experiment=$1 and e.arm=$2 and e.ticker=$3
      and e.close_time=$4::timestamptz and e.kind in ('intention','fill','veto','no_fill')
  )
  on conflict (experiment,arm,ticker,close_time,kind) do nothing returning kind`, [...economic(key), kind, guarded, ask]);
const kinds = async (key) => (await admin.query("select kind from desk_shadow_receipts where ticker=$1 order by kind", [key])).rows.map((r) => r.kind);
const snapshot = async () => JSON.stringify((await admin.query("select * from desk_shadow_receipts order by experiment,arm,ticker,close_time,kind")).rows);
let pidA, pidB;

async function assertBlocked(isDone) {
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    assert.equal(isDone(), false, "second writer finished before the first transaction released its decision");
    const blockers = (await admin.query("select pg_blocking_pids($1::int) as pids", [pidB])).rows[0].pids;
    if (blockers.includes(pidA)) return; // actual server lock dependency, not a guessed sleep
    await delay(20);
  }
  assert.fail("second writer did not block on the first writer's uncommitted decision");
}

async function legacyRace(first, second) {
  const key = `before-${first}-${second}`;
  try {
    await a.query("BEGIN"); await b.query("BEGIN");
    await write(a, key, first);
    await write(b, key, second);
    await b.query("COMMIT"); await a.query("COMMIT");
    assert.deepEqual(await kinds(key), [first, second].sort());
    ok(`reproduced original uncommitted ${first}/${second} contradiction`);
  } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); }
}

async function overlap(first, second, { rollback = false, duplicate = false, compatible = false, legacy = false } = {}) {
  const key = `after-${passes}-${first}-${second}`;
  let pending, done = false;
  try {
    await a.query("BEGIN"); await b.query("BEGIN");
    await write(a, key, first, false);
    pending = write(b, key, second, legacy ? false : second === "no_fill").then(
      (value) => { done = true; return { value }; },
      (error) => { done = true; return { error }; },
    );
    await assertBlocked(() => done);
    await a.query(rollback ? "ROLLBACK" : "COMMIT");
    const result = await pending;
    if (rollback || compatible || duplicate) {
      assert.equal(result.error, undefined);
      assert.equal(result.value.rowCount, duplicate ? 0 : 1);
      await b.query("COMMIT");
      assert.deepEqual(await kinds(key), rollback ? [second] : duplicate ? [first] : [first, second].sort());
    } else {
      assert.equal(result.error?.code, "23514");
      assert.match(result.error.message, /shadow receipt cross-kind decision conflict/);
      await b.query("ROLLBACK");
      assert.deepEqual(await kinds(key), [first]);
    }
    ok(`${legacy ? "legacy " : ""}${first} first, ${second} overlaps, first ${rollback ? "rolls back" : "commits"}`);
  } finally {
    await a.query("ROLLBACK"); // release a lock before waiting for b during cleanup
    if (pending) await pending;
    await b.query("ROLLBACK");
  }
}

try {
  for (const client of clients) await client.connect();
  const identity = (await admin.query("select current_database() as db, current_user as usr")).rows[0];
  assert.deepEqual(identity, { db: config.database, usr: config.user });
  await admin.query(`create schema "${schema}"`); created = true;
  for (const client of clients) await client.query(`set search_path to "${schema}", public`);
  pidA = (await a.query("select pg_backend_pid() as pid")).rows[0].pid;
  pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
  assert.notEqual(pidA, pidB);
  await admin.query(baseline);

  await legacyRace("fill", "no_fill");
  await legacyRace("no_fill", "intention");
  await write(admin, "existing-active", "intention", false);
  await write(admin, "existing-active", "fill", false);
  await write(admin, "existing-sit", "no_fill", false);
  const history = await snapshot();
  await admin.query(migration);
  await admin.query(migration);
  assert.equal(await snapshot(), history, "migration and reapply never change a historical receipt");
  assert.equal((await admin.query("select count(*)::int as n from desk_shadow_receipt_decisions where decision_class='conflicted'")).rows[0].n, 2);
  await assert.rejects(write(admin, "before-fill-no_fill", "veto", false), (e) => e.code === "23514");
  ok("populated migration is idempotent and preserves/fences preexisting contradictions");

  for (const active of ["intention", "fill", "veto"]) {
    await overlap(active, "no_fill");
    await overlap("no_fill", active);
    await overlap(active, "no_fill", { rollback: true });
    await overlap("no_fill", active, { rollback: true });
  }
  await overlap("intention", "fill", { compatible: true });
  await overlap("fill", "fill", { duplicate: true });
  await overlap("no_fill", "no_fill", { duplicate: true, legacy: true });
  await overlap("intention", "no_fill", { legacy: true });
  await overlap("no_fill", "fill", { legacy: true });

  const failed = "failed-after-claim";
  await assert.rejects(write(admin, failed, "fill", false, 120), (e) => e.code === "23514");
  assert.equal((await admin.query("select count(*)::int as n from desk_shadow_receipt_decisions where ticker=$1", [failed])).rows[0].n, 0);
  assert.equal((await write(admin, failed, "no_fill", false)).rowCount, 1);
  ok("failed receipt rolls back its claim; opposite kind can retry successfully");

  const freshContradictions = (await admin.query(`select ticker from desk_shadow_receipts where ticker like 'after-%'
    group by experiment,arm,ticker,close_time having bool_or(kind='no_fill') and bool_or(kind in ('intention','fill','veto'))`)).rows;
  assert.deepEqual(freshContradictions, []);
  console.log(`Native PostgreSQL validation passed: ${passes} scenarios; two independent writer sessions; explicit uncommitted-write barriers.`);
} finally {
  // Only this randomly generated schema is removed; never public or an existing schema.
  for (const client of [a, b]) { try { await client.query("ROLLBACK"); } catch { /* A failed connection may already be closed; preserve the original failure. */ } }
  if (created) await admin.query(`drop schema "${schema}" cascade`);
  await Promise.all(clients.map((client) => client.end().catch(() => {})));
}
