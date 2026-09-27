/**
 * MID_RECOVERY_LOCKS_V1_INACTIVE — acceptance through the ACTUAL path.
 *
 * Part 1 (vite): the real producer capture, the real projection and the real
 * Chair through the pure LOCKS evaluator: BAR_NO_SITMASS removes exactly the
 * Chair's own sit-mass term; CONTROL is exactly the V1 recovered arm; nothing
 * handed in is mutated.
 *
 * Part 2 (vm loader, mocked database, engine and clock): the recorder is
 * env-gated default OFF on its own literal flag, is kicked by healthz and
 * imported by nothing in production, writes only desk_shadow_receipts under
 * its own experiment for all five arms on the same window, skips the window
 * open at boot and records the next fresh one.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const now = Date.parse("2026-09-27T15:05:00Z");
const snapshot = (extra = {}) => ({
  as_of: now, kalshi_host: "fixture", kalshi_trade_n: 0, kalshi_taker_yes: 0, official_settles: [], close_time: now + 420_000, ticker: "KXBTC15M-LOCKS", mins_left: 7, secs_left: 420,
  yes_ask: 60, yes_bid: 59, no_ask: 41, no_bid: 40, yes_mid: 59.5, no_mid: 40.5,
  yes_bid_size: 7, no_bid_size: 5, edge_up: 6, edge_down: -8, fair_yes: 66, lab_fair_yes: 66, lab_locked: 0, lab_age_s: 1,
  fee_yes: 2, fee_no: 2, spread_cents: 1, leftover_cents: -1, spot: 80_100, strike: 80_000,
  spot_source: "fixture", spot_age_s: 1, spot_backup: 80_100, spot_backup_source: "fixture", spot_div_bps: 0, perp: 80_100, perp_source: "fixture", index_px: 80_100, strike_source: "fixture", quote_age_s: 1, quote_ts: now, last_trade_id: "fixture", combined_ask_cents: 101, print_age_s: 1, quote_seq: 1, obs: { receipt_ts: now - 1_000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
  phase: "MID", regime_key: "locks-fixture", session: "US_AM", demo: false, chalk: false,
  ret5: 0.003, ret15: 0.006, ret30: 0.009, ret1h: 0.01, spot_lead_bps: 0, atr: 100, atr_pct: 0.2,
  vol_median: 1, vol_last: 1, vol_percentile: 0.5, location: "MID", range_pos: 0.5,
  imbalance: 0, imbalance_hist: [], candles_1m: [], candles_5m: [], candles_15m: [], candles_1h: [], yes_mid_path: [], yes_mid_path_pts: [], candle_ts: { accepted: 0, rejected: 0 }, window_memory: {}, clock_key: "locks-fixture",
  funding_rate: 0, funding_apr: 0, funding_time: now, funding_history: [], funding_series: [], basis_bps: 0,
  open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [], oi_delta_3m: 0,
  oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0, liq_long_usd: 0, liq_short_usd: 0,
  liq_n: 0, liq_source: "", force_n: 0, cascade_proxy: false, fear_greed: 50, fear_greed_label: "neutral", fng_history: [],
  ...extra,
});

async function modules(t) {
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const names = ["bots", "call-recovery-candidate", "chair", "persist", "skills", "shadow-lab-mid-recovery", "shadow-lab-mid-recovery-locks"];
  const loaded = await Promise.all(names.map((n) => vite.ssrLoadModule(`/src/lib/desk/${n}.ts`)));
  return Object.assign({}, ...loaded);
}
const realDeps = (m) => ({ runBotsWithEvaluatedCandidates: m.runBotsWithEvaluatedCandidates, projectInactiveE1Recovery: m.projectInactiveE1Recovery, runChair: m.runChair });
const blankArms = () => Object.fromEntries(["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG"].map((a) => [a, { watch: null, calls: [], last_lean: "WAIT" }]));
const shadowDrift = (m) => { const learner = m.freshLearner(); learner.skills["DRIFT.aligned_3h"].status = "SHADOW"; return learner; };

// ---------------------------------------------------------------------------
// Part 1: the actual path.
// ---------------------------------------------------------------------------

test("real Chair: BAR_NO_SITMASS removes exactly the sit-mass term; CONTROL is exactly V1's recovered arm; production is untouched", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const snap = snapshot();
  const votes = m.runBots(snap, learner);
  const chair = m.runChair(votes, snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  const before = JSON.stringify({ votes, chair, learner, snap });
  const input = { snap, chair, learner, settings: m.DEFAULT_SETTINGS, call_log: [], audit: null, ready: true, start: now - 3_600_000, arms: blankArms() };
  const ev = m.evaluateLocks(input, realDeps(m));
  assert.equal(JSON.stringify({ votes, chair, learner, snap }), before, "the production votes, Chair, learner and snapshot are byte-identical");
  assert.equal(JSON.stringify(m.runChair(m.runBots(snap, learner), snap, learner, m.DEFAULT_SETTINGS, "WAIT", [])), JSON.stringify(chair), "the production Chair recomputes identically");
  const bar = ev.arms.BAR_NO_SITMASS.intervention.bar_no_sitmass;
  assert.equal(bar.applied, true);
  assert.equal(bar.exact, true, `arm pre-clamp ${bar.arm_pre_clamp} = control ${bar.control_pre_clamp} − sit ${bar.sit_term}`);
  assert.ok(bar.sit_term >= 0);
  assert.equal(ev.arms.BAR_NO_SITMASS.evaluation.recovered.chair_trace.bar, bar.arm_bar);
  const ctlTrace = ev.arms.CONTROL.evaluation.recovered.chair_trace;
  const barTrace = ev.arms.BAR_NO_SITMASS.evaluation.recovered.chair_trace;
  assert.equal(barTrace.score, ctlTrace.score, "the score is the Chair's own, untouched");
  assert.equal(barTrace.sit_mass, ctlTrace.sit_mass);
  assert.deepEqual(barTrace.rows, ctlTrace.rows, "rows, weights, statuses and folds are the Chair's own");
  for (const k of ["quiet", "weekend", "phase", "law_miss1", "calib_tax", "knn"]) assert.equal(barTrace.bar_breakdown[k], ctlTrace.bar_breakdown[k], k);
  const direct = m.evaluateMidRecovery({ ...input, recovered_calls: [], watch: null, last_recovered_lean: "WAIT" }, realDeps(m));
  assert.deepEqual(JSON.parse(JSON.stringify(ev.arms.CONTROL.evaluation)), JSON.parse(JSON.stringify(direct)), "CONTROL = MID_RECOVERY_V1 recovered arm, through the same evaluator");
  assert.equal(learner.skills["DRIFT.aligned_3h"].status, "SHADOW", "no promotion, no status change");
  assert.equal(Object.keys(learner.skills).some((id) => id.startsWith("E1_UNMUTE::")), false);
});

// ---------------------------------------------------------------------------
// Part 2: the recorder.
// ---------------------------------------------------------------------------

function loader(deps = {}, { env = {}, clock = null } = {}) {
  const cache = new Map();
  const FakeDate = clock == null ? Date : class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (key) => {
      if (key in deps) return deps[key];
      const bare = key.replace(/\.ts$/, "");
      if (bare in deps) return deps[bare];
      assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
      const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
      return load(path.href.slice(root.href.length));
    }, Date: FakeDate, Math, JSON, Number, Array, Object, Map, Set, Intl, Promise, Error, structuredClone, setInterval: () => 1, clearInterval: () => {}, globalThis: {}, console, process: { env: { ...env } } });
    return exports;
  }
  return load;
}
function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const rel = `${dir}${name}`;
    if (statSync(new URL(rel, root)).isDirectory()) walk(`${rel}/`, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}
const OBSERVER = "src/lib/desk/shadow-lab-mid-recovery-locks.server.ts";
const PURE = "src/lib/desk/shadow-lab-mid-recovery-locks.ts";
function fakeSql() {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/^\s*insert into desk_shadow_receipts/.test(text)) return [{ experiment: values[0] }];
    return [];
  };
  return { sql, calls };
}
const inserts = (calls) => calls.filter((c) => /^\s*insert into desk_shadow_receipts/.test(c.text)).map((c) => ({ experiment: c.values[0], arm: c.values[1], ticker: c.values[2], close: c.values[3], kind: c.values[4], payload: JSON.parse(c.values[18]) }));
const engineFrame = (m, snap, learner) => {
  const votes = m.runBots(snap, learner);
  const chair = m.runChair(votes, snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  return { snap, votes, chair, learner, settings: { bar_override: null, adaptive_bar: true, mutes: [], beast: false }, call_log: [], selective: { ready: true, start: now - 3_600_000, audit: null } };
};

test("env flag: only the literal MID_RECOVERY_LOCKS_SHADOW_ENABLED=true starts it; the V1 flag does not", () => {
  const load = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } });
  const mod = load(OBSERVER);
  assert.equal(mod.ensureMidRecoveryLocksObserver({}), "disabled");
  for (const v of ["TRUE", "True", "1", "yes", " true", "true "]) assert.equal(mod.ensureMidRecoveryLocksObserver({ MID_RECOVERY_LOCKS_SHADOW_ENABLED: v }), "disabled", JSON.stringify(v));
  assert.equal(mod.ensureMidRecoveryLocksObserver({ MID_RECOVERY_SHADOW_ENABLED: "true" }), "disabled", "the V1 switch never starts LOCKS");
  assert.equal(mod.midRecoveryLocksHealth().enabled, false);
  assert.equal(mod.midRecoveryLocksHealth().env_flag, "MID_RECOVERY_LOCKS_SHADOW_ENABLED");
  assert.equal(mod.midRecoveryLocksHealth().experiment, "MID_RECOVERY_LOCKS_V1_INACTIVE");
});

test("wiring and isolation: healthz kicks it fire-and-forget; no production module imports it; it owns no SQL writer and never reaches production state", () => {
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/shadow-lab-mid-recovery-locks\.server"\)\s*\.then\(\(m\) => m\.ensureMidRecoveryLocksObserver\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  // The V1 kick is still there, unchanged.
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/shadow-lab-mid-recovery\.server"\)\s*\.then\(\(m\) => m\.ensureMidRecoveryObserver\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  for (const f of walk("src/").concat(walk("server/"))) {
    if (f === "server/routes/healthz.get.ts" || f === "server/routes/research/mid-recovery-locks.get.ts" || f.startsWith("src/lib/desk/shadow-lab-mid-recovery-locks")) continue;
    assert.ok(!read(f).includes("mid-recovery-locks"), `${f} imports the LOCKS experiment`);
  }
  for (const prod of ["chair.ts", "bots.ts", "server-engine.ts", "selective-entry.ts", "book-floor.ts", "gate-vector.ts", "support-eligibility.ts", "floor-policy.ts", "fee-engine.ts", "call-recovery-candidate.ts", "persist.ts"]) {
    assert.doesNotMatch(read(`src/lib/desk/${prod}`), /MID_RECOVERY_LOCKS|mid-recovery-locks|shadow-lab-mid-recovery/, `${prod} knows nothing of the experiment`);
  }
  const src = codeOf(OBSERVER);
  for (const forbidden of ["noteCall(", "applyDeskOp(", "promoteToLive", "setKnob", "reviewSeats", "desk_ledger", "desk_state", "desk_shadow_manifests", "activateInitialShadowCollection", "registerShadowManifests", "saveSettings", "seat_calib_debt"]) {
    assert.ok(!src.includes(forbidden), `the recorder reaches ${forbidden}`);
  }
  assert.doesNotMatch(src, /shadow-lab-mid-recovery\.server/, "it does not import (or share state with) the V1 recorder");
  const writes = [...src.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)].map((x) => x[1] || x[2] || x[3]);
  assert.deepEqual(writes, [], "no SQL writer of its own: the shadow lab's append-only writer and settle sweep only");
  assert.match(src, /recordShadowReceipt\(/);
  assert.match(src, /settleShadowReceipts\(/);
  assert.match(src, /structuredClone\(\{\s*snap: frame\.snap, chair: frame\.chair, learner: frame\.learner, settings: frame\.settings, call_log: frame\.call_log \?\? \[\], audit: frame\.selective\.audit, start: frame\.selective\.start,?\s*\}\)/);
  assert.doesNotMatch(src, /frame\.(snap|chair|votes|learner|settings|selective|call_log)\s*=/);
  assert.match(src, /where experiment = \$\{EXPERIMENT\}/, "the report reads only this experiment's rows");
  const pure = codeOf(PURE);
  assert.doesNotMatch(pure, /from "@\/lib\/db"|server-engine|process\.env|Date\.now\(\)/, "the evaluator is pure");
  const route = codeOf("server/routes/research/mid-recovery-locks.get.ts");
  assert.match(route, /adminKeyOk\(key\)\) return new Response\("not found", \{ status: 404 \}\)/);
});

test("in band, all five arms record under their own experiment on the same window; nothing is written under MID_RECOVERY_V1_INACTIVE", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const { sql, calls } = fakeSql();
  let frame = engineFrame(m, snapshot(), learner);
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { env: { MID_RECOVERY_LOCKS_SHADOW_ENABLED: "true" } })(OBSERVER);
  await mod.midRecoveryLocksTick(now + 1);
  assert.equal(mod.midRecoveryLocksHealth().error, null, mod.midRecoveryLocksHealth().error ?? "");
  frame = engineFrame(m, snapshot({ as_of: now + 120_000 }), learner); // T-5:00: NULL_FAV_80 fallback checkpoint
  await mod.midRecoveryLocksTick(now + 120_001);
  frame = engineFrame(m, snapshot({ as_of: now + 239_000 }), learner); // T-3:01: still in band
  await mod.midRecoveryLocksTick(now + 239_001);
  frame = engineFrame(m, snapshot({ as_of: now + 241_000 }), learner); // T-2:59: receipt-only grace
  await mod.midRecoveryLocksTick(now + 241_001);
  assert.equal(mod.midRecoveryLocksHealth().error, null, mod.midRecoveryLocksHealth().error ?? "");
  const rows = inserts(calls);
  assert.deepEqual(rows.map((r) => [r.arm, r.kind]), [
    ["NULL_FAV_80", "no_fill"], ["CONTROL", "no_fill"], ["BAR_NO_SITMASS", "no_fill"], ["SUPPORT_UNCAL_E1", "no_fill"], ["COMBINED_DIAG", "no_fill"],
  ]);
  assert.ok(rows.every((r) => r.experiment === "MID_RECOVERY_LOCKS_V1_INACTIVE"), "never a V1 row");
  assert.equal(new Set(rows.map((r) => `${r.ticker}|${r.close}`)).size, 1, "one window");
  assert.equal(new Set(rows.map((r) => `${r.experiment}|${r.arm}|${r.ticker}|${r.close}|${r.kind}`)).size, 5, "five distinct primary keys on the one window");
  for (const r of rows.slice(1)) {
    assert.equal(r.payload.experiment, "MID_RECOVERY_LOCKS_V1_INACTIVE");
    assert.equal(r.payload.version, "MID_RECOVERY_LOCKS_V1_INACTIVE", "the stored record carries this experiment's identity, not V1's");
    assert.equal(r.payload.evaluator, "MID_RECOVERY_V1_INACTIVE");
    assert.equal(r.payload.arm, r.arm);
    assert.equal(r.payload.production_authority, "NONE");
    assert.equal(r.payload.checkpoint, 180);
    assert.equal(r.payload.receipt_only, true);
    assert.equal(r.payload.intervention.arm, r.arm);
    assert.equal("watch" in r.payload.confirmation, false, "the in-memory latch is not persisted");
  }
  assert.equal(rows.find((r) => r.arm === "COMBINED_DIAG").payload.promotion_eligible, false);
  assert.ok(calls.every((c) => /^\s*(insert into desk_shadow_receipts|update desk_shadow_receipts|select[\s\S]*from desk_shadow_receipts)/.test(c.text)), "only the receipts table");
  assert.ok(calls.filter((c) => /^\s*select[\s\S]*from desk_shadow_receipts/.test(c.text)).every((c) => c.values[0] === "MID_RECOVERY_LOCKS_V1_INACTIVE"), "risk history reads only this experiment");
  const armReads = calls.filter((c) => /^\s*select[\s\S]*from desk_shadow_receipts/.test(c.text)).map((c) => c.values[1]);
  assert.deepEqual([...new Set(armReads)], ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG"], "each arm reads its own risk history");
  // Idempotent: the same window again writes nothing new.
  await mod.midRecoveryLocksTick(now + 241_002);
  assert.equal(inserts(calls).length, 5);
});

test("clean session/window boundary: the window open at boot is skipped, the next fresh window records", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const { sql, calls } = fakeSql();
  const clock = { now: now };
  const boot = snapshot(); // closes at now + 7m, so it opened 8m before boot
  let frame = engineFrame(m, boot, learner);
  const mod = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { env: { MID_RECOVERY_LOCKS_SHADOW_ENABLED: "true" }, clock })(OBSERVER);
  assert.equal(mod.ensureMidRecoveryLocksObserver({ MID_RECOVERY_LOCKS_SHADOW_ENABLED: "true" }), "started");
  assert.equal(mod.ensureMidRecoveryLocksObserver({ MID_RECOVERY_LOCKS_SHADOW_ENABLED: "true" }), "already");
  assert.equal(mod.midRecoveryLocksHealth().session_start, now, "the session boundary is the boot instant");
  // Walk the boot window through its checkpoints and T-3: nothing is written.
  for (const dt of [1, 120_000, 239_000, 241_000]) {
    clock.now = now + dt;
    frame = engineFrame(m, snapshot({ as_of: now + dt }), learner);
    await mod.midRecoveryLocksTick(now + dt + 1);
  }
  assert.deepEqual(inserts(calls), [], "the market open at boot is never collected, not even its T-3 sit");
  // The next window opens after boot and is eligible.
  const nextClose = boot.close_time + 900_000;
  const nextTicker = "KXBTC15M-LOCKS-NEXT";
  for (const secsLeft of [420, 300, 181, 179]) {
    const asOf = nextClose - secsLeft * 1000;
    clock.now = asOf;
    frame = engineFrame(m, snapshot({ ticker: nextTicker, close_time: nextClose, as_of: asOf, mins_left: secsLeft / 60, secs_left: secsLeft }), learner);
    await mod.midRecoveryLocksTick(asOf + 1);
  }
  assert.equal(mod.midRecoveryLocksHealth().error, null, mod.midRecoveryLocksHealth().error ?? "");
  const rows = inserts(calls);
  assert.ok(rows.length >= 5, `the fresh window records: ${rows.map((r) => r.arm).join(",")}`);
  assert.ok(rows.every((r) => r.ticker === nextTicker), "only the fresh window");
  assert.deepEqual([...new Set(rows.map((r) => r.arm))].sort(), ["BAR_NO_SITMASS", "COMBINED_DIAG", "CONTROL", "NULL_FAV_80", "SUPPORT_UNCAL_E1"]);
});
