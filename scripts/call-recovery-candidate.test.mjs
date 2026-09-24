import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

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
  const [bots, recovery, chair, persist, skills] = await Promise.all([
    vite.ssrLoadModule("/src/lib/desk/bots.ts"), vite.ssrLoadModule("/src/lib/desk/call-recovery-candidate.ts"),
    vite.ssrLoadModule("/src/lib/desk/chair.ts"), vite.ssrLoadModule("/src/lib/desk/persist.ts"),
    vite.ssrLoadModule("/src/lib/desk/skills.ts"),
  ]);
  return { ...bots, ...recovery, ...chair, ...persist, ...skills };
}

test("actual producer -> recovery adapter -> actual Chair retains full paper-card provenance", async (t) => {
  const m = await modules(t);
  const learner = m.freshLearner();
  learner.skills["DRIFT.aligned_3h"].status = "SHADOW";
  const frame = m.runBotsWithEvaluatedCandidates(snapshot(), learner);
  const selected = frame.votes.find((item) => item.seat === "DRIFT");
  const paper = selected.paper.find((item) => item.id === "DRIFT.aligned_3h");
  assert.equal(selected.skill_used, "SIT");
  assert.equal(paper.lean, "UP");
  const recovery = m.projectInactiveE1Recovery(frame, learner);
  const candidate = recovery.candidates.find((item) => item.card_id === paper.id);
  assert.ok(candidate.vote.reasoning);
  assert.deepEqual(candidate.vote.features, frame.evaluated.find((item) => item.skill_used === paper.id).features);
  assert.deepEqual(frame.votes.find((item) => item.seat === "DRIFT"), selected, "projection does not mutate the frame");
  const chair = m.runChair(recovery.simulated.votes, snapshot(), recovery.simulated.learner, m.DEFAULT_SEATS);
  assert.equal(chair.lean, "UP", "the actual Chair can hear the recovered vote in this controlled frame");
  assert.equal(chair.gates.find((gate) => gate.id === "quiet").pass, false, "the exact remaining Chair blocker is the quiet gate");
  assert.equal(recovery.active, false, "a Chair lean is not presented as a qualified fill or activated order");
  assert.ok(chair.gates.some((gate) => !gate.pass), "actual Chair exposes remaining blockers");
});

const vote = (seat, skill, lean, status = "SHADOW") => ({
  seat, lean, raw_lean: lean, confidence: 70, raw_conf: 70, features: { source: skill }, reasoning: skill,
  skill_used: skill, skill_status: status, shadow: null, paper: [], thresh_used: [], skill_n: 1, skill_hits: 0,
  skill_wilson: 0, hypothesis: skill, evidence: [skill], counter: "", invalidate_if: "", health: "LIVE",
  feed_age_s: 1, eyes: skill, phase: "MID",
});

test("candidate selection is deterministic, one per seat, and paper-only disconnect is detected", async (t) => {
  const m = await modules(t);
  const learner = m.freshLearner();
  const base = vote("DRIFT", "SIT", "WAIT", "SIT");
  base.paper = [{ id: "DRIFT.aligned_3h", lean: "UP", confidence: 70, status: "SHADOW" }];
  const frame = { version: "E1_RECOVERY_V1_INACTIVE", ticker: "T", close_time: 2, as_of: 1, votes: [base], evaluated: [
    vote("DRIFT", "DRIFT.pullback_in_trend", "DOWN"), vote("DRIFT", "DRIFT.aligned_3h", "UP"), vote("DRIFT", "DRIFT.aligned_3h", "UP"),
  ] };
  for (const evaluated of [frame.evaluated, [...frame.evaluated].reverse()]) {
    assert.deepEqual(m.projectInactiveE1Recovery({ ...frame, evaluated }, learner).candidates.map((item) => item.card_id), ["DRIFT.aligned_3h"]);
  }
  assert.equal(m.projectInactiveE1Recovery({ ...frame, evaluated: [] }, learner).candidates.length, 0,
    "paper metadata cannot invent unavailable full provenance");
});
