/**
 * Actual Chair -> public hearing labels. Synthetic market/learner fixtures,
 * no production state or bookings. A producer direction is not Chair admission.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const CLOSE = Date.parse("2026-09-18T22:30:00Z");
const AS_OF = CLOSE - 484_900;
const CARD_OF = {
  STRIKE: "STRIKE.itm_time",
  CHAIN: "CHAIN.oi_with_price",
  CARRY: "CARRY.trend_carry",
  CLOCK: "CLOCK.session_prior",
};

/** Market values from the existing last-fill-shape fixture; no real replay claim. */
function snapshot() {
  return {
    as_of: AS_OF, close_time: CLOSE, ticker: "KXBTC15M-26SEP181830-30",
    mins_left: (CLOSE - AS_OF) / 60_000, secs_left: (CLOSE - AS_OF) / 1000,
    yes_ask: 81, yes_bid: 80, no_ask: 20, no_bid: 19, yes_bid_size: 7, no_bid_size: 5,
    edge_up: 4, edge_down: -30, fair_yes: 87, lab_fair_yes: 85, lab_age_s: 1,
    fee_yes: 2, fee_no: 2, spread_cents: 1, leftover_cents: -1, combined_ask_cents: 101,
    chalk: false, spot: 80_000, strike: 79_900, spot_age_s: 1, quote_age_s: 1,
    print_age_s: 1, quote_seq: 1, obs: { receipt_ts: AS_OF - 1000, gap: "ok", last_ok_ts: AS_OF - 1000 },
    health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
    phase: "MID", regime_key: "hearing-fixture", session: "US_PM", demo: false,
    ret5: 0, ret15: 0, ret30: 0, ret1h: 0, atr: 1, atr_pct: 0.2,
    vol_median: 1, vol_last: 1, vol_percentile: 0.5, location: "MID", range_pos: 0.5,
    imbalance: 0, imbalance_hist: [], candles_1m: [], window_memory: {}, clock_key: "hearing-fixture",
    funding_rate: 0, funding_apr: 0, funding_time: AS_OF, funding_history: [], funding_series: [],
    open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [],
    oi_delta_3m: 0, oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0,
    liq_long_usd: 0, liq_short_usd: 0, liq_n: 0, liq_source: "", force_n: 0, cascade_proxy: false,
    fear_greed: 50, fear_greed_label: "neutral", fng_history: [],
  };
}

async function modules(t) {
  const vite = await createServer({ envDir: false, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const loaded = await Promise.all(["skills", "persist", "chair", "types", "pro-floor", "seat-lean", "support-eligibility"].map((name) => vite.ssrLoadModule(`/src/lib/desk/${name}.ts`)));
  return Object.assign({}, ...loaded);
}

function setup(m, seats, cardChanges = {}) {
  const learner = m.freshLearner();
  for (const seat of seats) {
    const id = CARD_OF[seat];
    assert.ok(learner.skills[id], `${id} is an actual registered card`);
    Object.assign(learner.skills[id], {
      status: "LIVE", n: 100, ev_n: 100, hits: 95, wilson: 0.9, ev: 5, manual_hold: false,
      ...cardChanges[id],
    });
    learner.seat_n[seat] = 100;
    learner.seat_hits[seat] = 95;
    learner.seat_calib_debt[seat] = 0;
  }
  const votes = m.SEAT_IDS.map((seat) => {
    const directional = seats.includes(seat);
    return {
      seat, lean: directional ? "UP" : "WAIT", confidence: directional ? 70 : 50,
      raw_lean: directional ? "UP" : "WAIT", raw_conf: directional ? 70 : 50,
      features: {}, reasoning: "SYNTHETIC selected read", skill_used: directional ? CARD_OF[seat] : "SIT",
      skill_status: directional ? learner.skills[CARD_OF[seat]].status : "SIT",
      shadow: null, paper: [], thresh_used: [], skill_n: 100, skill_hits: 95, skill_wilson: 0.9,
      hypothesis: "", evidence: [], counter: "", invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID",
    };
  });
  const snap = snapshot();
  const before = JSON.stringify({ votes, snap });
  const learnerBefore = structuredClone(learner);
  delete learnerBefore.last_calib_tax_line;
  const chair = m.runChair(votes, snap, learner, m.DEFAULT_SETTINGS, "WAIT", []);
  assert.equal(JSON.stringify({ votes, snap }) === before, true, "real Chair admission leaves retained producer inputs unchanged");
  const learnerAfter = structuredClone(learner);
  delete learnerAfter.last_calib_tax_line;
  assert.equal(JSON.stringify(learnerAfter) === JSON.stringify(learnerBefore), true, "only the Chair's existing tax annotation may change; cards, authority and counters remain identical");
  return { learner, votes, snap, chair };
}

function display(m, frame, seat) {
  const vote = frame.votes.find((v) => v.seat === seat);
  const row = frame.chair.rows.find((r) => r.seat === seat);
  assert.ok(row, "the real Chair supplied the displayed row");
  const before = JSON.stringify(frame);
  const fact = m.seatFactFor(seat, vote, row, frame.learner.knobs, frame.snap.as_of);
  const lean = m.seatDirectionalLean(fact, frame.snap);
  assert.equal(JSON.stringify(frame) === before, true, "presentation leaves the complete actual Chair/producer frame unchanged");
  return { vote, row, fact, lean };
}

test("actual Chair admission and public specialist hearing labels agree", async (t) => {
  const m = await modules(t);

  for (const [name, changed] of [
    ["immature LIVE", { status: "LIVE", n: 49, ev_n: 49 }],
    ["mature SHADOW", { status: "SHADOW" }],
  ]) {
    await t.test(`${name}: raw direction remains visible but the admitted forced sit is not SPEAKING`, () => {
      const frame = setup(m, ["STRIKE", "CHAIN"], { [CARD_OF.STRIKE]: changed });
      const { vote, row, fact, lean } = display(m, frame, "STRIKE");
      assert.equal(vote.lean, "UP", "producer direction is the trigger for the old presentation regression");
      assert.equal(row.lean, "WAIT");
      assert.equal(row.forced_sit, true, "actual authority guard forced the sit");
      assert.equal(fact.final_lean, "WAIT", "the display follows the admitted Chair row");
      assert.equal(fact.raw_lean, "UP");
      assert.equal(lean.score, 85, "retained selected raw strength still drives the meter");
      assert.equal(lean.researchSide, "UP");
      assert.equal(lean.direction, "BULLISH");
      assert.notEqual(lean.status, "SPEAKING");
      assert.equal(lean.isAuthorizedSpeaker, false);
      assert.equal(lean.heardLean, "WAIT");
      assert.ok(!m.eligibleSupportRows(frame.chair, "UP").some((r) => r.seat === "STRIKE"));
    });
  }

  await t.test("mature eligible LIVE positive control remains SPEAKING", () => {
    const frame = setup(m, ["STRIKE", "CHAIN"]);
    const { row, fact, lean } = display(m, frame, "STRIKE");
    assert.equal(row.lean, "UP");
    assert.equal(row.forced_sit, false);
    assert.equal(row.status, "LIVE");
    assert.ok(row.weight > 0 && row.contribution > 0);
    assert.equal(fact.final_lean, "UP");
    assert.equal(lean.score, 85);
    assert.equal(lean.status, "SPEAKING");
    assert.equal(lean.isAuthorizedSpeaker, true);
    assert.equal(lean.heardLean, "UP");
    assert.ok(m.eligibleSupportRows(frame.chair, "UP").some((r) => r.seat === "STRIKE"));
  });

  await t.test("actual FOLDED row is grouped Chair evidence and never separate entry support", () => {
    const frame = setup(m, ["CARRY", "CHAIN"]);
    const folded = frame.chair.rows.find((r) => r.folded && ["CARRY", "CHAIN"].includes(r.seat));
    assert.ok(folded, "actual same-family Chair fold occurred");
    const { row, lean } = display(m, frame, folded.seat);
    assert.equal(row.status, "FOLDED");
    assert.equal(row.lean, "UP");
    assert.equal(row.forced_sit, false);
    assert.ok(row.weight > 0 && row.contribution > 0, "folding preserves a scaled score contribution");
    assert.equal(lean.score, 85);
    assert.equal(lean.status, "FOLDED");
    assert.equal(lean.heardLean, "UP", "the Chair heard the grouped evidence");
    assert.equal(lean.isAuthorizedSpeaker, true, "grouped score evidence is heard without becoming separate entry support");
    assert.match(lean.statusPlain, /folded.*not separate entry support/i);
    assert.equal(m.eligibleSupportRows(frame.chair, "UP").filter((r) => ["CARRY", "CHAIN"].includes(r.seat)).length, 1);
    assert.ok(!m.eligibleSupportRows(frame.chair, "UP").some((r) => r.seat === folded.seat));
  });

  await t.test("actual CLOCK-only zero-contribution FOLDED read remains research context with no heard direction", () => {
    const frame = setup(m, ["CLOCK"]);
    const { row, lean } = display(m, frame, "CLOCK");
    assert.equal(row.lean, "UP");
    assert.equal(row.folded, false, "CLOCK alone uses the FOLDED status without a family-fold flag");
    assert.equal(row.status, "FOLDED");
    assert.ok(row.weight > 0, "the real row retains weight while its signed score is zero");
    assert.equal(row.signed, 0);
    assert.equal(row.contribution, 0);
    assert.equal(lean.score, 85);
    assert.equal(lean.researchSide, "UP");
    assert.equal(lean.status, "FOLDED");
    assert.equal(lean.isAuthorizedSpeaker, false);
    assert.equal(lean.heardLean, "WAIT");
    assert.ok(!m.eligibleSupportRows(frame.chair, "UP").some((r) => r.seat === "CLOCK"));
  });

  await t.test("a retained producer read without its Chair row is research context, never a hearing", () => {
    const frame = setup(m, ["STRIKE", "CHAIN"]);
    const vote = frame.votes.find((v) => v.seat === "STRIKE");
    const before = JSON.stringify(frame);
    const fact = m.seatFactFor("STRIKE", vote, undefined, frame.learner.knobs, frame.snap.as_of);
    const lean = m.seatDirectionalLean(fact, frame.snap);
    assert.equal(JSON.stringify(frame) === before, true, "presentation preserves every input field");
    assert.equal(lean.score, 85);
    assert.equal(lean.researchSide, "UP");
    assert.equal(lean.status, "RESEARCH READ");
    assert.equal(lean.isAuthorizedSpeaker, false);
    assert.equal(lean.heardLean, "WAIT");
  });
});
