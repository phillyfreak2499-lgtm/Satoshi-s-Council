import assert from "node:assert/strict";
import test from "node:test";
import { feeCents } from "./fee-engine.ts";
import { MID_RECOVERY_EXPERIMENT } from "./shadow-lab-mid-recovery.ts";
import { MID_RECOVERY_LOCKS_EXPERIMENT } from "./shadow-lab-mid-recovery-locks.ts";
import { MID_RECOVERY_LOCKS_V2_EXPERIMENT } from "./shadow-lab-mid-recovery-locks-v2.ts";
import { V2_COHORT_ARMS, V2_EVALUATOR_REVISION } from "./mid-recovery-locks-v2-cohort.ts";
import { stageUnlocks } from "./research-factory-insight.ts";
import {
  DEFAULT_THRESHOLDS, KNOWN_EXPERIMENTS, RESEARCH_FACTORY, benjaminiHochberg, binomialUpperP, computeUtilization, ece, fillStats, governorDecision, thresholdsFromEnv, wilson,
  type ResourceSample,
} from "./research-factory.ts";
import {
  P2_FIXED_POLICY, REASONS, RECOVERY_EXPERIMENTS, auditWindow, evidenceEligible, isDiagnosticOnly, stageOfRecord, windowFacts,
  type ReceiptRow, type WindowInput,
} from "./research-factory-analysis.ts";
import {
  chokeAttribution, clean, cohortCoverage, counterfactualGates, evidenceSafety, lifecycle, matchedGrade, pocketScan,
  type GradedFact,
} from "./research-factory-reports.ts";

// ---------------------------------------------------------------------------
// Fixtures: receipts shaped exactly as the MID recovery recorders store them.
// ---------------------------------------------------------------------------

const LOCKS = "MID_RECOVERY_LOCKS_V1_INACTIVE";
const V1 = "MID_RECOVERY_V1_INACTIVE";
const close = Date.parse("2026-09-28T15:15:00Z");
const ticker = "KXBTC15M-26SEP281015-15";
const decided = close - 300_000;
const CHECK_IDS = ["risk_history", "daily_risk", "complete_window", "direction", "team", "supporters", "families", "opposition", "time", "feeds", "quote", "profit_reserve", "model_edge", "index_fresh", "index_edge", "confirmation"];

type Cand = { seat: string; card_id: string; original_status?: string; lean?: "UP" | "DOWN"; conf?: number; health?: string; hypothesis?: string; support?: boolean };
const DEFAULT_CANDS: Cand[] = [
  { seat: "STREAK", card_id: "STREAK.continue_young" },
  { seat: "CHAIN", card_id: "CHAIN.oi_with_price" },
];

/** A recovered-path evaluation record. `fail` lists the check ids that failed. */
function record(opts: { arm: string; experiment?: string; cands?: Cand[]; side?: "UP" | "DOWN" | null; fail?: string[]; confirmed?: boolean; booked?: boolean; ask?: number; roster?: Array<Record<string, unknown>>; held?: string[]; released?: string[]; asOf?: number; supporters?: string[]; mode?: string; indexMargin?: number; modelEdge?: number; familiesOk?: boolean; quoteParts?: Record<string, boolean> } ) {
  const cands = opts.cands ?? DEFAULT_CANDS;
  const side = opts.side === undefined ? "UP" : opts.side;
  const fail = new Set(opts.fail ?? []);
  const checks = CHECK_IDS.map((id) => ({ id, pass: id === "confirmation" ? (opts.confirmed ?? false) : side == null && id !== "risk_history" ? null : !fail.has(id) }));
  const familiesOk = opts.familiesOk ?? (side != null && !fail.has("families"));
  const eligible = side != null && familiesOk && checks.filter((c) => c.id !== "confirmation" && c.id !== "families").every((c) => c.pass === true);
  const ask = opts.ask ?? 85;
  const booked = opts.booked ?? (eligible && (opts.confirmed ?? false) && ask >= 80);
  return {
    version: opts.experiment ?? LOCKS, experiment: opts.experiment ?? LOCKS, arm: opts.arm, ticker, close_time: close, as_of: opts.asOf ?? decided, secs_left: 300,
    baseline: { side: null, lean: "WAIT" },
    candidates: cands.map((c) => ({
      seat: c.seat, card_id: c.card_id, original_status: c.original_status ?? "SHADOW", calibrated_lean: c.lean ?? "UP", calibrated_conf: c.conf ?? 64,
      health: c.health ?? "LIVE", hypothesis: c.hypothesis ?? c.card_id, survived_fold: true, counted_as_support: c.support ?? side != null,
    })),
    recovery: {
      released: opts.released ?? cands.map((c) => c.card_id),
      held_seats: opts.held ?? [],
      evaluated_roster: opts.roster ?? cands.map((c) => ({ card_id: c.card_id, seat: c.seat, evaluated_lean: c.lean ?? "UP", evaluated_conf: c.conf ?? 64, evaluated_health: c.health ?? "LIVE", selected_skill_used: "SIT", selected_forced_sit: false })),
    },
    recovered: {
      side, lean: side ?? "WAIT", confidence: 64, eligible, families_ok: familiesOk, mode: opts.mode ?? "normal", supporters: opts.supporters ?? (side ? cands.map((c) => c.seat) : []), families: ["book", "derivs"], checks,
      chair_trace: { score: 0.61, bar: 0.66, vs_bar: 0.615, hard_fail: false, bar_breakdown: { sit_mass: 0.2 } },
    },
    confirmation: { confirmed: opts.confirmed ?? false, frames: opts.confirmed ? 3 : 1, need_frames: 3 },
    economics: { ask_cents: side ? ask : null, spread_cents: 1, model_edge_cents: opts.modelEdge ?? 5, index_margin_cents: opts.indexMargin ?? 4, ...(opts.quoteParts ?? { floor_ok: ask >= 80, ceiling_ok: true, spread_ok: true, size_ok: true }) },
    simulated: { qualified: eligible && (opts.confirmed ?? false), booked, authority: "research-only-simulated" },
    funnel_stage_index: 0,
  };
}
const receipt = (arm: string, kind: ReceiptRow["kind"], payload: Record<string, unknown> | null, extra: Partial<ReceiptRow> = {}): ReceiptRow => ({
  experiment: LOCKS, arm, ticker, close_ms: close, kind, decided_ms: decided, recorded_ms: decided + 500, side: null, ask_cents: null, fee_cents: null,
  official_winner: null, net_cents: null, build_sha: "abc1234", payload, ...extra,
});
const fillReceipt = (arm: string, payload: Record<string, unknown>, ask = 85, side: "UP" | "DOWN" = "UP", extra: Partial<ReceiptRow> = {}) =>
  receipt(arm, "fill", payload, { side, ask_cents: ask, fee_cents: feeCents(ask), ...extra });
const ledger = (winner: "UP" | "DOWN" = "UP") => ({ ticker, close_ms: close, winner, chair_lean: "WAIT", entry_cents: null, entry_fee_cents: null, entry_lean: null, entry_build_sha: null });
const opening = { regime_key: "trend-quiet", atr: 50, yes_ask: 85, no_ask: 16, spot: 80_100, strike: 80_000, decision_ms: close - 840_000 };
const windowOf = (receipts: ReceiptRow[], extra: Partial<WindowInput> = {}): WindowInput => ({ ticker, close_ms: close, receipts, ledger: ledger(), opening, counters: [], ...extra });
const cleanFill = (arm = "BAR_NO_SITMASS") => fillReceipt(arm, record({ arm, confirmed: true }));
const statusOf = (notes: ReturnType<typeof auditWindow>, arm: string, kind = "fill") => notes.find((n) => n.arm === arm && n.kind === kind)!;

// ---------------------------------------------------------------------------
// Framework and governor.
// ---------------------------------------------------------------------------

test("the factory has no production authority and is off unless the literal flag is set", () => {
  assert.equal(RESEARCH_FACTORY.production_authority, "NONE");
  assert.equal(RESEARCH_FACTORY.env_flag, "RESEARCH_FACTORY_ENABLED");
  assert.equal(RESEARCH_FACTORY.max_concurrent_jobs, 1);
});

test("the factory's experiment names are the recorders' own frozen identities (held as data, never imported)", () => {
  assert.equal(KNOWN_EXPERIMENTS.mid_recovery_v1.id, MID_RECOVERY_EXPERIMENT.id);
  assert.equal(KNOWN_EXPERIMENTS.mid_recovery_v1.version, MID_RECOVERY_EXPERIMENT.version);
  assert.equal(KNOWN_EXPERIMENTS.mid_recovery_locks_v1.id, MID_RECOVERY_LOCKS_EXPERIMENT.id);
  assert.equal(KNOWN_EXPERIMENTS.mid_recovery_locks_v1.version, MID_RECOVERY_LOCKS_EXPERIMENT.version);
  assert.equal(KNOWN_EXPERIMENTS.mid_recovery_locks_v2.id, MID_RECOVERY_LOCKS_V2_EXPERIMENT.id);
  assert.equal(KNOWN_EXPERIMENTS.mid_recovery_locks_v2.version, MID_RECOVERY_LOCKS_V2_EXPERIMENT.version);
  assert.equal(KNOWN_EXPERIMENTS.decision_cutoff_secs, MID_RECOVERY_EXPERIMENT.band_secs.min);
  assert.equal(KNOWN_EXPERIMENTS.decision_cutoff_secs, MID_RECOVERY_LOCKS_EXPERIMENT.band_secs.min);
});

test("resource governor: any one pressure signal pauses research; a missing pool signal is not pressure; a broken reading is", () => {
  const ok: ResourceSample = { rss_mb: 300, load_per_cpu: 0.2, event_loop_p99_ms: 12, db_waiting: 0, db_in_use: 1, db_ping_ms: 20 };
  assert.deepEqual(governorDecision(ok, DEFAULT_THRESHOLDS), { run: true, reasons: [] });
  const cases: Array<[Partial<ResourceSample>, string]> = [
    [{ rss_mb: 5_000 }, "MEMORY"], [{ load_per_cpu: 0.95 }, "SYSTEM_LOAD"], [{ event_loop_p99_ms: 400 }, "REQUEST_LATENCY"],
    [{ db_waiting: 2 }, "DB_POOL_WAITING"], [{ db_in_use: 9 }, "DB_POOL_BUSY"], [{ db_ping_ms: 900 }, "DB_LATENCY"], [{ rss_mb: Number.NaN }, "MEMORY"],
  ];
  for (const [delta, reason] of cases) assert.deepEqual(governorDecision({ ...ok, ...delta }, DEFAULT_THRESHOLDS), { run: false, reasons: [reason] }, reason);
  assert.equal(governorDecision({ ...ok, db_waiting: null, db_in_use: null, db_ping_ms: null }, DEFAULT_THRESHOLDS).run, true, "the embedded DB has no pool");
  const t = thresholdsFromEnv({ RESEARCH_FACTORY_MAX_RSS_MB: "900", RESEARCH_FACTORY_MAX_EVENT_LOOP_P99_MS: "abc" }, 4096);
  assert.equal(t.max_rss_mb, 900);
  assert.equal(t.max_event_loop_p99_ms, DEFAULT_THRESHOLDS.max_event_loop_p99_ms, "a non-numeric override keeps the default");
  assert.equal(thresholdsFromEnv({}, 4096).max_rss_mb, Math.round(4096 * 0.6), "default memory ceiling: 60% of the container limit");
  assert.equal(computeUtilization(36_000, 3_600_000, 2), 0.005);
});

test("statistics: Wilson, exact binomial, Benjamini-Hochberg, and no ECE on thin bins", () => {
  assert.deepEqual(wilson(8, 10), { lo: 49, hi: 94.3 });
  assert.equal(wilson(0, 0), null);
  assert.ok(Math.abs(binomialUpperP(8, 10, 0.5)! - 0.0546875) < 1e-6, "P(X >= 8 | 10, 0.5) = 56/1024");
  // m = 3 tested: 0.001 <= 0.033 and 0.04 <= 0.067 pass; 0.2 > 0.1 does not; the null is untested.
  assert.deepEqual(benjaminiHochberg([0.001, 0.2, null, 0.04], 0.1), [true, false, false, true]);
  assert.deepEqual(benjaminiHochberg([0.03, 0.04, 0.06], 0.05), [false, false, false], "step-up needs p(k) <= k/m * q");
  assert.equal(ece([0.8, 0.85], [1, 0]), null, "two observations are not a calibration curve");
  const s = fillStats([{ side: "UP", ask_cents: 85, fee_cents: feeCents(85), winner: "UP", close_ms: 1 }, { side: "UP", ask_cents: 85, fee_cents: feeCents(85), winner: "DOWN", close_ms: 2 }]);
  assert.equal(s.net_cents, Math.round((15 - feeCents(85) - 85 - feeCents(85)) * 10) / 10);
  assert.equal(s.wins, 1);
  assert.equal(s.max_drawdown_cents, -(85 + feeCents(85)));
});

// ---------------------------------------------------------------------------
// Phase 2: replay facts.
// ---------------------------------------------------------------------------

test("replay is deterministic, never mutates its input, and labels EXACT / PARTIAL / UNAVAILABLE honestly", () => {
  const w = windowOf([cleanFill(), fillReceipt("NULL_FAV_80", { checkpoint: 450 }), receipt("CONTROL", "no_fill", record({ arm: "CONTROL", fail: ["supporters"] }))]);
  const before = JSON.stringify(w);
  const a = windowFacts(w), b = windowFacts(w);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "same stored inputs, same facts");
  assert.equal(JSON.stringify(w), before, "the stored records are not touched");
  const q = (arm: string) => a.find((f) => f.arm === arm)!;
  assert.equal(q("BAR_NO_SITMASS").replay_quality, "EXACT");
  assert.equal(q("BAR_NO_SITMASS").net_cents, 100 - 85 - feeCents(85));
  assert.equal(q("CONTROL").replay_quality, "EXACT");
  assert.equal(q("CONTROL").first_blocker, "SUPPORTERS");
  assert.equal(q("NULL_FAV_80").replay_quality, "EXACT", "a benchmark fill carries its own ask and fee");
  assert.equal(q("FLOOR").experiment, "PRODUCTION");
  for (const f of a) assert.match(String(f.facts.candidate_replay), /^UNAVAILABLE/, "candidate generation is never claimed replayable");
  // Missing inputs are labelled, never substituted.
  const partial = windowFacts(windowOf([receipt("CONTROL", "no_fill", { ...record({ arm: "CONTROL" }), recovered: { ...record({ arm: "CONTROL" }).recovered, chair_trace: undefined } })]));
  assert.equal(partial.find((f) => f.arm === "CONTROL")!.replay_quality, "PARTIAL");
  assert.ok(partial.find((f) => f.arm === "CONTROL")!.quality_reasons.includes("MISSING_CHAIR_TRACE"));
  const sit = windowFacts(windowOf([receipt("NULL_FAV_80", "no_fill", { checkpoint: 300 })]));
  assert.deepEqual(sit.find((f) => f.arm === "NULL_FAV_80")!.quality_reasons, ["NO_BOOK_AT_CHECKPOINT"]);
  const unsettled = windowFacts(windowOf([cleanFill()], { ledger: null }));
  assert.equal(unsettled[0]!.replay_quality, "UNAVAILABLE");
  assert.equal(unsettled[0]!.net_cents, null, "no settlement is invented");
  assert.equal(unsettled.some((f) => f.experiment === "PRODUCTION"), false);
});

test("no future-data leakage: decision facts do not depend on the outcome, and a frame from after the close is INVALID", () => {
  const up = windowFacts(windowOf([cleanFill(), receipt("CONTROL", "no_fill", record({ arm: "CONTROL", fail: ["quote"] }))], { ledger: ledger("UP") }));
  const down = windowFacts(windowOf([cleanFill(), receipt("CONTROL", "no_fill", record({ arm: "CONTROL", fail: ["quote"] }))], { ledger: ledger("DOWN") }));
  const decisionOnly = (fs: typeof up) => fs.map(({ official_winner, net_cents, ...rest }) => { void official_winner; void net_cents; return rest; });
  assert.deepEqual(decisionOnly(up), decisionOnly(down), "only settlement fields change with the winner");
  assert.notEqual(up.find((f) => f.arm === "BAR_NO_SITMASS")!.net_cents, down.find((f) => f.arm === "BAR_NO_SITMASS")!.net_cents);
  const late = auditWindow(windowOf([fillReceipt("BAR_NO_SITMASS", record({ arm: "BAR_NO_SITMASS", confirmed: true }), 85, "UP", { decided_ms: close + 1_000 })]));
  assert.equal(late[0]!.integrity_status, "INVALID");
  assert.ok(late[0]!.reason_codes.includes("DECIDED_AFTER_CLOSE"));
  const future = auditWindow(windowOf([fillReceipt("BAR_NO_SITMASS", record({ arm: "BAR_NO_SITMASS", confirmed: true, asOf: decided + 60_000 }))]));
  assert.ok(future[0]!.reason_codes.includes("FUTURE_FRAME"));
  const cutoff = auditWindow(windowOf([fillReceipt("BAR_NO_SITMASS", record({ arm: "BAR_NO_SITMASS", confirmed: true }), 85, "UP", { decided_ms: close - 170_000, recorded_ms: close - 169_500 })]));
  assert.ok(cutoff[0]!.reason_codes.includes("DECIDED_AFTER_CUTOFF"), "inside the last 180 s nothing may be decided");
});

// ---------------------------------------------------------------------------
// Phase 3: integrity.
// ---------------------------------------------------------------------------

test("a clean recovered fill is CLEAN; every provenance defect is caught with its own reason code", () => {
  assert.equal(statusOf(auditWindow(windowOf([cleanFill()])), "BAR_NO_SITMASS").integrity_status, "CLEAN");
  const cases: Array<[string, Parameters<typeof record>[0], string]> = [
    ["duplicate seat", { arm: "A", cands: [{ seat: "STREAK", card_id: "STREAK.continue_young" }, { seat: "STREAK", card_id: "STRIKE.itm_time" }], confirmed: true }, "DUPLICATE_SEAT"],
    ["non-roster card", { arm: "A", cands: [{ seat: "WICK", card_id: "WICK.not_e1" }], confirmed: true }, "NON_ROSTER_CARD"],
    ["held seat", { arm: "A", held: ["CHAIN"], confirmed: true }, "HELD_SEAT_RECOVERED"],
    ["hold hypothesis", { arm: "A", cands: [{ seat: "STRIKE", card_id: "STRIKE.itm_time", hypothesis: "clock-owned window" }], confirmed: true }, "HOLD_HYPOTHESIS_RECOVERED"],
    ["not in source frame", { arm: "A", roster: [{ card_id: "STREAK.continue_young", seat: "STREAK", evaluated_lean: "UP", evaluated_conf: 64, selected_skill_used: "SIT" }, { card_id: "CHAIN.oi_with_price", seat: "CHAIN", evaluated_lean: null, evaluated_conf: null, selected_skill_used: "SIT" }], confirmed: true }, "CANDIDATE_NOT_IN_SOURCE"],
    ["not released", { arm: "A", released: ["STREAK.continue_young"], confirmed: true }, "CANDIDATE_NOT_IN_SOURCE"],
    ["rewritten candidate", { arm: "A", roster: DEFAULT_CANDS.map((c) => ({ card_id: c.card_id, seat: c.seat, evaluated_lean: "DOWN", evaluated_conf: 64, selected_skill_used: "SIT" })), confirmed: true }, "CANDIDATE_DIFFERS_FROM_SOURCE"],
    ["unhealthy support", { arm: "A", cands: [{ seat: "STREAK", card_id: "STREAK.continue_young", health: "STALE", support: true }], confirmed: true }, "UNHEALTHY_SUPPORT"],
  ];
  for (const [label, opts, code] of cases) {
    const n = statusOf(auditWindow(windowOf([fillReceipt("A", record(opts))])), "A");
    assert.equal(n.integrity_status, "INVALID", label);
    assert.ok(n.reason_codes.includes(code), `${label}: ${n.reason_codes}`);
    assert.ok(n.reason_codes.includes("FILL_FROM_INVALID_CANDIDATE"), `${label}: a fill from an invalid candidate is itself invalid`);
  }
  const identity = statusOf(auditWindow(windowOf([fillReceipt("A", { ...record({ arm: "A", confirmed: true }), ticker: "OTHER" })])), "A");
  assert.ok(identity.reason_codes.includes("IDENTITY_MISMATCH"), "cross-window leakage");
  const wrongExp = statusOf(auditWindow(windowOf([fillReceipt("A", { ...record({ arm: "A", confirmed: true }), experiment: V1 })])), "A");
  assert.ok(wrongExp.reason_codes.includes("EXPERIMENT_MISMATCH"));
  const wrongArm = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "B", confirmed: true }))])), "A");
  assert.ok(wrongArm.reason_codes.includes("ARM_MISMATCH"));
  const net = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", confirmed: true }), 85, "UP", { official_winner: "UP", net_cents: 99 })])), "A");
  assert.ok(net.reason_codes.includes("NET_MISMATCH"));
  const floor = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", confirmed: true, ask: 79, booked: true }), 79)])), "A");
  assert.ok(floor.reason_codes.includes("FILL_BELOW_FLOOR"), "a 79c fill is invalid evidence");
  const unconfirmed = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", confirmed: false }))])), "A");
  assert.ok(unconfirmed.reason_codes.includes("FILL_WITHOUT_BOOKED_RECORD"), "a fill that bypassed confirmation is invalid");
  // Deployment-crossed window and late writes are suspect, not proven.
  const crossed = auditWindow(windowOf([cleanFill(), receipt("NULL_FAV_80", "no_fill", { checkpoint: 300 }, { build_sha: "def5678" })]));
  assert.equal(statusOf(crossed, "BAR_NO_SITMASS").integrity_status, "SUSPECT");
  assert.ok(statusOf(crossed, "BAR_NO_SITMASS").reason_codes.includes("BUILD_CROSSED_WINDOW"));
  const lateWrite = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", confirmed: true }), 85, "UP", { recorded_ms: decided + 120_000 })])), "A");
  assert.ok(lateWrite.reason_codes.includes("LATE_WRITE"));
  // A record with nothing to audit is UNVERIFIABLE, never CLEAN.
  const empty = statusOf(auditWindow(windowOf([receipt("CONTROL", "no_fill", { receipt_only: true, checkpoint: 180 })])), "CONTROL", "no_fill");
  assert.equal(empty.integrity_status, "UNVERIFIABLE");
  for (const code of Object.keys(REASONS)) assert.match(code, /^[A-Z0-9_]+$/);
});

test("P2 (exploit-rejected card recovery): a LIVE card the producer did not select is SUSPECT; stored counters can confirm or clear it", () => {
  const live = [{ seat: "DRIFT", card_id: "DRIFT.pullback_in_trend", original_status: "LIVE" }];
  const roster = [{ card_id: "DRIFT.pullback_in_trend", seat: "DRIFT", evaluated_lean: "UP", evaluated_conf: 64, evaluated_health: "LIVE", selected_skill_used: "SIT", selected_forced_sit: true }];
  const fill = fillReceipt("A", record({ arm: "A", cands: live, roster, confirmed: true }));
  const unknown = statusOf(auditWindow(windowOf([fill])), "A");
  assert.equal(unknown.integrity_status, "SUSPECT");
  assert.ok(unknown.reason_codes.includes("P2_LIVE_CARD_NOT_SELECTED"));
  const likely = statusOf(auditWindow(windowOf([fill], { counters: [{ id: "DRIFT.pullback_in_trend", status_at_input: "LIVE", n: 30, hits: 9 }] })), "A");
  assert.ok(likely.reason_codes.includes("P2_EXPLOIT_REJECT_LIKELY"), "n >= 16 and wilson < 0.42: the EXPLOIT guard would have rejected it");
  const cleared = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", cands: live, roster: roster.map((r) => ({ ...r, selected_forced_sit: false })), confirmed: true }))], { counters: [{ id: "DRIFT.pullback_in_trend", status_at_input: "LIVE", n: 10, hits: 8 }] })), "A");
  assert.equal(cleared.integrity_status, "CLEAN", "n < 16: the guard cannot have rejected it");
  assert.ok(cleared.details["p2_cleared_DRIFT.pullback_in_trend"]);
  const shadow = statusOf(auditWindow(windowOf([cleanFill()])), "BAR_NO_SITMASS");
  assert.equal(shadow.integrity_status, "CLEAN", "a SHADOW card is not on the P2 path");
  // After the fix: the producer never captures an exploit-rejected card, and the receipt says so.
  const fixedRec = record({ arm: "A", cands: live, roster: roster.map((r) => ({ ...r, selected_forced_sit: false })), confirmed: true });
  (fixedRec as Record<string, unknown>).capture_policy = P2_FIXED_POLICY;
  const fixed = statusOf(auditWindow(windowOf([fillReceipt("A", fixedRec)])), "A");
  assert.equal(fixed.integrity_status, "CLEAN", "a receipt captured under P2_EXPLOIT_GUARD_V1 is not a P2 suspect");
  assert.equal(fixed.details.capture_policy, P2_FIXED_POLICY);
  const unstamped = record({ arm: "A", cands: live, roster: roster.map((r) => ({ ...r, selected_forced_sit: false })), confirmed: true });
  (unstamped as Record<string, unknown>).capture_policy = "SOMETHING_ELSE";
  assert.ok(statusOf(auditWindow(windowOf([fillReceipt("A", unstamped)])), "A").reason_codes.includes("P2_LIVE_CARD_NOT_SELECTED"), "only the exact policy clears it; older receipts stay suspect");
});

test("P2-suspect and invalid results never count as clean promotion evidence", () => {
  const live = [{ seat: "DRIFT", card_id: "DRIFT.pullback_in_trend", original_status: "LIVE" }];
  const graded = gradedWindows(40, (i) => [fillReceipt("SUPPORT_UNCAL_E1", record({ arm: "SUPPORT_UNCAL_E1", cands: live, confirmed: true }), 85, "UP", { close_ms: close + i * 900_000 })]);
  const f = graded.find((x) => x.arm === "SUPPORT_UNCAL_E1")!;
  assert.deepEqual(f.integrity, ["SUSPECT"]);
  assert.equal(evidenceEligible(f, f.integrity), false);
  assert.equal(clean(f), false);
  const row = lifecycle(graded).find((l) => l.arm === "SUPPORT_UNCAL_E1")!;
  assert.equal(row.current_sample.clean_settled_fills, 0, "40 winning fills, none evidence-grade");
  assert.equal(row.current_sample.suspect_fills, 40);
  assert.equal(row.flag_for_human_review, false);
  assert.equal(pocketScan(graded, LOCKS, "SUPPORT_UNCAL_E1").pockets.every((p) => p.stats.fills === 0), true, "pockets read clean fills only");
});

// ---------------------------------------------------------------------------
// Phases 4-8.
// ---------------------------------------------------------------------------

/** Build graded facts for `n` windows, each from the receipts `make(i)` returns (close times advance 15 min). */
function gradedWindows(n: number, make: (i: number) => ReceiptRow[], winner: (i: number) => "UP" | "DOWN" = () => "UP"): GradedFact[] {
  const out: GradedFact[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = close + i * 900_000;
    const receipts = make(i).map((r) => ({ ...r, close_ms: c, decided_ms: c - 300_000, recorded_ms: c - 299_500, payload: r.payload ? { ...r.payload, close_time: c } : r.payload }));
    const w: WindowInput = { ticker, close_ms: c, receipts, ledger: { ...ledger(winner(i)), close_ms: c }, opening: { ...opening, decision_ms: c - 840_000 }, counters: [] };
    const notes = auditWindow(w);
    for (const f of windowFacts(w)) out.push({ ...f, integrity: notes.filter((a) => a.experiment === f.experiment && a.arm === f.arm).map((a) => a.integrity_status) });
  }
  return out;
}

test("COMBINED_DIAG can never become promotion eligible, however good its numbers", () => {
  const graded = gradedWindows(80, () => [fillReceipt("COMBINED_DIAG", record({ arm: "COMBINED_DIAG", confirmed: true }))]);
  const row = lifecycle(graded).find((l) => l.arm === "COMBINED_DIAG")!;
  assert.equal(row.status, "DIAGNOSTIC_ONLY");
  assert.equal(row.promotion_eligible, false);
  assert.equal(row.flag_for_human_review, false);
  assert.equal(row.authority, "NONE");
  const f = graded.find((x) => x.arm === "COMBINED_DIAG")!;
  assert.deepEqual(f.integrity, ["CLEAN"]);
  assert.equal(evidenceEligible(f, f.integrity), false, "clean, exact, and still not evidence");
  assert.equal(matchedGrade(graded, LOCKS).matched.find((a) => a.arm === "COMBINED_DIAG")!.role, "DIAGNOSTIC_ONLY");
  assert.equal(counterfactualGates(graded, LOCKS, "COMBINED_DIAG").every((c) => c.gate.length > 0), true);
});

test("an isolated arm with enough clean winning fills is FLAGGED for human review, never promoted; every row has authority NONE", () => {
  const graded = gradedWindows(60, () => [cleanFill("BAR_NO_SITMASS"), fillReceipt("NULL_FAV_80", { checkpoint: 450 }, 85, "DOWN")]);
  const rows = lifecycle(graded);
  const bar = rows.find((l) => l.arm === "BAR_NO_SITMASS")!;
  assert.equal(bar.status, "PROMISING");
  assert.equal(bar.flag_for_human_review, true);
  assert.ok(rows.every((l) => l.authority === "NONE"));
  assert.equal(rows.find((l) => l.arm === "NULL_FAV_80")!.promotion_eligible, false);
  assert.equal(rows.find((l) => l.arm === "CONTROL")!.promotion_eligible, false);
});

test("matched grading compares identical window IDs only; the rest is labelled UNMATCHED", () => {
  const graded = gradedWindows(10, (i) => i < 6
    ? [cleanFill("BAR_NO_SITMASS"), fillReceipt("NULL_FAV_80", { checkpoint: 450 })]
    : [cleanFill("BAR_NO_SITMASS")]);
  const g = matchedGrade(graded, LOCKS);
  assert.equal(g.matched_windows, 6);
  assert.deepEqual(g.arms, [`${LOCKS}|BAR_NO_SITMASS`, `${LOCKS}|NULL_FAV_80`, "PRODUCTION|FLOOR"]);
  for (const a of g.matched) assert.equal(a.observed_windows, 6, a.arm);
  assert.equal(g.unmatched.find((a) => a.arm === "BAR_NO_SITMASS")!.observed_windows, 10);
  assert.match(g.unmatched[0]!.population, /^UNMATCHED/);
  // Experiments are never pooled: a V1 row in the same window is not a LOCKS arm.
  const mixed = gradedWindows(3, () => [cleanFill("BAR_NO_SITMASS"), { ...fillReceipt("RECOVERED_MID", record({ arm: "RECOVERED_MID", experiment: V1, confirmed: true })), experiment: V1 }]);
  assert.equal(matchedGrade(mixed, LOCKS).arms.some((a) => a.startsWith(V1)), false);
  assert.equal(matchedGrade(mixed, V1).arms.some((a) => a.startsWith(LOCKS)), false);
});

test("choke attribution names the first blocker and every blocker, rolling, and never recommends loosening", () => {
  const graded = gradedWindows(30, (i) => [receipt("CONTROL", "no_fill", record({ arm: "CONTROL", fail: i % 3 === 0 ? ["quote", "index_edge"] : ["supporters"] }))]);
  const c = chokeAttribution(graded, LOCKS, "CONTROL");
  assert.equal(c.rolling[0]!.windows, "last 25");
  assert.equal(c.rolling[c.rolling.length - 1]!.n, 30);
  assert.equal(c.rolling[c.rolling.length - 1]!.first_blocker[0]!.stage, "SUPPORTERS");
  assert.deepEqual(c.all_blockers.map((b) => b.check).sort(), ["index_edge", "quote", "supporters"]);
  assert.ok(c.breakdowns.seat && c.breakdowns.regime && c.breakdowns.hour_block_chicago && c.breakdowns.build);
  assert.match(c.caution, /not a recommendation/);
  assert.deepEqual(stageOfRecord(record({ arm: "X", fail: ["quote", "index_edge"] }))!.blockers, ["index_edge", "quote"]);
});

test("counterfactuals change one gate at a time: tightening is EXACT, loosening is PARTIAL, confirmation is UNAVAILABLE", () => {
  const graded = gradedWindows(8, (i) => i < 4
    ? [fillReceipt("CONTROL", record({ arm: "CONTROL", confirmed: true, ask: 80 + i }), 80 + i)]
    : [receipt("CONTROL", "no_fill", record({ arm: "CONTROL", fail: ["quote"], ask: 79, quoteParts: { floor_ok: false, ceiling_ok: true, spread_ok: true, size_ok: true } }))]);
  const cf = counterfactualGates(graded, LOCKS, "CONTROL");
  const by = (id: string) => cf.find((c) => c.id === id)!;
  assert.equal(by("FLOOR_82").replay_quality, "EXACT");
  assert.equal(by("FLOOR_82").removed_fills, 2, "80c and 81c fills removed");
  assert.equal(by("FLOOR_78").replay_quality, "PARTIAL");
  assert.equal(by("FLOOR_78").added_fills, 4, "four windows failed only the floor at 79c");
  assert.match(by("FLOOR_78").quality_note, /confirmation/);
  assert.equal(by("CONFIRMATION_FRAMES").replay_quality, "UNAVAILABLE");
  assert.equal(by("CONFIRMATION_FRAMES").added_fills, 0);
  for (const c of cf) assert.equal(typeof c.gate, "string", "every counterfactual names exactly one gate");
  assert.equal(new Set(cf.map((c) => c.id)).size, cf.length);
});

test("pockets are pre-registered, report their test count, and small samples are never PROMISING", () => {
  const graded = gradedWindows(12, () => [cleanFill("BAR_NO_SITMASS")]);
  const p = pocketScan(graded, LOCKS, "BAR_NO_SITMASS");
  assert.ok(p.tests > 0);
  assert.equal(p.pockets.every((x) => x.label === "INSUFFICIENT_SAMPLE"), true, "12 fills win every time and still prove nothing");
  assert.match(p.caution, /Benjamini-Hochberg/);
});

test("P1 (E1 family override): STREAK + STRIKE counted as two supporters is SUSPECT only when the double count decided the gate", () => {
  const pair = [{ seat: "STREAK", card_id: "STREAK.continue_young" }, { seat: "STRIKE", card_id: "STRIKE.itm_time" }];
  // Normal mode needs 2 supporters: STREAK + STRIKE are one E1 book read, so the gate would have failed.
  const decided = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", cands: pair, supporters: ["STREAK", "STRIKE"], confirmed: true }))])), "A");
  assert.ok(decided.reason_codes.includes("E1_FAMILY_SUPPORT_DOUBLE_COUNT"), String(decided.reason_codes));
  assert.equal(decided.integrity_status, "SUSPECT");
  assert.deepEqual(decided.details.e1_supporters, { counted: 2, independent: 1, required: 2 });
  // With a third independent supporter the overlap did not decide anything.
  const trio = [...pair, { seat: "CHAIN", card_id: "CHAIN.oi_with_price" }];
  const fine = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", cands: trio, supporters: ["STREAK", "STRIKE", "CHAIN"], confirmed: true }))])), "A");
  assert.equal(fine.reason_codes.includes("E1_FAMILY_SUPPORT_DOUBLE_COUNT"), false);
  // Two ordinary book seats are production policy, not the E1 override: not flagged.
  const plain = statusOf(auditWindow(windowOf([fillReceipt("A", record({ arm: "A", cands: [{ seat: "STRIKE", card_id: "STRIKE.itm_time" }], supporters: ["STRIKE", "ODDS"], confirmed: true }))])), "A");
  assert.equal(plain.reason_codes.includes("E1_FAMILY_SUPPORT_DOUBLE_COUNT"), false);
});

test("LOCKS V2 receipts: P1/P2 corrections alone do not establish the corrected cohort", () => {
  const V2 = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  const live = [{ seat: "STREAK", card_id: "STREAK.continue_young", original_status: "LIVE" as const }, { seat: "STRIKE", card_id: "STRIKE.itm_time", original_status: "LIVE" as const }, { seat: "CHAIN", card_id: "CHAIN.oi_with_price" }];
  const roster = live.map((c) => ({ card_id: c.card_id, seat: c.seat, evaluated_lean: "UP", evaluated_conf: 64, evaluated_health: "LIVE", selected_skill_used: "SIT", selected_forced_sit: false }));
  // V2 already removed STREAK from the supporters it recorded.
  const rec = record({ arm: "CONTROL", experiment: V2, cands: live, roster, supporters: ["STRIKE", "CHAIN"], confirmed: true });
  (rec as Record<string, unknown>).capture_policy = P2_FIXED_POLICY;
  const n = statusOf(auditWindow(windowOf([fillReceipt("CONTROL", rec, 85, "UP", { experiment: V2 })])), "CONTROL");
  assert.equal(n.integrity_status, "UNVERIFIABLE", String(n.reason_codes));
  assert.deepEqual(n.reason_codes, ["V2_COHORT_UNVERIFIABLE"]);
  assert.equal(RECOVERY_EXPERIMENTS.has(V2), true, "V2 receipts get the full recovery provenance audit");
  assert.equal(isDiagnosticOnly(V2, "COMBINED_DIAG"), true, "COMBINED_DIAG stays diagnostic-only in V2");
  // The same record under V1's identity would be a version mismatch, not silently accepted.
  const crossed = statusOf(auditWindow(windowOf([fillReceipt("CONTROL", rec)])), "CONTROL");
  assert.ok(crossed.reason_codes.includes("EXPERIMENT_MISMATCH"), String(crossed.reason_codes));
});

function v2Receipts(revision: string | null = V2_EVALUATOR_REVISION): ReceiptRow[] {
  const experiment = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  const stamp = { ...(revision == null ? {} : { evaluator_revision: revision }), observer_session_start_ms: close - 1_800_000, capture_policy: P2_FIXED_POLICY };
  return V2_COHORT_ARMS.map((arm) => fillReceipt(arm,
    arm === "NULL_FAV_80" ? { ...stamp, experiment, checkpoint: 450 } : { ...record({ arm, experiment, confirmed: true }), ...stamp },
    85, "UP", { experiment }));
}

test("factory V2 economics never pool old winning receipts with corrected losing receipts", () => {
  const V2 = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  const graded = gradedWindows(3, (i) => v2Receipts(i === 0 ? null : V2_EVALUATOR_REVISION), (i) => i === 0 ? "UP" : "DOWN");
  const before = JSON.stringify(graded);
  const grade = matchedGrade(graded, V2);
  assert.equal(grade.matched_windows, 2);
  assert.equal(grade.matched_clean_windows, 2);
  const bar = grade.matched_clean.find((a) => a.arm === "BAR_NO_SITMASS")!;
  assert.equal(bar.stats.settled, 2);
  assert.equal(bar.stats.wins, 0);
  assert.equal(bar.stats.net_cents, -2 * (85 + feeCents(85)));
  assert.ok(grade.unmatched.every((a) => a.observed_windows === 2), "unmatched cannot blend revisions either");
  const row = lifecycle(graded).find((l) => l.experiment === V2 && l.arm === "BAR_NO_SITMASS")!;
  assert.equal(row.current_result.net_cents, bar.stats.net_cents);
  assert.equal(row.current_sample.observed_windows, 2);
  assert.equal(row.excluded_cohort_windows, 1);
  assert.equal(row.evaluator_revision, V2_EVALUATOR_REVISION);
  assert.ok(pocketScan(graded, V2, "BAR_NO_SITMASS").pockets.every((p) => p.stats.wins === 0));
  assert.ok(counterfactualGates(graded, V2, "BAR_NO_SITMASS").every((c) => c.baseline.wins === 0 && c.windows_considered === 2));
  assert.ok(stageUnlocks(graded, V2).arms.every((a) => a.matched_windows === 2));
  assert.equal(chokeAttribution(graded, V2, "BAR_NO_SITMASS").rolling[0]!.n, 2);
  const coverage = cohortCoverage(graded);
  assert.equal(coverage.observed_windows, 3);
  assert.equal(coverage.excluded_windows.length, 1);
  assert.deepEqual(coverage.excluded_windows[0]!.reasons, ["LEGACY_UNSTAMPED"]);
  const safety = evidenceSafety(graded, []).rows.find((r) => r.experiment === V2 && r.arm === "BAR_NO_SITMASS")!;
  assert.equal(safety.fills, 3, "all observed fills remain visible for safety review");
  assert.equal(safety.evidence_grade_fills, 2);
  assert.equal(JSON.stringify(graded), before);
  assert.equal(lifecycle(graded).find((l) => l.experiment === V2 && l.arm === "COMBINED_DIAG")!.status, "DIAGNOSTIC_ONLY");
});

test("factory V2 excludes incomplete, mixed, unknown, and restart-boundary windows but retains their reasons", () => {
  const V2 = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  const cases = [
    { reason: "INCOMPLETE_ARMS", rows: v2Receipts().slice(0, -1) },
    { reason: "MIXED_REVISIONS", rows: v2Receipts().map((r, i) => i === 0 ? { ...r, payload: { ...r.payload, evaluator_revision: undefined } } : r) },
    { reason: "MIXED_BUILDS", rows: v2Receipts().map((r, i) => i === 0 ? { ...r, build_sha: "another-build" } : r) },
    { reason: "UNKNOWN_REVISION", rows: v2Receipts("FUTURE_UNKNOWN") },
    { reason: "MISSING_SESSION_BOUNDARY", rows: v2Receipts().map((r) => ({ ...r, payload: { ...r.payload, observer_session_start_ms: undefined } })) },
    { reason: "WINDOW_CROSSES_SESSION_BOUNDARY", rows: v2Receipts().map((r) => ({ ...r, payload: { ...r.payload, observer_session_start_ms: close - 899_999 } })) },
  ];
  for (const c of cases) {
    const graded = gradedWindows(1, () => c.rows);
    assert.equal(matchedGrade(graded, V2).matched_windows, 0, c.reason);
    assert.equal(lifecycle(graded).find((l) => l.experiment === V2 && l.arm === "BAR_NO_SITMASS")!.current_result.fills, 0, c.reason);
    assert.ok(cohortCoverage(graded).excluded_windows[0]!.reasons instanceof Array);
    assert.ok((cohortCoverage(graded).excluded_windows[0]!.reasons as string[]).includes(c.reason), c.reason);
    assert.ok(graded.filter((f) => f.experiment === V2).every((f) => !clean(f)), c.reason);
  }
  const complete = gradedWindows(1, () => v2Receipts());
  const staleFacts = complete.map((f) => ({ ...f, facts: {} }));
  assert.equal(matchedGrade(staleFacts, V2).matched_windows, 0, "stale derived facts cannot bypass cohort metadata");
});

test("current V2 cohort membership never certifies candidate integrity", () => {
  const rows = v2Receipts();
  rows[1]!.payload = { ...rows[1]!.payload, recovery: { ...(rows[1]!.payload!.recovery as object), released: ["STREAK.continue_young", "CHAIN.oi_with_price", "DRIFT.aligned_3h"] } };
  const graded = gradedWindows(1, () => rows);
  const V2 = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  assert.equal(cohortCoverage(graded).current_comparable_windows, 1);
  assert.equal(matchedGrade(graded, V2).matched_clean_windows, 0);
  assert.equal(lifecycle(graded).find((l) => l.experiment === V2 && l.arm === "BAR_NO_SITMASS")!.current_result.fills, 0);
});

test("partly written V2 derived facts cannot enter economic comparisons despite complete raw metadata", () => {
  const V2 = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  const complete = gradedWindows(1, () => v2Receipts());
  const partial = complete.filter((f) => f.arm !== "NULL_FAV_80");
  const before = JSON.stringify(partial);
  assert.equal(matchedGrade(partial, V2).matched_windows, 0);
  assert.equal(lifecycle(partial).find((l) => l.experiment === V2 && l.arm === "BAR_NO_SITMASS")!.current_result.fills, 0);
  assert.equal(lifecycle(partial).find((l) => l.experiment === V2 && l.arm === "BAR_NO_SITMASS")!.excluded_cohort_windows, 1);
  assert.equal(pocketScan(partial, V2, "BAR_NO_SITMASS").pockets.length, 0);
  assert.ok(counterfactualGates(partial, V2, "BAR_NO_SITMASS").every((c) => c.baseline.fills === 0));
  assert.equal(stageUnlocks(partial, V2).arms.length, 0);
  const coverage = cohortCoverage(partial);
  assert.equal(coverage.observed_windows, 1);
  assert.equal(coverage.current_comparable_windows, 0);
  assert.deepEqual(coverage.excluded_windows[0]!.reasons, ["INCOMPLETE_DERIVED_ARMS"]);
  assert.equal(JSON.stringify(partial), before);
});

test("V2 auditor flags a released roster card that was never a candidate, preserving the original receipt", () => {
  const V2 = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  const rec = record({ arm: "CONTROL", experiment: V2, released: ["STREAK.continue_young", "CHAIN.oi_with_price", "DRIFT.aligned_3h"], confirmed: true });
  (rec as Record<string, unknown>).capture_policy = P2_FIXED_POLICY;
  const before = JSON.stringify(rec);
  const note = statusOf(auditWindow(windowOf([fillReceipt("CONTROL", rec, 85, "UP", { experiment: V2 })])), "CONTROL");
  assert.equal(note.integrity_status, "SUSPECT");
  assert.ok(note.reason_codes.includes("RELEASED_WITHOUT_CANDIDATE"));
  assert.equal(JSON.stringify(rec), before);
  const old = statusOf(auditWindow(windowOf([fillReceipt("CONTROL", { ...rec, experiment: LOCKS, version: LOCKS })])), "CONTROL");
  assert.equal(old.reason_codes.includes("RELEASED_WITHOUT_CANDIDATE"), false, "V1 history is not reclassified by this V2 rule");
});
