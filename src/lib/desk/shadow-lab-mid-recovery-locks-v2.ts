/**
 * MID_RECOVERY_LOCKS_V2_INACTIVE — LOCKS V1 with evidence-integrity
 * corrections isolated to the V2 research path (pure).
 *
 * WHY A NEW VERSION. LOCKS V1 keeps running unchanged; its receipts stay
 * exactly as recorded and are annotated by the research auditor. V2 asks the
 * same question with the same five arms, but on a path where the known
 * integrity defects are corrected, so version-2 receipts can be clean evidence:
 *
 *   P1  The Chair's supporter count is per seat. Under E1, STREAK
 *       (continue_young reads the YES book) is a book read, so STREAK beside
 *       another book-family supporter (STRIKE, and any other E1 book seat) is
 *       ONE independent read, not two. In every recovered arm, when STREAK and
 *       at least one other E1 book seat both count as supporters of the same
 *       side, STREAK's row is relabelled E1_BOOK_DUPLICATE for support
 *       accounting only: the deployed support predicate (eligibleSupportRows,
 *       used by gateVector and the evaluator alike) then no longer counts it.
 *       Its lean, weight, health, the Chair's lean, score and bar are
 *       untouched, the family gate is unchanged (STREAK was already a book
 *       read there), and nothing happens when there is no overlap.
 *   P2  The producer's captured frame must carry capture_policy
 *       P2_EXPLOIT_GUARD_V1 (bots.ts): an exploit-rejected card never reaches
 *       recovery. A frame without it is not evaluated.
 *   P3  Only directional cards present in candidates[] may be released by the
 *       E1 shadow unmute. A production selected vote that was forced to SIT
 *       stays SIT instead of being revived merely because its raw_lean was
 *       directional. V1 remains frozen and unchanged.
 *
 * ARMS, INTERVENTIONS, FLOOR, GATES, CONFIRMATION, FEES: exactly LOCKS V1's.
 * CONTROL is V1's CONTROL plus the P1 correction; the single-lock arms and
 * COMBINED_DIAG add their V1 wrapper first and the P1 correction last.
 * COMBINED_DIAG is diagnostic only and never promotion eligible.
 *
 * Pure module: no clock, no state, no database, no engine import.
 */
import type { EvaluatedCandidateFrame } from "./bots";
import type { RecoveryProjection } from "./call-recovery-candidate";
import { e1FamilyOf, unmuteRoster } from "./shadow-arms.ts";
import { evaluateMidRecovery, type MidRecoveryDeps, type MidRecoveryInput, type MidRecoveryRow } from "./shadow-lab-mid-recovery.ts";
import {
  LOCKS_ARMS, LOCKS_INTERVENTIONS, LOCKS_PROMOTION_ELIGIBLE, LOCKS_RECOVERED_ARMS, MID_RECOVERY_LOCKS_EXPERIMENT, chairWithoutSitMass, summarizeLocks,
  waiveUncalibratedE1Support,
  type LocksArmState, type LocksInput, type LocksIntervention, type LocksRecoveredArm, type LocksSummary,
} from "./shadow-lab-mid-recovery-locks.ts";
import { eligibleSupportRows } from "./support-eligibility.ts";
import type { ChairResult, SeatId, SeatRow } from "./types";

/** bots.ts CAPTURE_POLICY, held as data (a rail test pins the two equal). */
export const REQUIRED_CAPTURE_POLICY = "P2_EXPLOIT_GUARD_V1";
/** The support-accounting status given to a STREAK row that duplicates another E1 book supporter. */
export const E1_BOOK_DUPLICATE = "E1_BOOK_DUPLICATE";

export const MID_RECOVERY_LOCKS_V2_EXPERIMENT = Object.freeze({
  ...MID_RECOVERY_LOCKS_EXPERIMENT,
  id: "MID_RECOVERY_LOCKS_V2_INACTIVE",
  version: 2,
  supersedes: MID_RECOVERY_LOCKS_EXPERIMENT.id,
  corrections: Object.freeze({
    p1_e1_book_supporter_dedupe: "STREAK beside another E1 book-family supporter of the same side counts once",
    p2_capture_policy_required: REQUIRED_CAPTURE_POLICY,
    p3_candidate_only_unmute: "only captured directional candidates may be released; selected SIT votes remain SIT",
  }),
} as const);

export const MID_RECOVERY_LOCKS_V2_ENV_FLAG = "MID_RECOVERY_LOCKS_V2_SHADOW_ENABLED";

// ---------------------------------------------------------------------------
// The P1 correction.
// ---------------------------------------------------------------------------

export type P1Trace = {
  /** STREAK's side when it was an eligible supporter; null otherwise. */
  streak_side: "UP" | "DOWN" | null;
  /** Other E1 book-family seats counted as supporters of that side. */
  book_supporters: SeatId[];
  /** true when STREAK was relabelled E1_BOOK_DUPLICATE for support accounting. */
  applied: boolean;
};
export type LocksV2Intervention = LocksIntervention & { e1_book_dedupe: P1Trace };

/**
 * A copy of the Chair in which STREAK no longer counts as a separate supporter
 * when another E1 book-family seat already supports the same side. Only the
 * row's status changes (to E1_BOOK_DUPLICATE, which the deployed support
 * predicate does not accept). The input Chair is never mutated.
 */
export function dedupeE1BookSupport(chair: ChairResult, trace: P1Trace): ChairResult {
  const out = structuredClone(chair);
  const streak = (out.rows ?? []).find((r) => r.seat === "STREAK");
  const side = streak?.lean === "UP" || streak?.lean === "DOWN" ? streak.lean : null;
  if (!side) return out;
  const supporting = eligibleSupportRows(out, side).map((r) => r.seat);
  if (!supporting.includes("STREAK")) return out;
  trace.streak_side = side;
  trace.book_supporters = supporting.filter((seat) => seat !== "STREAK" && e1FamilyOf(seat) === "book");
  if (!trace.book_supporters.length) return out;
  for (const row of out.rows) if (row.seat === "STREAK") row.status = E1_BOOK_DUPLICATE as SeatRow["status"];
  trace.applied = true;
  return out;
}

const blankTrace = (arm: LocksRecoveredArm): LocksV2Intervention => ({
  arm,
  bar_no_sitmass: { requested: LOCKS_INTERVENTIONS[arm].bar_no_sitmass, applied: false, control_bar: null, control_pre_clamp: null, sit_term: null, arm_bar: null, arm_pre_clamp: null, exact: null, control_lean: null, arm_lean: null },
  support_uncal_e1: { requested: LOCKS_INTERVENTIONS[arm].support_uncal_e1, candidate_seats: [], waived_seats: [], folded_uncalibrated_seats: [] },
  e1_book_dedupe: { streak_side: null, book_supporters: [], applied: false },
});

/**
 * V2-only P3 correction. The shared V1 projection un-mutes every selected
 * roster vote with a directional raw_lean, which can revive a vote production
 * forced to SIT even though it never entered candidates[]. Rebuild the
 * simulated vote set from the original producer votes and release only the
 * candidate card ids. The shared V1 path is deliberately left untouched.
 */
function candidateOnlyProjection(frame: EvaluatedCandidateFrame, learner: Parameters<MidRecoveryDeps["projectInactiveE1Recovery"]>[1], projection: RecoveryProjection): RecoveryProjection {
  const bySeat = new Map(projection.candidates.map((candidate) => [candidate.seat, candidate.vote] as const));
  const projectedVotes = frame.votes.map((vote) => bySeat.get(vote.seat) ?? vote);
  const cards = projection.candidates.map((candidate) => candidate.card_id);
  return { ...projection, simulated: unmuteRoster(projectedVotes, learner, cards) };
}

/** V1's arm path, with the P3 projection guard and P1 correction applied only inside V2. */
export function locksV2ArmDeps(base: MidRecoveryDeps, arm: LocksRecoveredArm, frame: EvaluatedCandidateFrame, trace: LocksV2Intervention): MidRecoveryDeps {
  const iv = LOCKS_INTERVENTIONS[arm];
  let candidateSeats: SeatId[] = [];
  return {
    runBotsWithEvaluatedCandidates: () => structuredClone(frame),
    projectInactiveE1Recovery: (f, learner) => {
      const projection: RecoveryProjection = base.projectInactiveE1Recovery(f, learner);
      candidateSeats = projection.candidates.map((c) => c.seat);
      return candidateOnlyProjection(f, learner, projection);
    },
    runChair: (...args) => {
      let chair = iv.bar_no_sitmass ? chairWithoutSitMass(base.runChair, args, trace.bar_no_sitmass) : base.runChair(...args);
      if (iv.support_uncal_e1) chair = waiveUncalibratedE1Support(chair, candidateSeats, trace.support_uncal_e1);
      return dedupeE1BookSupport(chair, trace.e1_book_dedupe);
    },
  };
}

// ---------------------------------------------------------------------------
// One tick.
// ---------------------------------------------------------------------------

export type LocksV2ArmEvaluation = {
  experiment: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  experiment_version: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.version;
  arm: LocksRecoveredArm;
  promotion_eligible: boolean;
  intervention: LocksV2Intervention;
  capture_policy: string;
  evaluation: ReturnType<typeof evaluateMidRecovery>;
};
export type LocksV2Evaluation = {
  experiment: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  arms: Record<LocksRecoveredArm, LocksV2ArmEvaluation>;
  null_fav: ReturnType<typeof evaluateMidRecovery>["null_fav"];
};

/** Thrown when the producer frame was not captured under the P2 guard; the recorder skips the tick. */
export class CapturePolicyMissing extends Error {
  constructor(got: unknown) { super(`producer frame capture_policy ${JSON.stringify(got ?? null)} is not ${REQUIRED_CAPTURE_POLICY}`); }
}

export function evaluateLocksV2Arm(arm: LocksRecoveredArm, input: LocksInput, frame: EvaluatedCandidateFrame, deps: MidRecoveryDeps): LocksV2ArmEvaluation {
  const own: LocksArmState = input.arms[arm];
  const trace = blankTrace(arm);
  const armInput: MidRecoveryInput = {
    snap: structuredClone(input.snap), chair: structuredClone(input.chair), learner: structuredClone(input.learner), settings: structuredClone(input.settings),
    call_log: structuredClone([...input.call_log]), audit: structuredClone(input.audit), ready: input.ready, start: input.start,
    recovered_calls: structuredClone([...own.calls]), watch: structuredClone(own.watch), last_recovered_lean: own.last_lean,
  };
  const evaluation = evaluateMidRecovery(armInput, locksV2ArmDeps(deps, arm, frame, trace));
  return {
    experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, experiment_version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version, arm,
    promotion_eligible: LOCKS_PROMOTION_ELIGIBLE[arm], intervention: trace, capture_policy: REQUIRED_CAPTURE_POLICY, evaluation,
  };
}

export function evaluateLocksV2(input: LocksInput, deps: MidRecoveryDeps): LocksV2Evaluation {
  const frame = deps.runBotsWithEvaluatedCandidates(structuredClone(input.snap), structuredClone(input.learner));
  if (frame.capture_policy !== REQUIRED_CAPTURE_POLICY) throw new CapturePolicyMissing(frame.capture_policy);
  const arms = {} as Record<LocksRecoveredArm, LocksV2ArmEvaluation>;
  for (const arm of LOCKS_RECOVERED_ARMS) arms[arm] = evaluateLocksV2Arm(arm, input, frame, deps);
  return { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arms, null_fav: structuredClone(arms.CONTROL.evaluation.null_fav) };
}

export type LocksV2Summary = Omit<LocksSummary, "experiment" | "experiment_version"> & {
  experiment: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  experiment_version: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.version;
};

/** V1's summary over V2's own rows (the recorder reads only V2 receipts). */
export function summarizeLocksV2(rows: readonly MidRecoveryRow[]): LocksV2Summary {
  return { ...summarizeLocks(rows), experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, experiment_version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version };
}

export { LOCKS_ARMS, LOCKS_RECOVERED_ARMS };
