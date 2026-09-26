/**
 * MID_RECOVERY_V1_INACTIVE — acceptance through the ACTUAL path.
 *
 * Part 1 (vite): the real producer capture (bots.runBotsWithEvaluatedCandidates),
 * the real projection (call-recovery-candidate.projectInactiveE1Recovery) and
 * the real Chair, driven through the pure evaluator: baseline unchanged, exact
 * runBots without capture, frozen roster only, one per seat, deterministic,
 * stale/down and Brier/EV suppression honoured, holds excluded.
 *
 * Part 2 (vm loader, mocked database and engine): the recorder is env-gated
 * default OFF, absorbs failures into its own health, reads a clone, writes only
 * desk_shadow_receipts under its own experiment id with idempotent keys, and
 * stamps every simulated fill as research only. The engine never imports it.
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

const now = Date.parse("2026-09-16T15:05:00Z");
const snapshot = (extra = {}) => ({
  as_of: now, kalshi_host: "fixture", kalshi_trade_n: 0, kalshi_taker_yes: 0, official_settles: [], close_time: now + 420_000, ticker: "KXBTC15M-RECOVERY", mins_left: 7, secs_left: 420,
  yes_ask: 60, yes_bid: 59, no_ask: 41, no_bid: 40, yes_mid: 59.5, no_mid: 40.5,
  yes_bid_size: 7, no_bid_size: 5, edge_up: 6, edge_down: -8, fair_yes: 66, lab_fair_yes: 66, lab_locked: 0, lab_age_s: 1,
  fee_yes: 2, fee_no: 2, spread_cents: 1, leftover_cents: -1, spot: 80_100, strike: 80_000,
  spot_source: "fixture", spot_age_s: 1, spot_backup: 80_100, spot_backup_source: "fixture", spot_div_bps: 0, perp: 80_100, perp_source: "fixture", index_px: 80_100, strike_source: "fixture", quote_age_s: 1, quote_ts: now, last_trade_id: "fixture", combined_ask_cents: 101, print_age_s: 1, quote_seq: 1, obs: { receipt_ts: now - 1_000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
  phase: "MID", regime_key: "recovery-fixture", session: "US_AM", demo: false, chalk: false,
  ret5: 0.003, ret15: 0.006, ret30: 0.009, ret1h: 0.01, spot_lead_bps: 0, atr: 100, atr_pct: 0.2,
  vol_median: 1, vol_last: 1, vol_percentile: 0.5, location: "MID", range_pos: 0.5,
  imbalance: 0, imbalance_hist: [], candles_1m: [], candles_5m: [], candles_15m: [], candles_1h: [], yes_mid_path: [], yes_mid_path_pts: [], candle_ts: { accepted: 0, rejected: 0 }, window_memory: {}, clock_key: "recovery-fixture",
  funding_rate: 0, funding_apr: 0, funding_time: now, funding_history: [], funding_series: [], basis_bps: 0,
  open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [], oi_delta_3m: 0,
  oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0, liq_long_usd: 0, liq_short_usd: 0,
  liq_n: 0, liq_source: "", force_n: 0, cascade_proxy: false, fear_greed: 50, fear_greed_label: "neutral", fng_history: [],
  ...extra,
});

async function modules(t) {
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const names = ["bots", "call-recovery-candidate", "chair", "persist", "skills", "shadow-arms", "shadow-lab-mid-recovery"];
  const loaded = await Promise.all(names.map((n) => vite.ssrLoadModule(`/src/lib/desk/${n}.ts`)));
  return Object.assign({}, ...loaded);
}
const realDeps = (m) => ({ runBotsWithEvaluatedCandidates: m.runBotsWithEvaluatedCandidates, projectInactiveE1Recovery: m.projectInactiveE1Recovery, runChair: m.runChair });
const inputFor = (m, snap, learner, chair, extra = {}) => ({ snap, chair, learner, settings: m.DEFAULT_SETTINGS, call_log: [], audit: null, ready: true, start: now - 3_600_000, recovered_calls: [], watch: null, ...extra });
const shadowDrift = (m) => { const learner = m.freshLearner(); learner.skills["DRIFT.aligned_3h"].status = "SHADOW"; return learner; };
const vote = (seat, skill, lean, status = "SHADOW", extra = {}) => ({
  seat, lean, raw_lean: lean, confidence: 70, raw_conf: 70, features: { source: skill }, reasoning: skill,
  skill_used: skill, skill_status: status, shadow: null, paper: [], thresh_used: [], skill_n: 1, skill_hits: 0,
  skill_wilson: 0, hypothesis: skill, evidence: [skill], counter: "", invalidate_if: "", health: "LIVE",
  feed_age_s: 1, eyes: skill, phase: "MID", ...extra,
});
/** The real projection and Chair over a synthetic producer frame. */
const syntheticDeps = (m, frame) => ({ ...realDeps(m), runBotsWithEvaluatedCandidates: (snap) => ({ ...frame, ticker: snap.ticker, close_time: snap.close_time, as_of: snap.as_of }) });

// ---------------------------------------------------------------------------
// Part 1: the actual path.
// ---------------------------------------------------------------------------

test("baseline unchanged: production runBots, learner and Chair are byte-identical before and after an evaluation; no capture means the exact runBots result", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const snap = snapshot();
  const votes = m.runBots(snap, learner);
  const chair = m.runChair(votes, snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  const before = JSON.stringify({ votes, chair, learner, snap });
  const ev = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), realDeps(m));
  assert.equal(JSON.stringify({ votes, chair, learner, snap }), before, "the evaluation mutates nothing it was handed");
  assert.deepEqual(JSON.parse(JSON.stringify(m.runBots(snap, learner))), JSON.parse(JSON.stringify(votes)), "runBots after the evaluation is the exact production result");
  assert.deepEqual(JSON.parse(JSON.stringify(m.runBotsWithEvaluatedCandidates(snap, learner).votes)), JSON.parse(JSON.stringify(votes)), "capture returns the exact runBots votes");
  assert.deepEqual(JSON.parse(JSON.stringify(m.runChair(votes, snap, learner, m.DEFAULT_SETTINGS, "WAIT", []))), JSON.parse(JSON.stringify(chair)));
  assert.equal(ev.baseline.lean, chair.lean);
  assert.equal(ev.baseline.state, "WAIT");
  assert.equal(ev.recovered.lean, "UP", "the recovered arm hears DRIFT.aligned_3h in this controlled frame");
  assert.equal(ev.flags.wait_to_directional, true);
  assert.equal(ev.simulated.booked, false);
  assert.equal(ev.recovered.eligible, false, "the actual Chair and the deployed gates still block: one uncalibrated supporter under the floor");
  assert.equal(ev.economics.floor_ok, false);
  assert.equal(ev.flags.funnel_stage, "directional");
  assert.equal(ev.direction.reason, "DIRECTIONAL", "the diagnosis reads the actual Chair result");
  assert.equal(ev.direction.lean, "UP");
  assert.equal(ev.direction.bar_gate_value, ev.recovered.checks.length ? ev.direction.bar_gate_value : "", "carried verbatim from the Chair's bar gate");
  assert.match(ev.direction.bar_gate_value, /^\|[\d.]+\| × [\d.]+ = [\d.]+ vs bar [\d.]+ \(sit [\d.]+\)$/);
  assert.equal(Math.round(ev.direction.vs_bar * 1000), Math.round(Math.abs(ev.direction.score) * ev.direction.aggressiveness * 1000));
  assert.equal(learner.skills["DRIFT.aligned_3h"].status, "SHADOW", "no promotion, no status change");
  assert.equal(Object.keys(learner.skills).some((id) => id.startsWith("E1_UNMUTE::")), false, "the twin lives only in the projection's clone");
});

test("only the frozen roster, one candidate per real seat, deterministic across runs and evaluated order", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const snap = snapshot();
  const chair = m.runChair(m.runBots(snap, learner), snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  const a = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), realDeps(m));
  const b = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), realDeps(m));
  assert.equal(JSON.stringify(a), JSON.stringify(b), "same frame, same evaluation");
  assert.deepEqual(a.candidates.map((c) => c.card_id), ["DRIFT.aligned_3h"]);
  for (const c of a.candidates) assert.ok(m.E1_ROSTER_CARDS.includes(c.card_id));
  for (const id of a.recovery.released) assert.ok(m.E1_ROSTER_CARDS.includes(id));
  assert.deepEqual(a.recovery.missing, []);
  // Synthetic frame: two directional DRIFT roster cards plus a directional non-roster card.
  const base = vote("DRIFT", "SIT", "WAIT", "SIT");
  const frame = { version: "E1_RECOVERY_V1_INACTIVE", votes: [base], evaluated: [vote("DRIFT", "DRIFT.pullback_in_trend", "DOWN"), vote("DRIFT", "DRIFT.aligned_3h", "UP"), vote("WICK", "WICK.not_in_roster", "UP")] };
  for (const evaluated of [frame.evaluated, [...frame.evaluated].reverse()]) {
    const ev = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), syntheticDeps(m, { ...frame, evaluated }));
    assert.deepEqual(ev.candidates.map((c) => c.card_id), ["DRIFT.aligned_3h"], "frozen roster order, one per seat, regardless of evaluated order");
    assert.deepEqual(ev.recovery.correlated_cards_dropped, ["DRIFT.pullback_in_trend"], "the correlated card cannot inflate the quorum");
    assert.ok(ev.recovered.quorum.up + ev.recovered.quorum.down <= 1, "one real seat contributes at most one directional row");
    assert.equal(ev.candidates.some((c) => c.card_id === "WICK.not_in_roster"), false);
  }
});

test("stale or down source health cannot recover: the producer's own treatment is on the captured card", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  for (const health of ["STALE", "DOWN"]) {
    const snap = snapshot({ health: { ...snapshot().health, spot: health, spot_ok: health !== "DOWN" }, spot_age_s: 30 });
    const chair = m.runChair(m.runBots(snap, learner), snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
    const ev = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), realDeps(m));
    assert.deepEqual(ev.candidates, [], `${health}: no candidate`);
    assert.equal(ev.recovered.state, "WAIT", `${health}: nothing to hear`);
    assert.equal(ev.flags.funnel_stage, "observed");
    assert.equal(ev.economics.feeds_ok, false);
  }
});

test("Brier/EV suppression is honoured: the recovered twin carries the calibrated confidence, and a suppressed card cannot recover", async (t) => {
  const m = await modules(t);
  const snap = snapshot();
  const plain = shadowDrift(m);
  const plainChair = m.runChair(m.runBots(snap, plain), snap, plain, m.DEFAULT_SETTINGS, "WAIT", []);
  const plainEv = m.evaluateMidRecovery(inputFor(m, snap, plain, plainChair), realDeps(m));
  const raw = plainEv.candidates[0].calibrated_conf;
  assert.ok(raw >= 52, `the uncalibrated read speaks at ${raw}`);
  // A poorly calibrated card: Brier above 0.3 on a real sample scales the read down before the projection sees it.
  const poor = shadowDrift(m);
  Object.assign(poor.skills["DRIFT.aligned_3h"], { brier_n: 8, brier: 0.4 });
  const poorEv = m.evaluateMidRecovery(inputFor(m, snap, poor, plainChair), realDeps(m));
  const scaled = Math.round(raw * 0.85);
  assert.equal(poorEv.candidates[0].calibrated_conf, scaled, "the candidate carries the Brier-scaled confidence");
  assert.equal(poorEv.candidates[0].raw_conf, scaled, "there is no pre-calibration read on the captured card to restore");
  const projection = m.projectInactiveE1Recovery(m.runBotsWithEvaluatedCandidates(snap, poor), poor);
  assert.equal(projection.simulated.votes.find((v) => v.seat === "DRIFT").confidence, scaled, "the actual Chair hears the calibrated confidence, not the pre-calibration authority");
  assert.ok(poorEv.recovered.confidence <= plainEv.recovered.confidence);
  // Brier and negative EV together: below the whisper bar, the card is a forced sit and no candidate exists.
  const suppressed = shadowDrift(m);
  Object.assign(suppressed.skills["DRIFT.aligned_3h"], { brier_n: 8, brier: 0.4, ev_n: 8, ev: -1 });
  const supEv = m.evaluateMidRecovery(inputFor(m, snap, suppressed, plainChair), realDeps(m));
  assert.deepEqual(supEv.candidates, []);
  assert.equal(supEv.recovered.state, "WAIT");
});

test("clock-owned and in-window revision holds stay excluded from recovery", async (t) => {
  const m = await modules(t);
  const learner = m.freshLearner();
  const snap = snapshot();
  const chair = m.runChair(m.runBots(snap, learner), snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  const clockHeld = vote("STRIKE", "SIT", "WAIT", "SIT", { hypothesis: "clock-owned window" });
  const revisionHeld = vote("DRIFT", "SIT", "WAIT", "SIT", { hypothesis: "in-window path revision" });
  const frame = { version: "E1_RECOVERY_V1_INACTIVE", votes: [clockHeld, revisionHeld], evaluated: [vote("STRIKE", "STRIKE.itm_time", "UP"), vote("DRIFT", "DRIFT.aligned_3h", "UP")] };
  const ev = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), syntheticDeps(m, frame));
  assert.deepEqual(ev.candidates, []);
  assert.deepEqual(ev.recovery.held_seats, ["STRIKE", "DRIFT"]);
  assert.deepEqual(ev.recovery.correlated_cards_dropped, []);
});

test("the actual Chair still folds a same-family pair to one eligible representative under the projection", async (t) => {
  const m = await modules(t);
  const learner = m.freshLearner();
  const snap = snapshot();
  const chair = m.runChair(m.runBots(snap, learner), snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  const sit = (seat) => vote(seat, "SIT", "WAIT", "SIT");
  const frame = { version: "E1_RECOVERY_V1_INACTIVE", votes: [sit("CARRY"), sit("CHAIN")], evaluated: [vote("CARRY", "CARRY.trend_carry", "UP"), vote("CHAIN", "CHAIN.oi_with_price", "UP")] };
  const ev = m.evaluateMidRecovery(inputFor(m, snap, learner, chair), syntheticDeps(m, frame));
  assert.deepEqual(ev.candidates.map((c) => c.seat), ["CHAIN", "CARRY"], "frozen roster order");
  assert.ok(ev.candidates.filter((c) => c.survived_fold).length <= 1, "CARRY and CHAIN are one derivs group: the Chair keeps at most one representative");
  assert.ok(ev.candidates.some((c) => !c.survived_fold), "the correlated member is folded out");
  assert.ok(ev.recovered.supporters.length <= 1, "a folded pair cannot count as two supporters");
  assert.equal(ev.recovered.eligible, false);
});

// ---------------------------------------------------------------------------
// Part 2: the recorder.
// ---------------------------------------------------------------------------

function loader(deps = {}, globals = {}) {
  const cache = new Map();
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
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, Promise, Error, structuredClone, setInterval: () => 1, clearInterval: () => {}, globalThis: {}, console, process: { env: { ...globals.env } } });
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
const OBSERVER = "src/lib/desk/shadow-lab-mid-recovery.server.ts";
/** A fake database: records every statement, answers inserts as new rows, selects as empty. */
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
const engineFrame = (m, snap, learner, extra = {}) => {
  const votes = m.runBots(snap, learner);
  const chair = m.runChair(votes, snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  return { snap, votes, chair, learner, settings: { bar_override: null, adaptive_bar: true, mutes: [], beast: false }, call_log: [], selective: { ready: true, start: now - 3_600_000, audit: null }, ...extra };
};

test("the recorder is env-gated default OFF, kicked fire-and-forget by healthz, imported by nothing else, and reaches no production writer", () => {
  const load = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } }, { env: {} });
  const mod = load(OBSERVER);
  assert.equal(mod.ensureMidRecoveryObserver({}), "disabled");
  assert.equal(mod.ensureMidRecoveryObserver({ MID_RECOVERY_SHADOW_ENABLED: "TRUE" }), "disabled", "only the literal string true enables it");
  assert.equal(mod.ensureMidRecoveryObserver({ MID_RECOVERY_SHADOW_ENABLED: "1" }), "disabled");
  assert.equal(mod.midRecoveryHealth().enabled, false);
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/shadow-lab-mid-recovery\.server"\)\s*\.then\(\(m\) => m\.ensureMidRecoveryObserver\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  for (const f of walk("src/").concat(walk("server/"))) {
    if (f === "server/routes/healthz.get.ts" || f === "server/routes/research/mid-recovery.get.ts" || f.startsWith("src/lib/desk/shadow-lab-mid-recovery")) continue;
    assert.ok(!read(f).includes("shadow-lab-mid-recovery"), `${f} imports the experiment`);
  }
  const src = codeOf(OBSERVER);
  for (const forbidden of ["noteCall(", "applyDeskOp(", "promoteToLive", "setKnob", "reviewSeats", "desk_ledger", "desk_state", "desk_shadow_manifests", "activateInitialShadowCollection", "registerShadowManifests"]) {
    assert.ok(!src.includes(forbidden), `the recorder reaches ${forbidden}`);
  }
  assert.doesNotMatch(src, /\be\.learner\b/, "the recorder never reaches the engine's learner");
  const writes = [...src.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)].map((x) => x[1] || x[2] || x[3]);
  assert.deepEqual(writes, [], "the recorder owns no SQL writer: it goes through the shadow lab's append-only receipt writer and settle sweep");
  assert.match(src, /recordShadowReceipt\(/);
  assert.match(src, /settleShadowReceipts\(/);
  assert.match(src, /structuredClone\(\{\s*snap: frame\.snap, chair: frame\.chair, learner: frame\.learner, settings: frame\.settings, call_log: frame\.call_log \?\? \[\], audit: frame\.selective\.audit, start: frame\.selective\.start,?\s*\}\)/);
  assert.doesNotMatch(src, /frame\.(snap|chair|votes|learner|settings|selective|call_log)\s*=/);
  assert.match(src, /MID_RECOVERY_DEPS[\s\S]*Object\.freeze\(\{ runBotsWithEvaluatedCandidates, projectInactiveE1Recovery, runChair \}\)/, "the one downstream path is the merged one");
  assert.doesNotMatch(read("src/lib/desk/server-engine.ts"), /mid-recovery/);
  assert.doesNotMatch(read("src/lib/desk/bots.ts"), /mid-recovery/);
  assert.doesNotMatch(read("src/lib/desk/call-recovery-candidate.ts"), /mid-recovery/);
});

test("a failing database or frame is absorbed into the recorder's own health; an out-of-band frame writes nothing and is not mutated", async (t) => {
  const m = await modules(t);
  const learner = m.freshLearner();
  let frameReads = 0;
  const down = loader({ "@/lib/db": { getSql: async () => { throw new Error("db down"); } }, "./server-engine": { getServerFrame: async () => { frameReads += 1; return {}; } } }, { env: { MID_RECOVERY_SHADOW_ENABLED: "true" } });
  const m1 = down(OBSERVER);
  await assert.doesNotReject(m1.midRecoveryTick(now + 1));
  assert.equal(m1.midRecoveryHealth().error, "db down");
  assert.equal(frameReads, 0);
  const { sql, calls } = fakeSql();
  const boom = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => { throw new Error("frame boom"); } } }, { env: {} });
  const m2 = boom(OBSERVER);
  await assert.doesNotReject(m2.midRecoveryTick(now + 1));
  assert.equal(m2.midRecoveryHealth().error, "frame boom");
  const frame = engineFrame(m, snapshot({ close_time: now + 800_000 }), learner);
  const before = JSON.stringify(frame);
  const ok = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { env: {} });
  const m3 = ok(OBSERVER);
  await assert.doesNotReject(m3.midRecoveryTick(now + 1));
  assert.equal(m3.midRecoveryHealth().error, null);
  assert.equal(JSON.stringify(frame), before);
  assert.ok(calls.every((c) => /^\s*update desk_shadow_receipts/.test(c.text)), `only the settle sweep touched the database: ${calls.map((c) => c.text.slice(0, 40)).join(" | ")}`);
});

test("in band, the recorder writes only desk_shadow_receipts under its own experiment, idempotently, with the T-3 sit classified as a sit and every simulated fill stamped research-only", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const { sql, calls } = fakeSql();
  let frame = engineFrame(m, snapshot(), learner);
  const load = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { env: { MID_RECOVERY_SHADOW_ENABLED: "true" } });
  const mod = load(OBSERVER);
  const inserts = () => calls.filter((c) => /^\s*insert into desk_shadow_receipts/.test(c.text)).map((c) => ({ experiment: c.values[0], arm: c.values[1], ticker: c.values[2], kind: c.values[4], side: c.values[6], ask: c.values[7], payload: JSON.parse(c.values[18]) }));
  // T-7:00 (420 s): no checkpoint, the recovered read is directional but not eligible → nothing to write yet.
  await mod.midRecoveryTick(now + 1);
  assert.equal(mod.midRecoveryHealth().error, null, mod.midRecoveryHealth().error ?? "");
  assert.deepEqual(inserts(), []);
  const frameBefore = JSON.stringify(frame);
  // T-5:00 (300 s): NULL_FAV_80 fallback checkpoint; the 60¢ favourite is not eligible → its no_fill at 300.
  frame = engineFrame(m, snapshot({ as_of: now + 120_000 }), learner);
  await mod.midRecoveryTick(now + 120_001);
  let rows = inserts();
  assert.deepEqual(rows.map((r) => [r.experiment, r.arm, r.kind]), [["MID_RECOVERY_V1_INACTIVE", "NULL_FAV_80", "no_fill"]]);
  assert.equal(rows[0].payload.checkpoint, 300);
  // Same frame again: the idempotent key blocks a second write.
  await mod.midRecoveryTick(now + 120_002);
  assert.equal(inserts().length, 1);
  // T-3:01 (181 s): still in band, evaluated, nothing new to write.
  frame = engineFrame(m, snapshot({ as_of: now + 239_000 }), learner);
  await mod.midRecoveryTick(now + 239_001);
  assert.equal(inserts().length, 1);
  // T-2:59 (179 s): the poll crossed the cutoff; the receipt-only grace finalizes the window this session evaluated in band:
  // T-3 sits for BASELINE and RECOVERED_MID, classified as sits (checkpoint 180), carrying the last evaluation and the funnel stage reached.
  frame = engineFrame(m, snapshot({ as_of: now + 241_000 }), learner);
  await mod.midRecoveryTick(now + 241_001);
  rows = inserts();
  assert.deepEqual(rows.map((r) => [r.arm, r.kind]), [["NULL_FAV_80", "no_fill"], ["BASELINE", "no_fill"], ["RECOVERED_MID", "no_fill"]]);
  const rec = rows.find((r) => r.arm === "RECOVERED_MID");
  assert.equal(rec.payload.checkpoint, 180);
  assert.equal(rec.payload.receipt_only, true);
  assert.equal(rec.payload.funnel_stage, "directional");
  assert.equal(rec.payload.baseline.state, "WAIT");
  assert.equal(rec.payload.recovered.lean, "UP");
  assert.equal(rec.payload.simulated.booked, false);
  assert.equal(rec.payload.simulated.settlement, null);
  assert.equal("watch" in rec.payload.confirmation, false, "the in-memory latch is not persisted");
  assert.equal(typeof rec.payload.direction.reason, "string", "the terminal direction diagnosis is persisted");
  assert.ok(rec.payload.direction_best && typeof rec.payload.direction_best.reason === "string", "the best in-band tick's diagnosis rides the T-3 sit");
  assert.ok(Number.isFinite(rec.payload.direction_best_secs_left));
  assert.ok(rec.payload.direction_best.margin >= rec.payload.direction.margin || rec.payload.direction_best.reason === "DIRECTIONAL", "the best tick is never worse than the terminal tick");
  assert.ok(Object.keys(rec.payload).length >= 12);
  const base = rows.find((r) => r.arm === "BASELINE");
  assert.equal(base.payload.checkpoint, 180);
  assert.equal(base.payload.baseline.lean, "WAIT");
  assert.equal(base.payload.baseline.booked, null, "no production booking exists, so none is mirrored");
  assert.equal(JSON.stringify(engineFrame(m, snapshot(), learner)), frameBefore, "the engine frame the recorder reads is never changed");
  assert.ok(calls.every((c) => /^\s*(insert into desk_shadow_receipts|update desk_shadow_receipts|select[\s\S]*from desk_shadow_receipts)/.test(c.text)), `only the experiment's own receipts: ${calls.map((c) => c.text.slice(0, 40)).join(" | ")}`);
  assert.ok(rows.every((r) => r.experiment === "MID_RECOVERY_V1_INACTIVE" && r.ticker === "KXBTC15M-RECOVERY"));
  assert.equal(mod.midRecoveryHealth().written, 3);
  // A production booking in the paper log is mirrored as the BASELINE fill, never as a recovered fill.
  const { sql: sql2, calls: calls2 } = fakeSql();
  const booked = engineFrame(m, snapshot({ as_of: now + 60_000 }), learner, { call_log: [{ id: "p", t: now + 50_000, ticker: "KXBTC15M-RECOVERY", close_time: now + 420_000, lean: "DOWN", cents: 84, settle: null, flipped: false }] });
  const mod2 = loader({ "@/lib/db": { getSql: async () => sql2 }, "./server-engine": { getServerFrame: async () => booked } }, { env: { MID_RECOVERY_SHADOW_ENABLED: "true" } })(OBSERVER);
  await mod2.midRecoveryTick(now + 60_001);
  const mirrored = calls2.filter((c) => /^\s*insert into desk_shadow_receipts/.test(c.text)).map((c) => ({ arm: c.values[1], kind: c.values[4], side: c.values[6], ask: c.values[7], payload: JSON.parse(c.values[18]) }));
  assert.deepEqual(mirrored.map((r) => [r.arm, r.kind, r.side, r.ask]), [["BASELINE", "fill", "DOWN", 84]]);
  assert.equal(mirrored[0].payload.source, "production_call_log");
  assert.doesNotMatch(codeOf("src/lib/desk/shadow-lab.server.ts"), /desk_ledger\b(?!_research)/, "the settle sweep reads the official research ledger and writes only receipts");
  assert.match(read("src/lib/desk/shadow-lab.server.ts"), /on conflict \(experiment, arm, ticker, close_time, kind\) do nothing/);
});

test("a restart never back-fills the window already open at boot; a simulated fill is stamped and can only come from a confirmed, bookable, eligible read", async (t) => {
  const m = await modules(t);
  const learner = shadowDrift(m);
  const { sql, calls } = fakeSql();
  const frame = engineFrame(m, snapshot({ as_of: now + 240_000 }), learner);
  const load = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { env: { MID_RECOVERY_SHADOW_ENABLED: "true" } });
  const mod = load(OBSERVER);
  assert.equal(mod.ensureMidRecoveryObserver({ MID_RECOVERY_SHADOW_ENABLED: "true" }), "started");
  assert.equal(mod.ensureMidRecoveryObserver({ MID_RECOVERY_SHADOW_ENABLED: "true" }), "already");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.filter((c) => /insert into/.test(c.text)).length, 0, "the market open at boot is skipped");
  const src = codeOf(OBSERVER);
  assert.match(src, /if \(st\.sessionStartedAt > 0 && windowOpen < st\.sessionStartedAt\) return;/);
  assert.match(src, /if \(ev\.simulated\.booked && side && q\) \{\s*once\(receipt\(ARMS\.recovered, snap, "fill"/);
  assert.match(src, /simulated: true, authority: MID_RECOVERY_EXPERIMENT\.authority/);
  const pure = codeOf("src/lib/desk/shadow-lab-mid-recovery.ts");
  assert.match(pure, /const qualified = eligible && confirmed && side != null && !hasPaperPosition\(ctx\.calls, snap\);/);
  assert.match(pure, /const booked = qualified && bookable\(ask\);/);
  assert.match(pure, /settlement: null, win: null, net_cents: null/);
});
