import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
if (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim()) {
  throw new Error("risk reservation persistence integration refuses production DATABASE_URL");
}
const now = Date.parse("2026-09-16T15:05:00Z");

function snapshot(asOf) {
  return {
    as_of: asOf, close_time: now + 420_000, ticker: "KXBTC15M-26SEP161015-15",
    mins_left: (now + 420_000 - asOf) / 60_000, secs_left: (now + 420_000 - asOf) / 1000,
    yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, yes_bid_size: 7, no_bid_size: 5,
    edge_up: 6, edge_down: -8, fair_yes: 90, lab_fair_yes: 92, lab_age_s: 1,
    fee_yes: 2, fee_no: 2, spread_cents: 1, leftover_cents: -1,
    spot: 80_000, strike: 79_000, spot_age_s: 1, quote_age_s: 1, print_age_s: 1, quote_seq: 1,
    obs: { receipt_ts: asOf - 1000, gap: "ok" },
    health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
    phase: "MID", regime_key: "integration", session: "US_AM", demo: false, chalk: false,
    ret5: 0, ret15: 0, ret30: 0, ret1h: 0, atr: 1, atr_pct: 0.2,
    vol_median: 1, vol_last: 1, vol_percentile: 0.5, location: "MID", range_pos: 0.5,
    imbalance: 0, imbalance_hist: [], candles_1m: [], window_memory: {}, clock_key: "integration",
    funding_rate: 0, funding_apr: 0, funding_time: asOf, funding_history: [], funding_series: [],
    open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [],
    oi_delta_3m: 0, oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0,
    liq_long_usd: 0, liq_short_usd: 0, liq_n: 0, liq_source: "", force_n: 0, cascade_proxy: false,
    fear_greed: 50, fear_greed_label: "neutral", fng_history: [],
  };
}

const vote = (seat) => ({
  seat, lean: "UP", confidence: 100, features: {}, reasoning: "integration fixture",
  skill_used: ({ STRIKE: "STRIKE.itm_time", INDEX: "INDEX.settle_fair", STREAK: "STREAK.continue_young" })[seat], skill_status: "LIVE", shadow: null, paper: [], thresh_used: [],
  skill_n: 100, skill_hits: 80, skill_wilson: 0.8, hypothesis: "", evidence: [], counter: "",
  invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID",
});


test("known-valid reservation save recovers only after exact complete durable acknowledgement", async (t) => {
  const vite = await createServer({ configFile: false, envDir: false, resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  t.after(() => vite.close());
  const [{ runChair }, { freshLearner }, { DEFAULT_SETTINGS }, { __entryIntegration: api }, dbModule] = await Promise.all([
    vite.ssrLoadModule("/src/lib/desk/chair.ts"), vite.ssrLoadModule("/src/lib/desk/skills.ts"),
    vite.ssrLoadModule("/src/lib/desk/persist.ts"), vite.ssrLoadModule("/src/lib/desk/server-engine.ts"), vite.ssrLoadModule("/src/lib/db.ts"),
  ]);
  assert.equal(dbModule.dbSource, "pglite", "actual persistence uses disposable database only");
  const db = await dbModule.getSql();
  const create = () => db.query("create table desk_state (id text primary key, state jsonb not null, updated_at timestamptz default now())");
  const saved = async () => (await db.query("select state from desk_state where id = $1", ["live"]))[0].state;
  const learner = freshLearner();
  for (const seat of ["STRIKE", "INDEX", "STREAK"]) {
    learner.seat_n[seat] = 100; learner.seat_hits[seat] = 80; learner.seat_w[seat] = 0.2;
  }
  for (const id of ["STRIKE.itm_time", "INDEX.settle_fair", "STREAK.continue_young"]) {
    Object.assign(learner.skills[id], { status: "LIVE", n: 100, ev_n: 100, wilson: 0.8, ev: 5, manual_hold: false, min_walkforward_n: undefined, min_regime_n: undefined });
  }
  // Synthetic mechanical fixture; never presented as current production qualification.
  const votes = [vote("STRIKE"), vote("INDEX"), vote("STREAK")];
  const e = api.freshEng();
  e.learner = learner;
  e.riskReady = true; e.selectiveStart = now - 86_400_000;
  await db.query("drop table if exists desk_state");
  let confirmedSnap, confirmedChair;
  for (const elapsed of [0, 4_000, 8_000]) {
    const snap = snapshot(now + elapsed);
    const chair = api.applyEntryMode(e, snap, runChair(votes, snap, learner, DEFAULT_SETTINGS));
    await api.noteCall(e, snap, chair, votes);
    confirmedSnap = snap; confirmedChair = chair;
  }
  assert.equal(e.riskCalls.length, 1);
  assert.equal(e.riskReady, false, "missing reservation write acknowledgement closes readiness");
  assert.equal(await api.persistState(e, true), false, "a second unavailable write stays blocked");
  assert.equal(e.riskReady, false);
  await create();
  assert.equal(await api.persistState(e, true), true);
  assert.equal(e.riskReady, true, "exact complete acknowledged retry releases only this process-local proof");
  assert.equal(e.riskReservationPending, null);
  assert.equal((await saved()).risk_history_valid, true);
  assert.equal((await saved()).risk_calls.length, 1);
  assert.equal("riskReservationPending" in await saved(), false, "pending provenance is never stored");
  const restarted = api.freshEng();
  await api.loadState(restarted);
  assert.equal(restarted.riskReady, true);
  assert.equal(restarted.riskCalls.length, 1);
  assert.equal(restarted.riskReservationPending, null);
  await api.noteCall(e, confirmedSnap, confirmedChair, votes);
  assert.equal(e.riskCalls.length, 1, "retry cannot manufacture a second booking");

  const invalid = api.freshEng();
  invalid.riskCalls = structuredClone(e.riskCalls);
  invalid.callLog = structuredClone(e.callLog);
  assert.equal(await api.persistState(invalid, true), true);
  assert.equal(invalid.riskReady, false, "syntactically valid history with no provenance cannot reopen");
  assert.equal((await saved()).risk_history_valid, false);
  const invalidRestart = api.freshEng();
  await api.loadState(invalidRestart);
  assert.equal(invalidRestart.riskReady, false);
  assert.equal(invalidRestart.riskReservationPending, null);
  const reloaded = api.freshEng();
  reloaded.riskCalls = structuredClone(e.riskCalls);
  reloaded.callLog = structuredClone(e.callLog);
  reloaded.riskReservationPending = JSON.stringify(reloaded.riskCalls);
  await api.loadState(reloaded);
  assert.equal(reloaded.riskReady, false);
  assert.equal(reloaded.riskReservationPending, null, "a durable invalid load clears stale process-local proof");
  assert.equal(await api.persistState(reloaded, true), true);
  assert.equal(reloaded.riskReady, false);
  assert.equal((await saved()).risk_history_valid, false);

  const malformed = api.freshEng();
  malformed.riskCalls = [{ ...e.riskCalls[0], cents: NaN }];
  malformed.riskReservationPending = JSON.stringify(malformed.riskCalls);
  assert.equal(await api.persistState(malformed, true), true);
  assert.equal(malformed.riskReady, false, "even matching pending proof cannot release malformed history");
  assert.equal((await saved()).risk_history_valid, false);

  const incomplete = api.freshEng();
  incomplete.riskCalls = [];
  incomplete.callLog = structuredClone(e.callLog);
  incomplete.riskReservationPending = JSON.stringify([]);
  assert.equal(await api.persistState(incomplete, true), true);
  assert.equal(incomplete.riskReady, false, "a call-log reservation missing from risk snapshot cannot release");
  assert.equal((await saved()).risk_history_valid, false);

  const changing = api.freshEng();
  changing.riskCalls = structuredClone(e.riskCalls);
  changing.callLog = structuredClone(e.callLog);
  changing.riskReservationPending = JSON.stringify(changing.riskCalls);
  let release;
  changing.stateWrite = new Promise((resolve) => { release = resolve; });
  const older = api.persistState(changing, true);
  changing.riskCalls[0].cents += 1;
  const newer = api.persistState(changing, true);
  assert.equal(changing.riskReady, false, "no acknowledgement yet");
  release();
  assert.equal(await older, true);
  assert.equal(changing.riskReady, false, "an acknowledged old snapshot cannot release changed memory");
  assert.equal(await newer, true);
  assert.equal(changing.riskReady, false, "successful changed-history write carries no original proof");
  assert.equal((await saved()).risk_history_valid, false, "capture-order writes preserve newest fail-closed history");

  const queued = api.freshEng();
  queued.riskCalls = structuredClone(e.riskCalls);
  queued.callLog = structuredClone(e.callLog);
  queued.riskReservationPending = JSON.stringify(queued.riskCalls);
  let releaseQueued;
  queued.stateWrite = new Promise((resolve) => { releaseQueued = resolve; });
  const originalCents = queued.riskCalls[0].cents;
  const oldValid = api.persistState(queued, true);
  queued.riskCalls[0].cents += 1;
  const newInvalid = api.persistState(queued, true);
  queued.riskCalls[0].cents = originalCents;
  releaseQueued();
  assert.equal(await oldValid, true);
  assert.equal(queued.riskReady, false, "even matching current rows cannot release while a newer invalid write is queued");
  assert.equal(await newInvalid, true);
  assert.equal(queued.riskReady, false);
  assert.equal((await saved()).risk_history_valid, false);
});
