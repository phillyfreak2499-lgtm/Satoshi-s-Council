/** Actual receipt SQL + database migration; no application DB or network.
 * These PGlite tests are storage/rollback tests, not cross-session race proof.
 * scripts/shadow-receipt-race.mjs supplies the native two-session proof in CI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = (p) => readFileSync(new URL(p, root), "utf8");
const baseline = source("migrations/0057_desk_shadow_lab.sql");
const migration = source("migrations/0060_desk_shadow_receipt_decisions.sql");
const close = Date.parse("2026-10-01T15:00:00Z");
const row = (kind, overrides = {}) => ({
  experiment: "GUARD_FIXTURE", arm: "ARM", ticker: "TEST", close_ms: close,
  kind, decided_ms: close - 181_000, side: null, ask_cents: null,
  fee_engine: "fixture", fee_cents: null, size_at_ask: null, spread_cents: null,
  feeds_ok: null, hittable_150ms: null, hittable_500ms: null,
  official_winner: null, net_cents: null, note: null, ...overrides,
});

function productionWriter(db) {
  // Compile the full, unmodified source module. No copied writer function,
  // source-extracted SQL or import of application db.ts. Only its exported
  // recordShadowReceipt is called; other services must not run in this test.
  const exports = {};
  const code = ts.transpileModule(source("src/lib/desk/shadow-lab.server.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: () => ({}), process: { env: {} }, globalThis: {},
    Date, Math, JSON, Number, Array, Object, Map, Set, Promise, Error,
  });
  const sql = async (strings, ...values) => {
    let query = strings[0];
    for (let i = 0; i < values.length; i++) query += `$${i + 1}${strings[i + 1]}`;
    return (await db.query(query, values)).rows;
  };
  return (r, payload = {}, guarded = false) => exports.recordShadowReceipt(sql, r, payload, guarded);
}

async function fresh(run, { seed = false } = {}) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(); // no path, URL, env loading or external connector
  try {
    await db.exec(baseline);
    const write = productionWriter(db);
    if (!seed) await db.exec(migration);
    await run(db, write);
  } finally { await db.close(); }
}
const conflict = (error) => error.code === "23514" && /shadow receipt cross-kind decision conflict/.test(error.message);

test("receipt guard: native test rejects DATABASE_URL before client import or SQL", () => {
  const script = fileURLToPath(new URL("scripts/shadow-receipt-race.mjs", root));
  const child = spawnSync(process.execPath, [script, "--disposable-local-postgres"], {
    env: { PATH: process.env.PATH, DATABASE_URL: "postgres://dummy:dummy@production.invalid/forbidden" },
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(child.error, undefined);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Refusing DATABASE_URL before loading a database client/);
  assert.doesNotMatch(child.stderr, /ENOTFOUND|ECONNREFUSED|Cannot find package 'pg'/);
});

test("receipt guard: empty and populated migration reapply never rewrites receipts", async () => {
  await fresh(async (db, write) => {
    await write(row("intention", { ticker: "active" }));
    await write(row("fill", { ticker: "active" }));
    await write(row("no_fill", { ticker: "sit" }));
    await write(row("wait", { ticker: "ancillary" }));
    // Preserve a genuine pre-migration contradiction; do not pick a winner or delete history.
    await write(row("fill", { ticker: "historical-conflict" }));
    await write(row("no_fill", { ticker: "historical-conflict" }));
    const snapshot = async () => JSON.stringify((await db.query("select * from desk_shadow_receipts order by ticker,kind")).rows);
    const before = await snapshot();
    await db.exec(migration); await db.exec(migration);
    assert.equal(await snapshot(), before);
    assert.deepEqual((await db.query("select ticker,decision_class from desk_shadow_receipt_decisions order by ticker")).rows, [
      { ticker: "active", decision_class: "active" },
      { ticker: "historical-conflict", decision_class: "conflicted" },
      { ticker: "sit", decision_class: "no_fill" },
    ]);
    await assert.rejects(write(row("veto", { ticker: "historical-conflict" })), conflict);
    await assert.rejects(write(row("no_fill", { ticker: "active" })), conflict);
    await assert.rejects(write(row("intention", { ticker: "sit" })), conflict);
    assert.equal(await snapshot(), before);
  }, { seed: true });
  await fresh(async (db) => {
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::int as n from desk_shadow_receipt_decisions")).rows[0].n, 0);
  });
});

test("receipt guard: real writer rejects both incompatible orderings; duplicates and intention+fill remain valid", async () => {
  await fresh(async (db, write) => {
    for (const active of ["intention", "fill", "veto"]) {
      for (const [first, second] of [[active, "no_fill"], ["no_fill", active]]) {
        const ticker = `${first}-${second}`;
        assert.equal(await write(row(first, { ticker })), true);
        let acknowledged = false;
        await assert.rejects(write(row(second, { ticker })).then(() => { acknowledged = true; }), conflict);
        assert.equal(acknowledged, false, "a rejection never reaches the observer's durable-success .then");
        assert.equal(await write(row(first, { ticker })), false, "same-kind duplicate is still idempotent");
        assert.deepEqual((await db.query("select kind from desk_shadow_receipts where ticker=$1", [ticker])).rows, [{ kind: first }]);
      }
    }
    const ticker = "valid-active";
    for (const kind of ["intention", "fill", "veto"]) assert.equal(await write(row(kind, { ticker })), true);
    assert.equal(await write(row("no_fill", { ticker }), {}, true), false, "committed cross-kind grace skips remain benign and uncached");
    assert.equal((await db.query("select count(*)::int as n from desk_shadow_receipts where ticker=$1", [ticker])).rows[0].n, 3);
    // Each economic-key component is independent, including the same ticker at a different close.
    for (const overrides of [{ experiment: "OTHER" }, { arm: "OTHER" }, { ticker: "OTHER" }, { close_ms: close + 900_000 }]) {
      assert.equal(await write(row("no_fill", { ticker, ...overrides })), true);
    }
  });
});

test("receipt guard: failed writes and rolled-back transactions release claims for retry", async () => {
  await fresh(async (db, write) => {
    await assert.rejects(write(row("fill", { ask_cents: 120 })), (e) => e.code === "23514");
    assert.equal((await db.query("select count(*)::int as n from desk_shadow_receipt_decisions")).rows[0].n, 0);
    assert.equal(await write(row("no_fill")), true);
    await db.exec("begin");
    await write(row("intention", { ticker: "rollback" }));
    await db.exec("rollback");
    assert.equal(await write(row("no_fill", { ticker: "rollback" })), true);
    assert.equal((await db.query("select decision_class from desk_shadow_receipt_decisions where ticker='rollback'")).rows[0].decision_class, "no_fill");
  });
});

test("receipt guard: economic identity cannot change; settlement metadata can", async () => {
  await fresh(async (db, write) => {
    await write(row("fill"));
    await assert.rejects(db.query("update desk_shadow_receipts set kind='no_fill'"), (e) => e.code === "23514" && /identity is immutable/.test(e.message));
    await assert.rejects(db.query("update desk_shadow_receipts set ticker='rewritten'"), (e) => e.code === "23514");
    await db.query("update desk_shadow_receipts set official_winner='UP',net_cents=14");
    assert.deepEqual((await db.query("select kind,official_winner,net_cents from desk_shadow_receipts")).rows, [{ kind: "fill", official_winner: "UP", net_cents: 14 }]);
  });
});
