import assert from "node:assert/strict";
import test from "node:test";
import type { MidRecoveryDeps } from "./shadow-lab-mid-recovery.ts";
import {
  LOCKS_INTERVENTIONS, LOCKS_PROMOTION_ELIGIBLE, LOCKS_RECOVERED_ARMS, MID_RECOVERY_LOCKS_ENV_FLAG, MID_RECOVERY_LOCKS_EXPERIMENT, evaluateLocks,
  type LocksArmState, type LocksInput, type LocksRecoveredArm,
} from "./shadow-lab-mid-recovery-locks.ts";
import {
  CapturePolicyMissing, E1_BOOK_DUPLICATE, MID_RECOVERY_LOCKS_V2_ENV_FLAG, MID_RECOVERY_LOCKS_V2_EXPERIMENT, REQUIRED_CAPTURE_POLICY, dedupeE1BookSupport, evaluateLocksV2,
  type P1Trace,
} from "./shadow-lab-mid-recovery-locks-v2.ts";
import { DEPLOYED_POLICY, reachableQuorum } from "./gate-vector.ts";
import { eligibleSupportRows } from "./support-eligibility.ts";
import type { ChairResult, Learner, SeatId, SeatRow, Settings, Snapshot, Vote } from "./types";

// Fixtures: LOCKS V1's own stand-ins (a projection of STREAK + CHAIN and a Chair
// that builds its bar the way chair.ts does), with the P2-guarded frame stamp.
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
    runBotsWithEvaluatedCandidates: (s) => ({ version: "E1_RECOVERY_V1_INACTIVE", capture_policy: "P2_EXPLOIT_GUARD_V1", ticker: s.ticker, close_time: s.close_time, as_of: s.as_of, votes: [], evaluated: candidates.map((c) => c.vote) }),
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

const trace = (): P1Trace => ({ streak_side: null, book_supporters: [], applied: false });
const chairOf = (rows: SeatRow[]): ChairResult => ({ ...waitChair(), lean: "UP", rows } as unknown as ChairResult);
const STRIKE_UP = seatRow("STRIKE", "UP");
const CARRY_UP = seatRow("CARRY", "UP");

test("identity: a new experiment and flag beside LOCKS V1, the same five arms, both corrections declared, authority NONE", () => {
  const X = MID_RECOVERY_LOCKS_V2_EXPERIMENT;
  assert.equal(X.id, "MID_RECOVERY_LOCKS_V2_INACTIVE");
  assert.notEqual(X.id, MID_RECOVERY_LOCKS_EXPERIMENT.id);
  assert.equal(X.version, 1);
  assert.equal(X.supersedes, MID_RECOVERY_LOCKS_EXPERIMENT.id);
  assert.equal(X.active_by_default, false);
  assert.equal(X.production_authority, "NONE");
  assert.deepEqual(X.arms, MID_RECOVERY_LOCKS_EXPERIMENT.arms);
  assert.deepEqual(X.interventions, LOCKS_INTERVENTIONS);
  assert.deepEqual(X.promotion_eligible, LOCKS_PROMOTION_ELIGIBLE);
  assert.equal(X.promotion_eligible.COMBINED_DIAG, false);
  assert.deepEqual([X.floor_cents, X.policy_id, X.band_secs], [MID_RECOVERY_LOCKS_EXPERIMENT.floor_cents, MID_RECOVERY_LOCKS_EXPERIMENT.policy_id, MID_RECOVERY_LOCKS_EXPERIMENT.band_secs]);
  assert.equal(X.corrections.p2_capture_policy_required, "P2_EXPLOIT_GUARD_V1");
  assert.equal(REQUIRED_CAPTURE_POLICY, "P2_EXPLOIT_GUARD_V1");
  assert.equal(MID_RECOVERY_LOCKS_V2_ENV_FLAG, "MID_RECOVERY_LOCKS_V2_SHADOW_ENABLED");
  assert.notEqual(MID_RECOVERY_LOCKS_V2_ENV_FLAG, MID_RECOVERY_LOCKS_ENV_FLAG);
  assert.ok(Object.isFrozen(X) && Object.isFrozen(X.corrections));
});

test("P1: STREAK beside another E1 book supporter of the same side counts once; nothing else about the Chair moves", () => {
  const chair = chairOf([seatRow("STREAK", "UP"), STRIKE_UP, seatRow("CHAIN", "UP")]);
  const before = JSON.stringify(chair);
  const t = trace();
  const out = dedupeE1BookSupport(chair, t);
  assert.equal(JSON.stringify(chair), before, "the input Chair is never mutated");
  assert.deepEqual(t, { streak_side: "UP", book_supporters: ["STRIKE"], applied: true });
  assert.deepEqual(eligibleSupportRows(out, "UP").map((r) => r.seat), ["STRIKE", "CHAIN"]);
  const streak = out.rows.find((r) => r.seat === "STREAK")!;
  assert.equal(streak.status, E1_BOOK_DUPLICATE);
  const { status: _s, ...rest } = streak;
  const { status: _o, ...orig } = chair.rows.find((r) => r.seat === "STREAK")!;
  assert.deepEqual(rest, orig, "lean, weight, health, fold and forced-sit are the Chair's own");
  assert.deepEqual({ ...out, rows: [] }, { ...chair, rows: [] }, "lean, score, bar and gates are the Chair's own");
});

test("P1 applies only to a real double count", () => {
  const cases: Array<[string, SeatRow[]]> = [
    ["no other book supporter", [seatRow("STREAK", "UP"), seatRow("CHAIN", "UP")]],
    ["the book seat is folded", [seatRow("STREAK", "UP"), seatRow("STRIKE", "UP", { folded: true })]],
    ["the book seat is unhealthy", [seatRow("STREAK", "UP"), seatRow("STRIKE", "UP", { health: "STALE" })]],
    ["the book seat opposes", [seatRow("STREAK", "UP"), seatRow("STRIKE", "DOWN")]],
    ["STREAK is not itself a supporter", [seatRow("STREAK", "UP", { status: "UNCALIBRATED" }), STRIKE_UP]],
    ["STREAK waits", [seatRow("STREAK", "WAIT"), STRIKE_UP]],
  ];
  for (const [label, rows] of cases) {
    const t = trace();
    const chair = chairOf(rows);
    assert.deepEqual(dedupeE1BookSupport(chair, t), chair, label);
    assert.equal(t.applied, false, label);
  }
});

test("the deployed gate math: in tight mode the double count decides the supporter gate, and the correction removes it", () => {
  // Tight mode needs four supporters from three families. STREAK + STRIKE are one E1 book read.
  const chair = { ...chairOf([seatRow("STREAK", "UP"), STRIKE_UP, seatRow("CHAIN", "UP"), seatRow("DRIFT", "UP")]), quorum: { up: 4, down: 0, wait: 0 } } as ChairResult;
  const counted = reachableQuorum(chair, "UP", DEPLOYED_POLICY, "tight");
  assert.equal(counted.supporters.length, 4);
  assert.equal(counted.reachable, true, "V1 path: the per-seat count clears the tight bar");
  const t = trace();
  const corrected = reachableQuorum(dedupeE1BookSupport(chair, t), "UP", DEPLOYED_POLICY, "tight");
  assert.equal(t.applied, true);
  assert.deepEqual(corrected.supporters, ["STRIKE", "CHAIN", "DRIFT"]);
  assert.equal(corrected.reachable, false, "three independent reads do not clear a four-supporter bar");
  assert.equal(corrected.deficit.supporters, 1);
  // The auditor's rule agrees: it flags exactly this case on V1 receipts.
  const need = DEPLOYED_POLICY.params.tight_min_speaking;
  assert.ok(counted.supporters.length - 1 < need && counted.supporters.length >= need);
});

test("through the evaluator: every arm's gates see the corrected supporters; in normal mode the verdict is unchanged (not a veto)", () => {
  const sc = { ...OPEN, extraRows: [STRIKE_UP] };
  const v1 = evaluateLocks(input(snap()), depsFor(sc));
  const v2 = evaluateLocksV2(input(snap()), depsFor(sc));
  for (const arm of LOCKS_RECOVERED_ARMS) {
    assert.deepEqual(v1.arms[arm].evaluation.recovered.supporters, ["STREAK", "CHAIN", "STRIKE"], `V1 ${arm}`);
    assert.deepEqual(v2.arms[arm].evaluation.recovered.supporters, ["CHAIN", "STRIKE"], `V2 ${arm}`);
    assert.equal(v2.arms[arm].intervention.e1_book_dedupe.applied, true, arm);
    assert.deepEqual(v2.arms[arm].intervention.e1_book_dedupe.book_supporters, ["STRIKE"], arm);
    assert.equal(v2.arms[arm].capture_policy, "P2_EXPLOIT_GUARD_V1");
    const pass = (ev: typeof v1 | typeof v2) => ev.arms[arm].evaluation.recovered.checks.find((k) => k.id === "supporters")?.pass;
    assert.equal(pass(v2), pass(v1), `${arm}: two independent supporters still meet the normal-mode bar of ${DEPLOYED_POLICY.params.min_speaking}`);
    assert.equal(v2.arms[arm].evaluation.recovered.eligible, v1.arms[arm].evaluation.recovered.eligible, arm);
  }
});

test("without an E1 book overlap every V2 arm is exactly its LOCKS V1 arm", () => {
  for (const sc of [OPEN, LOCKED, { ...OPEN, extraRows: [CARRY_UP] }]) {
    const v1 = evaluateLocks(input(snap()), depsFor(sc));
    const v2 = evaluateLocksV2(input(snap()), depsFor(sc));
    for (const arm of LOCKS_RECOVERED_ARMS) {
      assert.equal(v2.arms[arm].intervention.e1_book_dedupe.applied, false);
      assert.deepEqual(v2.arms[arm].evaluation, v1.arms[arm].evaluation, arm);
      const { e1_book_dedupe: _p1, ...iv } = v2.arms[arm].intervention;
      assert.deepEqual(iv, v1.arms[arm].intervention, `${arm}: V1's own interventions`);
    }
  }
});

test("SUPPORT_UNCAL_E1: the waiver runs first, then the correction, so a waived STREAK still counts once", () => {
  const ev = evaluateLocksV2(input(snap()), depsFor({ ...LOCKED, vsBar: 0.9, extraRows: [STRIKE_UP] }));
  const a = ev.arms.SUPPORT_UNCAL_E1;
  assert.ok(a.intervention.support_uncal_e1.waived_seats.includes("STREAK"), "the V1 waiver relabelled STREAK");
  assert.equal(a.intervention.e1_book_dedupe.applied, true, "then P1 removed the duplicate");
  assert.equal(a.evaluation.recovered.supporters.includes("STREAK"), false);
});

test("P2: a producer frame without the capture guard is never evaluated", () => {
  const unguarded: MidRecoveryDeps = { ...depsFor(OPEN), runBotsWithEvaluatedCandidates: (s) => ({ version: "E1_RECOVERY_V1_INACTIVE", ticker: s.ticker, close_time: s.close_time, as_of: s.as_of, votes: [], evaluated: candidates.map((c) => c.vote) }) };
  assert.throws(() => evaluateLocksV2(input(snap()), unguarded), CapturePolicyMissing);
  const wrong: MidRecoveryDeps = { ...depsFor(OPEN), runBotsWithEvaluatedCandidates: (s) => ({ version: "E1_RECOVERY_V1_INACTIVE", capture_policy: "OTHER" as "P2_EXPLOIT_GUARD_V1", ticker: s.ticker, close_time: s.close_time, as_of: s.as_of, votes: [], evaluated: [] }) };
  assert.throws(() => evaluateLocksV2(input(snap()), wrong), CapturePolicyMissing);
});

test("isolation: no arm sees another arm's objects, and nothing handed in is mutated", () => {
  const i = input(snap());
  const before = JSON.stringify(i);
  const spy = { chair: [] as Array<{ settings: Settings; touched: unknown }>, project: [] as number[] };
  evaluateLocksV2(i, depsFor({ ...OPEN, extraRows: [STRIKE_UP] }, spy));
  assert.equal(JSON.stringify(i), before);
  assert.deepEqual(spy.project, [2, 2, 2, 2], "each arm's projection sees its own clean frame");
  assert.ok(spy.chair.every((c) => c.touched === undefined), "each arm's Chair sees its own learner");
});
