/**
 * MID_RECOVERY_LOCKS_V2_INACTIVE — LOCKS V1 with both evidence-integrity
 * corrections and an explicit candidate-provenance revision (pure).
 *
 * WHY A NEW VERSION. LOCKS V1 keeps running unchanged; its receipts stay
 * exactly as recorded and are annotated by the research auditor. V2 asks the
 * same question with the same five arms. The original V2 receipts are retained
 * as a legacy cohort; the candidate-only correction starts a distinct revision.
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
 *       P2_EXPLOIT_GUARD_V1 (bots.ts). A frame without it is not evaluated.
 *       The stamp identifies the capture path; it is not standalone proof of
 *       LIVE-candidate eligibility or an independent integrity verdict.
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
import { evaluateMidRecovery, type MidRecoveryDeps, type MidRecoveryInput } from "./shadow-lab-mid-recovery.ts";
import { V2_EVALUATOR_REVISION, V2_EXPERIMENT_ID, partitionLocksV2Rows, type LocksV2Row, type V2CohortClass, type V2ExcludedWindow } from "./mid-recovery-locks-v2-cohort.ts";
import {
  LOCKS_ARMS, LOCKS_INTERVENTIONS, LOCKS_PROMOTION_ELIGIBLE, LOCKS_RECOVERED_ARMS, MID_RECOVERY_LOCKS_EXPERIMENT, chairWithoutSitMass, summarizeLocks,
  waiveUncalibratedE1Support,
  type LocksArmState, type LocksInput, type LocksIntervention, type LocksRecoveredArm, type LocksSummary,
} from "./shadow-lab-mid-recovery-locks.ts";
import { eligibleSupportRows } from "./support-eligibility.ts";
import type { ReceiptKind } from "./shadow-lab.ts";
import type { ChairResult, SeatId, SeatRow } from "./types";

/** bots.ts CAPTURE_POLICY, held as data (a rail test pins the two equal). */
export const REQUIRED_CAPTURE_POLICY = "P2_EXPLOIT_GUARD_V1";
/** The support-accounting status given to a STREAK row that duplicates another E1 book supporter. */
export const E1_BOOK_DUPLICATE = "E1_BOOK_DUPLICATE";

export const MID_RECOVERY_LOCKS_V2_EXPERIMENT = Object.freeze({
  ...MID_RECOVERY_LOCKS_EXPERIMENT,
  id: V2_EXPERIMENT_ID,
  version: 1,
  evaluator_revision: V2_EVALUATOR_REVISION,
  supersedes: MID_RECOVERY_LOCKS_EXPERIMENT.id,
  corrections: Object.freeze({
    p1_e1_book_supporter_dedupe: "STREAK beside another E1 book-family supporter of the same side counts once",
    p2_capture_policy_required: REQUIRED_CAPTURE_POLICY,
  }),
} as const);

export const MID_RECOVERY_LOCKS_V2_ENV_FLAG = "MID_RECOVERY_LOCKS_V2_SHADOW_ENABLED";

/** An intention is evidence of eligibility, not a terminal arm outcome. */
export const V2_TERMINAL_RECEIPT_KINDS = Object.freeze(["fill", "veto", "no_fill"] as const satisfies readonly ReceiptKind[]);

export function planV2ReceiptTransition(
  existingKinds: ReadonlySet<ReceiptKind>,
  state: { eligible: boolean; booked: boolean; at_terminal_checkpoint: boolean },
): ReceiptKind[] {
  if (V2_TERMINAL_RECEIPT_KINDS.some((kind) => existingKinds.has(kind))) return [];
  const out: ReceiptKind[] = [];
  if (state.eligible && !existingKinds.has("intention")) out.push("intention");
  if (state.booked) out.push("fill");
  else if (state.at_terminal_checkpoint) out.push("no_fill");
  return out;
}

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

/** V1's arm path, with the P1 correction applied last to every recovered arm's Chair. */
export function locksV2ArmDeps(base: MidRecoveryDeps, arm: LocksRecoveredArm, frame: EvaluatedCandidateFrame, trace: LocksV2Intervention): MidRecoveryDeps {
  const iv = LOCKS_INTERVENTIONS[arm];
  let candidateSeats: SeatId[] = [];
  return {
    runBotsWithEvaluatedCandidates: () => structuredClone(frame),
    projectInactiveE1Recovery: (f, learner) => {
      const projection: RecoveryProjection = base.projectInactiveE1Recovery(f, learner);
      candidateSeats = projection.candidates.map((c) => c.seat);
      const candidateIds = projection.candidates.map((c) => c.card_id);
      // Preserve the existing V1-equivalent path whenever its release set is
      // already candidate-only. This also keeps the experiment's other arm
      // behavior byte-identical on unaffected frames.
      if (projection.simulated.released.every((id) => candidateIds.includes(id))) return projection;
      // The shared V1 projection can also unmute a selected roster vote that
      // was forced to SIT and never captured as a candidate. Rebuild only V2's
      // simulated votes from the source frame and its recorded candidates.
      const bySeat = new Map(projection.candidates.map((c) => [c.seat, c.vote]));
      const projectedVotes = f.votes.map((vote) => bySeat.get(vote.seat) ?? vote);
      return {
        ...projection,
        simulated: unmuteRoster(projectedVotes, learner, candidateIds),
      };
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
  evaluator_revision: typeof V2_EVALUATOR_REVISION;
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
    evaluator_revision: V2_EVALUATOR_REVISION,
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

/**
 * The same evaluator, split into bounded event-loop slices for the server-side
 * observer. The producer frame is captured exactly once and every arm receives
 * that immutable same-frame input; only scheduling differs from evaluateLocksV2.
 */
export async function evaluateLocksV2InSlices(
  input: LocksInput,
  deps: MidRecoveryDeps,
  yieldToLoop: () => Promise<void> = () => new Promise<void>((resolve) => setImmediate(resolve)),
): Promise<LocksV2Evaluation> {
  const frame = deps.runBotsWithEvaluatedCandidates(structuredClone(input.snap), structuredClone(input.learner));
  if (frame.capture_policy !== REQUIRED_CAPTURE_POLICY) throw new CapturePolicyMissing(frame.capture_policy);
  const arms = {} as Record<LocksRecoveredArm, LocksV2ArmEvaluation>;
  for (let i = 0; i < LOCKS_RECOVERED_ARMS.length; i += 1) {
    if (i > 0) await yieldToLoop();
    const arm = LOCKS_RECOVERED_ARMS[i]!;
    arms[arm] = evaluateLocksV2Arm(arm, input, frame, deps);
  }
  return { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arms, null_fav: structuredClone(arms.CONTROL.evaluation.null_fav) };
}

type V2ArmStatistics = Omit<LocksSummary, "experiment" | "experiment_version" | "foreign_rows">;
export type LocksV2Summary = {
  experiment: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;
  experiment_version: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT.version;
  evaluator_revision: typeof V2_EVALUATOR_REVISION;
  windows: number;
  foreign_rows: number;
  cohorts: Array<{
    revision: string;
    classification: V2CohortClass;
    build_shas: string[];
    first_receipt_at: string | null;
    last_receipt_at: string | null;
    /** Every row in this revision, including incomplete and boundary windows. Diagnostic only. */
    observed: V2ArmStatistics;
    /** Only complete five-arm terminal windows with a verified revision/session boundary. */
    matched: V2ArmStatistics;
    integrity_status: "NOT_EVALUATED";
  }>;
  excluded_windows: V2ExcludedWindow[];
  note: string;
};

/** No pooled economics: each semantic revision has observed and matched populations. */
export function summarizeLocksV2(rows: readonly LocksV2Row[]): LocksV2Summary {
  const partition = partitionLocksV2Rows(rows);
  const statistics = (own: readonly LocksV2Row[]): V2ArmStatistics => {
    // The shared arithmetic belongs to LOCKS V1 and checks that identity. Strip
    // only this query's already-validated experiment tag from a copy; never
    // change a receipt or pass foreign rows through the V1 filter.
    const bare = own.map(({ experiment: _experiment, ...row }) => row);
    const { experiment: _id, experiment_version: _version, foreign_rows: _foreign, ...summary } = summarizeLocks(bare);
    return summary;
  };
  const stamp = (xs: readonly LocksV2Row[], last: boolean) => {
    const times = xs.map((r) => r.decided_ms).filter(Number.isFinite);
    return times.length ? new Date(last ? Math.max(...times) : Math.min(...times)).toISOString() : null;
  };
  return {
    experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, experiment_version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version,
    evaluator_revision: V2_EVALUATOR_REVISION, windows: partition.windows, foreign_rows: partition.foreign_rows,
    cohorts: partition.cohorts.map((c) => ({
      revision: c.revision, classification: c.classification, build_shas: c.build_shas,
      first_receipt_at: stamp(c.rows, false), last_receipt_at: stamp(c.rows, true),
      observed: statistics(c.rows), matched: statistics(c.matched_rows), integrity_status: "NOT_EVALUATED",
    })),
    excluded_windows: partition.excluded_windows,
    note: "Revisions are never pooled. Observed includes historical, incomplete and boundary receipts. Matched is current-revision, complete terminal five-arm coverage only; it is not an integrity CLEAN verdict, settlement guarantee or promotion evidence by itself. Original receipts and first_receipt_at are preserved.",
  };
}

export { LOCKS_ARMS, LOCKS_RECOVERED_ARMS };
export { V2_EVALUATOR_REVISION, V2_EXPERIMENT_ID, V2_LEGACY_REVISION, partitionLocksV2Rows } from "./mid-recovery-locks-v2-cohort.ts";
