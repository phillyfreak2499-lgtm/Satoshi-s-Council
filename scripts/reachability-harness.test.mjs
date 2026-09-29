/**
 * REACHABILITY-A harness tests.
 *
 * What these prove and what they do not:
 *  - Every vote comes from the real runBots on a Snapshot; the Chair, entry mode,
 *    confirmation latch and noteCall are the production functions; persistence
 *    is the in-memory PGlite. No bar_override, no manufactured votes, no boosted
 *    authority.
 *  - The roster fixture copies the SHAPE of Grok CURRENT-STATE-A Q2 (captured
 *    2026-09-29T04:14Z: only DRIFT.aligned_3h, INDEX.settle_fair and
 *    INDEX.locked_avg are LIVE directional cards). The market frames are
 *    SYNTHETIC. So the witness below is a MECHANICAL reachability witness for
 *    that roster shape — not current-state evidence and not an economic result.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

if (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim()) {
  throw new Error("reachability harness refuses nonempty DATABASE_URL before Vite or database startup");
}

const HARNESS = fileURLToPath(new URL("./reachability-harness.mjs", import.meta.url));
const ENGINE = fileURLToPath(new URL("../src/lib/desk/server-engine.ts", import.meta.url));

let vite;
let mods;
async function setup() {
  if (vite) return mods;
  const { createServer } = await import("vite");
  vite = await createServer({ envDir: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
  const [harness, skills, demo, authority, floor] = await Promise.all([
    import(HARNESS),
    vite.ssrLoadModule("/src/lib/desk/skills.ts"),
    vite.ssrLoadModule("/src/lib/desk/demo.ts"),
    vite.ssrLoadModule("/src/lib/desk/council-authority.ts"),
    vite.ssrLoadModule("/src/lib/desk/floor-policy.ts"),
  ]);
  mods = { harness, skills, demo, authority, floor };
  return mods;
}
test.after(async () => { if (vite) await vite.close(); });

const REGIME = "ASIA_FINAL";
const LIVE_DIRECTIONAL = ["DRIFT.aligned_3h", "INDEX.settle_fair", "INDEX.locked_avg"];

/** Learner with the Q2 LIVE/SHADOW shape. Nothing is lowered: seed gates (min_regime_n 24) stay. */
function rosterLearner(m, { indexPocketN = 30, driftSeatN = 300, indexSeatN = 300 } = {}) {
  const L = m.skills.freshLearner();
  for (const c of Object.values(L.skills)) {
    if (["ORBIT", "WARDEN", "WIRE"].includes(c.owner)) continue;
    c.status = LIVE_DIRECTIONAL.includes(c.id) ? "LIVE" : "SHADOW";
  }
  for (const id of m.authority.CLOSED_DIRECTIONAL_CARDS) if (L.skills[id]) L.skills[id].status = "BENCH";
  Object.assign(L.skills["DRIFT.aligned_3h"], { n: 186, ev_n: 186, hits: 182, wilson: 0.979764, ev: 1.1237 });
  Object.assign(L.skills["INDEX.settle_fair"], { n: 197, ev_n: 197, hits: 192, wilson: 0.963745, ev: 5.8579, pocket: { [REGIME]: { n: indexPocketN, hits: indexPocketN } } });
  Object.assign(L.skills["INDEX.locked_avg"], { n: 167, ev_n: 167, hits: 163, wilson: 0.966865, ev: 6.3892, pocket: { [REGIME]: { n: indexPocketN, hits: indexPocketN } } });
  L.learn_phase = "EXPLOIT";
  L.authority_review_version = m.authority.AUTHORITY_REVIEW_V1;
  L.seat_n.DRIFT = driftSeatN;
  L.seat_n.INDEX = indexSeatN;
  L.last_regime = REGIME;
  return L;
}

const CLOSE = Date.parse("2026-09-29T04:30:00Z"); // KXBTC15M-26SEP290030-30 closes 00:30 ET = 04:30Z
const TICKER = "KXBTC15M-26SEP290030-30";
const BUILD = "34bda5ff203d419ffc35d5f214bae8206835ec9f";

/** SYNTHETIC frames on the demo generator's complete Snapshot. Default: 4 frames from 6 min left, 4 s apart. */
function frames(m, learner, { ret15 = 0.006, labFair = 92, count = 4, stepMs = 4_000, startSecsLeft = 360, ticker = TICKER, close = CLOSE, build = BUILD } = {}) {
  const base = m.demo.demoTick(m.demo.newDemoWindow(structuredClone(learner.window_memory), 360_000), structuredClone(learner.window_memory));
  const out = [];
  for (let i = 0; i < count; i++) {
    const as_of = close - startSecsLeft * 1000 + i * stepMs;
    out.push({ build_sha: build, snap: {
      ...base, as_of, close_time: close, ticker, mins_left: (close - as_of) / 60_000, secs_left: (close - as_of) / 1000,
      phase: "MID", regime_key: REGIME, session: "ASIA", demo: false, chalk: false,
      yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, yes_mid: 84.5, yes_bid_size: 50, no_bid_size: 50,
      edge_up: 6, edge_down: -8, fair_yes: 92, fee_yes: 1, fee_no: 1, spread_cents: 1, leftover_cents: 1, combined_ask_cents: 101,
      lab_fair_yes: labFair, lab_age_s: 1, lab_locked: 0,
      spot: 80_400, strike: 80_000, spot_age_s: 1, quote_age_s: 1, print_age_s: 1, quote_seq: i + 1,
      obs: { ...(base.obs ?? {}), receipt_ts: as_of - 1000, gap: "ok" },
      health: { ...(base.health ?? {}), spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
      ret5: 0.002, ret15, ret30: 0.008, ret1h: 0.01, atr_pct: 0.25, vol_percentile: 50,
    } });
  }
  return out;
}

const SETTINGS = { adaptive_bar: true, bar_override: null, mutes: [], beast: false };

function state(m, learner, extra = {}) {
  return { learner, settings: SETTINGS, risk_calls: [], call_log: [], risk_history_valid: true,
    selective_policy: m.floor.SELECTIVE_ENTRY_ID, selective_start: Date.parse("2026-09-29T04:00:00Z"), ...extra };
}

/** Explicitly SYNTHETIC input: the harness must never turn it into a current-state verdict. */
function synthetic(m, learner, fr, extraState = {}) {
  return { schema: "REACHABILITY_A_INPUT_V2", mode: "mechanical", risk_provenance: "unavailable",
    source: { kind: "synthetic", captured_at: "2026-09-29T04:21:00Z", build_sha: BUILD, note: "synthetic test fixture" },
    state: state(m, learner, extraState), frames: fr };
}

/**
 * Classification-logic fixture: the SAME synthetic data dressed with complete
 * primary-looking provenance, used only to test that the verdict gate opens when
 * (and only when) every current-state requirement holds.
 */
function primaryShaped(m, learner, fr, { stateExtra = {}, source = {}, risk = "primary_desk_state", windowStates } = {}) {
  return { schema: "REACHABILITY_A_INPUT_V2", mode: "current_state", risk_provenance: risk,
    source: { kind: "desk_state_row", captured_at: "2026-09-29T04:19:00Z", build_sha: BUILD, note: "classification-logic fixture", ...source },
    state: state(m, learner, stateExtra), frames: fr, ...(windowStates ? { window_states: windowStates } : {}) };
}

/** Record production outputs by replaying once, then attach them as the frames' recorded votes/chair. */
async function withRecorded(m, input) {
  const first = await m.harness.runReachability({ ...input, mode: "mechanical" }, vite, { includeReplayOutputs: true });
  const byAsOf = new Map(first.frames.map((r) => [r.as_of, r]));
  return { ...input, frames: input.frames.map((f) => {
    const r = byAsOf.get(f.snap.as_of);
    return r ? { ...f, votes: r.replay_votes, chair: r.replay_chair } : f;
  }) };
}

test("structural: Q2-shaped roster has exactly one admissible coalition (DRIFT candle + INDEX book); tight mode is impossible", async () => {
  const m = await setup();
  const res = await m.harness.runReachability(synthetic(m, rosterLearner(m), []), vite);
  assert.equal(res.status, "OK");
  assert.equal(res.evidence_class, "SYNTHETIC");
  assert.equal(res.verdict, "NOT_APPLICABLE");
  const r = res.structural.regimes.find((x) => x.regime === REGIME);
  assert.deepEqual([...r.supporters_possible].sort(), ["DRIFT", "INDEX"]);
  assert.deepEqual([...r.families_possible].sort(), ["book", "candle"]);
  assert.equal(r.normal.possible, true);
  assert.equal(r.tight.possible, false, "four supporters from three families cannot exist with two eligible seats");
  const locked = r.cards.find((c) => c.card_id === "INDEX.locked_avg");
  assert.equal(locked.timing, "final_minute_only");
  assert.equal(locked.eligible_in_band, false);
  assert.equal(res.mechanical.result, "NO_BOOKING");
});

test("structural: INDEX regime hold (pocket < 24) or an uncalibrated seat leaves one family", async () => {
  const m = await setup();
  const held = await m.harness.runReachability(synthetic(m, rosterLearner(m, { indexPocketN: 10 }), []), vite);
  const r1 = held.structural.regimes.find((x) => x.regime === REGIME);
  assert.deepEqual(r1.supporters_possible, ["DRIFT"]);
  assert.equal(r1.verdict, "STRUCTURALLY_BLOCKED");
  assert.equal(held.mechanical.result, "STRUCTURALLY_BLOCKED");
  assert.equal(held.verdict, "NOT_APPLICABLE", "synthetic input never yields a current-state verdict");
  const uncal = await m.harness.runReachability(synthetic(m, rosterLearner(m, { driftSeatN: 5 }), []), vite);
  const r2 = uncal.structural.regimes.find((x) => x.regime === REGIME);
  assert.deepEqual(r2.supporters_possible, ["INDEX"]);
  assert.match(r2.seats.find((s) => s.seat === "DRIFT").blockers.join(" "), /UNCALIBRATED/);
});

test("SYNTHETIC replay: real runBots → Chair → entry mode → confirmation → noteCall books once after 3 frames / 8 s; labelled synthetic, no witness", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const inp = synthetic(m, L, frames(m, L));
  const before = JSON.stringify(inp.state);
  const res = await m.harness.runReachability(inp, vite);
  assert.equal(res.evidence_class, "SYNTHETIC");
  assert.equal(res.verdict, "NOT_APPLICABLE");
  assert.equal(res.witness, null, "a synthetic booking is never a witness");
  assert.equal(res.mechanical.result, "BOOKED");
  assert.equal(JSON.stringify(inp.state), before, "the input state is never mutated");
  assert.deepEqual(res.frames.map((f) => f.stage), ["awaiting_confirmation", "awaiting_confirmation", "booked", "already_positioned"]);
  assert.deepEqual(res.frames[0].heard_directional.map((d) => `${d.seat}:${d.card}`).sort(), ["DRIFT:DRIFT.aligned_3h", "INDEX:INDEX.settle_fair"]);
  assert.equal(res.mechanical.booking.as_of, res.frames[0].as_of + 8_000);
});

test("SYNTHETIC contradiction: |ret15| 0.30% is below DRIFT's speak bar (≈0.412% in MID) — one family heard, no booking", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const res = await m.harness.runReachability(synthetic(m, L, frames(m, L, { ret15: 0.003 })), vite);
  assert.equal(res.mechanical.result, "NO_BOOKING");
  for (const f of res.frames) {
    assert.equal(f.stage, "heard_below_quorum");
    assert.deepEqual(f.heard_directional.map((d) => d.seat), ["INDEX"]);
    assert.match(f.forced_sit_reasons.DRIFT ?? "", /sit \(\d+ < 52 conf\)/);
  }
  assert.ok(Math.abs(res.structural.drift_speak_floor.MID - 0.00412) < 0.0001);
});

test("SYNTHETIC contradiction: settlement-index fair 86 at an 85¢ ask is under INDEX's 3¢ edge — no booking", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const res = await m.harness.runReachability(synthetic(m, L, frames(m, L, { labFair: 86 })), vite);
  assert.equal(res.mechanical.result, "NO_BOOKING");
  for (const f of res.frames) assert.deepEqual(f.heard_directional.map((d) => d.seat), ["DRIFT"]);
});

// Frames from 620 s left: coverage starts before the band, booking at 592 s.
const COVERED = { startSecsLeft: 620, count: 9 };

test("classification: every current-state requirement met + parity-clean recorded frames → REACHABLE (gate logic only)", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const res = await m.harness.runReachability(await withRecorded(m, primaryShaped(m, L, frames(m, L, COVERED))), vite);
  assert.equal(res.evidence_class, "CURRENT_STATE");
  assert.equal(res.verdict, "REACHABLE", res.verdict_basis);
  assert.equal(res.witness.secs_left, 592);
  assert.deepEqual(res.windows[0].diagnostic_reasons, []);
  assert.equal(res.windows[0].parity_mismatch_frames, 0);
});

test("fail closed: missing settings, build, policy/start or primary risk each block a current-state claim even though replay books", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const cases = [
    ["settings", { stateExtra: { settings: {} } }, /UNRECONSTRUCTABLE settings/],
    ["build", { source: { build_sha: null } }, /UNRECONSTRUCTABLE build/],
    ["policy", { stateExtra: { selective_policy: undefined } }, /UNRECONSTRUCTABLE admission/],
    ["start", { stateExtra: { selective_start: undefined } }, /selective_start absent/],
    ["risk provenance", { risk: "unavailable" }, /UNRECONSTRUCTABLE risk history/],
    ["risk array", { stateExtra: { risk_calls: null } }, /state.risk_calls is not the persisted array/],
    ["risk readiness", { stateExtra: { risk_history_valid: null } }, /risk_history_valid/],
    ["public frame source", { source: { kind: "public_frame_poll" } }, /not a primary desk_state row/],
  ];
  for (const [name, opt, re] of cases) {
    const res = await m.harness.runReachability(await withRecorded(m, primaryShaped(m, L, frames(m, L, COVERED), opt)), vite);
    assert.equal(res.evidence_class, "MECHANICAL_ONLY", name);
    assert.equal(res.verdict, "UNDETERMINED", name);
    assert.equal(res.witness, null, name);
    assert.match(res.verdict_basis, re, name);
  }
});

test("fail closed: current-state mode never substitutes a missing selective_start; mechanical mode does and says so", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const cur = await m.harness.runReachability(primaryShaped(m, L, frames(m, L), { stateExtra: { selective_start: undefined, selective_policy: undefined } }), vite);
  assert.equal(cur.mechanical.result, "NO_BOOKING", "boot default start refuses the recorded window");
  assert.ok(cur.harness_notes.some((n) => /boot default kept/.test(n)));
  const mech = await m.harness.runReachability(synthetic(m, L, frames(m, L), { selective_start: undefined, selective_policy: undefined }), vite);
  assert.equal(mech.mechanical.result, "BOOKED");
  assert.ok(mech.harness_notes.some((n) => /MECHANICAL substitution/.test(n)));
});

test("parity: a recorded Chair that did not go directional downgrades the booking to DIAGNOSTIC", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const rec = await withRecorded(m, primaryShaped(m, L, frames(m, L, COVERED)));
  rec.frames = rec.frames.map((f) => ({ ...f, chair: { lean: "WAIT" } }));
  const res = await m.harness.runReachability(rec, vite);
  assert.equal(res.mechanical.result, "BOOKED");
  assert.equal(res.verdict, "UNDETERMINED");
  assert.equal(res.witness, null);
  assert.match(res.verdict_basis, /differs from recorded production/);
});

test("parity: frames without recorded production votes/chair cannot witness", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const res = await m.harness.runReachability(primaryShaped(m, L, frames(m, L, COVERED)), vite);
  assert.equal(res.verdict, "UNDETERMINED");
  assert.match(res.verdict_basis, /lack recorded production votes\/chair/);
});

test("continuity: coverage starting inside the band, a >10 s gap, or a build change each downgrade", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const late = await m.harness.runReachability(await withRecorded(m, primaryShaped(m, L, frames(m, L))), vite);
  assert.match(late.verdict_basis, /coverage starts inside the entry band/);
  const long = frames(m, L, { startSecsLeft: 640, count: 14 });
  const holed = [long[0], ...long.slice(5)]; // 640 s → 620 s: a 20 s hole before the band; booking still at 592 s
  const gappy = await m.harness.runReachability(await withRecorded(m, primaryShaped(m, L, holed)), vite);
  assert.equal(gappy.mechanical.result, "BOOKED");
  assert.equal(gappy.verdict, "UNDETERMINED");
  assert.match(gappy.verdict_basis, /exceeds the 10s latch limit/);
  const mixed = frames(m, L, COVERED);
  mixed[7] = { ...mixed[7], build_sha: "0".repeat(40) };
  const built = await m.harness.runReachability(await withRecorded(m, primaryShaped(m, L, mixed)), vite);
  assert.match(built.verdict_basis, /differ from source.build_sha/);
});

test("identity: a stale-rollover frame (previous ticker, this close) is excluded and marks the window incomplete", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const fr = frames(m, L, COVERED);
  // Mirrors the lead's tape row: old ticker KXBTC15M-26SEP290015-15 paired with close 04:30Z.
  const stale = { ...fr[1], snap: { ...fr[1].snap, ticker: "KXBTC15M-26SEP290015-15", as_of: fr[1].snap.as_of + 1 } };
  const withStale = [fr[0], fr[1], stale, ...fr.slice(2)];
  const res = await m.harness.runReachability(await withRecorded(m, primaryShaped(m, L, withStale)), vite);
  assert.equal(res.identity_rejected_frames.length, 1);
  assert.equal(res.identity_rejected_frames[0].reason, "TICKER_CLOSE_TIME_MISMATCH");
  assert.ok(res.frames.every((f) => f.ticker === TICKER), "the mismatched frame is never replayed");
  assert.equal(res.verdict, "UNDETERMINED");
  assert.match(res.verdict_basis, /identity-incomplete/);
});

test("per-window state fidelity: a later window is DIAGNOSTIC unless its primary state is supplied", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const close2 = CLOSE + 900_000;
  const ticker2 = "KXBTC15M-26SEP290045-45";
  const quiet = frames(m, L, { ...COVERED, ret15: 0.003 }); // window 1: no booking
  const second = frames(m, L, { ...COVERED, ticker: ticker2, close: close2 });
  const base = primaryShaped(m, L, [...quiet, ...second]);
  const without = await m.harness.runReachability(await withRecorded(m, base), vite);
  assert.equal(without.mechanical.result, "BOOKED");
  assert.equal(without.verdict, "UNDETERMINED");
  assert.match(without.verdict_basis, /no per-window primary state/);
  const withState = await m.harness.runReachability(await withRecorded(m,
    primaryShaped(m, L, [...quiet, ...second], { windowStates: { [`${ticker2}|${close2}`]: state(m, rosterLearner(m)) } })), vite);
  assert.equal(withState.verdict, "REACHABLE", withState.verdict_basis);
  assert.equal(withState.windows[1].state_fidelity, "window_state");
});

test("witness selection: a diagnostic early booking does not hide a later eligible booking", async () => {
  const m = await setup();
  const L = rosterLearner(m);
  const close2 = CLOSE + 900_000;
  const ticker2 = "KXBTC15M-26SEP290045-45";
  const first = frames(m, L, COVERED);
  const second = frames(m, L, { ...COVERED, ticker: ticker2, close: close2 });
  const key2 = `${ticker2}|${close2}`;
  const recorded = await withRecorded(m,
    primaryShaped(m, L, [...first, ...second], { windowStates: { [key2]: state(m, rosterLearner(m)) } }));
  recorded.frames = recorded.frames.map((f) =>
    f.snap.close_time === CLOSE ? { ...f, chair: { lean: "WAIT" } } : f);
  const res = await m.harness.runReachability(recorded, vite);
  assert.equal(res.mechanical.result, "BOOKED");
  assert.equal(res.windows[0].diagnostic_reasons.length > 0, true);
  assert.deepEqual(res.windows[1].diagnostic_reasons, []);
  assert.equal(res.verdict, "REACHABLE", res.verdict_basis);
  assert.equal(res.witness.ticker, ticker2);
});

test("capture rail: /frame capture records risk history as unavailable, never as an empty array", () => {
  const src = readFileSync(fileURLToPath(new URL("./reachability-capture.mjs", import.meta.url)), "utf8");
  assert.match(src, /risk_calls: null/);
  assert.match(src, /riskProvenance = "unavailable"/);
  assert.doesNotMatch(src, /risk_calls: \[\]/);
});

test("missing inputs fail with explicit diagnostics, never a verdict", async () => {
  const m = await setup();
  const res = await m.harness.runReachability({ schema: "REACHABILITY_A_INPUT_V2", source: { kind: "other", captured_at: "x" }, state: { learner: {} }, frames: [{ snap: { as_of: 1 } }] }, vite);
  assert.equal(res.status, "MISSING_INPUTS");
  assert.ok(res.missing.includes("state.learner.skills"));
  assert.ok(res.missing.some((x) => x.startsWith("mode")));
  assert.ok(res.missing.some((x) => x.startsWith("risk_provenance")));
  assert.ok(res.missing.some((x) => x.startsWith("frames[0].snap.")));
});

test("rail: the harness replays tick's decision calls in tick's order", () => {
  const src = readFileSync(ENGINE, "utf8");
  const tick = src.slice(src.indexOf("async function tick(e: Eng)"), src.indexOf("function notePathParity"));
  const order = [
    "stickyVotes(e, runBots(snap, e.learner), snap)", "onLean(e.learner, v.seat, v.lean, snap)",
    "decideChair(e, votes, snap, lastSide(e, snap))", "noteUnfilteredCall(e, snap, rawChair)",
    "applyEntryMode(e, snap, rawChair)", "onLean(e.learner, CHAIR_SCALP, chair.lean, snap)", "await noteCall(e, snap, chair, votes)",
  ];
  let at = -1;
  for (const s of order) { const i = tick.indexOf(s, at + 1); assert.ok(i > at, `tick order changed at: ${s}`); at = i; }
  const h = readFileSync(HARNESS, "utf8");
  const horder = ["m.T.stickyVotes(e, m.runBots(snap, e.learner), snap)", "m.onLean(e.learner, v.seat, v.lean, snap)",
    "m.T.decideChair(e, votes, snap, m.T.lastSide(e, snap))", "m.T.noteUnfilteredCall(e, snap, rawChair)",
    "m.T.applyEntryMode(e, snap, rawChair)", "m.onLean(e.learner, m.CHAIR_SCALP, chair.lean, snap)", "await m.T.noteCall(e, snap, chair, votes)"];
  at = -1;
  for (const s of horder) { const i = h.indexOf(s, at + 1); assert.ok(i > at, `harness order drifted at: ${s}`); at = i; }
});

test("harness refuses DATABASE_URL before Vite or SQL startup", () => {
  const env = { ...process.env, DATABASE_URL: "postgresql://dummy.invalid/never-connect" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, [HARNESS, "--input", "/nonexistent.json"], { env, encoding: "utf8", timeout: 30_000 });
  assert.notEqual(child.status, 0);
  assert.match(`${child.stdout}\n${child.stderr}`, /refuses nonempty DATABASE_URL before Vite or database startup/);
  assert.doesNotMatch(`${child.stdout}\n${child.stderr}`, /ECONN|ENOTFOUND|connection refused/i);
});
