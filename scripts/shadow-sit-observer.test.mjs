/**
 * Execute the complete production observer, writer, checkpoint helper and arm
 * module. Only the external frame, Chair/gate outcomes, fee/math fixtures and
 * attribution service are controlled. These are boundary/recording tests, not
 * profitability tests or tests of the mocked Chair/gate's decision quality.
 * The storage test uses the real migration and real INSERT against a fresh
 * in-memory PGlite, never the application database or environment credentials.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const close = Date.parse("2026-10-01T15:00:00Z");
const E1 = "UNMUTE_DEDUP_SHELF_V1";
const snapshot = (secs, ticker = "TEST-WINDOW", closeTime = close) => ({
  as_of: closeTime - secs * 1000, close_time: closeTime, ticker, demo: false,
  yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15,
  no_bid_size: 10, yes_bid_size: 10, spot: 100_000, strike: 99_000, atr: 10,
  mins_left: secs / 60, spot_age_s: 0,
  obs: { receipt_ts: closeTime - secs * 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE" },
});

function harness(sqlImpl) {
  const inserts = [], queries = [], durable = new Map(), globalObject = {};
  const c = { frame: null, lean: "WAIT", gates: false, chairCalls: 0, gateCalls: 0, throwChair: false, failOnce: false };
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push(query);
    assert.doesNotMatch(query, /(?:insert into|update|delete from)\s+desk_(?:ledger|state)\b/i);
    if (sqlImpl) return sqlImpl(strings, ...values);
    if (!/^\s*insert into desk_shadow_receipts/.test(query)) return [];
    if (c.failOnce) { c.failOnce = false; throw new Error("synthetic receipt write failure"); }
    // Model only the production INSERT's optional cross-kind guard. The
    // PGlite test below verifies that guard against actual SQL as well.
    if (values[20] === true && /where not [\s\S]*or not exists/.test(query)) {
      const existing = [...durable.values()].some((r) => r.experiment === values[0] && r.arm === values[1]
        && r.ticker === values[2] && r.close_time === values[3]
        && ["fill", "intention", "veto", "no_fill"].includes(r.kind));
      if (existing) return [];
    }
    const key = values.slice(0, 5).join("|");
    if (durable.has(key)) return [];
    const row = {
      experiment: values[0], arm: values[1], ticker: values[2], close_time: values[3], kind: values[4], decided_at: values[5],
      side: values[6], ask_cents: values[7], fee_cents: values[9], official_winner: values[15], net_cents: values[16], payload: JSON.parse(values[18]),
    };
    durable.set(key, row); inserts.push(row);
    return [{ experiment: row.experiment }];
  };
  const policy = { id: "fixture", params: { min_families: 2, confirmation_frames: 3, confirmation_seconds: 8, tight_confirmation_frames: 4, tight_confirmation_seconds: 12 } };
  const deps = {
    "@/lib/db": { getSql: async () => sql },
    "./server-engine": { getServerFrame: async () => c.frame },
    "./chair": { runChair: () => {
      c.chairCalls++;
      if (c.throwChair) throw new Error("synthetic Chair failure");
      return { lean: c.lean, rows: [], gates: [], quorum: { up: 2, down: 0 } };
    } },
    "./economics-book": { chicagoDayOf: (t) => new Date(t).toISOString().slice(0, 10) },
    "./fee-engine": { DEFAULT_FEE_ENGINE: "fixture", feeCents: () => 1, realAskCents: (p) => Number.isFinite(p) && p > 0 && p < 100 },
    "./gate-vector": {
      DEPLOYED_POLICY: policy, OWNER_REFERENCE_POLICY: policy,
      supporterRows: () => [{ seat: "DRIFT" }, { seat: "CHAIN" }],
      gateVector: () => { c.gateCalls++; return { mode: "normal", binding_reason: "fixture", checks: [{ id: "fixture", pass: c.gates }] }; },
    },
    "./shadow-manifests": { INITIAL_SHADOW_COLLECTION_IDS: [], SHADOW_MANIFESTS: [], SHADOW_MANIFEST_FINGERPRINTS: {} },
    "./shadow-lab": { SHADOW_FEE_FINGERPRINT: "fixture", receiptKey: (r) => `${r.experiment}|${r.arm}|${r.ticker}|${r.close_ms}|${r.kind}` },
    "./selector-attribution.server": {
      blankAttributionTracker: () => ({ settled: 0, error: null }), attributionHealth: (a) => a,
      observeSelectorAttribution: async () => {}, settleAttributionRows: async () => 0,
    },
    "./seats": { EVIDENCE_OF: { DRIFT: "trend", CHAIN: "derivs" } },
    "./clock": { SETTLE_BASIS: 0.0002, normCdf: () => 1 },
    "./math": { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) },
  };
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    assert.ok(["shadow-lab.server.ts", "shadow-sit.ts", "shadow-arms.ts"].some((f) => file === `src/lib/desk/${f}`), `unexpected source ${file}`);
    const exports = {}; cache.set(file, exports);
    const source = readFileSync(new URL(file, root), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      exports, require: (key) => {
        const bare = key.replace(/\.ts$/, "");
        if (Object.hasOwn(deps, bare)) return deps[bare];
        assert.ok(key.startsWith("./"), `unexpected dependency ${key}`);
        return load(`src/lib/desk/${bare.slice(2)}.ts`);
      },
      Date, Math, Number, JSON, Object, Array, Map, Set, Promise, Error, structuredClone, console,
      globalThis: globalObject, process: { env: {} },
      setInterval: () => { throw new Error("test must not start timers"); }, clearInterval: () => {},
    });
    return exports;
  };
  const mod = load("src/lib/desk/shadow-lab.server.ts");
  const tick = async (secs, options = {}) => {
    const snap = snapshot(secs, options.ticker, options.closeTime);
    c.frame = { snap, chair: { lean: "WAIT" }, votes: [], learner: { skills: {} }, settings: {}, selective: { ready: true } };
    options.modify?.(c.frame);
    const before = JSON.stringify(c.frame);
    await mod.shadowLabTick(options.now ?? snap.as_of);
    assert.equal(JSON.stringify(c.frame), before, "observer must not mutate its input frame");
  };
  return { c, mod, tick, inserts, queries, durable, state: () => globalObject.__shadowLab__ };
}

const assertSits = (rows, count = 12) => {
  assert.equal(rows.length, count);
  for (const r of rows) {
    assert.equal(r.kind, "no_fill");
    for (const k of ["side", "ask_cents", "fee_cents", "official_winner", "net_cents"]) assert.equal(r[k], null, k);
  }
};

test("observer boundary: 181 -> 179 seconds writes the 12 missing research sits", async () => {
  const h = harness();
  await h.tick(181); assert.equal(h.inserts.length, 0);
  const observedAt = h.c.frame.snap.as_of;
  await h.tick(179);
  assert.equal(h.mod.shadowLabHealth().error, null);
  assertSits(h.inserts);
  for (const r of h.inserts) {
    assert.equal(r.payload.receipt_only, true);
    assert.equal(r.payload.last_observed_as_of, observedAt);
    assert.equal(r.payload.secs_left, 179);
    assert.equal(Date.parse(r.decided_at), close - 179_000, "never backdate the receipt to T-3");
  }
  assert.equal(new Set(h.inserts.map((r) => `${r.experiment}|${r.arm}`)).size, 12);
});

test("observer boundary: repeated grace ticks and exact-180 receipts are idempotent", async () => {
  for (const first of [180, 179]) {
    const h = harness(); await h.tick(181); await h.tick(first); await h.tick(170); await h.tick(169);
    assertSits(h.inserts);
  }
});

test("observer boundary: late directional evidence never runs a new Chair or gate", async () => {
  const h = harness(); await h.tick(181);
  const calls = [h.c.chairCalls, h.c.gateCalls];
  h.c.lean = "UP"; h.c.gates = true;
  await h.tick(179); await h.tick(170);
  assert.deepEqual([h.c.chairCalls, h.c.gateCalls], calls);
  assertSits(h.inserts);
  assert.ok([...h.state().arms.values()].every((a) => a.watch === null));
});

test("observer boundary: the 180-second entry cutoff stays inclusive, with real latch timing", async () => {
  const h = harness(); h.c.lean = "UP"; h.c.gates = true;
  await h.tick(188); await h.tick(184);
  assert.equal(h.inserts.filter((r) => r.kind === "fill").length, 0);
  await h.tick(180);
  assert.equal(h.inserts.filter((r) => r.kind === "fill" && r.experiment === E1).length, 4);
  const before = h.inserts.length;
  await h.tick(179); await h.tick(169);
  assert.equal(h.inserts.length, before, "existing intention/fill receipts must not become sits");
  assert.equal(h.c.chairCalls, 3);
});

test("observer boundary: unobserved and completely missed windows stay missing", async () => {
  const h = harness(); await h.tick(179); await h.tick(169);
  assert.equal(h.inserts.length, 0);
  await h.tick(181);
  for (const secs of [168, 167, 0, -1, 601, NaN, Infinity]) await h.tick(secs);
  assert.equal(h.inserts.length, 0, "no retrospective zero outside the frozen grace");
});

test("observer boundary: observation eligibility is keyed by ticker AND close time", async () => {
  for (const changed of [{ ticker: "OTHER-WINDOW" }, { closeTime: close + 900_000 }]) {
    const h = harness(); await h.tick(181); await h.tick(179, changed);
    assert.equal(h.inserts.length, 0);
  }
});

test("observer boundary: stale, future and out-of-order grace frames cannot finalize", async () => {
  for (const now of [close - 150_000, close - 181_000]) {
    const h = harness(); await h.tick(181); await h.tick(179, { now });
    assert.equal(h.inserts.length, 0);
  }
  const h = harness(); await h.tick(181);
  h.state().lastObservedWindow = { key: `TEST-WINDOW|${close}`, asOf: close - 178_000 };
  await h.tick(179); assert.equal(h.inserts.length, 0);
});

test("observer boundary: every existing durable receipt kind suppresses a grace sit", async () => {
  const h = harness(); await h.tick(181);
  const arms = ["PKG_85", "PKG_80", "PKG_88", "PKG_85_OWNER3"];
  ["fill", "intention", "veto", "no_fill"].forEach((kind, i) => {
    h.state().arms.get(`${E1}|${arms[i]}`).decided.add(`${E1}|${arms[i]}|TEST-WINDOW|${close}|${kind}`);
  });
  await h.tick(179);
  assertSits(h.inserts, 8);
  assert.ok(h.inserts.every((r) => r.experiment !== E1));
});

test("observer boundary: a long outage is missing evidence, not a zero", async () => {
  for (const earlier of [600, 450, 300, 200, 194]) {
    const h = harness(); await h.tick(earlier); const before = h.inserts.length;
    await h.tick(179);
    assert.equal(h.inserts.length, before, `no sits after observation at ${earlier}s`);
  }
  const boundary = harness(); await boundary.tick(193); await boundary.tick(179);
  assertSits(boundary.inserts); // 14 s = one 2 s poll plus the 12 s grace.
  const clock = harness(); await clock.tick(193);
  await clock.tick(179, { now: close - 178_999 });
  assert.equal(clock.inserts.length, 0, "age is measured at the observer clock, not only the snapshot clock");
});

test("observer boundary: another worker's durable kinds suppress a sit without inventing cache keys", async () => {
  const h = harness(); await h.tick(181);
  const arms = ["PKG_85", "PKG_80", "PKG_88", "PKG_85_OWNER3"];
  for (const [i, kind] of ["fill", "intention", "veto", "no_fill"].entries()) {
    h.durable.set(`other-worker-${i}`, { experiment: E1, arm: arms[i], ticker: "TEST-WINDOW", close_time: new Date(close).toISOString(), kind });
  }
  await h.tick(179); await h.tick(170);
  assertSits(h.inserts, 8);
  assert.ok(h.inserts.every((r) => r.experiment !== E1));
  for (const arm of arms) assert.equal(h.state().arms.get(`${E1}|${arm}`).decided.size, 0, "a guarded skip is not a durable no_fill");
});

test("observer boundary: failed receipt writes remain retryable without duplicating successes", async () => {
  const h = harness(); await h.tick(181); h.c.failOnce = true; await h.tick(179);
  assert.match(h.mod.shadowLabHealth().error, /synthetic receipt write failure/);
  await h.tick(170);
  assert.equal(h.mod.shadowLabHealth().error, null);
  assertSits(h.inserts);
});

test("observer boundary: failed evaluation is not evidence that a window sat", async () => {
  const h = harness(); h.c.throwChair = true; await h.tick(181); h.c.throwChair = false;
  await h.tick(179); assert.equal(h.inserts.length, 0);
});

test("observer boundary: session restart, demo and unready guards stay in force", async () => {
  const h = harness(); await h.tick(601);
  h.state().sessionStartedAt = close - 900_000 + 1;
  await h.tick(181); await h.tick(179); assert.equal(h.inserts.length, 0);
  for (const modify of [(f) => { f.snap.demo = true; }, (f) => { f.selective.ready = false; }, (f) => { f.chair = null; }]) {
    const x = harness(); await x.tick(181); await x.tick(179, { modify });
    assert.equal(x.inserts.length, 0);
  }
  assert.equal(h.mod.ensureShadowLabObserver({}), "disabled");
});

test("observer storage: the real writer persists once in disposable PGlite and never touches the paper book", async () => {
  // A new PGlite() has no connection string, file path or route to an external DB.
  // Application db.ts is never imported; the SQL tag below binds this instance only.
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(readFileSync(new URL("migrations/0057_desk_shadow_lab.sql", root), "utf8"));
    await db.exec("create table desk_ledger_research (ticker text, close_time timestamptz, winner text, source text); create table desk_state (id text primary key, payload jsonb); insert into desk_state values ('sentinel', '{\"unchanged\":true}');");
    const sql = async (strings, ...values) => {
      let query = strings[0];
      for (let i = 0; i < values.length; i++) query += `$${i + 1}${strings[i + 1]}`;
      return (await db.query(query, values)).rows;
    };
    const h = harness(sql); await h.tick(181); await h.tick(179); await h.tick(170);
    assert.equal(h.mod.shadowLabHealth().error, null);
    let rows = (await db.query("select * from desk_shadow_receipts")).rows;
    assertSits(rows);
    assert.ok(rows.every((r) => r.payload.receipt_only === true));
    // New process-local cache, same economic keys: DB conflicts prove durability.
    const second = harness(sql); await second.tick(181); await second.tick(179);
    assert.equal(second.mod.shadowLabHealth().error, null);
    rows = (await db.query("select * from desk_shadow_receipts")).rows;
    assertSits(rows);
    assert.deepEqual((await db.query("select payload from desk_state where id='sentinel'")).rows, [{ payload: { unchanged: true } }]);
    assert.equal((await db.query("select count(*)::int as n from desk_ledger_research")).rows[0].n, 0);

    // Different workers can have different caches. Four durable kinds from
    // a second worker must suppress a grace sit even when our cache is empty.
    const otherWindow = close + 900_000;
    const contender = harness(sql);
    await contender.tick(181, { closeTime: otherWindow });
    const arms = ["PKG_85", "PKG_80", "PKG_88", "PKG_85_OWNER3"];
    for (const [i, kind] of ["fill", "intention", "veto", "no_fill"].entries()) {
      await db.query(`insert into desk_shadow_receipts (experiment, arm, ticker, close_time, kind, decided_at, fee_engine)
        values ($1,$2,$3,$4,$5,$6,$7)`, [E1, arms[i], "TEST-WINDOW", new Date(otherWindow).toISOString(), kind, new Date(otherWindow - 181_000).toISOString(), "fixture"]);
    }
    await contender.tick(179, { closeTime: otherWindow });
    await contender.tick(170, { closeTime: otherWindow });
    assert.equal(contender.mod.shadowLabHealth().error, null);
    const mixed = (await db.query("select experiment,arm,kind from desk_shadow_receipts where close_time=$1", [new Date(otherWindow).toISOString()])).rows;
    assert.equal(mixed.length, 12, "4 already durable kinds plus 8 sits, never 16 contradictory rows");
    assert.equal(mixed.filter((r) => r.experiment === E1).length, 4);
    assert.deepEqual(mixed.filter((r) => r.experiment === E1).map((r) => r.kind).sort(), ["fill", "intention", "no_fill", "veto"]);
    assert.deepEqual((await db.query("select payload from desk_state where id='sentinel'")).rows, [{ payload: { unchanged: true } }]);
  } finally { await db.close(); }
});
