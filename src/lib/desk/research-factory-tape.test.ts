import assert from "node:assert/strict";
import test from "node:test";
import { SELECTIVE_PARAMS } from "./floor-policy.ts";
import {
  CHECKPOINTS, WAIT_REASONS, classifyTape, conditionMet, gradeWindow, shouldRecord,
  type Audit, type TapeEvent, type TapeFrame,
} from "./research-factory-tape.ts";
import {
  abstentionReport, briefAccuracy, marginalValue, redundancy, researchSummary, signalValueReport, stageUnlocks, survivalReport, transitionReport,
  type SignalObs, type TapeWindow,
} from "./research-factory-insight.ts";
import type { WindowFact } from "./research-factory-analysis.ts";
import { chairWaitReason } from "./telemetry.ts";
import type { ChairResult, SeatId, SeatRow, Snapshot } from "./types";

// ---------------------------------------------------------------------------
// Fixtures: a production frame as the engine publishes it.
// ---------------------------------------------------------------------------

const close = Date.parse("2026-09-28T15:15:00Z");
const ticker = "KXBTC15M-26SEP281015-15";
const snap = (secsLeft = 300, extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: close - secsLeft * 1000, close_time: close, ticker, mins_left: secsLeft / 60, secs_left: secsLeft, demo: false,
  yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, no_bid_size: 40, yes_bid_size: 30, yes_mid: 84.5, edge_up: 5, edge_down: -9,
  lab_fair_yes: 92, lab_age_s: 1, quote_seq: 7, regime_key: "trend-quiet", obs: { receipt_ts: close - secsLeft * 1000 - 500, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false }, ...extra,
} as Snapshot);
const row = (seat: SeatId, lean: "UP" | "DOWN" | "WAIT", extra: Partial<SeatRow> = {}): SeatRow =>
  ({ seat, lean, health: "LIVE", status: "LIVE", folded: false, weight: 0.1, forced_sit: false, conf: 64, ...extra }) as SeatRow;
type ChairOpts = { lean?: "UP" | "DOWN" | "WAIT"; rows?: SeatRow[]; vs_bar?: number; bar?: number; dir_mass?: number; gates?: Array<{ id: string; pass: boolean; hard: boolean; value?: string }>; sit_term?: number };
const chair = (o: ChairOpts = {}): ChairResult => {
  const rows = o.rows ?? [row("STREAK", "UP"), row("CHAIN", "UP"), row("DRIFT", "WAIT")];
  return {
    lean: o.lean ?? "WAIT", score: 0.5, vs_bar: o.vs_bar ?? 0.4, bar: o.bar ?? 0.5, dir_mass: o.dir_mass ?? 0.2, sit_mass: 0.9, aggressiveness: 1.15, confidence: 60,
    bar_breakdown: { base: 0.3, quiet: 0, weekend: 0, phase: 0.04, law_miss1: 0, calib_tax: 0, sit_mass: o.sit_term ?? 0.16, knn: 0, pre_clamp: o.bar ?? 0.5, final: o.bar ?? 0.5 },
    gates: (o.gates ?? [{ id: "bar", pass: (o.lean ?? "WAIT") !== "WAIT", hard: true }]).map((g) => ({ label: g.id, value: g.value ?? "", ...g })),
    quorum: { up: rows.filter((r) => r.lean === "UP").length, down: rows.filter((r) => r.lean === "DOWN").length, wait: rows.filter((r) => r.lean === "WAIT").length }, rows,
  } as unknown as ChairResult;
};
const ALL = ["risk_history", "daily_risk", "complete_window", "direction", "team", "supporters", "families", "opposition", "time", "feeds", "quote", "profit_reserve", "model_edge", "index_fresh", "index_edge", "confirmation"];
const audit = (fail: string[] = [], o: Partial<Audit> = {}, side = true): Audit => ({
  mode: "normal", positioned: false, eligible: false,
  checks: ALL.map((id) => ({ id, label: id, pass: !side && ["team", "supporters", "families", "opposition", "quote", "profit_reserve", "model_edge", "index_edge", "confirmation"].includes(id) ? null : !fail.includes(id) })),
  ...o,
});
const daily = { tightened: false } as TapeFrame["daily"];
const frame = (o: Partial<TapeFrame> = {}): TapeFrame => ({ snap: snap(), chair: chair(), audit: audit(["direction"], {}, false), daily, call_log: [], ...o });

// ---------------------------------------------------------------------------
// A. Structured WAIT taxonomy.
// ---------------------------------------------------------------------------

test("the taxonomy covers every required class, plus DIRECTION_CONFLICT and UNKNOWN rather than a guess", () => {
  for (const r of ["NO_RESEARCH_READ", "DIRECTION_BELOW_BAR", "STATUS_OR_AUTHORITY_SUPPRESSED", "TEAM_FAIL", "SUPPORTER_FAIL", "FAMILY_DIVERSITY_FAIL", "OPPOSITION_FAIL", "QUOTE_FAIL", "ENTRY_PRICE_FAIL", "MODEL_EDGE_FAIL", "INDEX_EDGE_FAIL", "CONFIRMATION_INCOMPLETE", "FEED_OR_DATA_HEALTH_FAIL", "TIME_WINDOW_FAIL", "DAILY_RISK_FAIL", "OTHER_EXPLICIT", "UNKNOWN"]) {
    assert.ok((WAIT_REASONS as readonly string[]).includes(r), r);
  }
});

test("each Chair WAIT is classified from production's own fields", () => {
  const silent = classifyTape(frame({ chair: chair({ rows: [row("STREAK", "WAIT"), row("CHAIN", "WAIT")] }) }));
  assert.equal(silent.primary_blocker, "NO_RESEARCH_READ");
  assert.equal(silent.stage, "OBSERVED");
  const suppressed = classifyTape(frame({ chair: chair({ dir_mass: 0 }) }));
  assert.equal(suppressed.primary_blocker, "STATUS_OR_AUTHORITY_SUPPRESSED");
  const below_chair = chair({ vs_bar: 0.37, bar: 0.42 });
  const below = classifyTape(frame({ chair: below_chair }));
  assert.equal(below.primary_blocker, "DIRECTION_BELOW_BAR");
  assert.equal(below.stage, "CANDIDATE");
  assert.deepEqual(below.conditions.map((c) => [c.metric, c.op, c.required]), [["vs_bar_minus_bar", ">=", 0]]);
  assert.ok(Math.abs((below.conditions[0]!.current as number) - (0.37 - 0.42)) < 1e-12, "exact current value");
  assert.equal(below.evidence.bar, 0.42);
  assert.equal(below.raw.chair_wait, chairWaitReason(below_chair), "production's own words, from production's own function");
  const conflict = classifyTape(frame({ chair: chair({ gates: [{ id: "bar", pass: false, hard: true }, { id: "top3", pass: false, hard: false }] }) }));
  assert.equal(conflict.primary_blocker, "DIRECTION_CONFLICT");
  const warden = classifyTape(frame({ chair: chair({ gates: [{ id: "warden", pass: false, hard: true, value: "SPOT DOWN" }] }) }));
  assert.equal(warden.primary_blocker, "FEED_OR_DATA_HEALTH_FAIL");
  assert.deepEqual(warden.raw.failing_chair_gates, [{ id: "warden", value: "SPOT DOWN" }]);
  const odd = classifyTape(frame({ chair: chair({ gates: [{ id: "novel_gate", pass: false, hard: true }] }) }));
  assert.equal(odd.primary_blocker, "OTHER_EXPLICIT", "an unmapped gate keeps its raw id and is not guessed");
  assert.equal(odd.raw.failing_chair_gates[0]!.id, "novel_gate");
  const ambiguous = classifyTape(frame({ chair: chair({ vs_bar: 0.6, bar: 0.5, gates: [] }) }));
  assert.equal(ambiguous.primary_blocker, "UNKNOWN", "WAIT with nothing in production's fields to explain it is UNKNOWN");
});

test("directional frames are classified in funnel order with every blocker kept; entry price is split from quote", () => {
  const dirChair = chair({ lean: "UP", vs_bar: 0.6, bar: 0.5 });
  const supporters = classifyTape(frame({ chair: dirChair, audit: audit(["supporters", "families", "confirmation"]) }));
  assert.equal(supporters.state, "DIRECTIONAL");
  assert.equal(supporters.primary_blocker, "SUPPORTER_FAIL");
  assert.deepEqual(supporters.blockers, ["SUPPORTER_FAIL", "FAMILY_DIVERSITY_FAIL", "CONFIRMATION_INCOMPLETE"]);
  assert.equal(supporters.stage, "TEAM");
  assert.deepEqual(supporters.conditions[0], { metric: "supporters", op: ">=", current: 2, required: SELECTIVE_PARAMS.min_speaking, changeable_within_window: true, note: "healthy LIVE/FADED unfolded supporters on the side" });
  const cheap = classifyTape(frame({ snap: snap(300, { yes_ask: 79, yes_bid: 78 }), chair: dirChair, audit: audit(["quote"]) }));
  assert.equal(cheap.primary_blocker, "ENTRY_PRICE_FAIL");
  assert.deepEqual(cheap.conditions.map((c) => [c.metric, c.current, c.required]), [["ask_cents", 79, 80]]);
  const wide = classifyTape(frame({ snap: snap(300, { yes_ask: 86, yes_bid: 82 }), chair: dirChair, audit: audit(["quote"]) }));
  assert.equal(wide.primary_blocker, "QUOTE_FAIL");
  assert.deepEqual(wide.conditions.map((c) => [c.metric, c.current, c.required]), [["spread_cents", 4, 2]]);
  const confirm = classifyTape(frame({ chair: dirChair, audit: audit(["confirmation"]) }));
  assert.equal(confirm.primary_blocker, "CONFIRMATION_INCOMPLETE");
  assert.match(confirm.conditions[0]!.note ?? "", /latch count is not published/, "the latch is not guessed");
  const late = classifyTape(frame({ snap: snap(150), chair: dirChair, audit: audit(["time"]) }));
  assert.equal(late.primary_blocker, "TIME_WINDOW_FAIL", "a precondition blocks first");
  const qualified = classifyTape(frame({ chair: dirChair, audit: audit([], { eligible: true }) }));
  assert.equal(qualified.state, "QUALIFIED");
  assert.equal(qualified.primary_blocker, null);
  assert.equal(qualified.label, "QUALIFIED");
  const booked = classifyTape(frame({ chair: dirChair, audit: audit([], { eligible: true, positioned: true }) }));
  assert.equal(booked.state, "BOOKED");
  assert.equal(booked.stage, "PRODUCTION_BOOKED");
});

test("no requirement is invented: without production's daily admission state, supporter requirements are unknown and the brief is not gradable", () => {
  const r = classifyTape(frame({ daily: null, chair: chair({ lean: "UP", vs_bar: 0.6 }), audit: audit(["supporters"]) }));
  assert.equal(r.conditions[0]!.required, null);
  assert.equal(conditionMet(r.conditions[0]!, { supporters: 9 }), null);
  const tight = classifyTape(frame({ daily: { tightened: true } as TapeFrame["daily"], chair: chair({ lean: "UP", vs_bar: 0.6 }), audit: audit(["supporters"], { mode: "tight" }) }));
  assert.equal(tight.conditions[0]!.required, SELECTIVE_PARAMS.tight_min_speaking, "tightened mode requires what production requires");
});

// ---------------------------------------------------------------------------
// B. Recording and grading.
// ---------------------------------------------------------------------------

test("a frame is recorded once per designated checkpoint and on every change, never twice for the same state", () => {
  assert.deepEqual([...CHECKPOINTS], [600, 450, 300, 240, 180, 120, 60]);
  const r = classifyTape(frame());
  assert.deepEqual(shouldRecord(r, null, new Set()), { record: true, checkpoint: 300, change: true });
  assert.deepEqual(shouldRecord(r, { label: r.label, stage_index: r.stage_index }, new Set([300])), { record: false, checkpoint: null, change: false });
  const later = classifyTape(frame({ snap: snap(290) }));
  assert.equal(shouldRecord(later, { label: r.label, stage_index: r.stage_index }, new Set([300])).record, false, "between checkpoints, an unchanged state is not re-recorded");
});

const ev = (secsLeft: number, f: Partial<TapeFrame>, extra: Partial<TapeEvent> = {}): TapeEvent => {
  const rec = classifyTape(frame({ snap: snap(secsLeft), ...f }));
  return { ...rec, checkpoint: (CHECKPOINTS as readonly number[]).includes(secsLeft) ? secsLeft : null, partial_window: false, build_sha: "abc", ...extra };
};
const belowBar = (vs: number): Partial<TapeFrame> => ({ chair: chair({ vs_bar: vs, bar: 0.5 }) });
const dirFail = (fail: string[], o: Partial<Audit> = {}): Partial<TapeFrame> => ({ chair: chair({ lean: "UP", vs_bar: 0.6, bar: 0.5 }), audit: audit(fail, o) });

test("grading a window: the timeline, stage-by-stage transitions, regressions, dwell, and brief outcomes", () => {
  const events = [
    ev(600, belowBar(0.4)),
    ev(450, belowBar(0.45)),
    ev(400, dirFail(["families", "confirmation"])),
    ev(300, dirFail(["families", "confirmation"])),
    ev(260, belowBar(0.42)),
    ev(240, belowBar(0.43)),
  ];
  const t = gradeWindow(events, "UP");
  assert.deepEqual(t.transitions.map((x) => [x.from, x.to, x.regression]), [["DIRECTION_BELOW_BAR", "FAMILY_DIVERSITY_FAIL", false], ["FAMILY_DIVERSITY_FAIL", "DIRECTION_BELOW_BAR", true]]);
  assert.equal(t.first_blocker, "DIRECTION_BELOW_BAR");
  assert.equal(t.terminal_label, "DIRECTION_BELOW_BAR");
  assert.equal(t.deepest_stage, "SUPPORTERS");
  assert.equal(t.became_directional, true);
  assert.equal(t.labels[0]!.dwell_s, 200, "600 s -> 400 s at DIRECTION_BELOW_BAR");
  assert.deepEqual(t.blockers_before_directional, ["DIRECTION_BELOW_BAR"]);
  const b600 = t.briefs.find((b) => b.checkpoint === 600)!;
  assert.equal(b600.condition_met, true);
  assert.equal(b600.condition_met_secs_left, 400);
  assert.equal(b600.blocker_cleared, true);
  assert.equal(b600.next_blocker, "FAMILY_DIVERSITY_FAIL", "the bar unlocked a stage; the next bottleneck was family independence");
  assert.equal(b600.correct_transition, true);
  assert.equal(b600.official_winner, "UP", "each graded brief carries the official settlement");
  assert.equal(b600.false_hope, false);
  const b300 = t.briefs.find((b) => b.checkpoint === 300)!;
  assert.equal(b300.primary_blocker, "FAMILY_DIVERSITY_FAIL");
  assert.equal(b300.condition_met, false);
  assert.equal(b300.qualified, false);
});

test("false hope and unexplained clears are measured, not hidden", () => {
  const fam = (fail: string[]) => dirFail(fail);
  const events = [ev(300, fam(["supporters"])), ev(250, fam(["model_edge"]))];
  // Supporter condition: supporters (2) >= 2 required, already met at 250 by value; the blocker moved to MODEL_EDGE; stage advanced.
  const t = gradeWindow(events, "DOWN");
  const b = t.briefs[0]!;
  assert.equal(b.primary_blocker, "SUPPORTER_FAIL");
  assert.equal(b.blocker_cleared, true);
  assert.equal(b.next_blocker, "MODEL_EDGE_FAIL");
  const stuck = gradeWindow([ev(300, belowBar(0.4)), ev(240, belowBar(0.55)), ev(180, belowBar(0.55))], "UP");
  // vs_bar reached the bar but the Chair stayed WAIT (a different, unrecorded reason): condition met, no advancement.
  assert.equal(stuck.briefs[0]!.condition_met, true);
  assert.equal(stuck.briefs[0]!.false_hope, true);
  const acc = briefAccuracy([{ ticker, close_ms: close, events: [], timeline: stuck }, { ticker, close_ms: close + 900_000, events: [], timeline: gradeWindow([ev(600, belowBar(0.4)), ev(400, dirFail(["families"]))], "UP") }]);
  assert.ok(acc.brief_condition_hit_rate != null && acc.brief_false_hope_rate != null && acc.brief_correct_transition_rate != null);
  assert.match(acc.definitions.brief_false_hope_rate, /never advanced/);
});

test("a window already open when the observer started is partial and excluded from first-blocker and dwell statistics", () => {
  const full: TapeWindow = { ticker, close_ms: close, events: [], timeline: gradeWindow([ev(600, belowBar(0.4)), ev(300, dirFail(["families"]))], "UP") };
  const partial: TapeWindow = { ticker: "P", close_ms: close + 900_000, events: [], timeline: gradeWindow([ev(300, dirFail(["supporters"]), { partial_window: true })], "UP") };
  const r = transitionReport([full, partial]);
  assert.equal(r.partial_windows_excluded, 1);
  assert.equal(r.rolling[r.rolling.length - 1]!.windows, 1);
  assert.deepEqual(r.rolling[0]!.first_blocker, [{ label: "DIRECTION_BELOW_BAR", n: 1 }]);
  assert.equal(r.rolling[0]!.matrix[0]!.rate_pct, 100);
});

// ---------------------------------------------------------------------------
// Survival, stage unlocks, value-add, summary.
// ---------------------------------------------------------------------------

const tw = (i: number, events: TapeEvent[], winner: "UP" | "DOWN" = "UP"): TapeWindow => ({ ticker: `T${i}`, close_ms: close + i * 900_000, events, timeline: gradeWindow(events, winner) });

test("survival ranks single changes by qualified fills created; a change that only meets the next blocker is a false unlock", () => {
  const onlyFloor = (i: number) => tw(i, [ev(300, { snap: snap(300, { yes_ask: 79, yes_bid: 78 }), chair: chair({ lean: "UP", vs_bar: 0.6 }), audit: audit(["quote", "confirmation"]) })]);
  const floorThenEdge = (i: number) => tw(i, [ev(300, { snap: snap(300, { yes_ask: 79, yes_bid: 78 }), chair: chair({ lean: "UP", vs_bar: 0.6 }), audit: audit(["quote", "model_edge"]) })]);
  const bar = (i: number) => tw(i, [ev(300, belowBar(0.47))]);
  const s = survivalReport([onlyFloor(1), onlyFloor(2), floorThenEdge(3), bar(4)]);
  assert.equal(s.hypothesis_kind, "EXPLORATORY");
  assert.ok(s.variants_tested >= 2);
  const floor = (s.levers as Array<Record<string, unknown>>).find((l) => l.lever === "floor_cents")!;
  assert.equal(floor.windows_unlocked_one_stage, 3);
  assert.equal(floor.qualified_fills_created_per_rule_change, 2, "the third window would meet MODEL_EDGE next");
  assert.equal(floor.wins, 2);
  assert.ok((s.false_unlocks as string[]).some((x) => x.startsWith("chair_bar")), "the bar change unlocks direction but nothing downstream is known to pass");
  assert.deepEqual(s.highest_leverage, { lever: "floor_cents", step: "<= 1 cents lower floor", qualified_fills_created: 2, net_cents: (100 - 79 - 2) * 2 });
});

test("stage unlocks count how much further each arm moves than CONTROL on matched windows", () => {
  const f = (arm: string, i: number, stage: WindowFact["funnel_stage"], blocker: WindowFact["first_blocker"] = null): WindowFact => ({
    ticker: `T${i}`, close_ms: close + i, experiment: "MID_RECOVERY_LOCKS_V1_INACTIVE", arm, fact_version: 1, replay_quality: "EXACT", quality_reasons: [], experiment_version: 1, source_build_sha: null,
    decided_ms: null, observed: true, terminal_kind: "no_fill", side: null, ask_cents: null, fee_cents: null, official_winner: "UP", net_cents: null, production_lean: "WAIT", production_booked: false,
    funnel_stage: stage, first_blocker: blocker, blockers: [], facts: {},
  });
  const facts = [
    f("CONTROL", 1, "CANDIDATE"), f("BAR_NO_SITMASS", 1, "SUPPORTERS", "FAMILIES"),
    f("CONTROL", 2, "CANDIDATE"), f("BAR_NO_SITMASS", 2, "DIRECTIONAL", "TEAM"),
    f("CONTROL", 3, "CANDIDATE"), f("BAR_NO_SITMASS", 3, "CANDIDATE"),
    f("BAR_NO_SITMASS", 4, "SUPPORTERS"),
  ];
  const r = stageUnlocks(facts, "MID_RECOVERY_LOCKS_V1_INACTIVE");
  const bar = r.arms.find((a) => a.arm === "BAR_NO_SITMASS")!;
  assert.equal(bar.matched_windows, 3, "window 4 has no CONTROL record");
  assert.equal(bar.advanced_further_than_control, 2);
  assert.equal(bar.incremental_stage_unlocks.find((x) => x.stage === "DIRECTIONAL")!.incremental, 2);
  assert.equal(bar.incremental_stage_unlocks.find((x) => x.stage === "SUPPORTERS")!.incremental, 1);
  assert.equal(bar.incremental_stage_unlocks.find((x) => x.stage === "QUALIFIED")!.incremental, 0, "+0 qualified is reported, not hidden");
});

test("marginal value: a signal that only restates the price adds nothing; a signal with information inside price bands does", () => {
  const rng = (() => { let x = 7; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();
  const echo: SignalObs[] = [], informed: SignalObs[] = [];
  for (let i = 0; i < 400; i += 1) {
    const p = 0.8 + 0.15 * rng();
    const won = (rng() < p ? 1 : 0) as 0 | 1;
    echo.push({ window: `w${i}`, close_ms: i, fav_prob: p, stance: "AGREE", fav_won: won });
    informed.push({ window: `w${i}`, close_ms: i, fav_prob: p, stance: won ? "AGREE" : rng() < 0.7 ? "OPPOSE" : "AGREE", fav_won: won });
  }
  const e = marginalValue(echo), inf = marginalValue(informed);
  assert.ok(e.raw_value.directional_accuracy_pct! > 75, "the echo looks accurate in isolation");
  assert.ok((e.incremental_value.incremental_log_loss ?? 0) <= 0.001, `the echo adds no information (${e.incremental_value.incremental_log_loss})`);
  assert.ok((inf.incremental_value.incremental_log_loss ?? 0) > 0.01, `the informed signal adds information (${inf.incremental_value.incremental_log_loss})`);
  assert.ok(inf.price_bands.some((b) => b.oppose.n > 0 && b.agree.n > 0));
  const red = redundancy(new Map([["A", new Map([["w1", { side: "UP" as const }], ["w2", { side: "DOWN" as const }]])], ["B", new Map([["w1", { side: "UP" as const }], ["w2", { side: "DOWN" as const }]])]]), new Map([["w1", "UP" as const], ["w2", "UP" as const]]));
  assert.equal(red[0]!.agreement_pct, 100, "two signals that always agree are redundant, however accurate");
});

test("the research summary answers the six questions deterministically, with honesty labels and no production authority", () => {
  const windows = [tw(1, [ev(300, { snap: snap(300, { yes_ask: 79, yes_bid: 78 }), chair: chair({ lean: "UP", vs_bar: 0.6 }), audit: audit(["quote", "confirmation"]) })]), tw(2, [ev(600, belowBar(0.4)), ev(300, belowBar(0.42))])];
  const input = { transitions: transitionReport(windows), abstention: abstentionReport(windows), survival: survivalReport(windows), signals: signalValueReport(windows), pockets_promising: [], lifecycle_flags: [] };
  const a = researchSummary(input), b = researchSummary(input);
  assert.deepEqual(a, b);
  for (const k of ["current_bottleneck", "highest_leverage_isolated_change", "best_incremental_signal", "most_redundant_signal", "false_unlocks", "next_prospective_experiment"]) assert.ok(k in a, k);
  assert.deepEqual(a.authority, { production_authority: "NONE", automatic_changes: false });
  assert.equal(a.honesty.survival.hypothesis_kind, "EXPLORATORY");
  assert.match(a.honesty.rule, /cannot earn production authority directly/);
  const ab = abstentionReport(windows);
  assert.ok(ab.frequency.primary.length > 0 && ab.character.length > 0 && ab.precedes_conversion.length >= 0);
});
