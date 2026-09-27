/**
 * MID_RECOVERY_LOCKS_V1_INACTIVE — the recorder (server only).
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureMidRecoveryLocksObserver`
 * beside the other observers; it returns "disabled" unless
 * MID_RECOVERY_LOCKS_SHADOW_ENABLED=true (the literal string), so a deploy
 * alone cannot start collection. It is independent of the MID_RECOVERY_V1
 * recorder and its flag: either can run without the other. It holds no
 * shadow-manifest slot and never registers, activates or edits a manifest.
 *
 * WHAT IT READS. A structuredClone of the engine frame (getServerFrame). It
 * never assigns into the frame. The same three real downstream functions the
 * V1 recorder binds are bound here (MID_RECOVERY_LOCKS_DEPS) and handed to the
 * pure evaluator; the V1 recorder module itself is never imported.
 *
 * WHAT IT WRITES. Only desk_shadow_receipts, through the shadow lab's
 * append-only writer (primary key experiment|arm|ticker|close_time|kind), under
 * experiment MID_RECOVERY_LOCKS_V1_INACTIVE with arms CONTROL, BAR_NO_SITMASS,
 * SUPPORT_UNCAL_E1, COMBINED_DIAG and NULL_FAV_80 — five arms, five keys, on
 * the same window. Never a MID_RECOVERY_V1_INACTIVE row. The shared settle
 * sweep fills official_winner/net_cents on fill rows. A fill is a SIMULATED
 * booking, stamped so; production authority is NONE.
 *
 * FRESH SESSION BOUNDARY. Each process start begins a new observer session;
 * the market already open at boot is skipped (never back-filled), so the first
 * window this experiment can record is the next one to open. The T-3 sit is
 * written only for a window this session evaluated in band.
 */
import { getSql, type Sql } from "@/lib/db";
import { runBotsWithEvaluatedCandidates } from "./bots";
import { projectInactiveE1Recovery } from "./call-recovery-candidate";
import { runChair } from "./chair";
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents } from "./fee-engine.ts";
import { NULL_FAV_GRACE_SECS, scheduledCheckpoint } from "./shadow-arms.ts";
import { receiptKey, type ShadowReceipt } from "./shadow-lab.ts";
import { armCalls, exactSideQuote, recordShadowReceipt, settleShadowReceipts } from "./shadow-lab.server.ts";
import type { MidRecoveryDeps, MidRecoveryRow } from "./shadow-lab-mid-recovery.ts";
import {
  LOCKS_ARMS, LOCKS_RECOVERED_ARMS, MID_RECOVERY_LOCKS_ENV_FLAG, MID_RECOVERY_LOCKS_EXPERIMENT, evaluateLocks, summarizeLocks,
  type LocksArmEvaluation, type LocksArmState, type LocksRecoveredArm, type LocksSummary,
} from "./shadow-lab-mid-recovery-locks.ts";
import { shouldWriteSitReceipt } from "./shadow-sit.ts";
import type { CallLogRow, Lean, Snapshot } from "./types";

export const MID_RECOVERY_LOCKS_POLL_MS = 2_000;
export const MID_RECOVERY_LOCKS_SETTLE_EVERY_MS = 60_000;
const EXPERIMENT = MID_RECOVERY_LOCKS_EXPERIMENT.id;

/** The one downstream path, the same merged modules the V1 recorder binds; never re-implemented. */
export const MID_RECOVERY_LOCKS_DEPS: MidRecoveryDeps = Object.freeze({ runBotsWithEvaluatedCandidates, projectInactiveE1Recovery, runChair });

export function midRecoveryLocksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[MID_RECOVERY_LOCKS_ENV_FLAG] === "true";
}

/** One recovered arm's in-memory state. Nothing is shared between arms. */
type ArmMemory = {
  watch: LocksArmState["watch"];
  lastLean: { key: string; lean: Lean } | null;
  stages: Map<string, { stage: number; label: string }>;
  lastRecord: { key: string; record: Record<string, unknown> } | null;
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
};
const blankArm = (): ArmMemory => ({ watch: null, lastLean: null, stages: new Map(), lastRecord: null });
const blankArms = (): Record<LocksRecoveredArm, ArmMemory> => ({ CONTROL: blankArm(), BAR_NO_SITMASS: blankArm(), SUPPORT_UNCAL_E1: blankArm(), COMBINED_DIAG: blankArm() });
const globalRef = globalThis as typeof globalThis & { __midRecoveryLocks__?: Observer };
const state = (): Observer => globalRef.__midRecoveryLocks__ ??= {
  timer: null, busy: false, arms: blankArms(), decided: new Set(), lastSettle: 0, lastCapture: null, written: 0, rejected: 0, error: null, sessionStartedAt: 0, lastObservedWindow: null,
};

const receipt = (arm: string, snap: Snapshot, kind: ShadowReceipt["kind"], side: "UP" | "DOWN" | null, ask: number | null, size: number | null, spread: number | null, feedsOk: boolean | null, note: string | null): ShadowReceipt => ({
  experiment: EXPERIMENT, arm, ticker: snap.ticker, close_ms: snap.close_time, kind, decided_ms: snap.as_of, side, ask_cents: ask, fee_engine: DEFAULT_FEE_ENGINE,
  fee_cents: ask != null && realAskCents(ask) ? feeCents(ask) : null, size_at_ask: size, spread_cents: spread, feeds_ok: feedsOk, hittable_150ms: null, hittable_500ms: null,
  official_winner: null, net_cents: null, note,
});

/** The stored record of one arm's evaluation: every measured field plus the arm's identity and intervention, minus the in-memory latch. */
function record(a: LocksArmEvaluation, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { confirmation, ...rest } = a.evaluation;
  const { watch, ...confirmationRest } = confirmation;
  void watch;
  return {
    ...rest, version: EXPERIMENT, experiment: EXPERIMENT, experiment_version: a.experiment_version, evaluator: MID_RECOVERY_LOCKS_EXPERIMENT.evaluator,
    arm: a.arm, promotion_eligible: a.promotion_eligible, production_authority: MID_RECOVERY_LOCKS_EXPERIMENT.production_authority, intervention: a.intervention,
    confirmation: confirmationRest, funnel_stage: a.evaluation.flags.funnel_stage, funnel_stage_index: a.evaluation.flags.funnel_stage_index, ...extra,
  };
}

/** One tick. Exported for the harness; the timer calls it. */
export async function midRecoveryLocksTick(now?: number): Promise<void> {
  const injectedNow = now;
  const currentTime = () => injectedNow ?? Date.now();
  now = currentTime();
  if (!Number.isFinite(now) || now <= 0) return;
  const st = state();
  if (st.busy) return;
  st.busy = true;
  try {
    const sql = await getSql();
    if (now - st.lastSettle > MID_RECOVERY_LOCKS_SETTLE_EVERY_MS) {
      st.lastSettle = now;
      await settleShadowReceipts(sql);
    }
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    if (!frame.snap || !frame.chair || frame.snap.demo || !frame.selective.ready) return;
    const { snap, chair, learner, settings, call_log, audit, start } = structuredClone({
      snap: frame.snap, chair: frame.chair, learner: frame.learner, settings: frame.settings, call_log: frame.call_log ?? [], audit: frame.selective.audit, start: frame.selective.start,
    });
    now = currentTime();
    if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(snap.as_of) || snap.as_of <= 0 || !Number.isFinite(snap.close_time) || snap.close_time <= 0 || snap.as_of > now) return;
    const secs = (snap.close_time - snap.as_of) / 1000;
    const band = MID_RECOVERY_LOCKS_EXPERIMENT.band_secs;
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
    for (const arm of LOCKS_RECOVERED_ARMS) {
      const mem = st.arms[arm];
      if (mem.watch && mem.watch.key !== windowKey) mem.watch = null; // no latch leaks across windows
      if (mem.lastLean && mem.lastLean.key !== windowKey) mem.lastLean = null; // no Chair-state leaks across windows
    }
    const writes: Array<Promise<boolean>> = [];
    const pending = new Set<string>();
    const decidedKinds = (arm: string) => (["fill", "intention", "veto", "no_fill"] as const).some((kind) => {
      const k = `${EXPERIMENT}|${arm}|${windowKey}|${kind}`;
      return st.decided.has(k) || pending.has(k);
    });
    const once = (r: ShadowReceipt, payload: Record<string, unknown> = {}, onlyIfUndecided = false) => {
      if (!onlyIfUndecided && !entryOpen()) return;
      const k = receiptKey(r);
      if (st.decided.has(k) || pending.has(k)) return;
      pending.add(k);
      writes.push(
        recordShadowReceipt(sql, r, payload, onlyIfUndecided)
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
      const maxObservationAge = MID_RECOVERY_LOCKS_POLL_MS + NULL_FAV_GRACE_SECS * 1000;
      if (!observed || observed.key !== windowKey || observed.asOf > snap.as_of || snap.as_of > now || now - observed.asOf > maxObservationAge
        || !shouldWriteSitReceipt((snap.close_time - now) / 1000, false)) return;
      for (const arm of LOCKS_RECOVERED_ARMS) {
        if (decidedKinds(arm)) continue;
        const mem = st.arms[arm];
        const stage = mem.stages.get(windowKey);
        const last = mem.lastRecord && mem.lastRecord.key === windowKey ? mem.lastRecord.record : {};
        once(receipt(arm, snap, "no_fill", null, null, null, null, null, "sit at T-3; receipt-only grace"), {
          ...last, experiment: EXPERIMENT, arm, secs_left: secs, checkpoint: 180, receipt_only: true, last_observed_as_of: observed.asOf, finalized_at: now,
          funnel_stage_index: stage?.stage ?? 0, funnel_stage: stage?.label ?? "observed",
        }, true);
      }
      await Promise.all(writes);
      if (writes.length) st.lastCapture = now;
      st.error = null;
      return;
    }

    // Each arm's own risk history comes from its own simulated fills, never the production book or another arm.
    const calls = {} as Record<LocksRecoveredArm, CallLogRow[]>;
    for (const arm of LOCKS_RECOVERED_ARMS) calls[arm] = await armCalls(sql, EXPERIMENT, arm, snap.as_of);
    if (!entryOpen()) { await Promise.all(writes); return; }
    const arms = {} as Record<LocksRecoveredArm, LocksArmState>;
    for (const arm of LOCKS_RECOVERED_ARMS) {
      const mem = st.arms[arm];
      arms[arm] = { watch: mem.watch, calls: calls[arm], last_lean: mem.lastLean?.key === windowKey ? mem.lastLean.lean : "WAIT" };
    }
    const ev = evaluateLocks({ snap, chair, learner, settings, call_log, audit, ready: true, start, arms }, MID_RECOVERY_LOCKS_DEPS);

    // NULL_FAV_80 at its frozen checkpoints: the same benchmark rule and identity as the shadow lab.
    const cp = scheduledCheckpoint(secs);
    if (cp != null && !st.decided.has(`${EXPERIMENT}|${LOCKS_ARMS.null_fav}|${windowKey}|fill`)) {
      if (ev.null_fav.eligible && ev.null_fav.side) {
        const q = exactSideQuote(snap, ev.null_fav.side);
        once(receipt(LOCKS_ARMS.null_fav, snap, "fill", ev.null_fav.side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, `checkpoint ${cp}s`), {
          experiment: EXPERIMENT, arm: LOCKS_ARMS.null_fav, checkpoint: cp, secs_left: secs, execution_qualified: true, hittability: "UNKNOWN at 2s poll",
          qualification_ask_cents: ev.null_fav.ask_cents, exact_ask_cents: q.exactAsk, price_lane: "exact_measurement", production_authority: MID_RECOVERY_LOCKS_EXPERIMENT.production_authority,
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
      if (a.evaluation.recovered.eligible && side && q) once(receipt(arm, snap, "intention", side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, "first eligible tick"), payload);
      if (a.evaluation.simulated.booked && side && q) {
        once(receipt(arm, snap, "fill", side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, "confirmed; SIMULATED booking, research only"), {
          ...payload, execution_qualified: true, simulated: true, authority: MID_RECOVERY_LOCKS_EXPERIMENT.authority,
        });
      }
      if (shouldWriteSitReceipt(secs, decidedKinds(arm))) {
        once(receipt(arm, snap, "no_fill", null, null, null, null, null, "sit at T-3"), { ...payload, secs_left: secs, checkpoint: 180 });
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
export function ensureMidRecoveryLocksObserver(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!midRecoveryLocksEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.sessionStartedAt = Date.now();
  st.timer = setInterval(() => void midRecoveryLocksTick(), MID_RECOVERY_LOCKS_POLL_MS);
  void midRecoveryLocksTick();
  return "started";
}

export function midRecoveryLocksHealth(): {
  experiment: typeof EXPERIMENT;
  env_flag: typeof MID_RECOVERY_LOCKS_ENV_FLAG;
  enabled: boolean;
  running: boolean;
  session_start: number | null;
  last_capture: number | null;
  written: number;
  rejected: number;
  error: string | null;
} {
  const st = globalRef.__midRecoveryLocks__;
  return {
    experiment: EXPERIMENT, env_flag: MID_RECOVERY_LOCKS_ENV_FLAG, enabled: midRecoveryLocksEnabled(), running: !!st?.timer, session_start: st?.sessionStartedAt ? st.sessionStartedAt : null,
    last_capture: st?.lastCapture ?? null, written: st?.written ?? 0, rejected: st?.rejected ?? 0, error: st?.error ?? null,
  };
}

/** This experiment's receipts only, oldest window first. Read only. */
export async function midRecoveryLocksRows(sql: Sql): Promise<MidRecoveryRow[]> {
  const rows = await sql<{ arm: string; ticker: string; close_ms: number | string; kind: MidRecoveryRow["kind"]; decided_ms: number | string; side: MidRecoveryRow["side"]; ask_cents: number | null; fee_cents: number | null; official_winner: MidRecoveryRow["official_winner"]; net_cents: number | string | null; payload: Record<string, unknown> | null }>`
    select arm, ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, kind, (extract(epoch from decided_at) * 1000)::bigint as decided_ms,
      side, ask_cents, fee_cents, official_winner, net_cents, payload
    from desk_shadow_receipts where experiment = ${EXPERIMENT} order by close_time asc, decided_at asc`;
  return rows.map((r) => ({
    arm: r.arm, ticker: r.ticker, close_ms: Number(r.close_ms), kind: r.kind, decided_ms: Number(r.decided_ms), side: r.side,
    ask_cents: r.ask_cents == null ? null : Number(r.ask_cents), fee_cents: r.fee_cents == null ? null : Number(r.fee_cents),
    official_winner: r.official_winner, net_cents: r.net_cents == null ? null : Number(r.net_cents), payload: r.payload,
  }));
}

export async function midRecoveryLocksReport(): Promise<{ experiment: typeof MID_RECOVERY_LOCKS_EXPERIMENT; health: ReturnType<typeof midRecoveryLocksHealth>; first_receipt_at: string | null; summary: LocksSummary }> {
  const sql = await getSql();
  const rows = await midRecoveryLocksRows(sql);
  const first = rows.length ? new Date(Math.min(...rows.map((r) => r.decided_ms))).toISOString() : null;
  return { experiment: MID_RECOVERY_LOCKS_EXPERIMENT, health: midRecoveryLocksHealth(), first_receipt_at: first, summary: summarizeLocks(rows) };
}
