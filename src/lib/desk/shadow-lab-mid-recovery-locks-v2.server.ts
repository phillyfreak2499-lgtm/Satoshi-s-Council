/**
 * MID_RECOVERY_LOCKS_V2_INACTIVE — the recorder (server only).
 *
 * LOCKS V1's recorder, unchanged in behaviour, bound to the V2 evaluator
 * (shadow-lab-mid-recovery-locks-v2.ts): the same five arms with the P1
 * supporter correction in every recovered arm, and only producer frames
 * captured under the P2 guard (a frame without capture_policy
 * P2_EXPLOIT_GUARD_V1 is not evaluated; the tick records the error).
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks
 * `ensureMidRecoveryLocksV2Observer`; it returns "disabled" unless
 * MID_RECOVERY_LOCKS_V2_SHADOW_ENABLED=true (the literal string). It is
 * independent of the V1 recorders and their flags: any can run without the
 * others. It holds no shadow-manifest slot.
 *
 * WHAT IT READS. A structuredClone of the engine frame (getServerFrame). It
 * never assigns into the frame.
 *
 * WHAT IT WRITES. Only desk_shadow_receipts, through the shadow lab's
 * append-only writer, under experiment MID_RECOVERY_LOCKS_V2_INACTIVE with arms
 * CONTROL, BAR_NO_SITMASS, SUPPORT_UNCAL_E1, COMBINED_DIAG and NULL_FAV_80.
 * Never a V1 row. A fill is a SIMULATED booking, stamped so; production
 * authority is NONE.
 *
 * FRESH SESSION BOUNDARY. As V1: the market already open at boot is skipped
 * (never back-filled), and the T-3 sit is written only for a window this
 * session evaluated in band.
 */
import { dbPoolStats, getSql, type Sql } from "@/lib/db";
import { runBotsWithEvaluatedCandidates } from "./bots";
import { projectInactiveE1Recovery } from "./call-recovery-candidate";
import { runChair } from "./chair";
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents } from "./fee-engine.ts";
import { ENTRY_SELECTIVE_V3 } from "./floor-policy.ts";
import { chicagoDayOf } from "./economics-book.ts";
import { NULL_FAV_GRACE_SECS, scheduledCheckpoint } from "./shadow-arms.ts";
import { receiptKey, type ShadowReceipt } from "./shadow-lab.ts";
import { exactSideQuote, recordShadowReceipt, settleShadowReceipts } from "./shadow-lab.server.ts";
import type { MidRecoveryDeps, MidRecoveryRow } from "./shadow-lab-mid-recovery.ts";
import { V2_EVALUATOR_REVISION, type LocksV2Row } from "./mid-recovery-locks-v2-cohort.ts";
import { governorDecision, type GovernorDecision, type ResourceSample } from "./resource-governor.ts";
import { readResourceGovernorWitness } from "./resource-governor-witness.ts";
import {
  LOCKS_ARMS, LOCKS_RECOVERED_ARMS, MID_RECOVERY_LOCKS_V2_ENV_FLAG, MID_RECOVERY_LOCKS_V2_EXPERIMENT, evaluateLocksV2InSlices, planV2ReceiptTransition, summarizeLocksV2,
  type LocksV2ArmEvaluation, type LocksV2Summary,
} from "./shadow-lab-mid-recovery-locks-v2.ts";
import type { LocksArmState, LocksInput, LocksRecoveredArm } from "./shadow-lab-mid-recovery-locks.ts";
import { shouldWriteSitReceipt } from "./shadow-sit.ts";
import type { CallLogRow, Lean, Snapshot } from "./types";

export const MID_RECOVERY_LOCKS_V2_POLL_MS = 2_000;
export const MID_RECOVERY_LOCKS_V2_SETTLE_EVERY_MS = 60_000;
const EXPERIMENT = MID_RECOVERY_LOCKS_V2_EXPERIMENT.id;

/** The one downstream path, the same merged modules the V1 recorders bind; never re-implemented. */
export const MID_RECOVERY_LOCKS_V2_DEPS: MidRecoveryDeps = Object.freeze({ runBotsWithEvaluatedCandidates, projectInactiveE1Recovery, runChair });

export function midRecoveryLocksV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[MID_RECOVERY_LOCKS_V2_ENV_FLAG] === "true";
}

/** One recovered arm's in-memory state. Nothing is shared between arms. */
type ArmMemory = {
  watch: LocksArmState["watch"];
  lastLean: { key: string; lean: Lean } | null;
  stages: Map<string, { stage: number; label: string }>;
  lastRecord: { key: string; record: Record<string, unknown> } | null;
};
type ObservationQuality = {
  closeMs: number;
  inBandTicks: number;
  governorSkips: number;
  busySkips: number;
  maxInBandGapMs: number;
  lastInBandTickMs: number | null;
};
type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  arms: Record<LocksRecoveredArm, ArmMemory>;
  decided: Set<string>;
  lastSettle: number;
  lastCapture: number | null;
  written: number;
  rejected: number;
  error: string | null;
  /** Process-local boundary: no window already open when this observer session began. */
  sessionStartedAt: number;
  lastObservedWindow: { key: string; asOf: number } | null;
  activeWindow: { key: string; closeMs: number } | null;
  observationQuality: Map<string, ObservationQuality>;
  unattributedSkips: Array<{ at: number; kind: "governor" | "busy" }>;
  lastGuard: GovernorDecision | null;
  guardSkips: number;
};
const blankArm = (): ArmMemory => ({ watch: null, lastLean: null, stages: new Map(), lastRecord: null });
const blankArms = (): Record<LocksRecoveredArm, ArmMemory> => ({ CONTROL: blankArm(), BAR_NO_SITMASS: blankArm(), SUPPORT_UNCAL_E1: blankArm(), COMBINED_DIAG: blankArm() });
const globalRef = globalThis as typeof globalThis & { __midRecoveryLocksV2__?: Observer };
const state = (): Observer => globalRef.__midRecoveryLocksV2__ ??= {
  timer: null, busy: false, arms: blankArms(), decided: new Set(), lastSettle: 0, lastCapture: null, written: 0, rejected: 0, error: null, sessionStartedAt: 0, lastObservedWindow: null,
  activeWindow: null, observationQuality: new Map(), unattributedSkips: [], lastGuard: null, guardSkips: 0,
};

const observationOf = (st: Observer, key: string, closeMs: number): ObservationQuality => {
  const existing = st.observationQuality.get(key);
  if (existing) return existing;
  const created: ObservationQuality = { closeMs, inBandTicks: 0, governorSkips: 0, busySkips: 0, maxInBandGapMs: 0, lastInBandTickMs: null };
  st.observationQuality.set(key, created);
  if (st.observationQuality.size > 200) st.observationQuality = new Map([...st.observationQuality.entries()].slice(-100));
  return created;
};

const noteObservation = (q: ObservationQuality, at: number, kind: "tick" | "governor" | "busy") => {
  if (q.lastInBandTickMs != null && at >= q.lastInBandTickMs) q.maxInBandGapMs = Math.max(q.maxInBandGapMs, at - q.lastInBandTickMs);
  if (kind === "tick") { q.inBandTicks += 1; q.lastInBandTickMs = at; }
  else if (kind === "governor") q.governorSkips += 1;
  else q.busySkips += 1;
};

const noteActiveSkip = (st: Observer, at: number, kind: "governor" | "busy") => {
  const active = st.activeWindow;
  if (active) {
    const secs = (active.closeMs - at) / 1000;
    const band = MID_RECOVERY_LOCKS_V2_EXPERIMENT.band_secs;
    if (secs >= band.min && secs <= band.max) {
      noteObservation(observationOf(st, active.key, active.closeMs), at, kind);
      return;
    }
  }
  // A guard or busy skip can occur before the first frame of a window is read.
  // Keep only a bounded recent timestamp trail; the next clean in-band frame
  // attributes matching timestamps to its exact close instead of losing them.
  st.unattributedSkips.push({ at, kind });
  st.unattributedSkips = st.unattributedSkips.filter((skip) => at - skip.at <= 15 * 60_000).slice(-500);
};

const attributePendingSkips = (st: Observer, key: string, closeMs: number) => {
  const band = MID_RECOVERY_LOCKS_V2_EXPERIMENT.band_secs;
  const keep: Observer["unattributedSkips"] = [];
  for (const skip of st.unattributedSkips) {
    const secs = (closeMs - skip.at) / 1000;
    if (secs >= band.min && secs <= band.max) noteObservation(observationOf(st, key, closeMs), skip.at, skip.kind);
    else if (skip.at > closeMs - 15 * 60_000) keep.push(skip);
  }
  st.unattributedSkips = keep;
};

const observationPayload = (st: Observer, key: string, closeMs: number) => {
  const q = observationOf(st, key, closeMs);
  return {
    in_band_ticks: q.inBandTicks,
    governor_skips: q.governorSkips,
    busy_skips: q.busySkips,
    max_in_band_gap_ms: q.maxInBandGapMs,
  };
};

/**
 * Reuse the factory's measured CPU/event-loop/DB-latency witness and exact
 * thresholds, while refreshing memory and pool occupancy without another SQL
 * ping. A missing or stale factory sample fails closed.
 */
export function midRecoveryLocksV2Governor(at: number = Date.now()): GovernorDecision {
  const witness = readResourceGovernorWitness();
  if (!witness || !Number.isFinite(witness.measured_at_ms) || at - witness.measured_at_ms > 2 * 30_000) {
    return { run: false, reasons: ["RESOURCE_SAMPLE_UNAVAILABLE"] };
  }
  const pool = dbPoolStats();
  const sample: ResourceSample = {
    ...witness.sample,
    rss_mb: process.memoryUsage().rss / 1_048_576,
    db_waiting: pool ? pool.waiting : witness.sample.db_waiting,
    db_in_use: pool ? pool.total - pool.idle : witness.sample.db_in_use,
  };
  return governorDecision(sample, witness.thresholds);
}

const receipt = (arm: string, snap: Snapshot, kind: ShadowReceipt["kind"], side: "UP" | "DOWN" | null, ask: number | null, size: number | null, spread: number | null, feedsOk: boolean | null, note: string | null): ShadowReceipt => ({
  experiment: EXPERIMENT, arm, ticker: snap.ticker, close_ms: snap.close_time, kind, decided_ms: snap.as_of, side, ask_cents: ask, fee_engine: DEFAULT_FEE_ENGINE,
  fee_cents: ask != null && realAskCents(ask) ? feeCents(ask) : null, size_at_ask: size, spread_cents: spread, feeds_ok: feedsOk, hittable_150ms: null, hittable_500ms: null,
  official_winner: null, net_cents: null, note,
});

/** The stored record of one arm's evaluation: every measured field plus the arm's identity and intervention, minus the in-memory latch. */
function record(a: LocksV2ArmEvaluation, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { confirmation, ...rest } = a.evaluation;
  const { watch, ...confirmationRest } = confirmation;
  void watch;
  return {
    ...rest, version: EXPERIMENT, experiment: EXPERIMENT, experiment_version: a.experiment_version, evaluator: MID_RECOVERY_LOCKS_V2_EXPERIMENT.evaluator,
    evaluator_revision: a.evaluator_revision,
    arm: a.arm, promotion_eligible: a.promotion_eligible, production_authority: MID_RECOVERY_LOCKS_V2_EXPERIMENT.production_authority, intervention: a.intervention, capture_policy: a.capture_policy,
    confirmation: confirmationRest, funnel_stage: a.evaluation.flags.funnel_stage, funnel_stage_index: a.evaluation.flags.funnel_stage_index, ...extra,
  };
}

/** Same daily-risk accounting as V1, scoped to this semantic revision's own fills. */
export async function locksV2ArmCalls(sql: Sql, arm: LocksRecoveredArm, asOf: number): Promise<CallLogRow[]> {
  const day = chicagoDayOf(asOf);
  const rows = await sql<{ ticker: string; close_ms: number | string; decided_ms: number | string; side: "UP" | "DOWN"; ask_cents: number; official_winner: "UP" | "DOWN" | null; evaluator_revision: string }>`
    select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, (extract(epoch from decided_at) * 1000)::bigint as decided_ms,
      side, ask_cents, official_winner, payload->>'evaluator_revision' as evaluator_revision
    from desk_shadow_receipts where experiment = ${EXPERIMENT} and arm = ${arm} and kind = 'fill'
      and payload->>'evaluator_revision' = ${V2_EVALUATOR_REVISION}
      and close_time > ${new Date(asOf - 48 * 3_600_000).toISOString()}::timestamptz`;
  return rows.filter((r) => r.evaluator_revision === V2_EVALUATOR_REVISION && (chicagoDayOf(Number(r.decided_ms)) === day || r.official_winner == null))
    .map((r) => ({ id: `${EXPERIMENT}|${V2_EVALUATOR_REVISION}|${arm}|${r.ticker}`, ticker: r.ticker, t: Number(r.decided_ms), close_time: Number(r.close_ms),
      lean: r.side, cents: Number(r.ask_cents), settle: r.official_winner == null ? null : r.official_winner === r.side ? 100 : 0, flipped: false }));
}

/** One tick. Exported for the harness; the timer calls it. */
export async function midRecoveryLocksV2Tick(now?: number): Promise<void> {
  const injectedNow = now;
  const currentTime = () => injectedNow ?? Date.now();
  now = currentTime();
  if (!Number.isFinite(now) || now <= 0) return;
  const st = state();
  if (st.busy) { noteActiveSkip(st, now, "busy"); return; }
  st.busy = true;
  try {
    const guard = midRecoveryLocksV2Governor(now);
    st.lastGuard = guard;
    if (!guard.run) {
      st.guardSkips += 1;
      noteActiveSkip(st, now, "governor");
      return;
    }
    const sql = await getSql();
    if (now - st.lastSettle > MID_RECOVERY_LOCKS_V2_SETTLE_EVERY_MS) {
      st.lastSettle = now;
      await settleShadowReceipts(sql);
    }
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    // These frozen V3 cohorts cannot mix observations from another production policy.
    // Existing receipts were settled above; only new collection is paused.
    if (frame.selective?.policy !== undefined && frame.selective.policy !== ENTRY_SELECTIVE_V3.id) return;
    if (!frame.snap || !frame.chair || frame.snap.demo || !frame.selective.ready) return;
    const { snap, chair, learner, settings, call_log, audit, start } = structuredClone({
      snap: frame.snap, chair: frame.chair, learner: frame.learner, settings: frame.settings, call_log: frame.call_log ?? [], audit: frame.selective.audit, start: frame.selective.start,
    });
    now = currentTime();
    if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(snap.as_of) || snap.as_of <= 0 || !Number.isFinite(snap.close_time) || snap.close_time <= 0 || snap.as_of > now) return;
    const secs = (snap.close_time - snap.as_of) / 1000;
    const band = MID_RECOVERY_LOCKS_V2_EXPERIMENT.band_secs;
    const entryOpen = () => {
      const wallNow = currentTime();
      const wallSecs = (snap.close_time - wallNow) / 1000;
      return snap.as_of <= wallNow && secs >= band.min && secs <= band.max && wallSecs >= band.min && wallSecs <= band.max;
    };
    const inEntryWindow = entryOpen();
    if (!inEntryWindow && !shouldWriteSitReceipt((snap.close_time - now) / 1000, false)) return;
    // Prospective means observed prospectively: the market already open at boot is never collected.
    const windowOpen = snap.close_time - 15 * 60_000;
    if (st.sessionStartedAt > 0 && windowOpen < st.sessionStartedAt) return;
    const windowKey = `${snap.ticker}|${snap.close_time}`;
    if (inEntryWindow) {
      st.activeWindow = { key: windowKey, closeMs: snap.close_time };
      attributePendingSkips(st, windowKey, snap.close_time);
      noteObservation(observationOf(st, windowKey, snap.close_time), now, "tick");
    }
    for (const arm of LOCKS_RECOVERED_ARMS) {
      const mem = st.arms[arm];
      if (mem.watch && mem.watch.key !== windowKey) mem.watch = null; // no latch leaks across windows
      if (mem.lastLean && mem.lastLean.key !== windowKey) mem.lastLean = null; // no Chair-state leaks across windows
    }
    const writes: Array<Promise<boolean>> = [];
    const pending = new Set<string>();
    const recordedKinds = (arm: string) => new Set<ShadowReceipt["kind"]>((["fill", "intention", "veto", "no_fill"] as const).filter((kind) => {
      const k = `${EXPERIMENT}|${arm}|${windowKey}|${kind}`;
      return st.decided.has(k) || pending.has(k);
    }));
    const once = (r: ShadowReceipt, payload: Record<string, unknown> = {}, onlyIfUndecided: false | true | "terminal" = false) => {
      if (!onlyIfUndecided && !entryOpen()) return;
      const k = receiptKey(r);
      if (st.decided.has(k) || pending.has(k)) return;
      pending.add(k);
      // One stamping point covers NULL, recovered intentions/fills, and both
      // in-band and grace no-fill finalization. Never rewrite prior receipts.
      const stampedPayload = { ...payload, experiment: EXPERIMENT, arm: r.arm,
        evaluator_revision: V2_EVALUATOR_REVISION, observer_session_start_ms: st.sessionStartedAt,
        ...observationPayload(st, windowKey, snap.close_time) };
      writes.push(
        recordShadowReceipt(sql, r, stampedPayload, onlyIfUndecided)
          .then((inserted) => {
            if (inserted || !onlyIfUndecided) st.decided.add(k);
            if (inserted) st.written += 1;
            if (st.decided.size > 4_000) st.decided = new Set([...st.decided].slice(-2_000));
            return inserted;
          })
          .catch((error: unknown) => {
            st.rejected += 1;
            st.error = error instanceof Error ? error.message : String(error);
            return false;
          })
          .finally(() => pending.delete(k)),
      );
    };

    if (!inEntryWindow) {
      // T-3 grace, receipt-only: finalize only a window this session evaluated in band; never replay or synthesize.
      const observed = st.lastObservedWindow;
      const maxObservationAge = MID_RECOVERY_LOCKS_V2_POLL_MS + NULL_FAV_GRACE_SECS * 1000;
      if (!observed || observed.key !== windowKey || observed.asOf > snap.as_of || snap.as_of > now || now - observed.asOf > maxObservationAge
        || !shouldWriteSitReceipt((snap.close_time - now) / 1000, false)) return;
      for (const arm of LOCKS_RECOVERED_ARMS) {
        const plan = planV2ReceiptTransition(recordedKinds(arm), { eligible: false, booked: false, at_terminal_checkpoint: true });
        if (!plan.includes("no_fill")) continue;
        const mem = st.arms[arm];
        const stage = mem.stages.get(windowKey);
        const last = mem.lastRecord && mem.lastRecord.key === windowKey ? mem.lastRecord.record : {};
        once(receipt(arm, snap, "no_fill", null, null, null, null, null, "sit at T-3; receipt-only grace"), {
          ...last, experiment: EXPERIMENT, arm, secs_left: secs, checkpoint: 180, receipt_only: true, last_observed_as_of: observed.asOf, finalized_at: now,
          funnel_stage_index: stage?.stage ?? 0, funnel_stage: stage?.label ?? "observed",
        }, "terminal");
      }
      await Promise.all(writes);
      if (writes.length) st.lastCapture = now;
      st.error = null;
      return;
    }

    // Each arm's own risk history comes from its own simulated fills, never the production book or another arm.
    const calls = {} as Record<LocksRecoveredArm, CallLogRow[]>;
    for (const arm of LOCKS_RECOVERED_ARMS) calls[arm] = await locksV2ArmCalls(sql, arm, snap.as_of);
    if (!entryOpen()) { await Promise.all(writes); return; }
    const arms = {} as Record<LocksRecoveredArm, LocksArmState>;
    for (const arm of LOCKS_RECOVERED_ARMS) {
      const mem = st.arms[arm];
      arms[arm] = { watch: mem.watch, calls: calls[arm], last_lean: mem.lastLean?.key === windowKey ? mem.lastLean.lean : "WAIT" };
    }
    const evaluationInput: LocksInput = { snap, chair, learner, settings, call_log, audit, ready: true, start, arms };
    const ev = await evaluateLocksV2InSlices(evaluationInput, MID_RECOVERY_LOCKS_V2_DEPS);
    if (!entryOpen()) { await Promise.all(writes); return; }

    // NULL_FAV_80 at its frozen checkpoints: the same benchmark rule and identity as the shadow lab.
    const cp = scheduledCheckpoint(secs);
    if (cp != null && !st.decided.has(`${EXPERIMENT}|${LOCKS_ARMS.null_fav}|${windowKey}|fill`)) {
      if (ev.null_fav.eligible && ev.null_fav.side) {
        const q = exactSideQuote(snap, ev.null_fav.side);
        once(receipt(LOCKS_ARMS.null_fav, snap, "fill", ev.null_fav.side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, `checkpoint ${cp}s`), {
          experiment: EXPERIMENT, arm: LOCKS_ARMS.null_fav, checkpoint: cp, secs_left: secs, execution_qualified: true, hittability: "UNKNOWN at 2s poll",
          qualification_ask_cents: ev.null_fav.ask_cents, exact_ask_cents: q.exactAsk, price_lane: "exact_measurement", production_authority: MID_RECOVERY_LOCKS_V2_EXPERIMENT.production_authority,
        });
      } else if (cp === 300) {
        once(receipt(LOCKS_ARMS.null_fav, snap, "no_fill", null, null, null, null, null, "no eligible favourite at 450s or 300s"), { experiment: EXPERIMENT, arm: LOCKS_ARMS.null_fav, checkpoint: cp });
      }
    }

    // The four recovered arms: intention at the first eligible tick, a SIMULATED fill once confirmed and bookable, a T-3 sit otherwise.
    for (const arm of LOCKS_RECOVERED_ARMS) {
      const a = ev.arms[arm];
      const mem = st.arms[arm];
      mem.watch = a.evaluation.confirmation.watch;
      mem.lastLean = { key: windowKey, lean: a.evaluation.recovered.lean };
      const prev = mem.stages.get(windowKey);
      if (!prev || a.evaluation.flags.funnel_stage_index > prev.stage) mem.stages.set(windowKey, { stage: a.evaluation.flags.funnel_stage_index, label: a.evaluation.flags.funnel_stage });
      if (mem.stages.size > 200) mem.stages = new Map([...mem.stages.entries()].slice(-100));
      const side = a.evaluation.recovered.side;
      const q = side ? exactSideQuote(snap, side) : null;
      const payload = record(a, { hittability: "UNKNOWN at 2s poll", price_lane: "exact_measurement", qualification_ask_cents: q?.decisionAsk ?? null, exact_ask_cents: q?.exactAsk ?? null });
      mem.lastRecord = { key: windowKey, record: payload };
      const plan = planV2ReceiptTransition(recordedKinds(arm), {
        eligible: a.evaluation.recovered.eligible && !!side && !!q,
        booked: a.evaluation.simulated.booked && !!side && !!q,
        at_terminal_checkpoint: shouldWriteSitReceipt(secs, false),
      });
      if (plan.includes("intention") && side && q) once(receipt(arm, snap, "intention", side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, "first eligible tick"), payload, "terminal");
      if (plan.includes("fill") && side && q) {
        once(receipt(arm, snap, "fill", side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, "confirmed; SIMULATED booking, research only"), {
          ...payload, execution_qualified: true, simulated: true, authority: MID_RECOVERY_LOCKS_V2_EXPERIMENT.authority,
        }, "terminal");
      }
      if (plan.includes("no_fill")) {
        once(receipt(arm, snap, "no_fill", null, null, null, null, null, "sit at T-3"), { ...payload, secs_left: secs, checkpoint: 180 }, "terminal");
      }
    }

    await Promise.all(writes);
    st.lastObservedWindow = { key: windowKey, asOf: snap.as_of };
    if (writes.length) st.lastCapture = now;
    st.error = null;
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
  } finally {
    st.busy = false;
  }
}

/** Env-gated, default OFF. No manifest, no activation: each process start is a fresh session boundary. */
export function ensureMidRecoveryLocksV2Observer(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!midRecoveryLocksV2Enabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.sessionStartedAt = Date.now();
  st.timer = setInterval(() => void midRecoveryLocksV2Tick(), MID_RECOVERY_LOCKS_V2_POLL_MS);
  void midRecoveryLocksV2Tick();
  return "started";
}

export function midRecoveryLocksV2Health(): {
  experiment: typeof EXPERIMENT;
  evaluator_revision: typeof V2_EVALUATOR_REVISION;
  env_flag: typeof MID_RECOVERY_LOCKS_V2_ENV_FLAG;
  enabled: boolean;
  running: boolean;
  session_start: number | null;
  last_capture: number | null;
  written: number;
  rejected: number;
  guard_skips: number;
  last_guard: GovernorDecision | null;
  error: string | null;
} {
  const st = globalRef.__midRecoveryLocksV2__;
  return {
    experiment: EXPERIMENT, env_flag: MID_RECOVERY_LOCKS_V2_ENV_FLAG, enabled: midRecoveryLocksV2Enabled(), running: !!st?.timer, session_start: st?.sessionStartedAt ? st.sessionStartedAt : null,
    evaluator_revision: V2_EVALUATOR_REVISION,
    last_capture: st?.lastCapture ?? null, written: st?.written ?? 0, rejected: st?.rejected ?? 0,
    guard_skips: st?.guardSkips ?? 0, last_guard: st?.lastGuard ?? null, error: st?.error ?? null,
  };
}

/** This experiment's receipts only, oldest window first. Read only. */
export async function midRecoveryLocksV2Rows(sql: Sql): Promise<LocksV2Row[]> {
  const rows = await sql<{ experiment: string; build_sha: string; arm: string; ticker: string; close_ms: number | string; kind: MidRecoveryRow["kind"]; decided_ms: number | string; side: MidRecoveryRow["side"]; ask_cents: number | null; fee_cents: number | null; official_winner: MidRecoveryRow["official_winner"]; net_cents: number | string | null; payload: Record<string, unknown> | null }>`
    select experiment, build_sha, arm, ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, kind, (extract(epoch from decided_at) * 1000)::bigint as decided_ms,
      side, ask_cents, fee_cents, official_winner, net_cents, payload
    from desk_shadow_receipts where experiment = ${EXPERIMENT} order by close_time asc, decided_at asc`;
  return rows.map((r) => ({
    experiment: r.experiment, build_sha: r.build_sha,
    arm: r.arm, ticker: r.ticker, close_ms: Number(r.close_ms), kind: r.kind, decided_ms: Number(r.decided_ms), side: r.side,
    ask_cents: r.ask_cents == null ? null : Number(r.ask_cents), fee_cents: r.fee_cents == null ? null : Number(r.fee_cents),
    official_winner: r.official_winner, net_cents: r.net_cents == null ? null : Number(r.net_cents), payload: r.payload,
  }));
}

export async function midRecoveryLocksV2Report(): Promise<{ experiment: typeof MID_RECOVERY_LOCKS_V2_EXPERIMENT; health: ReturnType<typeof midRecoveryLocksV2Health>; first_receipt_at: string | null; summary: LocksV2Summary }> {
  const sql = await getSql();
  const rows = await midRecoveryLocksV2Rows(sql);
  const first = rows.length ? new Date(Math.min(...rows.map((r) => r.decided_ms))).toISOString() : null;
  return { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT, health: midRecoveryLocksV2Health(), first_receipt_at: first, summary: summarizeLocksV2(rows) };
}
