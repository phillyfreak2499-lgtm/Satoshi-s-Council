import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");
function loader(deps = {}, globals = {}) {
  const cache = new Map();
  function load(file, append = "") {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file) + append, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: key => {
      if (key in deps) return deps[key];
      assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
      const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
      return load(path.href.slice(root.href.length));
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, structuredClone, process: { env: {} }, ...globals });
    return exports;
  }
  return load;
}
const load = loader();
const q = load("src/lib/desk/call-quality.ts");
const v3 = load("src/lib/desk/chair-v3.ts");
const audit = load("src/lib/desk/admission-audit.ts");
const entry = load("src/lib/desk/selective-entry.ts");
const close = Date.parse("2026-09-17T15:15:00Z");
const at = close - 455_000;
const ticker = "KXBTC15M-26SEP171115-15";
const snap = (patch = {}) => ({ as_of: at, close_time: close, secs_left: 455, mins_left: 455 / 60, ticker, demo: false,
  yes_bid: 81, yes_ask: 82, no_bid: 18, no_ask: 19, yes_mid: 81.5, yes_bid_size: 4, no_bid_size: 4,
  obs: { receipt_ts: at - 1000, gap: "ok" }, quote_age_s: 1, spot_age_s: 1,
  health: { spot: "LIVE", kalshi: "LIVE", spot_ok: true, kalshi_ok: true, spot_divergent: false, basis_wide: false },
  lab_fair_yes: 91, lab_age_s: 1, fair_yes: 90, edge_up: 6, edge_down: -8, regime_key: "quiet", session: "US_AM", ...patch });
const chair = (patch = {}) => ({ lean: "UP", score: .8, bar: .5, hard_fail: false, confidence: 80,
  gates: [], quorum: { up: 2, down: 0, wait: 19 },
  rows: ["STREAK", "STRIKE"].map(seat => ({ seat, lean: "UP", health: "LIVE", status: "LIVE", folded: false, weight: 0.1 })), ...patch });
const context = () => ({ calls: [], ready: true, start: close - 900_000, watch: { key: `${ticker}|${close}`, side: "UP", since: at - 8000, last: at, frames: 3, mode: "normal" } });
const model = (p = .90) => ({ p_market: .815, p_up: p, model_n: 240, adjustment_pp: (p - .815) * 100 });
const receipt = () => q.captureQuality(snap(), chair(), [{ seat: "TAPE", raw_lean: "UP", lean: "WAIT", raw_conf: 70, confidence: 50, health: "LIVE" }],
  audit.auditAdmission(snap(), chair(), context()), v3.zeroV3Features(), model(), close - 900_000);
const observation = (patch = {}) => ({ ticker, close_ms: close, taken_ms: at, recorded_ms: at + 1000, horizon: 450,
  entry_policy: "ENTRY_SELECTIVE_V3", capture_valid: true, receipt: receipt(), winner: "UP", source: "kalshi-result", research_quality: "valid", ...patch });

test("checkpoints refuse late catch-up, stale frames, future clocks and demo data", () => {
  assert.equal(q.qualityHorizon(snap(), at + 1000), 450);
  for (const h of [450, 300, 180]) {
    const t = close - h * 1000;
    assert.equal(q.qualityHorizon(snap({ as_of: t }), t), h);
    assert.equal(q.qualityHorizon(snap({ as_of: t + 1 }), t + 1), null);
    assert.equal(q.qualityHorizon(snap({ as_of: t - 12_000 }), t - 12_000), null);
  }
  assert.equal(q.qualityHorizon(snap(), at + 10_001), null);
  assert.equal(q.qualityHorizon(snap(), at - 1), null);
  assert.equal(q.qualityHorizon(snap({ demo: true }), at), null);
});

test("audit retains simultaneous blockers and agrees with authoritative entry permission", () => {
  const s = snap({ quote_age_s: 999, edge_up: -1, lab_age_s: 20, no_bid_size: 0, spot_age_s: 999 });
  const c = chair({ quorum: { up: 1, down: 2 }, rows: [] });
  const a = audit.auditAdmission(s, c, context());
  for (const id of ["team", "supporters", "families", "opposition", "feeds", "quote", "model_edge", "index_fresh"]) {
    assert.equal(a.checks.find(g => g.id === id).pass, false, id);
  }
  assert.equal(a.eligible, false);
  assert.equal(audit.auditAdmission(snap(), chair(), context()).eligible, entry.selectiveBookOk(snap(), chair(), context()));
  const wait = audit.auditAdmission(snap(), chair({ lean: "WAIT" }), context());
  assert.equal(wait.checks.find(g => g.id === "quote").pass, null, "WAIT never invents a direction");
});

test("bad identity, late persistence, quarantine and missing outcomes cannot earn a grade", () => {
  assert.equal(q.qualityEligibility(observation()), "graded");
  for (const patch of [{ ticker: "KXBTC15M-26SEP171100-00" }, { ticker: "unknown" }, { recorded_ms: close },
    { research_quality: "excluded" }, { capture_valid: false }, { taken_ms: close - 449_000 }]) {
    assert.equal(q.qualityEligibility(observation(patch)), "excluded");
  }
  assert.equal(q.qualityEligibility(observation({ winner: null, source: null, research_quality: null })), "pending");
  assert.equal(q.qualityEligibility(observation({ source: "proxy" })), "pending");
});

test("advisory Chair failures stay in the receipt but never inflate blocker counts", () => {
  const c = chair({ lean: "WAIT", gates: [
    { id: "early", label: "Early sizing only", pass: false, hard: false },
    { id: "bar", label: "Confluence bar", pass: false, hard: true },
  ] });
  const a = audit.auditAdmission(snap(), c, context());
  assert.equal(a.checks.find(x => x.id === "chair:early").pass, false);
  assert.equal(a.checks.find(x => x.id === "chair:early").blocking, false);
  const r = receipt(); r.audit = a;
  const group = q.qualityReport([observation({ receipt: r })], close + 1000)[0];
  assert.ok(!group.blockers.some(x => x.id === "chair:early"));
  assert.equal(group.blockers.find(x => x.id === "chair:bar").n, 1);
  for (const check of r.audit.checks) delete check.blocking;
  const legacy = q.qualityReport([observation({ receipt: r })], close + 1000)[0];
  assert.ok(!legacy.blockers.some(x => x.id.startsWith("chair:")), "untagged historical Chair checks cannot imply blocking authority");
  assert.equal(legacy.blockers.find(x => x.id === "direction").n, 1);
});

test("candidate prices asks and fees, requires size and fit, and exposes fragile margins", () => {
  assert.equal(q.qualityCandidate(snap(), model()).ask, 82);
  assert.equal(q.qualityCandidate(snap(), model()).fee, 2);
  assert.equal(q.qualityCandidate(snap(), model()).edge, 6);
  for (const s of [snap({ no_bid_size: 0 }), snap({ yes_ask: 84 }), snap({ quote_age_s: 20 }), snap({ ticker: "bad" })]) {
    assert.equal(q.qualityCandidate(s, model()), null);
  }
  assert.equal(q.qualityCandidate(snap(), { ...model(), model_n: 239 }), null);
  const r = q.qualityReport([observation(), observation({ winner: "DOWN" })], close + 1000)[0];
  assert.equal(r.quoted.net_cents, -68);
  assert.equal(r.stressed.net_cents, -70);
  assert.equal(r.quoted.max_drawdown_cents, -84);
  assert.ok(r.market_brier < r.model_brier, "overconfidence hurts on identical outcomes");
});

test("versions, horizons, warm-up, missing and quarantined outcomes remain separate", () => {
  const warm = receipt(); warm.model = { ...model(), model_n: 0 }; warm.candidate = null;
  const rs = q.qualityReport([observation(), observation({ entry_policy: "OLDER" }),
    observation({ horizon: 300, taken_ms: close - 305_000, recorded_ms: close - 304_000 }),
    observation({ winner: null }), observation({ research_quality: "excluded" }), observation({ receipt: warm })], close + 1000);
  const r = rs.find(g => g.policy === "ENTRY_SELECTIVE_V3" && g.horizon === 450);
  assert.equal(r.paired, 1); assert.equal(r.pending, 1); assert.equal(r.excluded, 1); assert.equal(r.warmup, 1);
  assert.equal(r.sample_ready, false);
  assert.equal(rs.find(g => g.policy === "OLDER" && g.horizon === 450).paired, 1);
  assert.equal(rs.find(g => g.policy === "ENTRY_SELECTIVE_V3" && g.horizon === 300).paired, 1);
});

test("probability bucket boundaries never count the same forecast twice", () => {
  const samples = [.2, .4, .6, .8].map(p => { const r = receipt(); r.model = model(p); return observation({ receipt: r }); });
  const r = q.qualityReport(samples, close)[0];
  assert.equal(r.calibration.reduce((n, b) => n + b.n, 0), 4);
  assert.deepEqual(Array.from(r.calibration, b => b.n), [0, 1, 1, 1, 1]);
});

test("missed checkpoints remain coverage gaps, including a fully missed next window", () => {
  assert.equal(q.checkpointCoverage([observation()], close).expected, 3);
  assert.equal(q.checkpointCoverage([observation()], close).missing, 2);
  assert.equal(q.checkpointCoverage([observation()], close + 900_000).missing, 5);
  assert.equal(q.checkpointCoverage([observation()], at + 1000).expected, 0);
});

async function database() {
  const pg = new PGlite();
  for (const f of ["0005_desk_ledger.sql", "0006_desk_samples.sql", "0024_desk_ledger_quality.sql", "0025_desk_policy_lab.sql", "0026_desk_policy_fills.sql", "0039_desk_chair_v3_prospective.sql", "0040_desk_call_quality.sql"]) await pg.exec(read(`migrations/${f}`));
  const sql = async (strings, ...values) => (await pg.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values)).rows;
  return { pg, sql };
}

test("database enforces checkpoint bounds, pre-close persistence and idempotence", async () => {
  const { pg } = await database();
  try {
    const insert = `insert into desk_call_quality (study,ticker,close_time,horizon,taken_at,entry_policy,capture_valid,receipt,recorded_at)
      values ('entry-time-v1',$1,$2,450,$3,'ENTRY_SELECTIVE_V3',true,$4,$5) on conflict do nothing`;
    const params = [ticker, new Date(close).toISOString(), new Date(at).toISOString(), JSON.stringify(receipt()), new Date(at + 1000).toISOString()];
    await pg.query(insert, params); await pg.query(insert, params);
    assert.equal((await pg.query("select count(*)::int as n from desk_call_quality")).rows[0].n, 1);
    await assert.rejects(pg.query(insert, ["late", params[1], params[2], params[3], params[1]]));
    await assert.rejects(pg.query(insert, ["outside", params[1], new Date(close - 440_000).toISOString(), params[3], params[4]]));
  } finally { await pg.close(); }
});

test("real training query excludes wrong horizons, versions, identities, proxies, late grades and quarantine", async () => {
  const { pg, sql } = await database();
  try {
    await pg.query(`insert into desk_call_quality (study,ticker,close_time,horizon,taken_at,entry_policy,capture_valid,receipt,recorded_at)
      values ('entry-time-v1',$1,$2,450,$3,'ENTRY_SELECTIVE_V3',true,$4,$5)`,
      [ticker, new Date(close).toISOString(), new Date(at).toISOString(), JSON.stringify(receipt()), new Date(at + 1000).toISOString()]);
    await pg.query("insert into desk_ledger (ticker,close_time,graded_at,source,winner,chair_lean) values ($1,$2,$3,'kalshi-result','UP','WAIT')",
      [ticker, new Date(close).toISOString(), new Date(close + 1000).toISOString()]);
    const server = loader({ "@/lib/db": { getSql: async () => sql } })("src/lib/desk/call-quality.server.ts", "\nexport { training };");
    const train = (h = 450, p = "ENTRY_SELECTIVE_V3", before = close + 5000) => server.training(h, p, before);
    assert.equal((await train()).through, close);
    assert.equal((await train(300)).through, null);
    assert.equal((await train(450, "OLDER")).through, null);
    assert.equal((await train(450, "ENTRY_SELECTIVE_V3", close + 500)).through, null);
    for (const mutation of ["update desk_ledger set source='proxy'", "update desk_ledger set source='kalshi-result', research_quality='excluded'"]) {
      await pg.exec(mutation); assert.equal((await train()).through, null);
    }
  } finally { await pg.close(); }
});

test("observer has no policy write or automatic authority, and public report keeps errors bounded", () => {
  const src = read("src/lib/desk/call-quality.server.ts");
  const writes = [...src.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)].map(m => m[1] || m[2] || m[3]);
  assert.deepEqual(writes, ["desk_call_quality"]);
  assert.doesNotMatch(src, /applyDeskOp|promoteToLive|noteCall\(/);
  assert.match(src, /on conflict \(study, ticker, close_time, horizon\) do nothing/);
  assert.match(read("server/routes/healthz.get.ts"), /ensureCallQualityObserver/);
  assert.match(read("src/lib/desk/chair-v3-prospective.server.ts"), /measurement_version = \$\{V3_MEASUREMENT_VERSION\}/);
});

test("public snapshot executes its real queries and keeps quarantined booked calls out of totals", async () => {
  const { pg, sql } = await database();
  try {
    const t = Math.floor(Date.now() / 900_000) * 900_000;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t).map(p => [p.type, p.value]));
    const symbol = `KXBTC15M-${parts.year}${parts.month.toUpperCase()}${parts.day}${parts.hour}${parts.minute}-00`;
    await pg.query("insert into desk_ledger (ticker,close_time,source,winner,chair_lean,entry_cents) values ($1,$2,'kalshi-result','UP','UP',82)", [symbol, new Date(t).toISOString()]);
    await pg.query("insert into desk_policy_fills values ('fill',$1,$2,'UP',$3,82,2,'CHAIR_V1','ENTRY_SELECTIVE_V3','RISK',now())", [symbol, new Date(t).toISOString(), new Date(t - 300_000).toISOString()]);
    const server = loader({ "@/lib/db": { getSql: async () => sql } })("src/lib/desk/call-quality.server.ts", "\nexport { buildSnapshot };");
    let report = await server.buildSnapshot();
    assert.equal(report.policies.length, 1);
    assert.equal(report.policies[0].net_cents, 16);
    assert.equal(report.groups.length, 0);
    await pg.exec("update desk_ledger set research_quality='suspect'");
    report = await server.buildSnapshot();
    assert.equal(report.policies.length, 0);
    assert.equal(report.coverage.held, 1);
    assert.equal(report.coverage.missing, 1);
  } finally { await pg.close(); }
});
