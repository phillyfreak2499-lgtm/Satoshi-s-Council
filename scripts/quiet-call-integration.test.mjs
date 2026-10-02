// QUIET_CALL_LEDGER_V1 — integration tests (spec rev 3 §11, items 28–47).
//
// SYNTHETIC fixtures, authority NONE. The real gradeWindow, runHuddle, applyGrade,
// persistState/loadState and the real migrations run here, on the disposable
// in-memory PGlite backend (DATABASE_URL is refused, like the REACHABILITY-A
// harness). Nothing here is evidence about the live desk.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

if (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim()) {
  throw new Error("quiet-call integration refuses nonempty DATABASE_URL before Vite or database startup");
}
delete process.env.QUIET_CALL_V1_ENABLED;

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

let vite;
let M;
async function load() {
  if (M) return M;
  const { createServer } = await import("vite");
  vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const names = ["server-engine", "learner", "quiet-call", "skills", "types", "bots", "book-floor"];
  const mods = await Promise.all(names.map((n) => vite.ssrLoadModule(`/src/lib/desk/${n}.ts`)));
  const db = await vite.ssrLoadModule("/src/lib/db.ts");
  assert.equal(db.dbSource, "pglite", "integration SQL must use the disposable PGlite backend");
  const [engine, learner, q, skills, types, bots, floor] = mods;
  M = { engine, learner, q, skills, types, bots, floor, db, h: engine.__quietIntegration, tick: engine.__tickIntegration };
  return M;
}
test.after(async () => { delete process.env.QUIET_CALL_V1_ENABLED; await vite?.close(); });

const on = () => { process.env.QUIET_CALL_V1_ENABLED = "true"; };
const off = () => { delete process.env.QUIET_CALL_V1_ENABLED; };
const clone = (x) => structuredClone(x);
const BASE = Date.parse("2026-10-05T14:00:00Z");
let seq = 0;
/** A fresh, unique 15-minute window. */
function win(i = seq++) {
  const close = BASE + i * 900_000;
  return { close, ticker: `KXBTC15M-QUIET-${i}` };
}

function snap(w, minsLeft, over = {}) {
  const asOf = w.close - Math.round(minsLeft * 60_000);
  return {
    as_of: asOf, close_time: w.close, ticker: w.ticker, mins_left: minsLeft, secs_left: minsLeft * 60,
    phase: "MID", kalshi_host: "", kalshi_trade_n: 0, kalshi_taker_yes: 0, official_settles: [],
    spot: 80_100, spot_source: "x", strike: 80_000, spot_age_s: 1, quote_age_s: 1, print_age_s: 1, quote_seq: 1,
    yes_ask: 55, yes_bid: 53, no_ask: 47, no_bid: 45, yes_mid: 54, yes_mid_path: [50, 51, 52, 52, 53, 54], spread_cents: 2,
    yes_bid_size: 5, no_bid_size: 5, leftover_cents: 2, combined_ask_cents: 102, chalk: false,
    edge_up: 1, edge_down: -1, fair_yes: 56, lab_fair_yes: 56, lab_age_s: 1, fee_yes: 2, fee_no: 2,
    obs: { receipt_ts: asOf - 1000, gap: "ok", last_ok_ts: asOf - 1000 },
    health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
    regime_key: "US_AM_MID", clock_key: "US_AM_1", session: "US_AM", demo: false,
    ret5: 0.001, ret15: 0.002, ret30: 0.002, ret1h: 0.004, atr: 40, atr_pct: 0.15,
    vol_median: 1, vol_last: 1, vol_percentile: 50, location: "MID", range_pos: 0.5,
    imbalance: 0.2, imbalance_hist: [], candles_1m: [], candles_5m: [], window_memory: { prior_settles: [] },
    funding_rate: 0, funding_apr: 0, funding_time: asOf, funding_history: [], funding_series: [],
    open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [],
    oi_delta_3m: 0, oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0,
    liq_long_usd: 0, liq_short_usd: 0, liq_n: 0, liq_source: "DOWN", force_n: 0, cascade_proxy: false,
    fear_greed: 50, fear_greed_label: "Neutral", fng_history: [], spot_lead_bps: 2,
    basis_bps: 0, perp: 80_100, perp_source: "x",
    ...over,
  };
}

/** SYNTHETIC votes: a mix of spoken, gagged, paper-only and silent seats. */
function votesFor(SEAT_IDS, k = 0) {
  return SEAT_IDS.map((seat, i) => {
    const kind = (i + k) % 4;
    const base = {
      seat, lean: "WAIT", confidence: 0, features: {}, reasoning: "SYNTHETIC", skill_used: "SIT", skill_status: "SIT",
      shadow: null, paper: [], thresh_used: [], skill_n: 0, skill_hits: 0, skill_wilson: 0, hypothesis: "", evidence: [],
      counter: "", invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID", raw_lean: "WAIT", raw_conf: 0,
    };
    if (seat === "WARDEN") return base;
    if (kind === 0) return { ...base, lean: "UP", confidence: 60, raw_lean: "UP", raw_conf: 60, skill_used: `${seat}.x`, skill_status: "LIVE" };
    if (kind === 1) return { ...base, lean: "WAIT", forced_sit: true, confidence: 70, raw_lean: "DOWN", raw_conf: 51 };
    if (kind === 2) return { ...base, paper: [{ id: `${seat}.p`, lean: "UP", confidence: 57, status: "SHADOW" }] };
    return base;
  });
}

function chairOf(lean = "WAIT", confidence = 0) {
  return { lean, confidence, score: 0, bar: 0.6, sit_mass: 1, rows: [], gates: [] };
}

function engineFor(m) {
  const e = m.h.freshEng();
  e.riskReady = true;
  return e;
}

async function rowsOf(m, ticker) {
  const sql = await m.db.getSql();
  return sql`select * from desk_quiet_calls where ticker = ${ticker} order by seat`;
}
async function windowRow(m, ticker) {
  const sql = await m.db.getSql();
  return (await sql`select * from desk_quiet_windows where ticker = ${ticker}`)[0] ?? null;
}
async function waitFor(fn, label, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
/** Arm an engine (first enabled tick on a prior window) so the next window captures. */
function arm(m, e) {
  const w0 = win();
  m.h.noteQuietCapture(e, snap(w0, 11.5), votesFor(m.types.SEAT_IDS));
  return w0;
}
function captureFor(m, w, L, k = 0) {
  return m.q.buildCapture(snap(w, 11.5), votesFor(m.types.SEAT_IDS, k), L, [], "test-sha");
}

// ---------------------------------------------------------------- gradeWindow

test("#28 gradeWindow invariance (core rail): with vs without quiet → identical learner and line, 50 windows", async () => {
  const m = await load();
  let A = m.skills.freshLearner();
  let B = m.skills.freshLearner();
  const book = m.q.freshQuietBook(1);
  for (let i = 0; i < 50; i++) {
    const w = win();
    const chalk = i % 7 === 3;
    const s = snap(w, 0.05, chalk ? { chalk: true, yes_ask: 99, no_ask: 2 } : { yes_ask: 90 + (i % 5), no_ask: 11 - (i % 5) });
    const votes = votesFor(m.types.SEAT_IDS, i);
    const chair = i % 3 === 0 ? chairOf("WAIT") : chairOf(i % 2 ? "UP" : "DOWN", 64);
    const finish = i % 4 === 1 ? "DOWN" : "UP";
    const capture = captureFor(m, w, B, i);
    const a = m.learner.gradeWindow(A, clone(s), clone(votes), clone(chair), finish);
    const b = m.learner.gradeWindow(B, clone(s), clone(votes), clone(chair), finish, { book, capture });
    assert.equal(b.line, a.line, `window ${i} line`);
    assert.deepEqual(b.learner, a.learner, `window ${i} learner`);
    A = a.learner; B = b.learner;
  }
  assert.ok(book.graded_windows > 0 && book.skipped.chalk > 0);
});

test("#29 gradeWindow credits the book: +1 graded window, +1 n per seat", async () => {
  const m = await load();
  const L = m.skills.freshLearner();
  const book = m.q.freshQuietBook(1);
  const w = win();
  const input = { book, capture: captureFor(m, w, L) };
  m.learner.gradeWindow(L, snap(w, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "UP", input);
  assert.equal(book.graded_windows, 1);
  for (const s of m.q.QUIET_SEATS) assert.equal(book.seats[s].all.n, 1, s);
  assert.equal(input.result.status, "GRADED");
  assert.equal(input.result.rows.length, 20);
});

test("#30 chalk path: early return marks SKIPPED_CHALK, credits nothing, learner matches baseline", async () => {
  const m = await load();
  const A = m.skills.freshLearner();
  const B = m.skills.freshLearner();
  const book = m.q.freshQuietBook(1);
  const w = win();
  const s = snap(w, 0.05, { chalk: true });
  const input = { book, capture: captureFor(m, w, B) };
  const a = m.learner.gradeWindow(A, clone(s), votesFor(m.types.SEAT_IDS), chairOf(), "UP");
  const b = m.learner.gradeWindow(B, clone(s), votesFor(m.types.SEAT_IDS), chairOf(), "UP", input);
  assert.deepEqual(b.learner, a.learner);
  assert.equal(input.result.status, "SKIPPED_CHALK");
  assert.equal(book.skipped.chalk, 1);
  assert.equal(book.graded_windows, 0);
  assert.equal(book.seats.DRIFT.all.n, 0);
});

test("#32 identity guard: a capture for another close → SKIPPED_IDENTITY, no credit", async () => {
  const m = await load();
  const L = m.skills.freshLearner();
  const book = m.q.freshQuietBook(1);
  const w = win();
  const other = { ...w, close: w.close + 900_000 };
  const input = { book, capture: captureFor(m, other, L) };
  m.learner.gradeWindow(L, snap(w, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "UP", input);
  assert.equal(input.result.status, "SKIPPED_IDENTITY");
  assert.equal(book.skipped.identity, 1);
  assert.equal(book.graded_windows, 0);
});

// ---------------------------------------------------------------- engine: applyGrade

test("#31 uncountable window: applyGrade skips gradeWindow (existing rule) and marks SKIPPED_UNCOUNTABLE", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    const w0 = { close: Date.parse("2026-09-10T07:45:00.000Z"), ticker: "KXBTC15M-QUIET-Q0" };
    m.h.noteQuietCapture(e, snap(w0, 11.5), votesFor(m.types.SEAT_IDS)); // arms
    const w = { close: Date.parse("2026-09-10T08:00:00.000Z"), ticker: "KXBTC15M-QUIET-Q1" }; // quarantined block
    m.h.noteQuietCapture(e, snap(w, 11.5), votesFor(m.types.SEAT_IDS));
    assert.ok(e.quietCaptures[`${w.ticker}:${w.close}`], "captured");
    const before = clone(e.learner);
    const s = snap(w, 0.05);
    await m.h.applyGrade(e, s, votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    assert.equal(e.learner.graded_windows, before.graded_windows, "learner not taught (existing S2-9 gate)");
    assert.equal(e.quietBook.skipped.uncountable, 1);
    assert.equal(e.quietBook.graded_windows, 0);
    assert.equal(e.quietCaptures[`${w.ticker}:${w.close}`], undefined);
    await waitFor(async () => (await rowsOf(m, w.ticker)).every((r) => r.grade_status === "SKIPPED_UNCOUNTABLE") && (await rowsOf(m, w.ticker)).length === 20, "uncountable rows");
  } finally { off(); }
});

test("#33 double grade: the second applyGrade is ignored and the book's n does not move", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    arm(m, e);
    const w = win();
    m.h.noteQuietCapture(e, snap(w, 11.5), votesFor(m.types.SEAT_IDS));
    const s = snap(w, 0.05);
    await m.h.applyGrade(e, s, votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    assert.equal(e.quietBook.graded_windows, 1);
    await m.h.applyGrade(e, s, votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    assert.equal(e.quietBook.graded_windows, 1);
    assert.equal(e.quietBook.seats.DRIFT.all.n, 1);
    // The book's own guard also refuses a replayed capture.
    const input = { book: e.quietBook, capture: captureFor(m, w, e.learner) };
    assert.equal(m.q.gradeQuiet(input, s, "UP", "GRADE", m.learner.creditDirectional).status, "DUPLICATE");
    await waitFor(async () => (await rowsOf(m, w.ticker)).filter((r) => r.grade_status === "GRADED").length === 20, "graded rows");
  } finally { off(); }
});

test("#34 missing capture: the learner is unaffected; seats untouched; an armed window counts MISSED", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    const ref = engineFor(m);
    arm(m, e);
    const w = win();
    const s = snap(w, 0.05);
    await m.h.applyGrade(e, clone(s), votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    off();
    await m.h.applyGrade(ref, clone(s), votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    on();
    assert.deepEqual(e.learner, ref.learner);
    assert.equal(e.quietBook.graded_windows, 0);
    assert.equal(e.quietBook.missed_windows, 1);
    assert.ok(m.q.QUIET_SEATS.every((x) => e.quietBook.seats[x].all.n === 0));
    assert.equal((await waitFor(() => windowRow(m, w.ticker), "MISSED row")).status, "MISSED");
  } finally { off(); }
});

test("#35 capture timing: once, at the first usable tick under 12 min; next-window activation; MISSED when none", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    const w0 = win();
    m.h.noteQuietCapture(e, snap(w0, 11.5), votesFor(m.types.SEAT_IDS));
    assert.equal(Object.keys(e.quietCaptures).length, 0, "activation arms for the NEXT window boundary");
    assert.ok(e.quietBook.activated_at > 0);
    const w = win();
    const key = `${w.ticker}:${w.close}`;
    m.h.noteQuietCapture(e, snap(w, 14), votesFor(m.types.SEAT_IDS));
    m.h.noteQuietCapture(e, snap(w, 12.0), votesFor(m.types.SEAT_IDS));
    assert.equal(e.quietCaptures[key], undefined, "12.0 is not < 12");
    m.h.noteQuietCapture(e, snap(w, 11.9), votesFor(m.types.SEAT_IDS, 0));
    m.h.noteQuietCapture(e, snap(w, 11.5), votesFor(m.types.SEAT_IDS, 1));
    assert.equal(e.quietCaptures[key].mins_left, 11.9, "captured exactly once, first usable tick");
    const w2 = win();
    const key2 = `${w2.ticker}:${w2.close}`;
    m.h.noteQuietCapture(e, snap(w2, 11.9, { chalk: true }), votesFor(m.types.SEAT_IDS));
    m.h.noteQuietCapture(e, snap(w2, 11.5), votesFor(m.types.SEAT_IDS));
    assert.equal(e.quietCaptures[key2].mins_left, 11.5, "non-gradeable book skipped");
    const w3 = win();
    for (const ml of [14, 13, 2.2, 1.0]) m.h.noteQuietCapture(e, snap(w3, ml), votesFor(m.types.SEAT_IDS));
    assert.equal(e.quietCaptures[`${w3.ticker}:${w3.close}`], undefined);
    await m.h.applyGrade(e, snap(w3, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    assert.equal(e.quietBook.missed_windows, 1);
    assert.equal((await waitFor(() => windowRow(m, w3.ticker), "MISSED row")).status, "MISSED");
    assert.equal((await waitFor(() => windowRow(m, w.ticker), "CAPTURED row")).status, "CAPTURED");
  } finally { off(); }
});

test("#36 capture is read-only: votes, snap, chair and learner are deep-equal after noteQuietCapture", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    arm(m, e);
    const w = win();
    const s = snap(w, 11.5);
    const votes = votesFor(m.types.SEAT_IDS);
    const chair = chairOf("UP", 61);
    e.lastChair = chair;
    const before = clone({ votes, s, chair, learner: e.learner });
    m.h.noteQuietCapture(e, s, votes);
    assert.ok(e.quietCaptures[`${w.ticker}:${w.close}`]);
    assert.deepEqual({ votes, s, chair, learner: e.learner }, before);
  } finally { off(); }
});

// ---------------------------------------------------------------- huddle

test("#37 runHuddle invariance: identical learner with or without the quiet review; huddle_log never says QUIET", async () => {
  const m = await load();
  const A = m.skills.freshLearner();
  A.graded_windows = 30;
  const B = clone(A);
  const book = m.q.freshQuietBook(1);
  book.graded_windows = 250;
  const a = m.learner.runHuddle(A);
  const b = m.learner.runHuddle(B);
  m.q.quietHuddleReview(book, b.learner, Date.now());
  const strip = (L) => ({ ...L, last_huddle: 0, huddle_log: L.huddle_log.map((l) => l.replace(/\d\d:\d\d/g, "")) });
  assert.deepEqual(strip(b.learner), strip(a.learner));
  assert.ok(!b.learner.huddle_log.some((l) => /QUIET/.test(l)));
  assert.ok(book.review_log[0].startsWith("QUIET "));
});

test("#38 huddle wiring: every runHuddle call site is followed by runQuietReview(e); engine.ts never runs it", async () => {
  const src = read("src/lib/desk/server-engine.ts");
  const calls = src.split("\n").filter((l) => /e\.learner = runHuddle\(e\.learner\)\.learner/.test(l));
  assert.equal(calls.length, 3, "three runHuddle call sites");
  for (const l of calls) assert.match(l, /runHuddle\(e\.learner\)\.learner; queueStatusTransitions\([^;]*\); runQuietReview\(e\); \}/);
  assert.equal((src.match(/runQuietReview\(e\);/g) ?? []).length, 3);
  assert.doesNotMatch(read("src/lib/desk/engine.ts"), /quiet-call|runQuietReview|QuietGradeInput/);
  const lsrc = read("src/lib/desk/learner.ts");
  const huddle = lsrc.slice(lsrc.indexOf("export function runHuddle"), lsrc.indexOf("export function acceptCandidate"));
  assert.doesNotMatch(huddle, /gradeQuiet|quietHuddleReview|QuietGradeInput|quiet-call/, "runHuddle itself is unmodified");
});

// ---------------------------------------------------------------- persistence

test("#39 persist round-trip: quiet_book and pending captures survive; a pre-change state restores an empty book", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    arm(m, e);
    const w1 = win();
    m.h.noteQuietCapture(e, snap(w1, 11.5), votesFor(m.types.SEAT_IDS));
    await m.h.applyGrade(e, snap(w1, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    const w2 = win();
    m.h.noteQuietCapture(e, snap(w2, 11.5), votesFor(m.types.SEAT_IDS));
    assert.equal(await m.h.persistState(e, true), true);
    const r = engineFor(m);
    await m.h.loadState(r);
    assert.deepEqual(r.quietBook, JSON.parse(JSON.stringify(e.quietBook)));
    assert.deepEqual(r.quietCaptures, JSON.parse(JSON.stringify(e.quietCaptures)));
    // A state saved before this change has no quiet keys.
    const sql = await m.db.getSql();
    const [{ state }] = await sql`select state from desk_state where id = 'live'`;
    const legacy = typeof state === "string" ? JSON.parse(state) : state;
    delete legacy.quiet_book; delete legacy.quiet_captures;
    await sql`update desk_state set state = ${JSON.stringify(legacy)}::jsonb where id = 'live'`;
    const old = engineFor(m);
    await m.h.loadState(old);
    assert.equal(old.lastError, null);
    assert.equal(old.quietBook.activated_at, 0);
    assert.equal(old.quietBook.graded_windows, 0);
    assert.deepEqual(old.quietCaptures, {});
  } finally { off(); }
});

test("#40 restart between capture and settle: graded once, from the persisted capture", async () => {
  const m = await load();
  on();
  try {
    const e = engineFor(m);
    arm(m, e);
    const w = win();
    m.h.noteQuietCapture(e, snap(w, 11.5), votesFor(m.types.SEAT_IDS));
    const captured = clone(e.quietCaptures[`${w.ticker}:${w.close}`]);
    await m.h.persistState(e, true);
    const r = engineFor(m);
    await m.h.loadState(r);
    assert.deepEqual(r.quietCaptures[`${w.ticker}:${w.close}`], JSON.parse(JSON.stringify(captured)));
    const n0 = r.quietBook.graded_windows;
    await m.h.applyGrade(r, snap(w, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "DOWN", "test");
    assert.equal(r.quietBook.graded_windows, n0 + 1);
    const drift = captured.calls.find((c) => c.seat === "DRIFT");
    assert.equal(r.quietBook.seats.DRIFT.roll.at(-1).hit, drift.side === "DOWN" ? 1 : 0);
  } finally { off(); }
});

test("#41 public leak rail: nothing quiet reaches /frame, the learner, or a vote", async () => {
  const m = await load();
  on();
  try {
    const src = read("src/lib/desk/server-engine.ts");
    const frame = src.slice(src.indexOf("export async function getServerFrame"), src.indexOf("/** The engine's current snapshot"));
    assert.ok(frame.length > 200);
    assert.doesNotMatch(frame, /quiet/i, "getServerFrame must not read the quiet ledger");
    const frameType = src.slice(src.indexOf("type ServerFrame"), src.indexOf("export async function getServerFrame"));
    assert.doesNotMatch(frameType, /quiet/i);
    const e = engineFor(m);
    arm(m, e);
    const w = win();
    const votes = votesFor(m.types.SEAT_IDS);
    const voteKeys = votes.map((v) => Object.keys(v).sort().join(","));
    m.h.noteQuietCapture(e, snap(w, 11.5), votes);
    await m.h.applyGrade(e, snap(w, 0.05), votes, chairOf(), "UP", "test");
    m.h.runQuietReview(e);
    assert.deepEqual(votes.map((v) => Object.keys(v).sort().join(",")), voteKeys, "no new keys on any Vote");
    const sliced = m.engine.__quietIntegration && JSON.stringify(e.learner);
    for (const banned of ["quiet_book", "quietBook", "QUIET_CALL", "p_used", "quietCaptures", "QUIET 20"]) assert.ok(!sliced.includes(banned), banned);
    assert.deepEqual(Object.keys(e.learner).sort(), Object.keys(m.skills.freshLearner()).sort().concat().filter((k) => k in e.learner).sort());
    for (const k of Object.keys(e.learner)) assert.ok(!/quiet/i.test(k), k);
    // The type contract: Vote and Learner gained no fields.
    const types = read("src/lib/desk/types.ts");
    const voteType = types.slice(types.indexOf("export type Vote = {"), types.indexOf("export type Gate = {"));
    const learnerType = types.slice(types.indexOf("export type Learner = {"), types.indexOf("export type Settings = {"));
    assert.doesNotMatch(voteType + learnerType, /quiet/i);
  } finally { off(); }
});

test("#42 route auth: header-only admin key, 404 otherwise, no-store, authority block, not in the sitemap", async () => {
  const m = await load();
  // Supply a restored, already-started synthetic engine: never start network timers.
  const priorEngine = globalThis.__satoshiServerEngine__;
  const reportEngine = engineFor(m);
  reportEngine.started = true;
  reportEngine.ready = Promise.resolve();
  globalThis.__satoshiServerEngine__ = reportEngine;
  const route = read("server/routes/research/quiet-calls.get.ts");
  assert.match(route, /headers\.get\("x-desk-admin"\)/);
  assert.doesNotMatch(route, /searchParams|get\("key"\)/);
  process.env.DESK_ADMIN_KEY = "quiet-test-key";
  try {
    const mod = await vite.ssrLoadModule("/server/routes/research/quiet-calls.get.ts");
    const call = async (headers, url = "http://x/research/quiet-calls") => mod.default({ req: { headers: new Headers(headers) }, url: new URL(url) });
    assert.equal((await call({})).status, 404);
    assert.equal((await call({}, "http://x/research/quiet-calls?key=quiet-test-key")).status, 404, "a key in the URL is never read");
    assert.equal((await call({ "x-desk-admin": "wrong" })).status, 404);
    const ok = await call({ "x-desk-admin": "quiet-test-key" });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const body = await ok.json();
    assert.deepEqual(body.authority, { production_authority: "NONE", promotes_nothing: true, books_nothing: true, paper_only: true, simulated_only: true });
    assert.equal(body.board.v, "QUIET_CALL_V1");
    assert.equal(body.enabled, false);
  } finally { delete process.env.DESK_ADMIN_KEY; globalThis.__satoshiServerEngine__ = priorEngine; }
  assert.doesNotMatch(read("src/lib/desk/site.server.ts"), /quiet/i, "sitemap must not list the route");
  for (const dir of ["src/routes", "src/components"]) {
    const { execSync } = await import("node:child_process");
    const hits = execSync(`grep -rli "quiet-calls\\|quiet_call\\|QUIET_CALL" ${dir} || true`, { cwd: new URL("..", import.meta.url) }).toString().trim();
    assert.equal(hits, "", `no public page links the quiet ledger (${dir})`);
  }
});

test("#43 disabled = inert: a full tick → settle → huddle cycle writes no quiet rows and leaves the book empty", async () => {
  const m = await load();
  off();
  const e = engineFor(m);
  const w = win();
  for (const ml of [11.9, 6, 3]) m.h.noteQuietCapture(e, snap(w, ml), votesFor(m.types.SEAT_IDS));
  await m.h.applyGrade(e, snap(w, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
  m.h.runQuietReview(e);
  assert.deepEqual(e.quietBook, m.q.freshQuietBook());
  assert.deepEqual(e.quietCaptures, {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await rowsOf(m, w.ticker)).length, 0);
  assert.equal(await windowRow(m, w.ticker), null);
});

test("#44 standing constraints: 80¢ floor, review freeze, no auto-promotion; bots and Chair identical on vs off", async () => {
  const m = await load();
  assert.equal(m.floor.FLOOR_LIVE_CENTS, 80);
  assert.equal(m.floor.CHAIR_MIN_ASK_CENTS, 80);
  assert.equal(m.learner.SEAT_REVIEW_DEMOTION_FROZEN, true);
  assert.equal(m.learner.AUTO_SKILL_PROMOTION_ENABLED, false);
  const w = win();
  const run = () => {
    const e = engineFor(m);
    const s = snap(w, 8);
    const L = m.skills.freshLearner();
    const votes = m.bots.runBots(clone(s), L);
    const chair = m.tick.decideChair(e, clone(votes), clone(s), m.tick.lastSide(e, s));
    return JSON.parse(JSON.stringify({ votes, chair }));
  };
  off();
  const a = run();
  on();
  const b = run();
  off();
  assert.deepEqual(b, a);
  // Only learner.ts (grading) and server-engine.ts (taps) import the ledger.
  const { execSync } = await import("node:child_process");
  const importers = execSync(`grep -rl "from \\"./quiet-call" src/lib/desk || true`, { cwd: new URL("..", import.meta.url) }).toString().trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(importers, ["src/lib/desk/learner.ts", "src/lib/desk/quiet-call.server.ts", "src/lib/desk/server-engine.ts"]);
  const q = read("src/lib/desk/quiet-call.ts");
  for (const banned of ['"./chair', '"./book-floor', '"./bots', '"./server-engine', '"./learner', "process.env.QUIET_CALL_V1_ENABLED =", "insert into", "update desk"])
    assert.ok(!q.includes(banned), `quiet-call.ts must not reference ${banned}`);
});

test("#45 ledger row unchanged: buildLedgerRow output is deep-equal with the feature on vs off", async () => {
  const m = await load();
  const w = win();
  const grade = async (enabled) => {
    if (enabled) on(); else off();
    const e = engineFor(m);
    if (enabled) { m.h.noteQuietCapture(e, snap({ close: w.close - 900_000, ticker: `${w.ticker}-ARM` }, 11.5), votesFor(m.types.SEAT_IDS)); m.h.noteQuietCapture(e, snap(w, 11.5), votesFor(m.types.SEAT_IDS)); }
    e.gradedKeys = [];
    await m.h.applyGrade(e, snap(w, 0.05), votesFor(m.types.SEAT_IDS), chairOf("UP", 62), "UP", "test");
    off();
    return { row: e.ledgerQueue.at(-1)?.row ?? e.ledgerQueue.at(-1), learner: e.learner };
  };
  const a = await grade(false);
  const b = await grade(true);
  // Only wall-clock stamps may differ (e.g. the score audit's graded_at inside its JSON text).
  const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) =>
    typeof v === "string" ? v.replace(/"graded_at":\d+/g, '"graded_at":0')
      : /(_at|At|_ts)$/.test(k) && typeof v === "number" ? 0 : v));
  assert.deepEqual(norm(b.row), norm(a.row));
  assert.deepEqual(norm(b.learner), norm(a.learner));
});

test("#46 migration 0071: constraints reject a WAIT side, p_used below 0.5 and an unknown source", async () => {
  const m = await load();
  const sql = await m.db.getSql();
  const ins = (over) => {
    const r = { side: "UP", p: 0.6, source: "RAW", ...over };
    return sql`insert into desk_quiet_calls (ticker, close_time, seat, captured_at, mins_left, regime_key, side, conf_raw, p_used, source,
      admitted_lean, admitted_state, skill_used, build_sha) values (${`MIG-${Math.random()}`}, now(), 'DRIFT', now(), 11.5, 'r', ${r.side}, 60, ${r.p},
      ${r.source}, 'WAIT', 'WAIT', 'SIT', 'sha')`;
  };
  await ins({});
  await assert.rejects(ins({ side: "WAIT" }));
  await assert.rejects(ins({ p: 0.4 }));
  await assert.rejects(ins({ source: "MAGIC" }));
  await ins({ source: "CONTROL", p: 0.5 });
});

test("#47 DB failure isolation: failing quiet writes never stop a tick tap or a grade; the error is recorded", async () => {
  const m = await load();
  on();
  const sql = await m.db.getSql();
  await sql`alter table desk_quiet_calls rename to desk_quiet_calls_away`;
  await sql`alter table desk_quiet_windows rename to desk_quiet_windows_away`;
  try {
    const e = engineFor(m);
    arm(m, e);
    const w = win();
    m.h.noteQuietCapture(e, snap(w, 11.5), votesFor(m.types.SEAT_IDS));
    assert.ok(e.quietCaptures[`${w.ticker}:${w.close}`], "the in-memory capture is kept");
    const before = e.learner.graded_windows;
    await m.h.applyGrade(e, snap(w, 0.05), votesFor(m.types.SEAT_IDS), chairOf(), "UP", "test");
    assert.equal(e.learner.graded_windows, before + 1, "the learner was still taught");
    assert.equal(e.quietBook.graded_windows, 1);
    await waitFor(() => e.errors.some((x) => x.scope === "quiet"), "quiet error recorded");
  } finally {
    await sql`alter table desk_quiet_calls_away rename to desk_quiet_calls`;
    await sql`alter table desk_quiet_windows_away rename to desk_quiet_windows`;
    off();
  }
});

test("#47a write ordering: a grade issued before (or without) its capture insert still lands GRADED, and is never rewritten", async () => {
  const m = await load();
  const srv = await vite.ssrLoadModule("/src/lib/desk/quiet-call.server.ts");
  const L = m.skills.freshLearner();
  const w = win();
  const capture = captureFor(m, w, L);
  const book = m.q.freshQuietBook(1);
  const r = m.q.gradeQuiet({ book, capture }, snap(w, 0.05), "UP", "GRADE", m.learner.creditDirectional);
  // Issue both without awaiting the first: the serial chain must keep capture → grade order.
  const a = srv.writeQuietCapture(capture);
  const b = srv.writeQuietGrade(capture, "GRADED", r.rows, Date.now());
  await Promise.all([a, b]);
  let rows = await rowsOf(m, w.ticker);
  assert.equal(rows.length, 20);
  assert.ok(rows.every((x) => x.grade_status === "GRADED" && (x.hit === 0 || x.hit === 1)));
  // A grade with no prior capture insert at all (lost write) is an upsert of the full call.
  const w2 = win();
  const c2 = captureFor(m, w2, L);
  const r2 = m.q.gradeQuiet({ book, capture: c2 }, snap(w2, 0.05), "DOWN", "GRADE", m.learner.creditDirectional);
  await srv.writeQuietGrade(c2, "GRADED", r2.rows, Date.now());
  rows = await rowsOf(m, w2.ticker);
  assert.equal(rows.filter((x) => x.grade_status === "GRADED").length, 20);
  const sql = await m.db.getSql();
  const windows = await sql`select status from desk_quiet_windows where ticker=${w2.ticker}`;
  assert.equal(windows.length, 1);
  assert.equal(windows[0].status, 'CAPTURED');
  // A settled row is never rewritten by a later write.
  await srv.writeQuietGrade(c2, "SKIPPED_CHALK", [], Date.now());
  assert.equal((await rowsOf(m, w2.ticker)).filter((x) => x.grade_status === "GRADED").length, 20);
});


test("#47b kill evaluation waits for issued grades and freezes the matching book", async () => {
  const m = await load();
  const srv = await vite.ssrLoadModule("/src/lib/desk/quiet-call.server.ts");
  const L = m.skills.freshLearner(), w = win();
  const capture = captureFor(m, w, L);
  const book = m.q.freshQuietBook(capture.as_of);
  const r = m.q.gradeQuiet({ book, capture }, snap(w, 0.05), "UP", "GRADE", m.learner.creditDirectional);
  const pending = srv.writeQuietGrade(capture, "GRADED", r.rows, Date.now());
  const result = srv.runQuietKill(book, Date.now());
  // Caller keeps processing ticks while the ordered read waits for DB writes.
  book.graded_windows += 1;
  for (const seat of m.q.QUIET_SEATS) book.seats[seat].all.n += 1;
  const verdict = await result;
  await pending;
  assert.deepEqual(verdict.k0.drift_seats, [], "issued grades and frozen book agree");
  assert.equal(verdict.k0.coverage, 1);
});

test('#48 all retained pending settlements plus active capture survive restart and grade the oldest result',async()=>{const m=await load();on();try{const e=engineFor(m);arm(m,e);const windows=[];let prev=null;for(let i=0;i<m.q.QUIET_CAPTURE_CAP;i++){const w=win(),s=snap(w,11.5),votes=votesFor(m.types.SEAT_IDS);windows.push(w);m.h.noteQuietCapture(e,s,votes);if(prev)await m.h.settleIfNeeded(e,s,votes,chairOf(),prev);prev={snap:s,votes,chair:chairOf()};}assert.equal(e.pending.length,32);assert.equal(Object.keys(e.quietCaptures).length,33);const oldest=windows[0],key=`${oldest.ticker}:${oldest.close}`;assert.ok(e.quietCaptures[key]);await m.h.persistState(e,true);const r=engineFor(m);await m.h.loadState(r);assert.ok(r.quietCaptures[key]);const active=windows.at(-1),s=snap(active,11.5,{official_settles:[{ticker:oldest.ticker,close_time:oldest.close,lean:'UP'}]});await m.h.settleIfNeeded(r,s,votesFor(m.types.SEAT_IDS),chairOf(),{snap:null,votes:[],chair:null});assert.equal(r.quietBook.graded_windows,1);assert.equal(r.quietBook.missed_windows,0);assert.equal(r.quietCaptures[key],undefined);await waitFor(async()=>{const rows=await rowsOf(m,oldest.ticker);return rows.length===20&&rows.every(x=>x.grade_status==='GRADED');},'delayed oldest quiet grade');}finally{off();}});

test('#49 immediate and pending identity faults retire quiet captures once, durably, without credit',async()=>{const m=await load();on();try{for(const delayed of [false,true]){const e=engineFor(m);arm(m,e);const w=win(),votes=votesFor(m.types.SEAT_IDS),key=`${w.ticker}:${w.close}`;m.h.noteQuietCapture(e,snap(w,11.5),votes);if(delayed)await m.h.settleIfNeeded(e,snap(w,0),votes,chairOf(),{snap:null,votes:[],chair:null});const next=delayed?win():w,s=snap(next,delayed?11.5:0,{official_settles:[{ticker:w.ticker,close_time:w.close+900000,lean:'UP'}]});await m.h.settleIfNeeded(e,s,votes,chairOf(),{snap:null,votes:[],chair:null});assert.equal(e.quietCaptures[key],undefined);assert.equal(e.quietBook.skipped.identity,1);assert.equal(e.quietBook.graded_windows,0);assert.equal(e.learner.graded_windows,0);assert.equal(e.pending.length,0);assert.ok(m.q.QUIET_SEATS.every(seat=>e.quietBook.seats[seat].all.n===0));await m.h.settleIfNeeded(e,s,votes,chairOf(),{snap:null,votes:[],chair:null});assert.equal(e.quietBook.skipped.identity,1);await waitFor(async()=>{const rows=await rowsOf(m,w.ticker);return rows.length===20&&rows.every(x=>x.grade_status==='SKIPPED_IDENTITY');},'identity retirement');const restored=engineFor(m);await m.h.loadState(restored);assert.equal(restored.quietCaptures[key],undefined);assert.equal(restored.quietBook.skipped.identity,1);}}finally{off();}});

test('#50 a new capture forces the real tick save through the throttle before restart',async()=>{const m=await load();on();try{const source=read('src/lib/desk/server-engine.ts');assert.match(source,/const quietCaptured = noteQuietCapture\(e, snap, votes\);/);assert.match(source,/await persistState\(e, quietCaptured\);/);const e=engineFor(m);arm(m,e);const w=win(),key=`${w.ticker}:${w.close}`;e.lastPersistAt=Date.now();const captured=m.h.noteQuietCapture(e,snap(w,11.5),votesFor(m.types.SEAT_IDS));assert.equal(captured,true);assert.ok(Date.now()-e.lastPersistAt<8000);await m.h.persistState(e,captured);const restored=engineFor(m);await m.h.loadState(restored);assert.ok(restored.quietCaptures[key]);assert.equal(m.h.noteQuietCapture(restored,snap(w,11),votesFor(m.types.SEAT_IDS)),false);await m.h.applyGrade(restored,snap(w,0.05),votesFor(m.types.SEAT_IDS),chairOf(),'UP','test');assert.equal(restored.quietBook.missed_windows,0);assert.equal(restored.quietBook.graded_windows,1);}finally{off();}});

 test('#51 uncaptured armed identity faults count as missed once for immediate and pending paths',async()=>{const m=await load();on();try{for(const delayed of [false,true]){const e=engineFor(m);arm(m,e);const w=win(),votes=votesFor(m.types.SEAT_IDS);if(delayed)await m.h.settleIfNeeded(e,snap(w,0),votes,chairOf(),{snap:null,votes:[],chair:null});const next=delayed?win():w,s=snap(next,delayed?11.5:0,{official_settles:[{ticker:w.ticker,close_time:w.close+900000,lean:'UP'}]});await m.h.settleIfNeeded(e,s,votes,chairOf(),{snap:null,votes:[],chair:null});await m.h.settleIfNeeded(e,s,votes,chairOf(),{snap:null,votes:[],chair:null});assert.equal(e.quietBook.missed_windows,1);assert.equal(e.quietBook.skipped.identity,0);assert.equal(e.quietBook.graded_windows,0);const sql=await m.db.getSql();await waitFor(async()=>{const rows=await sql`select status from desk_quiet_windows where ticker=${w.ticker}`;return rows.length===1&&rows[0].status==='MISSED';},'uncaptured identity receipt');const restored=engineFor(m);await m.h.loadState(restored);assert.equal(restored.quietBook.missed_windows,1);}}finally{off();}});

 test('#52 paused collection settles retained captures across restart and leaves fresh windows dark',async()=>{const m=await load();for(const identity of [false,true]){on();const e=engineFor(m);arm(m,e);const w=win(),votes=votesFor(m.types.SEAT_IDS),key=`${w.ticker}:${w.close}`;m.h.noteQuietCapture(e,snap(w,11.5),votes);await m.h.persistState(e,true);off();const restored=engineFor(m);await m.h.loadState(restored);assert.ok(restored.quietCaptures[key]);const fresh=win();assert.equal(m.h.noteQuietCapture(restored,snap(fresh,11.5),votes),false);const s=snap(w,0,{official_settles:[{ticker:w.ticker,close_time:w.close+(identity?900000:0),lean:'UP'}]});await m.h.settleIfNeeded(restored,s,votes,chairOf(),{snap:null,votes:[],chair:null});assert.equal(restored.quietCaptures[key],undefined);assert.equal(restored.quietBook.graded_windows,identity?0:1);assert.equal(restored.quietBook.skipped.identity,identity?1:0);await waitFor(async()=>{const rows=await rowsOf(m,w.ticker);return rows.length===20&&rows.every(x=>x.grade_status===(identity?'SKIPPED_IDENTITY':'GRADED'));},'paused retained settlement');const again=engineFor(m);await m.h.loadState(again);assert.equal(again.quietCaptures[key],undefined);await m.h.applyGrade(again,snap(fresh,0.05),votes,chairOf(),'UP','test');assert.equal(again.quietBook.missed_windows,0);assert.equal((await rowsOf(m,fresh.ticker)).length,0);}off();});

 test('#53 durable quiet outbox recovers failed grades and missed receipts after restart without credit duplication',async()=>{const m=await load(),sql=await m.db.getSql();on();const e=engineFor(m);arm(m,e);const w=win(),votes=votesFor(m.types.SEAT_IDS),key=`${w.ticker}:${w.close}`;m.h.noteQuietCapture(e,snap(w,11.5),votes);await waitFor(async()=>(await rowsOf(m,w.ticker)).length===20,'capture');await sql`alter table desk_quiet_calls rename to desk_quiet_calls_outage`;await sql`alter table desk_quiet_windows rename to desk_quiet_windows_outage`;try{await m.h.applyGrade(e,snap(w,0.05),votes,chairOf(),'UP','test');await waitFor(()=>e.quietWriting.size===0,'failed grade acknowledgement');assert.ok(e.quietWrites[key]);assert.equal(e.quietCaptures[key],undefined);const missed=win();await m.h.applyGrade(e,snap(missed,0.05),votes,chairOf(),'DOWN','test');await waitFor(()=>e.quietWriting.size===0,'failed missed acknowledgement');assert.equal(Object.keys(e.quietWrites).length,2);await m.h.persistState(e,true);}finally{await sql`alter table desk_quiet_calls_outage rename to desk_quiet_calls`;await sql`alter table desk_quiet_windows_outage rename to desk_quiet_windows`;off();}for(const row of e.quietWrites[key].rows.slice(0,3)){await sql`update desk_quiet_calls set grade_status='GRADED',finish=${row.finish},hit=${row.hit},cents=${row.cents},coin_cents=${row.coin_cents} where ticker=${w.ticker} and seat=${row.seat}`;}const r=engineFor(m);await m.h.loadState(r);assert.equal(Object.keys(r.quietWrites).length,2);const n=r.quietBook.graded_windows,learner=r.learner.graded_windows;m.h.flushQuietWrites(r);await waitFor(()=>Object.keys(r.quietWrites).length===0,'recovered acknowledged outbox');assert.equal(r.quietBook.graded_windows,n);assert.equal(r.learner.graded_windows,learner);assert.ok((await rowsOf(m,w.ticker)).every(x=>x.grade_status==='GRADED'&&(x.hit===0||x.hit===1)));const windows=await sql`select status from desk_quiet_windows where ticker=${w.ticker}`;assert.equal(windows[0].status,'CAPTURED');await m.h.persistState(r,true);const again=engineFor(m);await m.h.loadState(again);assert.deepEqual(again.quietWrites,{});});

 test('#54 report reads behind queued grades and freezes its invocation cohort',async()=>{const m=await load(),srv=await vite.ssrLoadModule('/src/lib/desk/quiet-call.server.ts');const w=win(),capture=captureFor(m,w,m.skills.freshLearner()),book=m.q.freshQuietBook(capture.as_of),result=m.q.gradeQuiet({book,capture},snap(w,0.05),'UP','GRADE',m.learner.creditDirectional);const grade=srv.writeQuietGrade(capture,'GRADED',result.rows,Date.now());const report=srv.quietReport(book,true,0);book.seats.DRIFT.all.n+=1;const w2=win(),c2=captureFor(m,w2,m.skills.freshLearner()),b2=m.q.freshQuietBook(c2.as_of),r2=m.q.gradeQuiet({book:b2,capture:c2},snap(w2,0.05),'UP','GRADE',m.learner.creditDirectional);const later=srv.writeQuietGrade(c2,'GRADED',r2.rows,Date.now());const got=await report;assert.equal(got.reconciliation.ok,true);assert.deepEqual(got.reconciliation.drift_seats,[]);assert.equal(got.reconciliation.table_windows,1);await Promise.all([grade,later]);});

 test('#55 owner report waits for restored engine state before freezing its book',async()=>{const m=await load(),e=engineFor(m);let release,done=false;e.ready=new Promise(r=>{release=r;});const pending=m.h.quietSnapshotAfterReady(e).then(x=>{done=true;return x;});await new Promise(r=>setImmediate(r));assert.equal(done,false);e.quietBook=m.q.freshQuietBook(1234);e.quietBook.missed_windows=7;release();const result=await pending;assert.equal(result.book.activated_at,1234);assert.equal(result.book.missed_windows,7);e.quietBook.missed_windows=8;assert.equal(result.book.missed_windows,7);const source=read('src/lib/desk/server-engine.ts');assert.match(source,/quietLedgerSnapshot\(\)[\s\S]*?ensureServerEngine\(\);\s*return quietSnapshotAfterReady\(eng\(\)\);/);assert.match(read('server/routes/research/quiet-calls.get.ts'),/const snap = await quietLedgerSnapshot\(\);/);});
