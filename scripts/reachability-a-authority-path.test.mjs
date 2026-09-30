// REACHABILITY-A — authority/calibration causality on the real current path.
//
// SYNTHETIC fixtures, authority NONE. Every step is the production function
// `tick` runs, in tick order: decideChair (runChair + softenTimeGates +
// stickLean) -> applyEntryMode (selectiveChair) -> noteCall (edge guard, team
// guard, selectiveBookOk, 80c floor, durable reservation on disposable PGlite).
// Market values for the witness frame are the primary 12:26:03.833Z quotes;
// learner values are shaped like the committed 2026-09-22 snapshot. Nothing
// here is current-state evidence or a claim that a call would have booked.
import assert from "node:assert/strict";
import test from "node:test";

if (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim()) {
  throw new Error("reachability-a authority path refuses nonempty DATABASE_URL before Vite or database startup");
}

const CLOSE_LAST_FILL = Date.parse("2026-09-18T22:30:00Z"); // KXBTC15M-26SEP181830-30, filled UP 81c at 484.9 s left
const CLOSE_WITNESS = Date.parse("2026-09-30T12:30:00Z"); // KXBTC15M-26SEP300830-30, 12:26:03.833Z checkpoint
const LAST_FILL = { ticker: "KXBTC15M-26SEP181830-30", yes_ask: 81, yes_bid: 80, no_ask: 20, no_bid: 19, edge_up: 4, edge_down: -30, fair_yes: 87, lab_fair_yes: 85 };
// Witness quotes are primary; fair/index are set generously so only the Chair can refuse.
const WITNESS = { ticker: "KXBTC15M-26SEP300830-30", yes_ask: 84, yes_bid: 83, no_ask: 17, no_bid: 16, edge_up: 8, edge_down: -30, fair_yes: 94, lab_fair_yes: 93 };
const CARD_OF = { STRIKE: "STRIKE.itm_time", STREAK: "STREAK.continue_young", CHAIN: "CHAIN.oi_with_price" };
const NUMERIC_PASS = { n: 683, ev_n: 683, hits: 640, wilson: 0.9, ev: 5, manual_hold: false, min_walkforward_n: undefined, min_regime_n: undefined };

function snapshot(asOf, close, m) {
  return {
    as_of: asOf, close_time: close, ticker: m.ticker, mins_left: (close - asOf) / 60_000, secs_left: (close - asOf) / 1000,
    yes_ask: m.yes_ask, yes_bid: m.yes_bid, no_ask: m.no_ask, no_bid: m.no_bid, yes_bid_size: 7, no_bid_size: 5,
    edge_up: m.edge_up, edge_down: m.edge_down, fair_yes: m.fair_yes, lab_fair_yes: m.lab_fair_yes, lab_age_s: 1,
    fee_yes: 2, fee_no: 2, spread_cents: m.yes_ask - m.yes_bid, leftover_cents: 100 - (m.yes_ask + m.no_ask),
    combined_ask_cents: m.yes_ask + m.no_ask, chalk: m.yes_ask >= 99 || m.no_ask >= 99,
    spot: 80_000, strike: 79_900, spot_age_s: 1, quote_age_s: 1, print_age_s: 1, quote_seq: 1,
    obs: { receipt_ts: asOf - 1000, gap: "ok", last_ok_ts: asOf - 1000 },
    health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
    phase: "MID", regime_key: "integration", session: "US_PM", demo: false,
    ret5: 0, ret15: 0, ret30: 0, ret1h: 0, atr: 1, atr_pct: 0.2,
    // vol_percentile < 25 -> readOrbit quiet: the +0.08 bar term the primary tape shows (0.62 at sit_mass 1).
    vol_median: 1, vol_last: 1, vol_percentile: 0.5, location: "MID", range_pos: 0.5,
    imbalance: 0, imbalance_hist: [], candles_1m: [], window_memory: {}, clock_key: "integration",
    funding_rate: 0, funding_apr: 0, funding_time: asOf, funding_history: [], funding_series: [],
    open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [],
    oi_delta_3m: 0, oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0,
    liq_long_usd: 0, liq_short_usd: 0, liq_n: 0, liq_source: "", force_n: 0, cascade_proxy: false,
    fear_greed: 50, fear_greed_label: "neutral", fng_history: [],
  };
}

async function load(t) {
  const { createServer } = await import("vite");
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const [skills, types, seats, arms, restore, engine, db] = await Promise.all([
    vite.ssrLoadModule("/src/lib/desk/skills.ts"),
    vite.ssrLoadModule("/src/lib/desk/types.ts"),
    vite.ssrLoadModule("/src/lib/desk/seats.ts"),
    vite.ssrLoadModule("/src/lib/desk/shadow-arms.ts"),
    vite.ssrLoadModule("/src/lib/desk/owner-restore.ts"),
    vite.ssrLoadModule("/src/lib/desk/server-engine.ts"),
    vite.ssrLoadModule("/src/lib/db.ts"),
  ]);
  assert.equal(db.dbSource, "pglite", "integration SQL must use the disposable PGlite backend");
  return { skills, types, seats, arms, restore, tick: engine.__tickIntegration, entry: engine.__entryIntegration };
}

function votesFor(SEAT_IDS, speakers, conf) {
  return SEAT_IDS.map((seat) => {
    const speaks = speakers.includes(seat);
    return {
      seat, lean: speaks ? "UP" : "WAIT", confidence: speaks ? conf : 50, features: {}, reasoning: "SYNTHETIC fixture",
      skill_used: speaks ? CARD_OF[seat] : "SIT", skill_status: speaks ? "LIVE" : "SIT", shadow: null, paper: [], thresh_used: [],
      skill_n: 100, skill_hits: 80, skill_wilson: 0.8, hypothesis: "", evidence: [], counter: "", invalidate_if: "",
      health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID",
    };
  });
}

/** Sep-18 shape: supporters LIVE and calibrated. Post-review shape: cards SHADOW, debt = seat_n. */
function learnerOf(m, { live = [], shadow = [], calibrated = [], reviewed = [] }) {
  const L = m.skills.freshLearner();
  L.learn_phase = "EXPLOIT"; // the +0.04 bar term the primary tape shows
  for (const seat of calibrated) { L.seat_n[seat] = 210; L.seat_hits[seat] = 170; L.seat_calib_debt[seat] = 0; }
  for (const seat of reviewed) { L.seat_n[seat] = 210; L.seat_hits[seat] = 170; L.seat_calib_debt[seat] = 210; }
  for (const id of live) Object.assign(L.skills[id], NUMERIC_PASS, { status: "LIVE" });
  for (const id of shadow) Object.assign(L.skills[id], NUMERIC_PASS, { status: "SHADOW" });
  return L;
}

/** Three frames 4 s apart through the exact tick functions; returns per-frame facts. */
async function run(m, learner, { close, secs, market, speakers, conf }) {
  const e = m.tick.freshEng();
  e.learner = learner;
  e.riskReady = true;
  e.selectiveStart = close - 86_400_000;
  const frames = [];
  for (const dt of [0, 4_000, 8_000]) {
    const snap = snapshot(close - Math.round(secs * 1000) + dt, close, market);
    const votes = votesFor(m.types.SEAT_IDS, speakers, conf);
    const decided = m.tick.decideChair(e, votes, snap, m.tick.lastSide(e, snap));
    const chair = m.tick.applyEntryMode(e, snap, decided);
    const before = e.riskCalls.length;
    await m.tick.noteCall(e, snap, chair, votes);
    frames.push({
      lean: chair.lean, booked: e.riskCalls.length > before, time_factor: chair.time_factor,
      bar_pass: chair.gates.find((g) => g.id === "bar")?.pass ?? null,
      selective: chair.gates.find((g) => g.id === "selective")?.value ?? null,
      rows: chair.rows.filter((r) => speakers.includes(r.seat)),
    });
    e.prevSnap = snap;
    e.lastChair = chair;
  }
  return { frames, calls: e.riskCalls };
}

test("no mechanical regression: the Sep-18 authority state still books the last-fill shape on the current path", async (t) => {
  const m = await load(t);
  const L = learnerOf(m, { live: ["STREAK.continue_young", "STRIKE.itm_time"], calibrated: ["STREAK", "STRIKE"] });
  const r = await run(m, L, { close: CLOSE_LAST_FILL, secs: 484.9, market: LAST_FILL, speakers: ["STREAK", "STRIKE"], conf: 61 });
  assert.deepEqual(r.frames.map((f) => f.booked), [false, false, true], "books once, after three frames over eight seconds");
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].lean, "UP");
  assert.equal(r.calls[0].cents, 81);
});

test("post-review state: SHADOW cards are forced sits, so the Chair never leans (authority)", async (t) => {
  const m = await load(t);
  const L = learnerOf(m, { shadow: ["STREAK.continue_young", "STRIKE.itm_time"], reviewed: ["STREAK", "STRIKE"] });
  const r = await run(m, L, { close: CLOSE_LAST_FILL, secs: 484.9, market: LAST_FILL, speakers: ["STREAK", "STRIKE"], conf: 61 });
  assert.ok(r.frames.every((f) => !f.booked && f.lean === "WAIT"));
  assert.ok(r.frames.every((f) => f.rows.every((row) => row.forced_sit === true && row.lean === "WAIT")));
});

test("status alone is not enough: debt = seat_n leaves the seats UNCALIBRATED and supplies no support (calibration)", async (t) => {
  const m = await load(t);
  const L = learnerOf(m, { live: ["STREAK.continue_young", "STRIKE.itm_time"], reviewed: ["STREAK", "STRIKE"] });
  const r = await run(m, L, { close: CLOSE_LAST_FILL, secs: 484.9, market: LAST_FILL, speakers: ["STREAK", "STRIKE"], conf: 61 });
  assert.ok(r.frames.every((f) => !f.booked));
  assert.ok(r.frames.every((f) => f.rows.every((row) => row.status === "UNCALIBRATED")));
  assert.match(r.frames[2].selective, /needs two healthy supporters from two evidence groups/);
});

test("P1 caveat is pinned: the last-fill pair is two production families but one corrected-E1 family", async (t) => {
  const m = await load(t);
  const pair = ["STREAK", "STRIKE"];
  assert.equal(new Set(pair.map((s) => m.seats.EVIDENCE_OF[s])).size, 2);
  assert.equal(new Set(pair.map((s) => m.arms.e1FamilyOf(s))).size, 1);
  const proposed = ["STRIKE", "CHAIN"];
  assert.equal(new Set(proposed.map((s) => m.seats.EVIDENCE_OF[s])).size, 2);
  assert.equal(new Set(proposed.map((s) => m.arms.e1FamilyOf(s))).size, 2, "the proposed pair is two groups under both maps");
});

test("OWNER_RESTORE_E1_PAIR_V1 (inactive by default) reaches a MID booking only through the unchanged path", async (t) => {
  const m = await load(t);
  const shadowed = () => learnerOf(m, { shadow: ["STRIKE.itm_time", "CHAIN.oi_with_price", "STREAK.continue_young"], reviewed: ["STRIKE"], calibrated: ["CHAIN"] });

  const off = shadowed();
  assert.equal(m.restore.applyOwnerRestore(off, m.restore.ownerRestoreMode({}), Date.now()).outcome, "OFF");
  const rOff = await run(m, off, { close: CLOSE_LAST_FILL, secs: 484.9, market: LAST_FILL, speakers: ["STRIKE", "CHAIN"], conf: 61 });
  assert.ok(rOff.frames.every((f) => !f.booked), "default OFF: nothing books");

  const statusOnly = shadowed();
  assert.equal(m.restore.applyOwnerRestore(statusOnly, "STATUS_ONLY", Date.now()).outcome, "APPLIED");
  const rStatus = await run(m, statusOnly, { close: CLOSE_LAST_FILL, secs: 484.9, market: LAST_FILL, speakers: ["STRIKE", "CHAIN"], conf: 61 });
  assert.ok(rStatus.frames.every((f) => !f.booked), "STATUS_ONLY: STRIKE is still UNCALIBRATED, so CHAIN alone cannot qualify");
  assert.equal(rStatus.frames[2].rows.find((row) => row.seat === "STRIKE").status, "UNCALIBRATED");

  const both = shadowed();
  assert.equal(m.restore.applyOwnerRestore(both, "STATUS_AND_STRIKE_CALIBRATION", Date.now()).outcome, "APPLIED");
  assert.equal(both.skills["STREAK.continue_young"].status, "SHADOW");
  const rBoth = await run(m, both, { close: CLOSE_LAST_FILL, secs: 484.9, market: LAST_FILL, speakers: ["STRIKE", "CHAIN"], conf: 61 });
  assert.deepEqual(rBoth.frames.map((f) => f.booked), [false, false, true], "all unchanged checks still run, including 3 frames over 8 s");
});

test("the restored pair still cannot book the 236 s witness: time factor 0.72 caps the Chair below its bar", async (t) => {
  const m = await load(t);
  for (const conf of [61, 64]) { // 64 = 61 x the maximum brierScale uplift (1.05)
    const L = learnerOf(m, { shadow: ["STRIKE.itm_time", "CHAIN.oi_with_price"], reviewed: ["STRIKE"], calibrated: ["CHAIN"] });
    m.restore.applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", Date.now());
    const r = await run(m, L, { close: CLOSE_WITNESS, secs: 236.167, market: WITNESS, speakers: ["STRIKE", "CHAIN"], conf });
    assert.ok(r.frames.every((f) => f.time_factor === 0.72 && f.bar_pass === false && !f.booked), `conf ${conf}`);
  }
});

test("loadState wiring: OFF leaves the restored learner untouched; an exact mode applies once, persists, and ROLLBACK returns it", async (t) => {
  const m = await load(t);
  const KEY = "OWNER_RESTORE_E1_PAIR_V1";
  const previous = process.env[KEY];
  t.after(() => { if (previous === undefined) delete process.env[KEY]; else process.env[KEY] = previous; });
  const writer = m.entry.freshEng();
  writer.learner = learnerOf(m, { shadow: ["STRIKE.itm_time", "CHAIN.oi_with_price", "STREAK.continue_young"], reviewed: ["STRIKE"], calibrated: ["CHAIN"] });
  writer.riskReady = true;
  await m.entry.persistState(writer, true);
  const statuses = (e) => ["STRIKE.itm_time", "CHAIN.oi_with_price", "STREAK.continue_young"].map((id) => e.learner.skills[id].status);

  delete process.env[KEY];
  const off = m.entry.freshEng();
  await m.entry.loadState(off);
  assert.equal(off.ownerRestore, null, "OFF: no receipt, no work");
  assert.deepEqual(statuses(off), ["SHADOW", "SHADOW", "SHADOW"]);
  assert.equal(off.learner.seat_calib_debt.STRIKE, 210);
  assert.equal(off.learner.owner_restore, undefined);

  process.env[KEY] = "true"; // not an exact mode string
  const loose = m.entry.freshEng();
  await m.entry.loadState(loose);
  assert.equal(loose.ownerRestore, null);
  assert.deepEqual(statuses(loose), ["SHADOW", "SHADOW", "SHADOW"]);

  process.env[KEY] = "STATUS_AND_STRIKE_CALIBRATION";
  const on = m.entry.freshEng();
  await m.entry.loadState(on);
  assert.equal(on.ownerRestore.outcome, "APPLIED");
  assert.deepEqual(statuses(on), ["LIVE", "LIVE", "SHADOW"]);
  assert.equal(on.learner.seat_calib_debt.STRIKE, 190);
  assert.equal(on.riskReady, true, "the rest of the load still ran");

  const again = m.entry.freshEng();
  await m.entry.loadState(again);
  assert.equal(again.ownerRestore.outcome, "ALREADY_DONE", "loadState persisted the marker automatically, preventing a second application");
  assert.deepEqual(statuses(again), ["LIVE", "LIVE", "SHADOW"]);

  process.env[KEY] = "ROLLBACK";
  const back = m.entry.freshEng();
  await m.entry.loadState(back);
  assert.equal(back.ownerRestore.outcome, "ROLLED_BACK");
  assert.deepEqual(statuses(back), ["SHADOW", "SHADOW", "SHADOW"]);
  assert.equal(back.learner.seat_calib_debt.STRIKE, 210);

  const rolledBackAgain = m.entry.freshEng();
  await m.entry.loadState(rolledBackAgain);
  assert.equal(rolledBackAgain.ownerRestore.outcome, "ALREADY_DONE", "rollback was also persisted automatically before loadState returned");
  assert.deepEqual(statuses(rolledBackAgain), ["SHADOW", "SHADOW", "SHADOW"]);
  assert.equal(rolledBackAgain.learner.seat_calib_debt.STRIKE, 210);
  assert.equal(rolledBackAgain.learner.owner_restore.state, "ROLLED_BACK");
});
