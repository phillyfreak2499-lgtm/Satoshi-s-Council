import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
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


test("real Chair authority suppression retains distinct producer and raw tape evidence", async (t) => {
  const vite = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  t.after(() => vite.close());
  const [{ runChair }, { freshLearner }, { DEFAULT_SETTINGS }, { classifyTape }] = await Promise.all([
    vite.ssrLoadModule("/src/lib/desk/chair.ts"), vite.ssrLoadModule("/src/lib/desk/skills.ts"),
    vite.ssrLoadModule("/src/lib/desk/persist.ts"), vite.ssrLoadModule("/src/lib/desk/research-factory-tape.ts"),
  ]);
  const learner = freshLearner();
  learner.skills["STRIKE.itm_time"].status = "SHADOW";
  const votes = [{ ...vote("STRIKE"), skill_status: "SHADOW", raw_lean: "UP", raw_conf: 100 }];
  const snap = snapshot(now);
  const chair = runChair(votes, snap, learner, DEFAULT_SETTINGS);
  assert.equal(chair.lean, "WAIT");
  assert.equal(chair.rows[0].lean, "WAIT");
  assert.equal(chair.rows[0].forced_sit, true);
  const frame = { snap, chair, votes, audit: null, daily: null, call_log: [] };
  const before = JSON.stringify({ votes, learner, snap, chair });
  const recorded = classifyTape(frame);
  assert.equal(recorded.primary_blocker, "STATUS_OR_AUTHORITY_SUPPRESSED");
  assert.equal(recorded.stage, "CANDIDATE", "an observed producer side reached candidate, without admitted direction");
  assert.equal(recorded.values.directional_seats, 0);
  assert.equal(recorded.values.raw_directional_seats, 1);
  assert.equal(recorded.values.producer_directional_seats, 1);
  assert.deepEqual(recorded.evidence.directional_seats, []);
  assert.deepEqual(recorded.evidence.raw_directional_seats, ["STRIKE"]);
  assert.deepEqual(recorded.evidence.producer_directional_seats, ["STRIKE"]);
  assert.equal(JSON.stringify({ votes, learner, snap, chair }), before, "measurement grants no authority or mutation");
  const whisper = [{ ...votes[0], lean: "WAIT", forced_sit: true, confidence: 70 }];
  const quietChair = runChair(whisper, snap, learner, DEFAULT_SETTINGS);
  const quiet = classifyTape({ ...frame, votes: whisper, chair: quietChair });
  assert.equal(quiet.primary_blocker, "NO_RESEARCH_READ", "no producer speaker does not assert authority suppression");
  assert.equal(quiet.values.raw_directional_seats, 1);
  assert.equal(quiet.values.producer_directional_seats, 0);
  assert.equal(quiet.values.directional_seats, 0);
  const legacy = classifyTape({ ...frame, votes: undefined });
  assert.equal(legacy.values.raw_directional_seats, null, "missing raw inputs remain unknown");
  assert.equal(legacy.values.producer_directional_seats, null);
  assert.equal(legacy.primary_blocker, "NO_RESEARCH_READ");
});
