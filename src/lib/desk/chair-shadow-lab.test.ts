/**
 * Chair v2 / v3 Lab scoreboard — pure projection tests.
 *
 * The cards must (1) cite the gates from chair-v2.ts / chair-v3.ts verbatim
 * and invent none, (2) render an empty or missing ledger as collecting or
 * unavailable rather than as a zero record, and (3) never call a met count a
 * promotion.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAIR_V2_SOURCE,
  CHAIR_V3_SOURCE,
  NOT_THESE,
  buildChairV2Card,
  buildChairV3Card,
  fmtBrier,
  fmtCents,
  fmtCount,
  fmtPp,
  gateLabel,
  standingLabel,
  v2RuleLine,
} from "./chair-shadow-lab.ts";
import {
  V2_GATE_CALLS,
  V2_GATE_SAMPLES,
  V2_MARGIN_CENTS,
  V2_MIN_ENTRY_CENTS,
  V2_POPULATION,
  V2_SAMPLE_MINS,
  v2Gates,
  type V2Stats,
} from "./chair-v2.ts";
import { V3_MAX_ADJUSTMENT, V3_MIN_TRAIN, walkForwardV3, type V3FitRow, type V3Report } from "./chair-v3.ts";

const MET: V2Stats = {
  n_samples: 420,
  n_graded: 300,
  brier_v2: 0.2201,
  brier_market: 0.2312,
  ev_v2: 41.5,
  ev_v1: -12,
  calls_v2: 40,
  calls_v1: 55,
};

// ---------------------------------------------------------------------------
// Chair v2
// ---------------------------------------------------------------------------

test("v2: a missing frame is unavailable — no counts, no record, no gates", () => {
  const c = buildChairV2Card({ stats: null, weights_n: 0, fitted_at: 0 });
  assert.equal(c.id, "CHAIR_V2");
  assert.equal(c.source, CHAIR_V2_SOURCE);
  assert.equal(c.standing, "unavailable");
  assert.equal(c.n_samples, null);
  assert.equal(c.n_graded, null);
  assert.equal(c.calls_v2, null);
  assert.equal(c.ev_v2, null);
  assert.equal(c.ev_v1, null);
  assert.equal(c.brier_v2, null);
  assert.equal(c.brier_market, null);
  assert.equal(c.gates, null);
  assert.equal(c.model.weights_n, 0);
  assert.equal(c.model.fitted_at, null);
});

test("v2: samples with nothing graded is collecting, and the record stays null rather than zero", () => {
  const c = buildChairV2Card({
    stats: { n_samples: 17, n_graded: 0, brier_v2: null, brier_market: null, ev_v2: 0, ev_v1: 0, calls_v2: 0, calls_v1: 0 },
    weights_n: 0,
    fitted_at: 0,
  });
  assert.equal(c.standing, "collecting");
  assert.equal(c.n_samples, 17);
  assert.equal(c.n_graded, 0);
  assert.equal(c.calls_v2, null);
  assert.equal(c.calls_v1, null);
  assert.equal(c.ev_v2, null);
  assert.equal(c.ev_v1, null);
  assert.equal(c.brier_v2, null);
  assert.equal(c.brier_market, null);
  assert.deepEqual(c.gates, { samplesOk: false, callsOk: false, brierOk: false, met: 0 });
});

test("v2: the gates are v2Gates() from chair-v2.ts, verbatim, with the frozen thresholds", () => {
  const c = buildChairV2Card({ stats: MET, weights_n: 300, fitted_at: 1_758_000_000_000 });
  assert.deepEqual(c.gates, v2Gates(MET));
  assert.deepEqual(c.gate_rules, { samples: 300, calls: 40, ev_positive: true, brier: "v2 < market" });
  assert.equal(c.gate_rules.samples, V2_GATE_SAMPLES);
  assert.equal(c.gate_rules.calls, V2_GATE_CALLS);
  assert.equal(c.standing, "gates-met");
  assert.equal(c.n_graded, 300);
  assert.equal(c.calls_v2, 40);
  assert.equal(c.ev_v2, 41.5);
  assert.equal(c.ev_v1, -12);
  assert.equal(c.brier_v2, 0.2201);
  assert.equal(c.brier_market, 0.2312);
  assert.equal(c.model.weights_n, 300);
  assert.equal(c.model.fitted_at, new Date(1_758_000_000_000).toISOString());
});

test("v2: any one unmet gate is collecting — a full sample bar is not a winner", () => {
  const short = buildChairV2Card({ stats: { ...MET, n_graded: 299 }, weights_n: 299, fitted_at: 1 });
  assert.equal(short.standing, "collecting");
  assert.equal(short.gates?.met, 2);
  assert.equal(short.gates?.samplesOk, false);

  const red = buildChairV2Card({ stats: { ...MET, ev_v2: -0.5 }, weights_n: 300, fitted_at: 1 });
  assert.equal(red.standing, "collecting");
  assert.equal(red.gates?.callsOk, false, "40 calls with a negative net does not clear the calls gate");

  const trails = buildChairV2Card({ stats: { ...MET, brier_v2: 0.2312 }, weights_n: 300, fitted_at: 1 });
  assert.equal(trails.standing, "collecting");
  assert.equal(trails.gates?.brierOk, false, "Brier equal to the market is not below it");

  const full = buildChairV2Card({ stats: { ...MET, n_graded: 1000, calls_v2: 5 }, weights_n: 1000, fitted_at: 1 });
  assert.equal(full.standing, "collecting", "1000 graded samples with 5 calls is still collecting");
});

test("v2: the live rule line prints the frozen constants, not fresh ones", () => {
  const line = v2RuleLine();
  assert.match(line, new RegExp(`fee \\+ ${V2_MARGIN_CENTS}¢`));
  assert.match(line, new RegExp(`under ${V2_MIN_ENTRY_CENTS}¢`));
  assert.match(line, new RegExp(`${V2_SAMPLE_MINS} min left`));
  assert.match(line, new RegExp(V2_POPULATION));
  assert.equal(V2_MARGIN_CENTS, 6);
  assert.equal(V2_MIN_ENTRY_CENTS, 35);
  assert.equal(V2_SAMPLE_MINS, 7.5);
  assert.equal(V2_POPULATION, "research-quality-valid");
  const c = buildChairV2Card({ stats: null, weights_n: 0, fitted_at: 0 });
  assert.equal(c.rule, line);
  assert.deepEqual(c.rule_parts, { margin_cents: 6, min_entry_cents: 35, sample_mins: 7.5, population: "research-quality-valid" });
});

// ---------------------------------------------------------------------------
// Chair v3
// ---------------------------------------------------------------------------

const REPORT: V3Report = {
  n_rows: 500,
  n_scored: 260,
  min_train: V3_MIN_TRAIN,
  refit_every: 32,
  market_brier: 0.2105,
  v3_brier: 0.2088,
  brier_delta: 0.0017,
  market_log_loss: 0.6102,
  v3_log_loss: 0.6071,
  avg_abs_adjustment_pp: 1.42,
  max_abs_adjustment_pp: 10,
  points: [],
};

test("v3: a missing report is unavailable — nothing is printed as zero", () => {
  const c = buildChairV3Card({ report: null, model_n: null, at: null });
  assert.equal(c.id, "CHAIR_V3");
  assert.equal(c.source, CHAIR_V3_SOURCE);
  assert.equal(c.evidence, "historical-strict-walk-forward");
  assert.equal(c.standing, "unavailable");
  assert.equal(c.n_rows, null);
  assert.equal(c.n_scored, null);
  assert.equal(c.market_brier, null);
  assert.equal(c.v3_brier, null);
  assert.equal(c.model_n, null);
  assert.equal(c.gate, null);
  assert.equal(c.min_train, 240);
  assert.equal(c.max_adjustment_pp, 10);
});

test("v3: the frozen constants are cited from chair-v3.ts", () => {
  const c = buildChairV3Card({ report: REPORT, model_n: 500, at: "2026-09-18T00:00:00.000Z" });
  assert.equal(c.min_train, V3_MIN_TRAIN);
  assert.equal(c.max_adjustment_pp, Math.round(V3_MAX_ADJUSTMENT * 100));
  assert.equal(V3_MIN_TRAIN, 240);
  assert.equal(V3_MAX_ADJUSTMENT, 0.1);
});

test("v3: an empty walk-forward (under min_train) is collecting with a null record", () => {
  const wf = walkForwardV3([]);
  const c = buildChairV3Card({ report: wf, model_n: 0, at: "2026-09-18T00:00:00.000Z" });
  assert.equal(c.standing, "collecting");
  assert.equal(c.n_rows, 0);
  assert.equal(c.n_scored, 0);
  assert.equal(c.market_brier, null);
  assert.equal(c.v3_brier, null);
  assert.equal(c.brier_delta, null);
  assert.equal(c.market_log_loss, null);
  assert.equal(c.v3_log_loss, null);
  assert.equal(c.avg_abs_adjustment_pp, null);
  assert.equal(c.max_abs_adjustment_pp, null);
  assert.equal(c.model_n, 0);
  assert.deepEqual(c.gate, { brierOk: false, scored: 0 });
});

test("v3: rows below min_train score nothing, so the gate cannot be met on warm-up", () => {
  const rows: V3FitRow[] = Array.from({ length: V3_MIN_TRAIN - 1 }, (_, i) => ({
    close_time: 900_000 * (i + 1),
    winner: i % 2 ? "UP" : "DOWN",
    market_p: 0.5,
    features: { STRIKE: 0, DRIFT: 0, STREAK: 0, CASCADE: 0, CHAIN: 0, TAPE: 0, WICK: 0, FADE: 0, fair_gap: 0 },
  }));
  const wf = walkForwardV3(rows);
  assert.equal(wf.n_scored, 0);
  const c = buildChairV3Card({ report: wf, model_n: 0, at: null });
  assert.equal(c.standing, "collecting");
  assert.equal(c.n_rows, V3_MIN_TRAIN - 1);
  assert.equal(c.gate?.scored, 0);
  assert.equal(c.gate?.brierOk, false);
});

test("v3: the one gate is v3_brier < market_brier on the scored points", () => {
  const met = buildChairV3Card({ report: REPORT, model_n: 500, at: "2026-09-18T00:00:00.000Z" });
  assert.equal(met.standing, "gates-met");
  assert.deepEqual(met.gate, { brierOk: true, scored: 260 });
  assert.equal(met.n_rows, 500);
  assert.equal(met.n_scored, 260);
  assert.equal(met.market_brier, 0.2105);
  assert.equal(met.v3_brier, 0.2088);
  assert.equal(met.brier_delta, 0.0017);
  assert.equal(met.market_log_loss, 0.6102);
  assert.equal(met.v3_log_loss, 0.6071);
  assert.equal(met.avg_abs_adjustment_pp, 1.42);
  assert.equal(met.max_abs_adjustment_pp, 10);
  assert.equal(met.model_n, 500);
  assert.equal(met.report_at, "2026-09-18T00:00:00.000Z");

  const tie = buildChairV3Card({ report: { ...REPORT, v3_brier: 0.2105, brier_delta: 0 }, model_n: 500, at: null });
  assert.equal(tie.standing, "collecting", "equal Brier is not below the market");
  assert.equal(tie.gate?.brierOk, false);

  const worse = buildChairV3Card({ report: { ...REPORT, v3_brier: 0.2131, brier_delta: -0.0026 }, model_n: 500, at: null });
  assert.equal(worse.standing, "collecting");
  assert.equal(worse.gate?.brierOk, false);
});

// ---------------------------------------------------------------------------
// Copy and formatters
// ---------------------------------------------------------------------------

test("a met count is never labelled promotion, and unavailable is never a zero", () => {
  assert.match(standingLabel("gates-met"), /not promotion/);
  assert.match(standingLabel("gates-met"), /review required/);
  assert.match(standingLabel("unavailable"), /not a zero result/);
  assert.equal(standingLabel("collecting"), "Collecting");
  assert.equal(gateLabel(null), "no evidence yet");
  assert.equal(gateLabel(true), "met");
  assert.equal(gateLabel(false), "not met");
});

test("formatters print — for null and never coerce it to 0", () => {
  assert.equal(fmtCount(null), "—");
  assert.equal(fmtCount(0), "0");
  assert.equal(fmtCents(null), "—");
  assert.equal(fmtCents(0), "0.0¢");
  assert.equal(fmtCents(41.5), "+41.5¢");
  assert.equal(fmtCents(-12), "-12.0¢");
  assert.equal(fmtBrier(null), "—");
  assert.equal(fmtBrier(0.2201), "0.2201");
  assert.equal(fmtPp(null), "—");
  assert.equal(fmtPp(1.42), "1.42pp");
});

test("the disambiguation names the entry policies this page is not", () => {
  assert.deepEqual([...NOT_THESE], ["FLOOR_SELECTIVE_V2", "ENTRY_SELECTIVE_V3"]);
  assert.equal(CHAIR_V2_SOURCE, "src/lib/desk/chair-v2.ts");
  assert.equal(CHAIR_V3_SOURCE, "src/lib/desk/chair-v3.ts");
});
