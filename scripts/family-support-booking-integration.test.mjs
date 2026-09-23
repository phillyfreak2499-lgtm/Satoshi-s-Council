import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (typeof databaseUrl === "string" && databaseUrl.trim()) {
  throw new Error("family-support booking integration refuses nonempty DATABASE_URL before Vite or database startup");
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
  skill_used: "STRIKE.itm_time", skill_status: "LIVE", shadow: null, paper: [], thresh_used: [],
  skill_n: 100, skill_hits: 80, skill_wilson: 0.8, hypothesis: "", evidence: [], counter: "",
  invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID",
});

test("real Chair family fold confirms once and persists one paper position", async (t) => {
  const { createServer } = await import("vite");
  const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const [{ runChair }, { freshLearner }, { DEFAULT_SETTINGS }, { __entryIntegration }, dbModule] = await Promise.all([
    vite.ssrLoadModule("/src/lib/desk/chair.ts"),
    vite.ssrLoadModule("/src/lib/desk/skills.ts"),
    vite.ssrLoadModule("/src/lib/desk/persist.ts"),
    vite.ssrLoadModule("/src/lib/desk/server-engine.ts"),
    vite.ssrLoadModule("/src/lib/db.ts"),
  ]);
  assert.equal(dbModule.dbSource, "pglite", "integration SQL must use the disposable PGlite backend");
  const db = await dbModule.getSql();

  const learner = freshLearner();
  for (const seat of ["STRIKE", "INDEX", "STREAK"]) {
    learner.seat_n[seat] = 100; learner.seat_hits[seat] = 80; learner.seat_w[seat] = 0.2;
  }
  Object.assign(learner.skills["STRIKE.itm_time"], {
    status: "LIVE", n: 100, ev_n: 100, wilson: 0.8, ev: 5,
    manual_hold: false, min_walkforward_n: undefined, min_regime_n: undefined,
  });
  const votes = [vote("STRIKE"), vote("INDEX"), vote("STREAK")];
  const settings = { ...DEFAULT_SETTINGS, bar_override: 0.1 };
  const e = __entryIntegration.freshEng();
  e.riskReady = true;
  e.selectiveStart = now - 86_400_000;

  for (const elapsed of [0, 4_000, 8_000]) {
    const snap = snapshot(now + elapsed);
    const rawChair = runChair(votes, snap, learner, settings);
    const family = rawChair.rows.filter((row) => row.seat === "STRIKE" || row.seat === "INDEX");
    assert.equal(family.filter((row) => !row.folded).length, 1,
      "the original bug folded both correlated rows, so this assertion detects it");
    assert.equal(family.filter((row) => row.folded).length, 1);
    const chair = __entryIntegration.applyEntryMode(e, snap, rawChair);
    await __entryIntegration.noteCall(e, snap, chair, votes);
    assert.equal(e.riskCalls.length, elapsed < 8_000 ? 0 : 1, "booking waits for three frames over eight seconds");
  }

  const confirmedSnap = snapshot(now + 8_000);
  const confirmedChair = __entryIntegration.applyEntryMode(e, confirmedSnap, runChair(votes, confirmedSnap, learner, settings));
  await __entryIntegration.noteCall(e, confirmedSnap, confirmedChair, votes);
  assert.equal(e.riskCalls.length, 1, "a duplicate booking attempt cannot add an in-memory position");
  const rows = await db.query("select state from desk_state where id = $1", ["live"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state.risk_calls.length, 1, "normal persistence stores exactly one paper position");
  assert.equal(rows[0].state.risk_calls[0].ticker, confirmedSnap.ticker);
});

test("integration refuses DATABASE_URL before Vite or SQL startup", () => {
  const childEnv = { ...process.env, DATABASE_URL: "postgresql://dummy.invalid/never-connect" };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--test", fileURLToPath(import.meta.url)], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    timeout: 30_000,
  });
  const output = `${child.stdout}\n${child.stderr}`;
  assert.notEqual(child.status, 0);
  assert.match(output, /refuses nonempty DATABASE_URL before Vite or database startup/);
  assert.doesNotMatch(output, /vite.*optimizer|ECONN|ENOTFOUND|connection refused/i,
    "the safety rejection happens before Vite optimization or a database connection attempt");
});
