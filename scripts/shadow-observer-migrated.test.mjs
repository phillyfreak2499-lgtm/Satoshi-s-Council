/** Run the complete production observer with both receipt migrations.
 * External frames and Chair/gates are controlled fixtures; observer, attribution,
 * arm/checkpoint code and both persistence paths are real. This is not
 * proof of predictive quality or a live market/production database test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = (p) => readFileSync(new URL(p, root), "utf8");
const close = Date.parse("2026-10-01T15:00:00Z");
const baseline = source("migrations/0057_desk_shadow_lab.sql");
const attributionMigration = source("migrations/0059_desk_selector_attribution.sql");
const migration = source("migrations/0060_desk_shadow_receipt_decisions.sql");

async function fixture(run, { legacyClassifier = false, lateClockGuard = false } = {}) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(); // Always fresh memory: no app db.ts, env files or URL.
  let c, globalObject;
  try {
    await db.exec(baseline);
    await db.exec(attributionMigration);
    await db.exec(migration);
    if (legacyClassifier) {
      // Mutation witness: reproduce the rejected pre-75f1c36 policy that
      // treated every no_fill as terminal, while leaving the real trigger,
      // unique-key arbitration and production observer untouched.
      await db.exec(`create or replace function shadow_receipt_decision_class(receipt_kind text, receipt_payload jsonb)
        returns text language sql immutable as $$ select case when receipt_kind='no_fill' then 'no_fill'
        when receipt_kind in ('intention','fill','veto') then 'active' else null end $$;`);
    }
    await db.exec(`create table desk_ledger_research (ticker text, close_time timestamptz, winner text, source text);
      create table desk_state (id text primary key, payload jsonb);
      insert into desk_state values ('sentinel', '{"unchanged":true}');
      insert into desk_shadow_manifests (experiment, experiment_version, fingerprint, manifest, frozen_at, prospective_start_at, status)
      values
        ('UNMUTE_DEDUP_SHELF_V1', 1, 'fixture-e1', '{}', '2026-09-01', '2026-10-01T14:44:00Z', 'SHADOW'),
        ('WARDEN_JUMP_VETO_V1', 1, 'fixture-e2', '{}', '2026-09-01', '2026-10-01T14:44:00Z', 'SHADOW'),
        ('SETTLE_BASIS_MEASURED_V1', 1, 'fixture-e3', '{}', '2026-09-01', '2026-10-01T14:44:00Z', 'SHADOW');`);
    const sql = async (strings, ...values) => {
      let query = strings[0];
      for (let i = 0; i < values.length; i++) query += `$${i + 1}${strings[i + 1]}`;
      assert.doesNotMatch(query, /(?:insert into|update|delete from)\s+desk_(?:ledger|state)\b/i);
      const result = await db.query(query, values);
      if (c?.afterHistoryNow != null && /^\s*select[\s\S]*from desk_shadow_receipts/.test(query)) c.now = c.afterHistoryNow;
      return result.rows;
    };
    c = { frame: null, lean: "WAIT", gates: false, probability: 1, chairCalls: 0, gateCalls: 0, now: close - 181_000, afterFrameNow: null, afterHistoryNow: null };
    class FixtureDate extends Date { static now() { return c.now; } }
    globalObject = {};
    const policy = { id: "fixture", params: { floor_cents: 80, min_families: 2, confirmation_frames: 3, confirmation_seconds: 8, tight_confirmation_frames: 4, tight_confirmation_seconds: 12 } };
    const deps = {
      "@/lib/db": { getSql: async () => sql },
      "./server-engine": { getServerFrame: async () => { if (c.afterFrameNow != null) c.now = c.afterFrameNow; return c.frame; } },
      "./chair": { runChair: () => { c.chairCalls++; return { lean: c.lean, rows: [], gates: [], quorum: { up: 2, down: 0 } }; } },
      "./economics-book": { chicagoDayOf: (t) => new Date(t).toISOString().slice(0, 10) },
      "./fee-engine": { DEFAULT_FEE_ENGINE: "fixture", feeCents: () => 1, realAskCents: (p) => Number.isFinite(p) && p > 0 && p < 100 },
      "./gate-vector": {
        DEPLOYED_POLICY: policy, OWNER_REFERENCE_POLICY: policy,
        supporterRows: () => [{ seat: "DRIFT" }, { seat: "CHAIN" }],
        reachableQuorum: () => ({ reachable: true, count: 2, needed: 2 }),
        gateVector: (_snap, _chair, ctx) => {
          if (ctx?.watch !== null) c.gateCalls++;
          return { mode: "normal", binding_reason: "fixture", checks: [{ id: "fixture", pass: c.gates }] };
        },
      },
      "./shadow-manifests": {
        INITIAL_SHADOW_COLLECTION_IDS: ["UNMUTE_DEDUP_SHELF_V1", "WARDEN_JUMP_VETO_V1", "SETTLE_BASIS_MEASURED_V1"],
        SHADOW_MANIFESTS: [], SHADOW_MANIFEST_FINGERPRINTS: {},
      },
      "./shadow-lab": { SHADOW_FEE_FINGERPRINT: "fixture", receiptKey: (r) => `${r.experiment}|${r.arm}|${r.ticker}|${r.close_ms}|${r.kind}` },
      "./counterfactuals": { GATE_VARIANTS: [{ id: "FLAT_3C", threshold: () => 3 }] },
      "./seats": { EVIDENCE_OF: { DRIFT: "trend", CHAIN: "derivs" } },
      "./clock": { SETTLE_BASIS: 0.0002, normCdf: () => c.probability },
      "./math": { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) },
    };
    const cache = new Map();
    const load = (file) => {
      if (cache.has(file)) return cache.get(file);
      assert.ok(["shadow-lab.server.ts", "shadow-sit.ts", "shadow-arms.ts", "selector-attribution.server.ts", "selector-attribution.ts"].some((f) => file === `src/lib/desk/${f}`), `unexpected source ${file}`);
      const exports = {}; cache.set(file, exports);
      let input = source(file);
      if (lateClockGuard && file.endsWith("shadow-lab.server.ts")) {
        const guard = /[ ]{4}\/\/ Validate before either stateful auxiliary observer,[\s\S]*?[ ]{6}\|\| snap\.as_of > now\) return;\n/;
        const match = input.match(guard);
        assert.ok(match, "pre-observer clock guard mutation anchor");
        input = input.replace(guard, "").replace("    const entryOpen = () => {", `${match[0]}    const entryOpen = () => {`);
      }
      const code = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      vm.runInNewContext(code, {
        exports, require: (key) => {
          const bare = key.replace(/\.ts$/, "");
          if (Object.hasOwn(deps, bare)) return deps[bare];
          assert.ok(key.startsWith("./"), `unexpected dependency ${key}`);
          return load(`src/lib/desk/${bare.slice(2)}.ts`);
        },
        Date: FixtureDate, Math, Number, JSON, Object, Array, Map, Set, Promise, Error, structuredClone, console,
        globalThis: globalObject, process: { env: {} },
        setInterval: () => { throw new Error("test must not start timers"); }, clearInterval: () => {},
      });
      return exports;
    };
    const mod = load("src/lib/desk/shadow-lab.server.ts");
    const tick = async (secs, { ticker = "FIXTURE", side = "UP", ask = 85, now, asOf, demo = false, runtimeClock = false } = {}) => {
      const other = 101 - ask;
      const snap = {
        as_of: asOf ?? close - secs * 1000, close_time: close, ticker, demo,
        yes_ask: side === "UP" ? ask : other, yes_bid: side === "UP" ? ask - 1 : other - 1,
        no_ask: side === "DOWN" ? ask : other, no_bid: side === "DOWN" ? ask - 1 : other - 1,
        no_bid_size: 10, yes_bid_size: 10, spot: 100_000, strike: 99_000, atr: 10,
        mins_left: secs / 60, spot_age_s: 0, quote_age_s: 0,
        fair_yes: 90, yes_mid: 84, lab_fair_yes: 90, lab_age_s: 0, fee_yes: 1, fee_no: 1, edge_up: 4, edge_down: -4,
        obs: { receipt_ts: asOf ?? close - secs * 1000, gap: "ok" },
        health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE" },
      };
      c.frame = { snap, chair: { lean: "WAIT", rows: [], confidence: 0, score: 0, bar: 0, sit_mass: 0, quorum: { up: 0, down: 0, wait: 1 } }, call_log: [], votes: [], learner: { skills: {} }, settings: {}, selective: { ready: true, start: close - 900_000 } };
      const before = JSON.stringify(c.frame);
      c.now = now ?? snap.as_of;
      await mod.shadowLabTick(runtimeClock ? undefined : c.now);
      assert.equal(JSON.stringify(c.frame), before, "observer never writes back into the supplied frame");
    };
    const rows = async (ticker) => (await db.query("select * from desk_shadow_receipts where ticker=$1 order by experiment,arm,kind", [ticker])).rows;
    const attributionRows = async (ticker) => (await db.query("select * from desk_selector_attribution where ticker=$1 order by kind", [ticker])).rows;
    await run({ db, c, mod, tick, rows, attributionRows, state: () => globalObject.__shadowLab__ });
    assert.deepEqual((await db.query("select payload from desk_state where id='sentinel'")).rows, [{ payload: { unchanged: true } }]);
    assert.equal((await db.query("select count(*)::int as n from desk_ledger_research")).rows[0].n, 0);
  } finally { await db.close(); }
}

const nullRows = (rows) => rows.filter((r) => r.arm.startsWith("NULL_FAV_"));

test("migrated observer: all NULL_FAV floors and both directions retain within-grace qualification after provisional no_fill", async () => {
  await fixture(async ({ tick, rows, mod }) => {
    for (const side of ["UP", "DOWN"]) for (const floor of [80, 85, 88]) {
      const ticker = `${side}-${floor}`;
      await tick(300, { ticker, side, ask: 79 });
      assert.equal(mod.shadowLabHealth().error, null);
      const provisional = nullRows(await rows(ticker));
      assert.equal(provisional.length, 3);
      assert.ok(provisional.every((r) => r.kind === "no_fill" && r.payload.checkpoint === 300));
      await tick(298, { ticker, side, ask: floor });
      assert.equal(mod.shadowLabHealth().error, null);
      await tick(298, { ticker, side, ask: floor }); // same observation repeated
      await tick(297, { ticker, side, ask: floor }); // new tick, same economic receipt
      const after = nullRows(await rows(ticker));
      const fills = after.filter((r) => r.kind === "fill");
      assert.deepEqual(fills.map((r) => r.arm).sort(), [80, 85, 88].filter((f) => f <= floor).map((f) => `NULL_FAV_${f}`));
      assert.ok(fills.every((r) => r.side === side && r.ask_cents === floor && r.payload.checkpoint === 300));
      assert.deepEqual(after.filter((r) => r.kind === "no_fill"), provisional, "raw provisional history is immutable, not a second terminal outcome");
    }
  });
});

test("migrated observer: qualification outside the benchmark grace stays unfilled", async () => {
  await fixture(async ({ tick, rows, mod }) => {
    for (const side of ["UP", "DOWN"]) for (const secs of [288, 287, 180, 179]) {
      const ticker = `closed-${side}-${secs}`;
      await tick(300, { ticker, side, ask: 79 });
      await tick(secs, { ticker, side, ask: 90 });
      assert.equal(mod.shadowLabHealth().error, null);
      const records = nullRows(await rows(ticker));
      assert.equal(records.length, 3);
      assert.ok(records.every((r) => r.kind === "no_fill" && r.payload.checkpoint === 300));
    }
  });
});

test("migrated observer: all twelve terminal arms persist idempotent sits; missing/stale windows stay missing", async () => {
  await fixture(async ({ db, c, tick, rows, mod, state }) => {
    for (const first of [180, 179]) {
      const ticker = `terminal-${first}`;
      await tick(181, { ticker }); await tick(first, { ticker });
      await tick(170, { ticker }); await tick(169, { ticker });
      assert.equal(mod.shadowLabHealth().error, null);
      const records = await rows(ticker);
      assert.equal(records.length, 12);
      assert.ok(records.every((r) => r.kind === "no_fill" && r.payload.checkpoint === 180));
      // Any competing worker using the old plain INSERT still hits the guard.
      for (const r of records) {
        await assert.rejects(db.query(`insert into desk_shadow_receipts (experiment,arm,ticker,close_time,kind,decided_at,fee_engine)
          values ($1,$2,$3,$4,'fill',$5,'fixture')`, [r.experiment,r.arm,r.ticker,r.close_time,r.decided_at]),
        (e) => e.code === "23514" && /cross-kind decision conflict/.test(e.message));
      }
      assert.equal((await rows(ticker)).length, 12);
    }
    await tick(179, { ticker: "unobserved" }); assert.equal((await rows("unobserved")).length, 0);
    await tick(181, { ticker: "missed" }); await tick(167, { ticker: "missed" }); assert.equal((await rows("missed")).length, 0);
    await tick(200, { ticker: "stale" }); await tick(179, { ticker: "stale" }); assert.equal((await rows("stale")).length, 0);
    await tick(181, { ticker: "late-signal" });
    const counts = [c.chairCalls,c.gateCalls]; c.lean = "UP"; c.gates = true;
    await tick(179, { ticker: "late-signal" });
    assert.deepEqual([c.chairCalls,c.gateCalls], counts, "receipt grace never evaluates late entry evidence");
    assert.equal((await rows("late-signal")).length, 12);
    state().sessionStartedAt = close - 900_000 + 1;
    await tick(181, { ticker: "restart" }); await tick(179, { ticker: "restart" });
    assert.equal((await rows("restart")).length, 0);
  });
});

test("migrated observer: basis-block observations can later fill without rewriting the earlier receipt", async () => {
  await fixture(async ({ c, tick, rows, mod }) => {
    c.lean = "UP"; c.gates = true; c.probability = 0.86;
    const ticker = "basis-transition";
    await tick(408, { ticker }); await tick(404, { ticker }); await tick(400, { ticker });
    assert.equal(mod.shadowLabHealth().error, null);
    const blocked = (await rows(ticker)).filter((r) => ["BASIS_5BPS","BASIS_7BPS","BASIS_9BPS"].includes(r.arm) && r.kind === "no_fill");
    assert.equal(blocked.length, 3);
    c.probability = 1;
    await tick(398, { ticker }); await tick(396, { ticker });
    assert.equal(mod.shadowLabHealth().error, null);
    const after = await rows(ticker);
    assert.equal(after.filter((r) => ["BASIS_5BPS","BASIS_7BPS","BASIS_9BPS"].includes(r.arm) && r.kind === "fill").length, 3);
    assert.deepEqual(after.filter((r) => ["BASIS_5BPS","BASIS_7BPS","BASIS_9BPS"].includes(r.arm) && r.kind === "no_fill"), blocked);
  });
});

test("migrated observer mutation witness: the rejected broad no_fill guard blocks the permitted benchmark fill", async () => {
  await fixture(async ({ tick, rows, mod }) => {
    const ticker = "old-guard-witness";
    await tick(300, { ticker, ask: 79 });
    assert.equal(mod.shadowLabHealth().error, null);
    await tick(298, { ticker, ask: 88 });
    assert.match(mod.shadowLabHealth().error, /shadow receipt cross-kind decision conflict/);
    // Drain the queued queries before inspecting results/closing the instance.
    const after = nullRows(await rows(ticker));
    assert.equal(after.filter((r) => r.kind === "fill").length, 0);
    assert.equal(after.filter((r) => r.kind === "no_fill").length, 3);
  }, { legacyClassifier: true });
});


test("migrated observer: cached 181-second frame at wall-clock 179 never evaluates late entry", async () => {
  await fixture(async ({ c, tick, rows, mod, state }) => {
    const ticker = "cached-cutoff";
    await tick(181, { ticker });
    const evaluations = [c.chairCalls, c.gateCalls];
    const watches = JSON.stringify([...state().arms].map(([id, a]) => [id, a.watch]));
    c.lean = "UP"; c.gates = true;
    await tick(181, { ticker, now: close - 179_000 });
    await tick(181, { ticker, now: close - 178_000 });
    assert.equal(mod.shadowLabHealth().error, null);
    assert.deepEqual([c.chairCalls,c.gateCalls], evaluations);
    assert.equal(JSON.stringify([...state().arms].map(([id, a]) => [id, a.watch])), watches);
    const receipts = await rows(ticker);
    assert.equal(receipts.length, 12);
    assert.ok(receipts.every((r) => r.kind === "no_fill" && r.payload.receipt_only === true));
    assert.ok(receipts.every((r) => r.payload.finalized_at === close - 179_000));
    await tick(181, { ticker: "cached-unobserved", now: close - 179_000 });
    assert.equal((await rows("cached-unobserved")).length, 0);
    assert.deepEqual([c.chairCalls,c.gateCalls], evaluations);
  });
});

test("migrated observer: wall-clock grace expiration and future snapshots cannot reopen the entry band", async () => {
  await fixture(async ({ c, tick, rows }) => {
    for (const wall of [168, 167, 0]) {
      const ticker = `cached-expired-${wall}`;
      c.lean = "WAIT"; c.gates = false;
      await tick(181, { ticker });
      const evaluations = [c.chairCalls,c.gateCalls];
      c.lean = "UP"; c.gates = true;
      await tick(181, { ticker, now: close - wall * 1000 });
      assert.deepEqual([c.chairCalls,c.gateCalls], evaluations);
      assert.equal((await rows(ticker)).length, 0);
    }
    const evaluations = [c.chairCalls,c.gateCalls];
    await tick(179, { ticker: "future-frame", now: close - 181_000 });
    assert.deepEqual([c.chairCalls,c.gateCalls], evaluations);
    assert.equal((await rows("future-frame")).length, 0);
  });
});

test("migrated observer: production clock refreshes after the awaited frame crosses T-3", async () => {
  await fixture(async ({ c, tick, rows, mod }) => {
    const ticker = "awaited-frame-cutoff";
    await tick(181, { ticker });
    const evaluations = [c.chairCalls,c.gateCalls];
    c.lean = "UP"; c.gates = true;
    c.afterFrameNow = close - 179_000;
    // Call the same no-argument clock path as the production timer, while the
    // controlled getServerFrame advances time without a nondeterministic sleep.
    await tick(181, { ticker, runtimeClock: true });
    assert.equal(mod.shadowLabHealth().error, null);
    assert.deepEqual([c.chairCalls,c.gateCalls], evaluations);
    const receipts = await rows(ticker);
    assert.equal(receipts.length, 12);
    assert.ok(receipts.every((r) => r.kind === "no_fill" && r.payload.receipt_only === true));
  });
});

test("migrated observer: an awaited history query cannot advance confirmation or start a late fill", async () => {
  await fixture(async ({ c, tick, rows, mod, state }) => {
    const ticker = "awaited-history-cutoff";
    c.lean = "UP"; c.gates = true;
    await tick(190, { ticker }); await tick(186, { ticker });
    const before = await rows(ticker);
    assert.ok(before.some((r) => r.kind === "intention"));
    assert.ok(before.every((r) => r.kind !== "fill"));
    const gates = c.gateCalls;
    const watches = JSON.stringify([...state().arms].map(([id, a]) => [id, a.watch]));
    const observed = JSON.stringify(state().lastObservedWindow);
    c.afterHistoryNow = close - 179_000;
    // A third timely snapshot would confirm, but database latency has already
    // carried the actual observer clock past the unchanged entry cutoff.
    await tick(182, { ticker, runtimeClock: true });
    assert.equal(mod.shadowLabHealth().error, null);
    assert.equal(c.gateCalls, gates);
    assert.equal(JSON.stringify([...state().arms].map(([id, a]) => [id, a.watch])), watches);
    assert.equal(JSON.stringify(state().lastObservedWindow), observed);
    assert.deepEqual(await rows(ticker), before);
  });
});

test("migrated observer: exact 180-second wall cutoff remains eligible with an older in-band frame", async () => {
  await fixture(async ({ c, tick, rows, mod }) => {
    const ticker = "exact-wall-cutoff";
    c.lean = "UP"; c.gates = true;
    await tick(190, { ticker }); await tick(186, { ticker });
    const gates = c.gateCalls;
    await tick(181, { ticker, now: close - 180_000 });
    assert.equal(mod.shadowLabHealth().error, null);
    assert.ok(c.gateCalls > gates);
    assert.ok((await rows(ticker)).some((r) => r.arm === "PKG_85" && r.kind === "fill"));
  });
});

test("migrated observer: future in-band snapshots and nonfinite observer clocks fail closed", async () => {
  await fixture(async ({ c, tick, rows, state }) => {
    c.lean = "UP"; c.gates = true;
    const cases = [close - 183_000, NaN, Infinity, -Infinity];
    for (const [i, now] of cases.entries()) {
      const ticker = `invalid-clock-${i}`;
      const evaluations = [c.chairCalls,c.gateCalls];
      await tick(181, { ticker, now });
      assert.deepEqual([c.chairCalls,c.gateCalls], evaluations);
      assert.equal((await rows(ticker)).length, 0);
      assert.equal(state().lastObservedWindow, null);
    }
  });
});

const stableReceipts = (rows) => rows.map(({ recorded_at: _recordedAt, ...row }) => row);
const stableAttribution = (rows) => rows.map(({ recorded_at: _recordedAt, ...row }) => row);

async function clockIsolationSequence({ c, tick, rows, attributionRows, state, mod }, { ticker, polluted, invalidNow }) {
  if (state()) {
    state().jump = { yes_ask: null, no_ask: null, last_shock_ms: null, last_shock_side: null, last_shock_cents: null };
    state().attribution = { boundary_ms: null, boundary_iso: null, windows: new Map(), decided: new Set(), written: 0, failed: 0, settled: 0, error: null, last_write: null };
  }
  c.lean = "UP"; c.gates = true;

  // A genuine successful observation seeds both auxiliary observers.  In
  // particular this writes BLIND_ELIGIBLE through the real attribution SQL.
  await tick(190, { ticker, ask: 85 });
  assert.equal(mod.shadowLabHealth().error, null);
  const attributionBefore = stableAttribution(await attributionRows(ticker));
  const jumpBefore = JSON.stringify(state().jump);
  const trackerBefore = JSON.stringify({
    windows: [...state().attribution.windows],
    decided: [...state().attribution.decided],
    written: state().attribution.written,
    failed: state().attribution.failed,
  });
  assert.ok(attributionBefore.some((r) => r.kind === "BLIND_ELIGIBLE"), "positive control exercises the attribution writer");
  assert.equal(JSON.parse(jumpBefore).yes_ask, 85, "positive control exercises jump observation");

  if (polluted) {
    // Start with a valid runtime clock; invalidate it inside getServerFrame
    // so this reaches the post-await guard instead of the pre-frame guard.
    c.afterFrameNow = invalidNow;
    try {
      await tick(181, { ticker, ask: 95, runtimeClock: true });
    } finally {
      c.afterFrameNow = null;
    }
    // Retain the independent finite-clock future-snapshot case.
    await tick(181, { ticker, ask: 95, now: close - 190_000 });
    assert.equal(JSON.stringify(state().jump), jumpBefore);
    assert.equal(JSON.stringify({
      windows: [...state().attribution.windows],
      decided: [...state().attribution.decided],
      written: state().attribution.written,
      failed: state().attribution.failed,
    }), trackerBefore);
    assert.deepEqual(stableAttribution(await attributionRows(ticker)), attributionBefore, "invalid frames perform no attribution SQL writes");
  }

  // Identical valid continuation in clean and polluted databases. The real
  // 3-cent shock at 182 seconds is a positive control: E2 must emit vetoes,
  // so a permanently inactive jump observer cannot satisfy this regression.
  await tick(186, { ticker, ask: 85 });
  await tick(182, { ticker, ask: 88 });
  const receiptRows = stableReceipts(await rows(ticker));
  const e2 = receiptRows.filter((r) => r.experiment === "WARDEN_JUMP_VETO_V1");
  assert.ok(e2.some((r) => r.kind === "veto"), "positive control exercises the existing shock veto");
  return {
    e2: e2.map((r) => ({ ...r, ticker: "CLOCK" })),
    attribution: stableAttribution(await attributionRows(ticker)).map((r) => ({ ...r, ticker: "CLOCK" })),
  };
}

test("migrated observer: invalid clocks and future price jumps leave real auxiliary observers isolated", async () => {
  await fixture(async (ctx) => {
    for (const [i, invalidNow] of [NaN, Infinity, -Infinity, 0, -1].entries()) {
      const clean = await clockIsolationSequence(ctx, { ticker: `clock-clean-${i}`, polluted: false, invalidNow });
      const polluted = await clockIsolationSequence(ctx, { ticker: `clock-polluted-${i}`, polluted: true, invalidNow });
      assert.deepEqual(polluted.e2, clean.e2, `E2 result changed after invalid clock ${String(invalidNow)}`);
      assert.deepEqual(polluted.attribution, clean.attribution, `attribution changed after invalid clock ${String(invalidNow)}`);
    }
  });
});

test("migrated observer mutation witness: pre-c302 guard ordering fails auxiliary-state isolation", async () => {
  await fixture(async (ctx) => {
    await assert.rejects(
      clockIsolationSequence(ctx, { ticker: "clock-mutated", polluted: true, invalidNow: NaN }),
      /invalid frames perform no attribution SQL writes|Expected values to be strictly equal/,
    );
  }, { lateClockGuard: true });
});
