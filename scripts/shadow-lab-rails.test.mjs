/**
 * Shadow-lab rails: the observer is wired from healthz only, cannot start
 * without the env flag, writes only its own two tables, reaches no production actuator, and
 * its receipts are idempotent and settle from the official ledger with the fee
 * the receipt recorded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function loader(deps = {}, globals = {}) {
  const cache = new Map();
  function load(file, append = "") {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file) + append, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (key) => {
      if (key in deps) return deps[key];
      assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
      const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
      return load(path.href.slice(root.href.length));
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, structuredClone, setInterval, clearInterval, globalThis: {}, console, process: { env: { ...globals.env } } });
    return exports;
  }
  return load;
}

async function database() {
  const pg = new PGlite();
  for (const f of ["0005_desk_ledger.sql", "0024_desk_ledger_quality.sql", "0057_desk_shadow_lab.sql", "0058_desk_shadow_manifest_candidate_not_collecting.sql"]) await pg.exec(read(`migrations/${f}`));
  const sql = async (strings, ...values) => (await pg.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values)).rows;
  sql.query = async (text, params) => (await pg.query(text, params)).rows;
  return { pg, sql };
}

const server = codeOf("src/lib/desk/shadow-lab.server.ts");

test("the observer is wired only from healthz, fire-and-forget, and nothing in the decision path imports it", () => {
  const healthz = read("server/routes/healthz.get.ts");
  assert.match(healthz, /void import\("\.\.\/\.\.\/src\/lib\/desk\/shadow-lab\.server"\)\s*\.then\(\(m\) => m\.ensureShadowLabObserver\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  const importers = ["src/lib/desk/server-engine.ts", "src/lib/desk/engine.ts", "src/lib/desk/chair.ts", "src/lib/desk/selective-entry.ts", "src/lib/desk/book-floor.ts", "server/plugins/desk-runtime.ts", "src/lib/desk/runtime-bootstrap.server.ts"].filter((f) => { try { return read(f).includes("shadow-lab"); } catch { return false; } });
  assert.deepEqual(importers, []);
});

test("the observer writes only its own tables and reaches no production actuator", () => {
  const writes = [...server.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+(?:r\s+)?set|delete from\s+(\w+)/gi)].map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual([...new Set(writes)].sort(), ["desk_shadow_manifests", "desk_shadow_receipts"]);
  for (const forbidden of ["noteCall(", "applyDeskOp(", "promoteToLive(", "reviewSeats(", "setKnob(", "runHuddle(", "desk_ledger (", "desk_state", "e.learner ="]) {
    assert.ok(!server.includes(forbidden), `observer reaches ${forbidden}`);
  }
  assert.match(server, /on conflict \(experiment, arm, ticker, close_time, kind\) do nothing/);
  assert.match(server, /on conflict \(experiment, experiment_version\) do nothing/);
  assert.match(server, /activateInitialShadowCollection/);
  assert.match(server, /verifyShadowManifests/);
});

test("without SHADOW_LAB_ENABLED=true the observer refuses to start", () => {
  const load = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } }, { env: {} });
  const mod = load("src/lib/desk/shadow-lab.server.ts");
  assert.equal(mod.shadowLabEnabled({}), false);
  assert.equal(mod.shadowLabEnabled({ SHADOW_LAB_ENABLED: "1" }), false);
  assert.equal(mod.shadowLabEnabled({ SHADOW_LAB_ENABLED: "true" }), true);
  assert.equal(mod.ensureShadowLabObserver({}), "disabled");
  assert.equal(mod.shadowLabHealth().running, false);
});

test("receipts are idempotent on their key, manifests register once without a start date, and settlement uses the receipt's own fee", async () => {
  const { pg, sql } = await database();
  try {
    const load = loader({ "@/lib/db": { getSql: async () => sql } }, { env: {} });
    const mod = load("src/lib/desk/shadow-lab.server.ts");
    const close = Date.parse("2026-10-01T15:00:00Z");
    const r = { experiment: "UNMUTE_DEDUP_SHELF_V1", arm: "PKG_85", ticker: "KXBTC15M-26OCT011100-00", close_ms: close, kind: "fill", decided_ms: close - 400_000, side: "UP", ask_cents: 85, fee_engine: "KALSHI_TAKER_7PCT_CEIL_CENT_V1", fee_cents: 1, size_at_ask: 12, spread_cents: 1, feeds_ok: true, hittable_150ms: null, hittable_500ms: null, official_winner: null, net_cents: null, note: "confirmed" };
    assert.equal(await mod.recordShadowReceipt(sql, r, { secs_left: 400 }), true);
    assert.equal(await mod.recordShadowReceipt(sql, { ...r, decided_ms: close - 380_000, ask_cents: 88 }, {}), false, "a re-poll with a different ask is not a second fill");
    assert.equal((await pg.query("select count(*)::int as n, min(ask_cents) as ask from desk_shadow_receipts")).rows[0].n, 1);
    assert.equal((await pg.query("select ask_cents from desk_shadow_receipts")).rows[0].ask_cents, 85, "the first receipt is the record");

    assert.equal(await mod.registerShadowManifests(sql), 4);
    assert.equal(await mod.registerShadowManifests(sql), 0);
    await assert.doesNotReject(mod.verifyShadowManifests(sql));
    const m = (await pg.query("select experiment, status, prospective_start_at from desk_shadow_manifests order by 1")).rows;
    assert.deepEqual(m.map((x) => x.status), ["CANDIDATE_NOT_COLLECTING", "CANDIDATE", "CANDIDATE", "CANDIDATE"]);
    assert.ok(m.every((x) => x.prospective_start_at == null));

    const firstStart = Date.parse("2026-10-01T14:52:00Z");
    const activated = await mod.activateInitialShadowCollection(sql, firstStart);
    assert.equal(activated.active, 3);
    assert.equal(activated.started_at.length, 1, "all active manifests share one boundary");
    const after = (await pg.query("select experiment, status, prospective_start_at from desk_shadow_manifests order by 1")).rows;
    assert.deepEqual(after.map((x) => x.status), ["CANDIDATE_NOT_COLLECTING", "SHADOW", "SHADOW", "SHADOW"]);
    assert.equal(after[0].prospective_start_at, null, "MIRROR-35 remains unstarted");
    const starts = new Set(after.slice(1).map((x) => new Date(x.prospective_start_at).toISOString()));
    assert.deepEqual([...starts], [new Date(firstStart).toISOString()]);

    const restarted = await mod.activateInitialShadowCollection(sql, firstStart + 86_400_000);
    assert.deepEqual(restarted.started_at, activated.started_at, "restart preserves the original prospective boundary");

    assert.equal(await mod.settleShadowReceipts(sql), 0, "no ledger row yet: nothing settles");
    await pg.query("insert into desk_ledger (ticker, close_time, graded_at, source, winner, chair_lean) values ($1, $2, $3, 'kalshi-result', 'DOWN', 'WAIT')", [r.ticker, new Date(close).toISOString(), new Date(close + 1000).toISOString()]);
    assert.equal(await mod.settleShadowReceipts(sql), 1);
    const settled = (await pg.query("select official_winner, net_cents from desk_shadow_receipts")).rows[0];
    assert.deepEqual(settled, { official_winner: "DOWN", net_cents: -86 });
    assert.equal(await mod.settleShadowReceipts(sql), 0, "already settled rows are not touched again");
    await pg.exec("update desk_ledger set research_quality = 'excluded'");
    await pg.query("insert into desk_shadow_receipts (experiment, arm, ticker, close_time, kind, decided_at, side, ask_cents, fee_engine, fee_cents) values ('E','A',$1,$2,'fill',$3,'DOWN',85,'KALSHI_TAKER_7PCT_CEIL_CENT_V1',1)", [r.ticker, new Date(close).toISOString(), new Date(close - 300_000).toISOString()]);
    assert.equal(await mod.settleShadowReceipts(sql), 0, "a quarantined ledger row settles nothing");
  } finally { await pg.close(); }
});

test("the migration is additive and idempotent, and the receipt key is the primary key", async () => {
  const pg = new PGlite();
  try {
    const sqlText = read("migrations/0057_desk_shadow_lab.sql") + read("migrations/0058_desk_shadow_manifest_candidate_not_collecting.sql");
    await pg.exec(sqlText); await pg.exec(sqlText);
    await pg.query("insert into desk_shadow_manifests (experiment, experiment_version, fingerprint, manifest, frozen_at, status) values ('M', 1, 'f', '{}'::jsonb, now(), 'CANDIDATE_NOT_COLLECTING')");
    await assert.rejects(pg.query("insert into desk_shadow_manifests (experiment, experiment_version, fingerprint, manifest, frozen_at, status) values ('N', 1, 'f', '{}'::jsonb, now(), 'LIVE')"), /check/i);
    const cols = (await pg.query("select column_name from information_schema.columns where table_name = 'desk_shadow_receipts' order by ordinal_position")).rows.map((r) => r.column_name);
    for (const c of ["experiment", "arm", "ticker", "close_time", "kind", "fee_engine", "hittable_150ms", "official_winner", "net_cents", "payload"]) assert.ok(cols.includes(c), c);
    const pk = (await pg.query("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'desk_shadow_receipts'::regclass and i.indisprimary order by a.attnum")).rows.map((r) => r.attname);
    assert.deepEqual(pk, ["experiment", "arm", "ticker", "close_time", "kind"]);
    await assert.rejects(pg.query("insert into desk_shadow_receipts (experiment, arm, ticker, close_time, kind, decided_at, fee_engine, ask_cents) values ('E','A','T',now(),'fill',now(),'F',100)"), /check/i);
  } finally { await pg.close(); }
});


test("activation refuses partial state and manifest fingerprint drift without mutating the remaining candidates", async () => {
  const { pg, sql } = await database();
  try {
    const load = loader({ "@/lib/db": { getSql: async () => sql } }, { env: {} });
    const mod = load("src/lib/desk/shadow-lab.server.ts");
    assert.equal(await mod.registerShadowManifests(sql), 4);
    await assert.doesNotReject(mod.verifyShadowManifests(sql));

    const partialStart = "2026-10-01T14:52:00.000Z";
    await pg.query(
      "update desk_shadow_manifests set status='SHADOW', prospective_start_at=$1 where experiment='UNMUTE_DEDUP_SHELF_V1'",
      [partialStart],
    );
    await assert.rejects(
      mod.activateInitialShadowCollection(sql, Date.parse("2026-10-01T15:00:00Z")),
      /uniform 3-manifest state/,
    );
    const partial = (await pg.query(
      "select experiment, status, prospective_start_at from desk_shadow_manifests where experiment <> 'MIRROR_35_V1' order by experiment",
    )).rows;
    assert.equal(partial.filter((x) => x.status === "SHADOW").length, 1, "partial state is rejected, not silently completed");
    assert.equal(partial.filter((x) => x.status === "CANDIDATE").length, 2);

    await pg.query(
      "update desk_shadow_manifests set fingerprint='stale-fingerprint' where experiment='WARDEN_JUMP_VETO_V1'",
    );
    await assert.rejects(mod.verifyShadowManifests(sql), /fingerprint mismatch/);
  } finally { await pg.close(); }
});
