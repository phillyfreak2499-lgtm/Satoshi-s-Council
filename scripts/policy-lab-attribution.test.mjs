import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// The actual writer and simulator use a disposable PostgreSQL engine. Only the
// transport is replaced; no external database or production state is accessed.
const root = new URL("../", import.meta.url);
function load(path, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, Math, Number, Set, Map,
    require: id => { assert.ok(id in dependencies, `unexpected import ${id}`); return dependencies[id]; } });
  return module.exports;
}
const math = load("src/lib/desk/math.ts");
const clock = load("src/lib/desk/clock.ts", { "./math.ts": math });
const policy = load("src/lib/desk/floor-policy.ts");
const arena = load("src/lib/desk/exit-arena.ts", { "./clock.ts": clock, "./floor-policy.ts": policy });
const booked = load("src/lib/desk/booked-decision.ts");
const boundary = Date.parse(policy.OWNER_ROLLBACK_V1_FROZEN_AT);
const plain = value => JSON.parse(JSON.stringify(value));

async function harness() {
  const db = new PGlite();
  for (const name of readdirSync(new URL("migrations/", root)).filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(`migrations/${name}`, root), "utf8"));
  }
  // Migrations stamp deployment time, so seed this test's fixed historical
  // activation sequence from the actual frozen definitions, independently of
  // the host clock. The writer must execute the real historical lookup SQL.
  for (const p of [policy.FLOOR_V1, policy.FLOOR_SELECTIVE_V1, policy.FLOOR_SELECTIVE_V2,
    policy.FLOOR_SELECTIVE_V3, policy.FLOOR_OWNER_ROLLBACK_V1]) {
    await db.query("update desk_floor_policy set prospective_start_at=$1 where policy_id=$2", [p.prospective_start_at, p.policy_id]);
  }
  const sql = async (strings, ...params) => {
    const query = strings.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query(query, params)).rows;
  };
  const writer = load("src/lib/desk/policy-lab.server.ts", {
    "@/lib/db": { getSql: async () => sql }, "./clock": clock,
    "./floor-policy": policy, "./exit-arena": arena,
  });
  return { db, writer };
}

function fixture(t, ticker) {
  return { ticker, closeMs: Math.ceil((t + 1) / 900_000) * 900_000, winner: "UP",
    entry: { side: "UP", cents: 83, t },
    path: [{ t: t + 4000, yes_bid: 84, yes_ask: 85 }, { t: t + 8000, yes_bid: 91, yes_ask: 92 }] };
}

async function assertWrittenPolicy(h, w, champion, expected) {
  assert.ok(await h.writer.recordExitArena(w, champion) > 0);
  const fills = await h.db.query("select entry_policy from desk_policy_fills where ticker=$1", [w.ticker]);
  assert.deepEqual(fills.rows, [{ entry_policy: expected }]);
  const observations = await h.db.query("select distinct entry_policy from desk_policy_observations where ticker=$1", [w.ticker]);
  assert.deepEqual(observations.rows, [{ entry_policy: expected }]);
  assert.equal(await h.writer.recordExitArena(w, champion), 0, "a replay does not rewrite recorded attribution");
}

test("actual active-Champion query resolves registered owner and V3 identities", async () => {
  const h = await harness();
  try {
    const current = await h.writer.activeChampion();
    assert.equal(current.policy_id, "FLOOR_OWNER_ROLLBACK_V1");
    assert.equal(current.entry_policy, "ENTRY_OWNER_ROLLBACK_V1");
    assert.equal(Date.parse(current.prospective_start_at), boundary);
    await h.db.exec("update desk_floor_policy set status='RETIRED' where status='CHAMPION'; update desk_floor_policy set status='CHAMPION' where policy_id='FLOOR_SELECTIVE_V3'");
    assert.equal((await h.writer.activeChampion()).entry_policy, "ENTRY_SELECTIVE_V3");
  } finally { await h.db.close(); }
});

test("unknown or inconsistent Champion records and read failure fall back to the current frozen policy", async () => {
  const h = await harness();
  try {
    await h.db.exec("update desk_floor_policy set entry_policy='UNKNOWN' where status='CHAMPION'");
    assert.deepEqual(plain(await h.writer.activeChampion()), plain(policy.FLOOR_OWNER_ROLLBACK_V1));
    await h.db.exec("drop table desk_floor_policy");
    assert.deepEqual(plain(await h.writer.activeChampion()), plain(policy.FLOOR_OWNER_ROLLBACK_V1));
  } finally { await h.db.close(); }
});

test("actual source-fill and exit writes retain paid 80/V1/V2/V3/owner identities", async () => {
  const h = await harness();
  try {
    const champion = await h.writer.activeChampion();
    await assertWrittenPolicy(h, fixture(Date.parse("2026-09-14T20:05:00Z"), "PAID-80"), champion, "ENTRY_80_V1");
    await assertWrittenPolicy(h, fixture(Date.parse("2026-09-15T14:30:00Z"), "PAID-V1"), champion, "ENTRY_SELECTIVE_V1");
    await assertWrittenPolicy(h, fixture(Date.parse("2026-09-16T20:05:00Z"), "PAID-V2"), champion, "ENTRY_SELECTIVE_V2");
    await assertWrittenPolicy(h, fixture(boundary - 180_000, "PAID-V3"), champion, "ENTRY_SELECTIVE_V3");
    await assertWrittenPolicy(h, fixture(boundary + 300_000, "PAID-OWNER"), champion, "ENTRY_OWNER_ROLLBACK_V1");
  } finally { await h.db.close(); }
});

test("captured paid owner identity survives state serialization and a later V3 rollback", async () => {
  const h = await harness();
  try {
    const entry = { entry_policy: "ENTRY_OWNER_ROLLBACK_V1", floor_policy: "FLOOR_OWNER_ROLLBACK_V1", prospective_start: boundary };
    const restored = booked.sanitizeBookedDecisionState(JSON.parse(JSON.stringify({ k: entry }))).k;
    await h.db.exec("update desk_floor_policy set status='RETIRED' where status='CHAMPION'; update desk_floor_policy set status='CHAMPION' where policy_id='FLOOR_SELECTIVE_V3'");
    assert.equal((await h.writer.activeChampion()).entry_policy, "ENTRY_SELECTIVE_V3");
    const paidChampion = await h.writer.activeChampion(restored);
    assert.equal(paidChampion.entry_policy, "ENTRY_OWNER_ROLLBACK_V1");
    assert.equal(Date.parse(paidChampion.prospective_start_at), boundary);
    await assertWrittenPolicy(h, fixture(boundary + 300_000, "HELD-OWNER"), paidChampion, "ENTRY_OWNER_ROLLBACK_V1");
  } finally { await h.db.close(); }
});

test("missing or inconsistent historical provenance cannot seed an exit cohort", async () => {
  const h = await harness();
  try {
    const champion = await h.writer.activeChampion();
    await h.db.exec("update desk_floor_policy set entry_policy='UNKNOWN' where policy_id='FLOOR_SELECTIVE_V3'");
    assert.equal(await h.writer.recordExitArena(fixture(boundary - 180_000, "BAD-V3"), champion), 0);
    assert.equal(await h.writer.recordExitArena(fixture(Date.parse("2026-09-10T20:05:00Z"), "NO-HISTORY"), champion), 0);
    await assert.rejects(h.writer.activeChampion({ entry_policy: "UNKNOWN", floor_policy: "FLOOR_OWNER_ROLLBACK_V1", prospective_start: boundary }), /unrecognized booked policy provenance/);
    await assert.rejects(h.writer.activeChampion({ entry_policy: "ENTRY_OWNER_ROLLBACK_V1", floor_policy: "FLOOR_OWNER_ROLLBACK_V1", prospective_start: boundary + 1 }), /unrecognized booked policy provenance/);
    await assert.rejects(h.writer.activeChampion({ entry_policy: "ENTRY_OWNER_ROLLBACK_V1", floor_policy: "FLOOR_OWNER_ROLLBACK_V1", prospective_start: boundary - 900_000 }), /unrecognized booked policy provenance/);
    assert.equal((await h.db.query("select count(*)::int as n from desk_policy_fills")).rows[0].n, 0);
  } finally { await h.db.close(); }
});

test("actual economics ledger query reads the paid policy from the persisted entry roster", async () => {
  const h = await harness();
  try {
    const source = readFileSync(new URL("src/lib/desk/economics-book.server.ts", root), "utf8");
    const ast = ts.createSourceFile("economics-book.server.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(value => value.name.getText(ast) === "LEDGER_QUERY"));
    assert.ok(declaration, "the actual source ledger query must be available");
    const query = vm.runInNewContext(declaration.getText(ast).replace(/^export\s+/, "") + "\nLEDGER_QUERY");
    await h.db.query(`insert into desk_ledger
      (ticker,close_time,source,winner,chair_lean,entry_cents,settle_cents,ev_cents,entry_lean,entry_skill_roster)
      values ('PAID-PROVENANCE',$1,'kalshi-result','UP','WAIT',83,100,16,'UP',$2::jsonb),
             ('LEGACY-PROVENANCE',$1,'kalshi-result','UP','WAIT',83,100,16,'UP',null)`,
    [new Date(boundary + 900_000).toISOString(), JSON.stringify({ book: { entry_policy: "ENTRY_OWNER_ROLLBACK_V1" } })]);
    const rows = (await h.db.query(query, [new Date(boundary).toISOString(), new Date(boundary + 1_800_000).toISOString()])).rows;
    assert.equal(rows.find(row => row.ticker === "PAID-PROVENANCE").entry_policy, "ENTRY_OWNER_ROLLBACK_V1");
    assert.equal(rows.find(row => row.ticker === "LEGACY-PROVENANCE").entry_policy, null, "the query cannot fabricate a legacy paid policy");
  } finally { await h.db.close(); }
});
