import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SELECTIVE_PARAMS } from "./floor-policy.ts";
import { DEPLOYED_POLICY } from "./gate-vector.ts";
import { receiptKey, type ShadowReceipt } from "./shadow-lab.ts";
import {
  MID_RECOVERY_ENV_FLAG, MID_RECOVERY_EXPERIMENT, evaluateMidRecovery,
  type MidRecoveryDeps, type MidRecoveryInput, type MidRecoveryRow,
} from "./shadow-lab-mid-recovery.ts";
import {
  LOCKS_ARMS, LOCKS_INTERVENTIONS, LOCKS_PROMOTION_ELIGIBLE, LOCKS_RECOVERED_ARMS, MID_RECOVERY_LOCKS_ENV_FLAG, MID_RECOVERY_LOCKS_EXPERIMENT,
  evaluateLocks, summarizeLocks, waiveUncalibratedE1Support,
  type LocksArmState, type LocksEvaluation, type LocksInput, type LocksIntervention, type LocksRecoveredArm,
} from "./shadow-lab-mid-recovery-locks.ts";
import type { ChairResult, Learner, SeatId, SeatRow, Settings, Snapshot, Vote } from "./types";

// ---------------------------------------------------------------------------
// Fixtures: the real evaluator and the real gate math over a Chair stand-in
// that builds its bar the way chair.ts does (base, or bar_override when
// adaptive_bar is off, + 0.2 × sit_mass, clamped 0.24–0.72). The real
// producer, projection and Chair are exercised by
// scripts/mid-recovery-locks-shadow.test.mjs.
// ---------------------------------------------------------------------------

const now = Date.parse("2026-09-27T15:05:00Z");
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: now + 420_000, ticker: "KXBTC15M-26SEP271012-15", mins_left: 7, secs_left: 420, demo: false,
  yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, no_bid_size: 40, yes_bid_size: 30,
  edge_up: 5, edge_down: -9, fair_yes: 91, fee_yes: 1, fee_no: 2,
  spread_cents: 1, leftover_cents: -1, spot_age_s: 1, lab_fair_yes: 92, lab_age_s: 1,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  ...extra,
} as Snapshot);
const seatRow = (seat: SeatId, lean: "UP" | "DOWN" | "WAIT", extra: Partial<SeatRow> = {}): SeatRow =>
  ({ seat, lean, health: "LIVE", status: "LIVE", folded: false, weight: 0.1, forced_sit: false, skill_used: `${seat}.card`, ...extra }) as SeatRow;
const vote = (seat: SeatId, skill: string, lean: Vote["lean"]): Vote => ({
  seat, lean, raw_lean: lean, confidence: 64, raw_conf: 64, features: {}, reasoning: skill, skill_used: skill, skill_status: "SHADOW", shadow: null, paper: [],
  thresh_used: [], skill_n: 1, skill_hits: 0, skill_wilson: 0, hypothesis: skill, evidence: [], counter: "", invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID",
});
const candidates = [
  { seat: "STREAK" as SeatId, card_id: "STREAK.continue_young", vote: vote("STREAK", "STREAK.continue_young", "UP") },
  { seat: "CHAIN" as SeatId, card_id: "CHAIN.oi_with_price", vote: vote("CHAIN", "CHAIN.oi_with_price", "UP") },
];
const waitChair = (): ChairResult => ({
  lean: "WAIT", score: 0, bar: 0.5, hard_fail: false, confidence: 50, calc: "production", gates: [{ id: "bar", label: "bar", pass: false, hard: true, value: "" }],
  quorum: { up: 0, down: 0, wait: 3 }, rows: [seatRow("STREAK", "WAIT"), seatRow("CHAIN", "WAIT"), seatRow("DRIFT", "WAIT")],
} as unknown as ChairResult);
const learner = (): Learner => ({ skills: {}, seat_w: {}, seat_n: {} } as unknown as Learner);

type Scenario = { vsBar: number; sitMass: number; status: SeatRow["status"]; extraRows?: SeatRow[] };
/** The recovered path stand-in: a projection of the two candidates and a Chair that composes its bar like chair.ts. */
function depsFor(sc: Scenario, spy: { chair: Array<{ settings: Settings; touched: unknown }>; project: number[] } = { chair: [], project: [] }): MidRecoveryDeps {
  return {
    runBotsWithEvaluatedCandidates: (s) => ({ version: "E1_RECOVERY_V1_INACTIVE", ticker: s.ticker, close_time: s.close_time, as_of: s.as_of, votes: [], evaluated: candidates.map((c) => c.vote) }),
    projectInactiveE1Recovery: (frame, l) => {
      spy.project.push(frame.evaluated.length);
      (frame.evaluated as Vote[]).push(vote("WICK", "WICK.mutation", "DOWN")); // a hostile projection: must not leak into another arm
      return { version: "E1_RECOVERY_V1_INACTIVE", active: false, ticker: frame.ticker, close_time: frame.close_time, as_of: frame.as_of,
        candidates: candidates.map((c) => ({ ...c, original_status: "SHADOW" as const })), simulated: { votes: candidates.map((c) => c.vote), learner: l, released: candidates.map((c) => c.card_id), missing: [] } };
    },
    runChair: (votes, _s, l, settings) => {
      const bag = l as unknown as { touched?: number };
      spy.chair.push({ settings: { ...settings }, touched: bag.touched });
      bag.touched = (bag.touched ?? 0) + 1; // a hostile Chair: must not leak into another arm or pass
      votes.push(vote("WICK", "WICK.mutation", "DOWN"));
      const base = settings.adaptive_bar ? 0.3 : (settings.bar_override ?? 0.3);
      const sitTerm = 0.2 * sc.sitMass;
      const pre = base + sitTerm;
      const bar = Math.min(0.72, Math.max(0.24, pre));
      const lean = sc.vsBar >= bar ? "UP" : "WAIT";
      const rows = [seatRow("STREAK", "UP", { status: sc.status }), seatRow("CHAIN", "UP", { status: sc.status }), seatRow("DRIFT", "WAIT"), ...(sc.extraRows ?? [])];
      return {
        lean, score: sc.vsBar, bar, vs_bar: sc.vsBar, sit_mass: sc.sitMass, hard_fail: false, confidence: 64, calc: "stand-in",
        gates: [{ id: "bar", label: "bar", pass: lean !== "WAIT", hard: true, value: "" }], quorum: { up: 2, down: 0, wait: 1 }, rows,
        bar_breakdown: { base, quiet: 0, weekend: 0, phase: 0, law_miss1: 0, calib_tax: 0, sit_mass: sitTerm, knn: 0, pre_clamp: pre, final: bar },
      } as unknown as ChairResult;
    },
  };
}
/** Under the bar only because of the sit term, and both recovered rows UNCALIBRATED: the audit's two locks. */
const LOCKED: Scenario = { vsBar: 0.45, sitMass: 1, status: "UNCALIBRATED" };
/** Nothing locked: every arm sees the same eligible read. */
const OPEN: Scenario = { vsBar: 0.9, sitMass: 0.1, status: "LIVE" };

const blankArms = (): Record<LocksRecoveredArm, LocksArmState> => ({
  CONTROL: { watch: null, calls: [], last_lean: "WAIT" }, BAR_NO_SITMASS: { watch: null, calls: [], last_lean: "WAIT" },
  SUPPORT_UNCAL_E1: { watch: null, calls: [], last_lean: "WAIT" }, COMBINED_DIAG: { watch: null, calls: [], last_lean: "WAIT" },
});
const input = (s: Snapshot, arms = blankArms()): LocksInput => ({
  snap: s, chair: waitChair(), learner: learner(), settings: { mutes: [], bar_override: null, adaptive_bar: true, beast: false }, call_log: [], audit: null, ready: true, start: now - 86_400_000, arms,
});
/** Drive every arm's own latch through `frames` ticks `gapMs` apart. */
function drive(sc: Scenario, frames: number, gapMs: number, s0 = snap(), arms = blankArms()): LocksEvaluation {
  let ev: LocksEvaluation | null = null;
  let state = arms;
  for (let i = 0; i < frames; i += 1) {
    ev = evaluateLocks(input(snap({ ...s0, as_of: s0.as_of + i * gapMs }), state), depsFor(sc));
    const next = {} as Record<LocksRecoveredArm, LocksArmState>;
    for (const arm of LOCKS_RECOVERED_ARMS) next[arm] = { ...state[arm], watch: ev.arms[arm].evaluation.confirmation.watch, last_lean: ev.arms[arm].evaluation.recovered.lean };
    state = next;
  }
  return ev!;
}
const booked = (ev: LocksEvaluation) => LOCKS_RECOVERED_ARMS.filter((a) => ev.arms[a].evaluation.simulated.booked);
const check = (ev: LocksEvaluation, arm: LocksRecoveredArm, id: string) => ev.arms[arm].evaluation.recovered.checks.find((k) => k.id === id)?.pass;

// ---------------------------------------------------------------------------
// Identity.
// ---------------------------------------------------------------------------

test("separate experiment identity and version: own id, own env flag, five approved arms, production authority NONE", () => {
  const X = MID_RECOVERY_LOCKS_EXPERIMENT;
  assert.equal(X.id, "MID_RECOVERY_LOCKS_V1_INACTIVE");
  assert.notEqual(X.id, MID_RECOVERY_EXPERIMENT.id);
  assert.equal(X.version, 1);
  assert.equal(X.active_by_default, false);
  assert.equal(X.authority, "research-only-simulated");
  assert.equal(X.production_authority, "NONE");
  assert.equal(MID_RECOVERY_LOCKS_ENV_FLAG, "MID_RECOVERY_LOCKS_SHADOW_ENABLED");
  assert.notEqual(MID_RECOVERY_LOCKS_ENV_FLAG, MID_RECOVERY_ENV_FLAG, "its own switch: turning V1 on or off never starts or stops this one");
  assert.deepEqual(Object.values(LOCKS_ARMS), ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG", "NULL_FAV_80"]);
  assert.deepEqual([...LOCKS_RECOVERED_ARMS], ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG"]);
  assert.deepEqual(JSON.parse(JSON.stringify(LOCKS_INTERVENTIONS)), {
    CONTROL: { bar_no_sitmass: false, support_uncal_e1: false }, BAR_NO_SITMASS: { bar_no_sitmass: true, support_uncal_e1: false },
    SUPPORT_UNCAL_E1: { bar_no_sitmass: false, support_uncal_e1: true }, COMBINED_DIAG: { bar_no_sitmass: true, support_uncal_e1: true },
  });
  assert.equal(X.floor_cents, 80);
  assert.equal(X.floor_cents, SELECTIVE_PARAMS.floor_cents, "the deployed floor, never lower");
  assert.equal(X.policy_id, DEPLOYED_POLICY.id);
  assert.ok(Object.isFrozen(X) && Object.isFrozen(X.arms) && Object.isFrozen(X.interventions) && Object.isFrozen(X.promotion_eligible));
  const ev = evaluateLocks(input(snap()), depsFor(OPEN));
  for (const arm of LOCKS_RECOVERED_ARMS) {
    assert.equal(ev.arms[arm].experiment, "MID_RECOVERY_LOCKS_V1_INACTIVE");
    assert.equal(ev.arms[arm].experiment_version, 1);
    assert.equal(ev.arms[arm].arm, arm);
  }
});

test("COMBINED_DIAG is never promotion eligible — not in the constant, not on an evaluation, not in the report", () => {
  assert.equal(LOCKS_PROMOTION_ELIGIBLE.COMBINED_DIAG, false);
  assert.equal(LOCKS_PROMOTION_ELIGIBLE.CONTROL, false, "a reference arm");
  assert.equal(LOCKS_PROMOTION_ELIGIBLE.NULL_FAV_80, false, "a benchmark");
  assert.throws(() => { (LOCKS_PROMOTION_ELIGIBLE as Record<string, boolean>).COMBINED_DIAG = true; }, TypeError, "frozen");
  // Even when COMBINED_DIAG is the only arm that books, it stays ineligible.
  const ev = drive(LOCKED, 3, 4_000);
  assert.deepEqual(booked(ev), ["COMBINED_DIAG"]);
  assert.equal(ev.arms.COMBINED_DIAG.promotion_eligible, false);
  const summary = summarizeLocks([]);
  assert.equal(summary.arms.COMBINED_DIAG.promotion_eligible, false);
  assert.equal(summary.promotion.eligible.COMBINED_DIAG, false);
  assert.equal(summary.promotion.auto_promotion, false);
  assert.equal(summary.promotion.production_authority, "NONE");
});

// ---------------------------------------------------------------------------
// The interventions do what they say, and nothing else.
// ---------------------------------------------------------------------------

test("each arm changes exactly its own lock: the audit's locked window opens only when both are removed", () => {
  const ev = evaluateLocks(input(snap()), depsFor(LOCKED));
  const lean = (a: LocksRecoveredArm) => ev.arms[a].evaluation.recovered.lean;
  assert.equal(lean("CONTROL"), "WAIT", "0.45 under a 0.50 bar (0.30 + 0.20 sit)");
  assert.equal(lean("SUPPORT_UNCAL_E1"), "WAIT", "the support waiver never moves the Chair's direction");
  assert.equal(lean("BAR_NO_SITMASS"), "UP", "0.45 clears the 0.30 bar without the sit term");
  assert.equal(lean("COMBINED_DIAG"), "UP");
  const bar = ev.arms.BAR_NO_SITMASS.intervention.bar_no_sitmass;
  assert.equal(bar.applied, true);
  assert.equal(bar.control_bar, 0.5);
  assert.equal(bar.sit_term, 0.2);
  assert.ok(Math.abs(bar.arm_bar! - 0.3) < 1e-12);
  assert.equal(bar.exact, true, "arm pre-clamp = control pre-clamp − sit term");
  assert.equal(bar.control_lean, "WAIT");
  assert.equal(bar.arm_lean, "UP");
  assert.equal(ev.arms.CONTROL.intervention.bar_no_sitmass.requested, false);
  assert.equal(ev.arms.CONTROL.intervention.bar_no_sitmass.applied, false);
  // BAR alone: directional, but the UNCALIBRATED rows still cannot support.
  assert.equal(check(ev, "BAR_NO_SITMASS", "supporters"), false);
  assert.equal(ev.arms.BAR_NO_SITMASS.evaluation.recovered.eligible, false);
  assert.deepEqual(ev.arms.BAR_NO_SITMASS.intervention.support_uncal_e1.waived_seats, []);
  // COMBINED: directional and supported.
  assert.deepEqual(ev.arms.COMBINED_DIAG.intervention.support_uncal_e1.waived_seats, ["STREAK", "CHAIN"]);
  assert.deepEqual(ev.arms.COMBINED_DIAG.evaluation.recovered.supporters, ["STREAK", "CHAIN"]);
  assert.equal(ev.arms.COMBINED_DIAG.evaluation.recovered.eligible, true);
  // CONTROL's Chair ran once, with the production bar settings; nothing about the bar was touched.
  const spy = { chair: [] as Array<{ settings: Settings; touched: unknown }>, project: [] as number[] };
  evaluateLocks(input(snap()), depsFor(LOCKED, spy));
  const adaptive = spy.chair.filter((c) => c.settings.adaptive_bar === true && c.settings.bar_override === null).length;
  const overridden = spy.chair.filter((c) => c.settings.adaptive_bar === false);
  assert.equal(spy.chair.length, 6, "CONTROL 1 + BAR 2 + SUPPORT 1 + COMBINED 2 Chair runs");
  assert.equal(adaptive, 4, "every control pass runs the production bar settings");
  assert.equal(overridden.length, 2, "only the two sit-free passes override the bar base");
  for (const o of overridden) assert.ok(Math.abs((o.settings.bar_override as number) - 0.1) < 1e-12, "base 0.30 − sit term 0.20");
});

test("the support waiver touches only unfolded UNCALIBRATED recovered E1 rows, never a production seat, a fold, or the input Chair", () => {
  const chair = {
    lean: "UP", rows: [
      seatRow("STREAK", "UP", { status: "UNCALIBRATED" }),
      seatRow("STRIKE", "UP", { status: "FOLDED", folded: true }),
      seatRow("WICK", "UP", { status: "UNCALIBRATED" }), // a production seat, not a recovered candidate
      seatRow("CHAIN", "UP", { status: "LIVE" }),
      seatRow("DRIFT", "UP", { status: "MUTED" }),
    ],
  } as unknown as ChairResult;
  const before = JSON.stringify(chair);
  const trace: LocksIntervention["support_uncal_e1"] = { requested: true, candidate_seats: [], waived_seats: [], folded_uncalibrated_seats: [] };
  const out = waiveUncalibratedE1Support(chair, ["STREAK", "STRIKE", "CHAIN", "DRIFT"], trace);
  assert.equal(JSON.stringify(chair), before, "the input Chair is not mutated");
  const status = (s: string) => out.rows.find((r) => r.seat === s)!.status;
  assert.equal(status("STREAK"), "LIVE");
  assert.equal(status("STRIKE"), "FOLDED", "the Chair's fold is never reversed");
  assert.equal(out.rows.find((r) => r.seat === "STRIKE")!.folded, true);
  assert.equal(status("WICK"), "UNCALIBRATED", "a production seat is never waived");
  assert.equal(status("CHAIN"), "LIVE");
  assert.equal(status("DRIFT"), "MUTED", "only UNCALIBRATED is waived");
  assert.deepEqual(trace.waived_seats, ["STREAK"]);
  assert.deepEqual(trace.folded_uncalibrated_seats, ["STRIKE"]);
  for (const k of ["weight", "lean", "health", "forced_sit"] as const) {
    assert.deepEqual(out.rows.map((r) => r[k]), chair.rows.map((r) => r[k]), `${k} untouched`);
  }
});

// ---------------------------------------------------------------------------
// Isolation between arms.
// ---------------------------------------------------------------------------

test("no cross-arm object mutation: a hostile Chair and projection cannot reach another arm, a second pass, or the inputs", () => {
  const spy = { chair: [] as Array<{ settings: Settings; touched: unknown }>, project: [] as number[] };
  const inp = input(snap());
  const before = JSON.stringify(inp);
  const ev = evaluateLocks(inp, depsFor(LOCKED, spy));
  assert.equal(JSON.stringify(inp), before, "the snapshot, learner, production Chair, settings, call log and arm states are unchanged");
  assert.deepEqual(spy.chair.map((c) => c.touched), [undefined, undefined, undefined, undefined, undefined, undefined], "every Chair run sees a learner no other run touched");
  assert.deepEqual(spy.project, [2, 2, 2, 2], "every arm's projection sees the pristine producer frame");
  // The four evaluations are distinct objects all the way down.
  const objs = LOCKS_RECOVERED_ARMS.map((a) => ev.arms[a].evaluation);
  for (let i = 0; i < objs.length; i += 1) for (let j = i + 1; j < objs.length; j += 1) {
    assert.notEqual(objs[i], objs[j]);
    assert.notEqual(objs[i]!.recovered.chair_trace.rows, objs[j]!.recovered.chair_trace.rows);
    assert.notEqual(objs[i]!.candidates, objs[j]!.candidates);
  }
  ev.arms.CONTROL.evaluation.recovered.supporters.push("WICK");
  assert.ok(!ev.arms.COMBINED_DIAG.evaluation.recovered.supporters.includes("WICK"));
});

test("independent EntryWatch per arm: one arm's latch never advances, starts or confirms another's", () => {
  // LOCKED: only COMBINED_DIAG is eligible, so only its latch runs.
  const one = evaluateLocks(input(snap()), depsFor(LOCKED));
  assert.equal(one.arms.COMBINED_DIAG.evaluation.confirmation.frames, 1);
  for (const a of ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1"] as const) assert.equal(one.arms[a].evaluation.confirmation.watch, null, a);
  // A mature latch handed to CONTROL does not become COMBINED's.
  const s = snap();
  const mature = { key: `${s.ticker}|${s.close_time}`, side: "UP" as const, since: s.as_of - 20_000, last: s.as_of - 4_000, frames: 5, mode: "normal" as const };
  const arms = blankArms();
  arms.CONTROL = { ...arms.CONTROL, watch: mature };
  const ev = evaluateLocks(input(s, arms), depsFor(LOCKED));
  assert.equal(ev.arms.COMBINED_DIAG.evaluation.confirmation.frames, 1, "COMBINED starts its own latch");
  assert.equal(ev.arms.COMBINED_DIAG.evaluation.confirmation.confirmed, false);
  assert.equal(ev.arms.CONTROL.evaluation.confirmation.watch, null, "CONTROL is not eligible, so its own latch drops");
  // OPEN: the same frames confirm each arm on its own latch.
  const open = drive(OPEN, 3, 4_000);
  for (const a of LOCKS_RECOVERED_ARMS) assert.equal(open.arms[a].evaluation.confirmation.frames, 3, a);
  const watches = LOCKS_RECOVERED_ARMS.map((a) => open.arms[a].evaluation.confirmation.watch);
  for (let i = 0; i < watches.length; i += 1) for (let j = i + 1; j < watches.length; j += 1) assert.notEqual(watches[i], watches[j], "each arm holds its own latch object");
  assert.deepEqual(booked(open), ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG"]);
});

test("independent arm risk history: an arm's own open fill blocks only that arm", () => {
  const open = [{ id: "r", t: now - 1_800_000, ticker: "PRIOR", close_time: now - 900_000, lean: "UP" as const, cents: 85, settle: null, flipped: false }];
  const arms = blankArms();
  arms.SUPPORT_UNCAL_E1 = { ...arms.SUPPORT_UNCAL_E1, calls: open };
  const ev = evaluateLocks(input(snap(), arms), depsFor(OPEN));
  assert.equal(check(ev, "SUPPORT_UNCAL_E1", "daily_risk"), false);
  assert.equal(ev.arms.SUPPORT_UNCAL_E1.evaluation.recovered.eligible, false);
  for (const a of ["CONTROL", "BAR_NO_SITMASS", "COMBINED_DIAG"] as const) {
    assert.equal(check(ev, a, "daily_risk"), true, a);
    assert.equal(ev.arms[a].evaluation.recovered.eligible, true, a);
  }
  // The production book is never an arm's risk history.
  const prod = evaluateLocks({ ...input(snap()), call_log: open }, depsFor(OPEN));
  for (const a of LOCKS_RECOVERED_ARMS) assert.equal(check(prod, a, "daily_risk"), true, a);
  // A window an arm already holds is never booked twice by that arm.
  const s = snap();
  const held = [{ id: "h", t: now - 30_000, ticker: s.ticker, close_time: s.close_time, lean: "UP" as const, cents: 85, settle: null, flipped: false }];
  const heldArms = blankArms();
  heldArms.BAR_NO_SITMASS = { ...heldArms.BAR_NO_SITMASS, calls: held };
  const again = drive(OPEN, 3, 4_000, s, heldArms);
  assert.ok(!booked(again).includes("BAR_NO_SITMASS"));
  assert.ok(booked(again).includes("CONTROL"));
});

// ---------------------------------------------------------------------------
// Production rules hold in every arm.
// ---------------------------------------------------------------------------

test("79¢ cannot fill in any arm, even fully confirmed; 80¢ can", () => {
  const cheap = { yes_ask: 79, yes_bid: 78, no_ask: 22, no_bid: 21 };
  for (const sc of [OPEN, LOCKED]) {
    const ev = drive(sc, 4, 4_000, snap(cheap));
    assert.deepEqual(booked(ev), [], "no arm books at 79¢");
    for (const a of LOCKS_RECOVERED_ARMS) {
      assert.equal(ev.arms[a].evaluation.recovered.eligible, false, a);
      assert.equal(ev.arms[a].evaluation.simulated.price_cents, null, a);
      if (ev.arms[a].evaluation.recovered.side) assert.equal(check(ev, a, "quote"), false, a);
    }
  }
  const at = drive(OPEN, 3, 4_000, snap({ yes_ask: 80, yes_bid: 79, no_ask: 21, no_bid: 20 }));
  assert.deepEqual(booked(at), ["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG"]);
  for (const a of LOCKS_RECOVERED_ARMS) assert.equal(at.arms[a].evaluation.simulated.price_cents, 80);
});

test("confirmation cannot be bypassed: one tick, two frames, or three frames in four seconds books nothing in any arm", () => {
  for (const [frames, gap] of [[1, 4_000], [2, 4_000], [3, 2_000]] as const) {
    const ev = drive(OPEN, frames, gap);
    assert.deepEqual(booked(ev), [], `${frames} frames ${gap}ms apart`);
    for (const a of LOCKS_RECOVERED_ARMS) {
      assert.equal(ev.arms[a].evaluation.recovered.eligible, true, a);
      assert.equal(ev.arms[a].evaluation.confirmation.confirmed, false, a);
      assert.equal(ev.arms[a].evaluation.confirmation.need_frames, SELECTIVE_PARAMS.confirmation_frames);
      assert.equal(ev.arms[a].evaluation.confirmation.need_seconds, SELECTIVE_PARAMS.confirmation_seconds);
    }
  }
  const ok = drive(OPEN, 3, 4_000);
  for (const a of LOCKS_RECOVERED_ARMS) {
    assert.deepEqual(ok.arms[a].evaluation.simulated, { qualified: true, booked: true, side: "UP", price_cents: 85, fee_cents: ok.arms[a].evaluation.simulated.fee_cents, settlement: null, win: null, net_cents: null, authority: "research-only-simulated" });
  }
});

// ---------------------------------------------------------------------------
// Receipts and the report.
// ---------------------------------------------------------------------------

test("receipt keys never collide between arms, kinds, or with MID_RECOVERY_V1_INACTIVE on the same window", () => {
  const s = snap();
  const kinds: ShadowReceipt["kind"][] = ["intention", "fill", "no_fill"];
  const keys = new Set<string>();
  const base = { ticker: s.ticker, close_ms: s.close_time };
  for (const arm of Object.values(LOCKS_ARMS)) for (const kind of kinds) keys.add(receiptKey({ experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arm, kind, ...base }));
  assert.equal(keys.size, 5 * kinds.length, "five arms × three kinds on one window, all distinct");
  for (const arm of Object.values(MID_RECOVERY_EXPERIMENT.arms)) for (const kind of kinds) {
    const v1 = receiptKey({ experiment: MID_RECOVERY_EXPERIMENT.id, arm, kind, ...base });
    assert.ok(!keys.has(v1), `${v1} is V1's alone — including V1's own NULL_FAV_80`);
  }
  // The persisted key is exactly the table's primary key order (migrations/0057).
  assert.match(readFileSync(new URL("../../../migrations/0057_desk_shadow_lab.sql", import.meta.url), "utf8"), /primary key \(experiment, arm, ticker, close_time, kind\)/);
});

test("the report reads only this experiment's arms, per arm, and never mixes in MID_RECOVERY_V1_INACTIVE rows", () => {
  const s = snap();
  const row = (arm: string, kind: MidRecoveryRow["kind"], extra: Partial<MidRecoveryRow & { experiment: string }> = {}): MidRecoveryRow & { experiment?: string } => ({
    arm, ticker: s.ticker, close_ms: s.close_time, kind, decided_ms: now, side: null, ask_cents: null, fee_cents: null, official_winner: null, net_cents: null, payload: { funnel_stage_index: 0 }, ...extra,
  });
  const fill = (arm: string, net: number) => row(arm, "fill", { side: "UP", ask_cents: 85, fee_cents: 2, official_winner: "UP", net_cents: net, payload: { funnel_stage_index: 9, recovered: { side: "UP" }, baseline: { side: null } } });
  const rows = [
    row("CONTROL", "no_fill"), row("BAR_NO_SITMASS", "no_fill"), row("SUPPORT_UNCAL_E1", "no_fill"), fill("COMBINED_DIAG", 13), fill("NULL_FAV_80", 13),
    row("RECOVERED_MID", "fill", { experiment: MID_RECOVERY_EXPERIMENT.id, side: "UP", ask_cents: 85 }),
    fill("CONTROL", 99), // a V1-labelled row with a LOCKS arm name must still be excluded
  ];
  rows[rows.length - 1] = { ...rows[rows.length - 1]!, experiment: MID_RECOVERY_EXPERIMENT.id };
  const sum = summarizeLocks(rows);
  assert.equal(sum.experiment, "MID_RECOVERY_LOCKS_V1_INACTIVE");
  assert.equal(sum.foreign_rows, 2);
  assert.equal(sum.windows, 1);
  assert.equal(sum.arms.CONTROL.quality.fills, 0, "the V1 row did not leak into CONTROL");
  assert.equal(sum.arms.COMBINED_DIAG.quality.fills, 1);
  assert.equal(sum.arms.COMBINED_DIAG.quality.net_cents, 13);
  assert.equal(sum.arms.COMBINED_DIAG.vs_null_fav.overlap_windows, 1);
  assert.equal(sum.arms.COMBINED_DIAG.vs_control.arm_only_fills, 1);
  assert.equal(sum.null_fav.fills, 1);
  for (const a of LOCKS_RECOVERED_ARMS) assert.equal(sum.arms[a].observed_windows, 1, a);
});

// ---------------------------------------------------------------------------
// MID_RECOVERY_V1_INACTIVE is unchanged.
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the V1 experiment's source at the commit this experiment was
 * added on. LOCKS reuses V1's evaluator unchanged; if these move, V1 changed —
 * which needs its own reviewed change, not a side effect of this experiment.
 */
const V1_SOURCES: Record<string, string> = {
  "src/lib/desk/shadow-lab-mid-recovery.ts": "16b5112f3c10631a41c4038d03f01d394f1522688be0e90077ba2ce1d7c17974",
  "src/lib/desk/shadow-lab-mid-recovery.server.ts": "3232f493f06475cef70741bedc7bb07459b8b87cc293d909a845abeec7628591",
  "server/routes/research/mid-recovery.get.ts": "e8f8c239c1be36c00fcdfc3ae6820a4826f65eedfe35bbb071d6c79c50a8ba8d",
};

test("MID_RECOVERY_V1_INACTIVE is unchanged: same identity, same sources, and CONTROL is exactly its recovered arm", () => {
  assert.equal(MID_RECOVERY_EXPERIMENT.id, "MID_RECOVERY_V1_INACTIVE");
  assert.equal(MID_RECOVERY_EXPERIMENT.version, 1);
  assert.deepEqual({ ...MID_RECOVERY_EXPERIMENT.arms }, { baseline: "BASELINE", recovered: "RECOVERED_MID", null_fav: "NULL_FAV_80" });
  assert.equal(MID_RECOVERY_ENV_FLAG, "MID_RECOVERY_SHADOW_ENABLED");
  for (const [rel, sha] of Object.entries(V1_SOURCES)) {
    const got = createHash("sha256").update(readFileSync(new URL(`../../../${rel}`, import.meta.url))).digest("hex");
    assert.equal(got, sha, `${rel} changed`);
  }
  // CONTROL is the V1 evaluator on the same input, unmodified.
  for (const sc of [OPEN, LOCKED]) {
    const locks = evaluateLocks(input(snap()), depsFor(sc));
    const v1Input: MidRecoveryInput = { ...input(snap()), recovered_calls: [], watch: null, last_recovered_lean: "WAIT" };
    const direct = evaluateMidRecovery(v1Input, depsFor(sc));
    assert.deepEqual(locks.arms.CONTROL.evaluation, direct);
  }
});
