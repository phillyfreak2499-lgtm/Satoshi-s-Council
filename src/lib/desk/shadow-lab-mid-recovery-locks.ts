/**
 * MID_RECOVERY_LOCKS_V1_INACTIVE — which lock holds the recovered read back (pure).
 *
 * QUESTION. The MID_RECOVERY_V1_INACTIVE direction audit
 * (docs/MID_RECOVERY_DIRECTION_AUDIT_2026-09-26.md, PR #335) found two locks
 * in front of the recovered E1 read: the Chair bar's sit-mass term keeps it
 * just under the bar, and behind that the support stage refuses UNCALIBRATED
 * rows (STREAK and STRIKE carry a full calibration debt). This experiment
 * measures, prospectively and on the same windows, what each lock is worth
 * when it is removed alone and together — in simulation only.
 *
 * FIVE ARMS, ONE WINDOW IDENTITY (ticker + close_time).
 *   CONTROL           the MID_RECOVERY_V1 recovered path exactly: the E1
 *                     projection through the actual Chair and the deployed
 *                     gates, its own latch, a SIMULATED booking at the
 *                     production `bookable` floor.
 *   BAR_NO_SITMASS    CONTROL with one change: the simulated Chair's bar is
 *                     built without its `0.2 × sit_mass` term. Done through the
 *                     actual Chair (its bar base is overridden by exactly the
 *                     sit term it computed), so every other bar step, the
 *                     0.24–0.72 clamp, the score, folding and the gates are the
 *                     Chair's own.
 *   SUPPORT_UNCAL_E1  CONTROL with one change: an unfolded recovered E1 row the
 *                     Chair marked UNCALIBRATED may count as entry support. Its
 *                     weight, lean, health and the Chair's fold are untouched;
 *                     a production seat is never waived.
 *   COMBINED_DIAG     both changes. Diagnostic only: NEVER promotion eligible.
 *   NULL_FAV_80       the existing favourite benchmark (`nullFavIntention`).
 *
 * WHAT NEVER CHANGES, IN ANY ARM. The 80¢ floor and the < 99 ceiling, fees,
 * spread and resting-size rules, feeds, the settlement index, model edge,
 * opposition, family de-duplication (STREAK is a book read), confirmation
 * frames/seconds, day risk, the production Chair, the learner and its
 * calibration debt, booking, followers and settings. Every arm runs through
 * the unchanged `evaluateMidRecovery` evaluator; an arm differs only by the
 * one wrapper it puts around the injected `runChair`.
 *
 * ISOLATION. Each arm gets its own structuredClone of every input (snapshot,
 * learner, production Chair, settings, call log, producer frame), its own
 * confirmation latch, its own prior lean and its own risk history, so no arm
 * can see or mutate another arm's objects. The producer frame is computed once
 * per tick and cloned per arm.
 *
 * Pure module: no clock, no state, no database, no engine import.
 */
import type { EvaluatedCandidateFrame } from "./bots";
import type { RecoveryProjection } from "./call-recovery-candidate";
import type { EntryWatch } from "./selective-entry.ts";
import {
  MID_RECOVERY_EXPERIMENT, MID_RECOVERY_STAGES, armQuality, evaluateMidRecovery,
  type ArmQuality, type MidRecoveryDeps, type MidRecoveryEvaluation, type MidRecoveryInput, type MidRecoveryRow,
} from "./shadow-lab-mid-recovery.ts";
import type { CallLogRow, ChairResult, Lean, SeatId, Settings } from "./types";

// ---------------------------------------------------------------------------
// The frozen experiment.
// ---------------------------------------------------------------------------

export const LOCKS_ARMS = Object.freeze({
  control: "CONTROL",
  bar_no_sitmass: "BAR_NO_SITMASS",
  support_uncal_e1: "SUPPORT_UNCAL_E1",
  combined_diag: "COMBINED_DIAG",
  null_fav: "NULL_FAV_80",
} as const);
export type LocksArm = (typeof LOCKS_ARMS)[keyof typeof LOCKS_ARMS];
/** The four arms that run the recovered path; NULL_FAV_80 is the benchmark. */
export type LocksRecoveredArm = Exclude<LocksArm, "NULL_FAV_80">;
export const LOCKS_RECOVERED_ARMS: readonly LocksRecoveredArm[] = Object.freeze(["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG"] as const);

/** Exactly one intervention per single-lock arm; COMBINED_DIAG has both; CONTROL none. */
export const LOCKS_INTERVENTIONS: Readonly<Record<LocksRecoveredArm, Readonly<{ bar_no_sitmass: boolean; support_uncal_e1: boolean }>>> = Object.freeze({
  CONTROL: Object.freeze({ bar_no_sitmass: false, support_uncal_e1: false }),
  BAR_NO_SITMASS: Object.freeze({ bar_no_sitmass: true, support_uncal_e1: false }),
  SUPPORT_UNCAL_E1: Object.freeze({ bar_no_sitmass: false, support_uncal_e1: true }),
  COMBINED_DIAG: Object.freeze({ bar_no_sitmass: true, support_uncal_e1: true }),
});

/**
 * Whether an arm's result may ever be put to the owner as a candidate for a
 * separate, pre-registered production test. Nothing here promotes anything:
 * there is no auto-promotion, and production authority is NONE for every arm.
 * CONTROL and NULL_FAV_80 are references; COMBINED_DIAG changes two locks at
 * once, so its result cannot be attributed and it is never eligible.
 */
export const LOCKS_PROMOTION_ELIGIBLE: Readonly<Record<LocksArm, boolean>> = Object.freeze({
  CONTROL: false,
  BAR_NO_SITMASS: true,
  SUPPORT_UNCAL_E1: true,
  COMBINED_DIAG: false,
  NULL_FAV_80: false,
});

export const MID_RECOVERY_LOCKS_EXPERIMENT = Object.freeze({
  id: "MID_RECOVERY_LOCKS_V1_INACTIVE",
  version: 1,
  /** Never collects unless an owner sets the env flag; never books, promotes or tunes. */
  active_by_default: false,
  authority: "research-only-simulated",
  production_authority: "NONE",
  /** The evaluator every arm runs through, unchanged. Its receipts are a different experiment and are never read here. */
  evaluator: MID_RECOVERY_EXPERIMENT.id,
  arms: LOCKS_ARMS,
  interventions: LOCKS_INTERVENTIONS,
  promotion_eligible: LOCKS_PROMOTION_ELIGIBLE,
  roster: MID_RECOVERY_EXPERIMENT.roster,
  family_override: MID_RECOVERY_EXPERIMENT.family_override,
  band_secs: MID_RECOVERY_EXPERIMENT.band_secs,
  floor_cents: MID_RECOVERY_EXPERIMENT.floor_cents,
  policy_id: MID_RECOVERY_EXPERIMENT.policy_id,
  recovery_version: MID_RECOVERY_EXPERIMENT.recovery_version,
  fee_engine: MID_RECOVERY_EXPERIMENT.fee_engine,
} as const);

export const MID_RECOVERY_LOCKS_ENV_FLAG = "MID_RECOVERY_LOCKS_SHADOW_ENABLED";

// ---------------------------------------------------------------------------
// The two interventions, as wrappers around the injected Chair.
// ---------------------------------------------------------------------------

/** What an arm's intervention actually did on this tick, stored with every receipt. */
export type LocksIntervention = {
  arm: LocksRecoveredArm;
  bar_no_sitmass: {
    requested: boolean;
    /** true when the arm's Chair ran with the sit term removed; false when requested but not measurable. */
    applied: boolean;
    control_bar: number | null;
    control_pre_clamp: number | null;
    sit_term: number | null;
    arm_bar: number | null;
    arm_pre_clamp: number | null;
    /** arm_pre_clamp === control_pre_clamp − sit_term (to 1e-9) and the sit mass did not move between the two runs. */
    exact: boolean | null;
    control_lean: Lean | null;
    arm_lean: Lean | null;
  };
  support_uncal_e1: {
    requested: boolean;
    /** Recovered E1 candidate seats the projection released this tick. */
    candidate_seats: SeatId[];
    /** Rows relabelled UNCALIBRATED → LIVE for support accounting only. */
    waived_seats: SeatId[];
    /** Candidate rows left alone because the Chair folded them (the fold is the Chair's, never reversed). */
    folded_uncalibrated_seats: SeatId[];
  };
};

const blankIntervention = (arm: LocksRecoveredArm): LocksIntervention => ({
  arm,
  bar_no_sitmass: { requested: LOCKS_INTERVENTIONS[arm].bar_no_sitmass, applied: false, control_bar: null, control_pre_clamp: null, sit_term: null, arm_bar: null, arm_pre_clamp: null, exact: null, control_lean: null, arm_lean: null },
  support_uncal_e1: { requested: LOCKS_INTERVENTIONS[arm].support_uncal_e1, candidate_seats: [], waived_seats: [], folded_uncalibrated_seats: [] },
});

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Re-run the actual Chair with its bar base lowered by exactly the sit-mass
 * term it just added. `adaptive_bar: false` + `bar_override` replaces ONLY the
 * base step of the bar (chair.ts), so every other step, the clamp and the
 * score are the Chair's own. Returns the control Chair when the trace needed
 * to do this is missing (then `applied` stays false).
 */
export function chairWithoutSitMass(
  runChair: MidRecoveryDeps["runChair"],
  args: Parameters<MidRecoveryDeps["runChair"]>,
  trace: LocksIntervention["bar_no_sitmass"],
): ChairResult {
  const [votes, snap, learner, settings, lastLean, cites] = args;
  const control = runChair(structuredClone(votes), structuredClone(snap), structuredClone(learner), structuredClone(settings), lastLean, structuredClone(cites));
  const bd = control.bar_breakdown;
  trace.control_bar = finite(control.bar) ? control.bar : null;
  trace.control_lean = control.lean;
  if (!bd || !finite(bd.base) || !finite(bd.sit_mass) || !finite(bd.pre_clamp)) return control;
  const override = bd.base - bd.sit_mass;
  const armSettings: Settings = { ...structuredClone(settings), adaptive_bar: false, bar_override: override };
  const arm = runChair(structuredClone(votes), structuredClone(snap), structuredClone(learner), armSettings, lastLean, structuredClone(cites));
  trace.applied = true;
  trace.control_pre_clamp = bd.pre_clamp;
  trace.sit_term = bd.sit_mass;
  trace.arm_bar = arm.bar;
  trace.arm_pre_clamp = arm.bar_breakdown?.pre_clamp ?? null;
  trace.arm_lean = arm.lean;
  trace.exact = trace.arm_pre_clamp != null && Math.abs(trace.arm_pre_clamp - (bd.pre_clamp - bd.sit_mass)) < 1e-9 && arm.sit_mass === control.sit_mass;
  return arm;
}

/**
 * A copy of the Chair in which an unfolded recovered E1 candidate row the Chair
 * marked UNCALIBRATED is relabelled LIVE, so the deployed support predicate
 * (eligibleSupportRows) may count it. Nothing else about the row changes: its
 * weight, lean, health, forced-sit flag and the Chair's fold stay as computed,
 * and every other support rule (health LIVE, weight > 0, not context, families,
 * opposition) still applies. The input Chair is never mutated.
 */
export function waiveUncalibratedE1Support(chair: ChairResult, candidateSeats: readonly SeatId[], trace: LocksIntervention["support_uncal_e1"]): ChairResult {
  const out = structuredClone(chair);
  const seats = new Set(candidateSeats);
  trace.candidate_seats = [...candidateSeats];
  for (const row of out.rows ?? []) {
    if (!seats.has(row.seat)) continue;
    if (row.folded && (row.status === "FOLDED" || row.status === "UNCALIBRATED")) {
      if (!trace.folded_uncalibrated_seats.includes(row.seat)) trace.folded_uncalibrated_seats.push(row.seat);
      continue;
    }
    if (row.status !== "UNCALIBRATED") continue;
    row.status = "LIVE";
    if (!trace.waived_seats.includes(row.seat)) trace.waived_seats.push(row.seat);
  }
  return out;
}

/**
 * The injected path for one arm. The producer frame is the one computed for
 * this tick, cloned for the arm; the projection is the real one on that clone;
 * the Chair is the real one, wrapped only by the arm's own intervention(s).
 */
export function locksArmDeps(base: MidRecoveryDeps, arm: LocksRecoveredArm, frame: EvaluatedCandidateFrame, trace: LocksIntervention): MidRecoveryDeps {
  const iv = LOCKS_INTERVENTIONS[arm];
  let candidateSeats: SeatId[] = [];
  return {
    runBotsWithEvaluatedCandidates: () => structuredClone(frame),
    projectInactiveE1Recovery: (f, learner) => {
      const projection: RecoveryProjection = base.projectInactiveE1Recovery(f, learner);
      candidateSeats = projection.candidates.map((c) => c.seat);
      return projection;
    },
    runChair: (...args) => {
      let chair = iv.bar_no_sitmass
        ? chairWithoutSitMass(base.runChair, args, trace.bar_no_sitmass)
        : base.runChair(...args);
      if (iv.support_uncal_e1) chair = waiveUncalibratedE1Support(chair, candidateSeats, trace.support_uncal_e1);
      return chair;
    },
  };
}

// ---------------------------------------------------------------------------
// One tick, four recovered arms and the benchmark.
// ---------------------------------------------------------------------------

/** Each recovered arm's own state, carried between ticks by the observer. */
export type LocksArmState = {
  /** The arm's own confirmation latch. */
  watch: EntryWatch | null;
  /** The arm's own simulated risk history (its own fill receipts). */
  calls: readonly CallLogRow[];
  /** The arm's own prior simulated Chair lean for this window. */
  last_lean: Lean;
};

export type LocksInput = Omit<MidRecoveryInput, "recovered_calls" | "watch" | "last_recovered_lean"> & {
  arms: Readonly<Record<LocksRecoveredArm, LocksArmState>>;
};

export type LocksArmEvaluation = {
  experiment: typeof MID_RECOVERY_LOCKS_EXPERIMENT.id;
  experiment_version: typeof MID_RECOVERY_LOCKS_EXPERIMENT.version;
  arm: LocksRecoveredArm;
  promotion_eligible: boolean;
  intervention: LocksIntervention;
  evaluation: MidRecoveryEvaluation;
};

export type LocksEvaluation = {
  experiment: typeof MID_RECOVERY_LOCKS_EXPERIMENT.id;
  arms: Record<LocksRecoveredArm, LocksArmEvaluation>;
  /** The benchmark, read once (it depends only on the snapshot). */
  null_fav: MidRecoveryEvaluation["null_fav"];
};

export function evaluateLocksArm(arm: LocksRecoveredArm, input: LocksInput, frame: EvaluatedCandidateFrame, deps: MidRecoveryDeps): LocksArmEvaluation {
  const own = input.arms[arm];
  const trace = blankIntervention(arm);
  // Every object the arm can reach is its own copy.
  const armInput: MidRecoveryInput = {
    snap: structuredClone(input.snap), chair: structuredClone(input.chair), learner: structuredClone(input.learner), settings: structuredClone(input.settings),
    call_log: structuredClone([...input.call_log]), audit: structuredClone(input.audit), ready: input.ready, start: input.start,
    recovered_calls: structuredClone([...own.calls]), watch: structuredClone(own.watch), last_recovered_lean: own.last_lean,
  };
  const evaluation = evaluateMidRecovery(armInput, locksArmDeps(deps, arm, frame, trace));
  return {
    experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, experiment_version: MID_RECOVERY_LOCKS_EXPERIMENT.version, arm,
    promotion_eligible: LOCKS_PROMOTION_ELIGIBLE[arm], intervention: trace, evaluation,
  };
}

export function evaluateLocks(input: LocksInput, deps: MidRecoveryDeps): LocksEvaluation {
  // The producer runs once per tick, on its own copy; each arm then clones the frame.
  const frame = deps.runBotsWithEvaluatedCandidates(structuredClone(input.snap), structuredClone(input.learner));
  const arms = {} as Record<LocksRecoveredArm, LocksArmEvaluation>;
  for (const arm of LOCKS_RECOVERED_ARMS) arms[arm] = evaluateLocksArm(arm, input, frame, deps);
  return { experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arms, null_fav: structuredClone(arms.CONTROL.evaluation.null_fav) };
}

// ---------------------------------------------------------------------------
// Reading the receipts back.
// ---------------------------------------------------------------------------

export type LocksArmSummary = {
  arm: LocksRecoveredArm;
  promotion_eligible: boolean;
  observed_windows: number;
  funnel: Array<{ stage: (typeof MID_RECOVERY_STAGES)[number]; windows: number }>;
  directional_windows: number;
  wait_to_directional_windows: number;
  quality: ArmQuality;
  vs_null_fav: { overlap_windows: number; side_agreement: number; settled_overlap: number; arm_net_on_overlap: number | null; null_net_on_overlap: number | null; incremental_net_cents: number | null; arm_only_windows: number };
  vs_control: { windows_both_observed: number; arm_only_fills: number; control_only_fills: number; both_filled: number };
};

export type LocksSummary = {
  experiment: typeof MID_RECOVERY_LOCKS_EXPERIMENT.id;
  experiment_version: typeof MID_RECOVERY_LOCKS_EXPERIMENT.version;
  windows: number;
  arms: Record<LocksRecoveredArm, LocksArmSummary>;
  null_fav: ArmQuality;
  /** Rows whose experiment or arm is not this experiment's: always 0 when the query is right; reported so a mix-up is visible. */
  foreign_rows: number;
  promotion: { auto_promotion: false; production_authority: "NONE"; eligible: Readonly<Record<LocksArm, boolean>>; note: string };
};

const windowKeyOf = (r: Pick<MidRecoveryRow, "ticker" | "close_ms">) => `${r.ticker}|${r.close_ms}`;
const sum = (xs: readonly number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10 : null);
const stageOf = (payload: Record<string, unknown> | null): number => {
  const idx = payload?.funnel_stage_index;
  return finite(idx) ? Math.max(0, Math.min(MID_RECOVERY_STAGES.length - 1, Math.floor(idx))) : 0;
};

export function summarizeLocks(rows: readonly (MidRecoveryRow & { experiment?: string })[]): LocksSummary {
  const known = new Set<string>(Object.values(LOCKS_ARMS));
  const own = rows.filter((r) => (r.experiment == null || r.experiment === MID_RECOVERY_LOCKS_EXPERIMENT.id) && known.has(r.arm));
  const windows = new Map<string, MidRecoveryRow[]>();
  for (const r of own) { const k = windowKeyOf(r); const list = windows.get(k) ?? []; list.push(r); windows.set(k, list); }
  const fillOf = (list: readonly MidRecoveryRow[], arm: string) => list.find((r) => r.arm === arm && r.kind === "fill" && r.side != null && r.ask_cents != null) ?? null;

  const arms = {} as Record<LocksRecoveredArm, LocksArmSummary>;
  for (const arm of LOCKS_RECOVERED_ARMS) {
    const reached = MID_RECOVERY_STAGES.map(() => 0);
    let observed = 0, directional = 0, waitToDir = 0;
    let overlap = 0, agree = 0, settledOverlap = 0, armOnly = 0;
    const armNets: number[] = [], nullNets: number[] = [];
    let both = 0, bothFilled = 0, armOnlyFills = 0, controlOnlyFills = 0;
    for (const list of windows.values()) {
      const mine = list.filter((r) => r.arm === arm);
      const fill = fillOf(list, arm);
      if (mine.length) {
        observed += 1;
        const stage = fill ? MID_RECOVERY_STAGES.length - 1 : Math.max(...mine.map((r) => stageOf(r.payload)));
        for (let i = 0; i <= stage; i += 1) reached[i]! += 1;
        const last = [...mine].sort((a, b) => b.decided_ms - a.decided_ms)[0]!;
        const ev = (last.payload ?? {}) as Partial<MidRecoveryEvaluation>;
        const recSide = fill?.side ?? ev.recovered?.side ?? null;
        if (recSide) directional += 1;
        if (recSide && !ev.baseline?.side) waitToDir += 1;
      }
      const nul = fillOf(list, LOCKS_ARMS.null_fav);
      if (fill && nul) {
        overlap += 1;
        if (fill.side === nul.side) agree += 1;
        if (fill.net_cents != null && nul.net_cents != null) { settledOverlap += 1; armNets.push(fill.net_cents); nullNets.push(nul.net_cents); }
      } else if (fill) armOnly += 1;
      if (arm !== "CONTROL") {
        const hasControl = list.some((r) => r.arm === LOCKS_ARMS.control);
        if (mine.length && hasControl) {
          both += 1;
          const ctl = fillOf(list, LOCKS_ARMS.control);
          if (fill && ctl) bothFilled += 1; else if (fill) armOnlyFills += 1; else if (ctl) controlOnlyFills += 1;
        }
      }
    }
    const armNet = sum(armNets), nulNet = sum(nullNets);
    arms[arm] = {
      arm, promotion_eligible: LOCKS_PROMOTION_ELIGIBLE[arm], observed_windows: observed,
      funnel: MID_RECOVERY_STAGES.map((stage, i) => ({ stage, windows: reached[i]! })),
      directional_windows: directional, wait_to_directional_windows: waitToDir, quality: armQuality(arm, own),
      vs_null_fav: { overlap_windows: overlap, side_agreement: agree, settled_overlap: settledOverlap, arm_net_on_overlap: armNet, null_net_on_overlap: nulNet, incremental_net_cents: armNet != null && nulNet != null ? Math.round((armNet - nulNet) * 10) / 10 : null, arm_only_windows: armOnly },
      vs_control: { windows_both_observed: both, arm_only_fills: armOnlyFills, control_only_fills: controlOnlyFills, both_filled: bothFilled },
    };
  }
  return {
    experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, experiment_version: MID_RECOVERY_LOCKS_EXPERIMENT.version, windows: windows.size, arms,
    null_fav: armQuality(LOCKS_ARMS.null_fav, own), foreign_rows: rows.length - own.length,
    promotion: {
      auto_promotion: false, production_authority: "NONE", eligible: LOCKS_PROMOTION_ELIGIBLE,
      note: "Measurement only. Nothing here promotes, books, or changes a threshold. COMBINED_DIAG changes two locks at once and is never promotion eligible.",
    },
  };
}
