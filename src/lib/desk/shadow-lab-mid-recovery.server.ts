/**
 * MID_RECOVERY_V1_INACTIVE — the recorder (server only).
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureMidRecoveryObserver`
 * beside the other observers; it returns "disabled" unless
 * MID_RECOVERY_SHADOW_ENABLED=true (the literal string), so a deploy alone
 * cannot start collection. It holds no shadow-manifest slot: it is a
 * measurement recorder like SELECTOR ATTRIBUTION, not a fourth hypothesis on
 * the 3-active shelf, and it never registers, activates or edits a manifest.
 *
 * WHAT IT READS. A structuredClone of the engine frame (getServerFrame): the
 * production snap, votes, Chair, learner, settings, paper call log and the
 * production admission audit. It never assigns into the frame. The three real
 * downstream functions (runBotsWithEvaluatedCandidates, projectInactiveE1Recovery,
 * runChair) are bound here and handed to the pure evaluator: one recovery path,
 * the merged one.
 *
 * WHAT IT WRITES. Only desk_shadow_receipts, through the shadow lab's own
 * append-only writer (recordShadowReceipt: ON CONFLICT DO NOTHING on the
 * primary key experiment|arm|ticker|close_time|kind) under experiment
 * MID_RECOVERY_V1_INACTIVE with arms BASELINE, RECOVERED_MID and NULL_FAV_80,
 * and the same settle sweep fills official_winner/net_cents on fill rows from
 * the official ledger row. It never touches desk_ledger, desk_state, the
 * learner, a seat or card status, a threshold, the Chair, the paper book, a
 * manifest, or any promotion. A RECOVERED_MID fill is a SIMULATED booking and
 * is stamped so; it can never become a production call.
 *
 * PROSPECTIVE ONLY. Every process restart skips the market already open at
 * boot, so no window is ever back-filled from a cached or reconstructed frame;
 * the T-3 sit is written only for a window this session evaluated in-band.
 */
import { getSql, type Sql } from "@/lib/db";
import { runBotsWithEvaluatedCandidates } from "./bots";
import { projectInactiveE1Recovery } from "./call-recovery-candidate";
import { runChair } from "./chair";
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents } from "./fee-engine.ts";
import type { EntryWatch } from "./selective-entry.ts";
import { NULL_FAV_GRACE_SECS, scheduledCheckpoint } from "./shadow-arms.ts";
import { receiptKey, type ShadowReceipt } from "./shadow-lab.ts";
import { armCalls, exactSideQuote, recordShadowReceipt, settleShadowReceipts } from "./shadow-lab.server.ts";
import { MID_RECOVERY_ENV_FLAG, MID_RECOVERY_EXPERIMENT, evaluateMidRecovery, summarizeMidRecovery, type MidRecoveryDeps, type MidRecoveryEvaluation, type MidRecoveryRow, type MidRecoverySummary } from "./shadow-lab-mid-recovery.ts";
import { shouldWriteSitReceipt } from "./shadow-sit.ts";
import type { Snapshot } from "./types";

export const MID_RECOVERY_POLL_MS = 2_000;
export const MID_RECOVERY_SETTLE_EVERY_MS = 60_000;
const EXPERIMENT = MID_RECOVERY_EXPERIMENT.id;
const ARMS = MID_RECOVERY_EXPERIMENT.arms;

export function midRecoveryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[MID_RECOVERY_ENV_FLAG] === "true";
}

/** The one downstream path: the merged modules, bound once, never re-implemented. */
export const MID_RECOVERY_DEPS: MidRecoveryDeps = Object.freeze({ runBotsWithEvaluatedCandidates, projectInactiveE1Recovery, runChair });

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  /** The recovered arm's own confirmation latch. */
  watch: EntryWatch | null;
  decided: Set<string>;
  /** Deepest funnel stage seen per window this session, for the T-3 sit record. */
  stages: Map<string, { stage: number; label: string; asOf: number }>;
  /** The tick where the simulated Chair sat closest to (or above) its bar, per window: the direction stage's best case. */
  bestDirection: Map<string, { direction: MidRecoveryEvaluation["direction"]; secs_left: number; asOf: number }>;
  lastSettle: number;
  lastCapture: number | null;
  written: number;
  rejected: number;
  error: string | null;
  /** Process-local boundary: no window already open when this observer session began. */
  sessionStartedAt: number;
  lastObservedWindow: { key: string; asOf: number } | null;
  /** The last in-band evaluation record, carried into a receipt-only T-3 sit of the same window. */
  lastRecord: { key: string; record: Record<string, unknown> } | null;
};
const globalRef = globalThis as typeof globalThis & { __midRecovery__?: Observer };
const state = (): Observer => globalRef.__midRecovery__ ??= {
  timer: null, busy: false, watch: null, decided: new Set(), stages: new Map(), bestDirection: new Map(), lastSettle: 0, lastCapture: null, written: 0, rejected: 0, error: null, sessionStartedAt: 0, lastObservedWindow: null, lastRecord: null,
};

const receipt = (arm: string, snap: Snapshot, kind: ShadowReceipt["kind"], side: "UP" | "DOWN" | null, ask: number | null, size: number | null, spread: number | null, feedsOk: boolean | null, note: string | null, decidedMs = snap.as_of): ShadowReceipt => ({
  experiment: EXPERIMENT, arm, ticker: snap.ticker, close_ms: snap.close_time, kind, decided_ms: decidedMs, side, ask_cents: ask, fee_engine: DEFAULT_FEE_ENGINE,
  fee_cents: ask != null && realAskCents(ask) ? feeCents(ask) : null, size_at_ask: size, spread_cents: spread, feeds_ok: feedsOk, hittable_150ms: null, hittable_500ms: null,
  official_winner: null, net_cents: null, note,
});

/** The stored record of one evaluation: every measured field, minus the in-memory latch object. */
function record(ev: MidRecoveryEvaluation, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { confirmation, ...rest } = ev;
  const { watch, ...confirmationRest } = confirmation;
  void watch;
  return { ...rest, confirmation: confirmationRest, funnel_stage: ev.flags.funnel_stage, funnel_stage_index: ev.flags.funnel_stage_index, ...extra };
}

/** One tick. Exported for the harness; the timer calls it. */
export async function midRecoveryTick(now?: number): Promise<void> {
  const injectedNow = now;
  const currentTime = () => injectedNow ?? Date.now();
  now = currentTime();
  if (!Number.isFinite(now) || now <= 0) return;
  const st = state();
  if (st.busy) return;
  st.busy = true;
  try {
    const sql = await getSql();
    if (now - st.lastSettle > MID_RECOVERY_SETTLE_EVERY_MS) {
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
    const entryOpen = () => {
      const wallNow = currentTime();
      const wallSecs = (snap.close_time - wallNow) / 1000;
      return snap.as_of <= wallNow && secs >= MID_RECOVERY_EXPERIMENT.band_secs.min && secs <= MID_RECOVERY_EXPERIMENT.band_secs.max
        && wallSecs >= MID_RECOVERY_EXPERIMENT.band_secs.min && wallSecs <= MID_RECOVERY_EXPERIMENT.band_secs.max;
    };
    const inEntryWindow = entryOpen();
    if (!inEntryWindow && !shouldWriteSitReceipt((snap.close_time - now) / 1000, false)) return;
    // Prospective means observed prospectively: the market already open at boot is never collected.
    const windowOpen = snap.close_time - 15 * 60_000;
    if (st.sessionStartedAt > 0 && windowOpen < st.sessionStartedAt) return;
    const windowKey = `${snap.ticker}|${snap.close_time}`;
    if (st.watch && st.watch.key !== windowKey) st.watch = null; // no latch leaks across windows
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
            if (st.decided.size > 2_000) st.decided = new Set([...st.decided].slice(-1_000));
            return inserted;
          })
          .catch((error: unknown) => {
            // A trigger rejection (cross-kind conflict) is counted, never cached as a receipt and never re-raised into the engine.
            st.rejected += 1;
            st.error = error instanceof Error ? error.message : String(error);
            return false;
          })
          .finally(() => pending.delete(k)),
      );
    };

    if (!inEntryWindow) {
      // T-3 grace, receipt-only: finalize only a window this session evaluated in-band; never replay or synthesize.
      const observed = st.lastObservedWindow;
      const maxObservationAge = MID_RECOVERY_POLL_MS + NULL_FAV_GRACE_SECS * 1000;
      if (!observed || observed.key !== windowKey || observed.asOf > snap.as_of || snap.as_of > now || now - observed.asOf > maxObservationAge
        || !shouldWriteSitReceipt((snap.close_time - now) / 1000, false)) return;
      const stage = st.stages.get(windowKey);
      const last = st.lastRecord && st.lastRecord.key === windowKey ? st.lastRecord.record : {};
      for (const arm of [ARMS.baseline, ARMS.recovered]) {
        if (decidedKinds(arm)) continue;
        once(receipt(arm, snap, "no_fill", null, null, null, null, null, "sit at T-3; receipt-only grace"), {
          ...(arm === ARMS.recovered ? last : { baseline: last.baseline ?? null }),
          secs_left: secs, checkpoint: 180, receipt_only: true, last_observed_as_of: observed.asOf, finalized_at: now,
          ...(arm === ARMS.recovered ? { funnel_stage_index: stage?.stage ?? 0, funnel_stage: stage?.label ?? "observed" } : {}),
        }, true);
      }
      await Promise.all(writes);
      if (writes.length) st.lastCapture = now;
      st.error = null;
      return;
    }

    // The recovered arm's own risk history comes from its own simulated fills, never the production book.
    const recoveredCalls = await armCalls(sql, EXPERIMENT, ARMS.recovered, snap.as_of);
    if (!entryOpen()) { await Promise.all(writes); return; }
    const ev = evaluateMidRecovery({ snap, chair, learner, settings, call_log, audit, ready: true, start, recovered_calls: recoveredCalls, watch: st.watch }, MID_RECOVERY_DEPS);
    st.watch = ev.confirmation.watch;
    const prev = st.stages.get(windowKey);
    if (!prev || ev.flags.funnel_stage_index > prev.stage) st.stages.set(windowKey, { stage: ev.flags.funnel_stage_index, label: ev.flags.funnel_stage, asOf: snap.as_of });
    if (st.stages.size > 200) st.stages = new Map([...st.stages.entries()].slice(-100));
    const prevBest = st.bestDirection.get(windowKey);
    const better = !prevBest || (ev.direction.reason === "DIRECTIONAL" && prevBest.direction.reason !== "DIRECTIONAL") || (ev.direction.margin > prevBest.direction.margin && prevBest.direction.reason !== "DIRECTIONAL");
    if (better) st.bestDirection.set(windowKey, { direction: ev.direction, secs_left: secs, asOf: snap.as_of });
    if (st.bestDirection.size > 200) st.bestDirection = new Map([...st.bestDirection.entries()].slice(-100));

    // NULL_FAV_80 at its frozen checkpoints: the same benchmark rule and identity as the shadow lab.
    const cp = scheduledCheckpoint(secs);
    if (cp != null && !st.decided.has(`${EXPERIMENT}|${ARMS.null_fav}|${windowKey}|fill`)) {
      if (ev.null_fav.eligible && ev.null_fav.side) {
        const q = exactSideQuote(snap, ev.null_fav.side);
        once(receipt(ARMS.null_fav, snap, "fill", ev.null_fav.side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, `checkpoint ${cp}s`), {
          checkpoint: cp, secs_left: secs, execution_qualified: true, hittability: "UNKNOWN at 2s poll",
          qualification_ask_cents: ev.null_fav.ask_cents, exact_ask_cents: q.exactAsk, price_lane: "exact_measurement",
        });
      } else if (cp === 300) {
        once(receipt(ARMS.null_fav, snap, "no_fill", null, null, null, null, null, "no eligible favourite at 450s or 300s"), { checkpoint: cp });
      }
    }

    // RECOVERED_MID: intention at the first eligible tick, a SIMULATED fill once confirmed and bookable, a T-3 sit otherwise.
    const side = ev.recovered.side;
    const q = side ? exactSideQuote(snap, side) : null;
    const best = st.bestDirection.get(windowKey);
    const payload = record(ev, {
      hittability: "UNKNOWN at 2s poll", price_lane: "exact_measurement", qualification_ask_cents: q?.decisionAsk ?? null, exact_ask_cents: q?.exactAsk ?? null,
      direction_best: best ? best.direction : null, direction_best_secs_left: best ? best.secs_left : null, direction_best_as_of: best ? best.asOf : null,
    });
    st.lastRecord = { key: windowKey, record: payload };
    if (ev.recovered.eligible && side && q) once(receipt(ARMS.recovered, snap, "intention", side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, "first eligible tick"), payload);
    if (ev.simulated.booked && side && q) {
      once(receipt(ARMS.recovered, snap, "fill", side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, true, "confirmed; SIMULATED booking, research only"), {
        ...payload, execution_qualified: true, simulated: true, authority: MID_RECOVERY_EXPERIMENT.authority,
      });
    }
    if (shouldWriteSitReceipt(secs, decidedKinds(ARMS.recovered))) {
      once(receipt(ARMS.recovered, snap, "no_fill", null, null, null, null, null, "sit at T-3"), { ...payload, secs_left: secs, checkpoint: 180 });
    }

    // BASELINE: a fill only when the production paper book itself holds this window; otherwise the production state at T-3.
    const booked = ev.baseline.booked;
    if (booked && !st.decided.has(`${EXPERIMENT}|${ARMS.baseline}|${windowKey}|fill`)) {
      const bq = exactSideQuote(snap, booked.side);
      once(receipt(ARMS.baseline, snap, "fill", booked.side, booked.ask_cents, bq.decisionSize, null, null, "production paper call, mirrored", booked.decided_ms), {
        source: "production_call_log", baseline: ev.baseline, secs_left: secs, execution_qualified: true,
      });
    }
    if (shouldWriteSitReceipt(secs, decidedKinds(ARMS.baseline))) {
      once(receipt(ARMS.baseline, snap, "no_fill", null, null, null, null, null, "production sit at T-3"), { baseline: ev.baseline, secs_left: secs, checkpoint: 180 });
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

/** Env-gated, default OFF. No manifest, no activation: the first receipt's decided_at is the boundary, derived, never edited. */
export function ensureMidRecoveryObserver(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!midRecoveryEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.sessionStartedAt = Date.now();
  st.timer = setInterval(() => void midRecoveryTick(), MID_RECOVERY_POLL_MS);
  void midRecoveryTick();
  return "started";
}

export function midRecoveryHealth(): {
  experiment: typeof EXPERIMENT;
  enabled: boolean;
  running: boolean;
  session_start: number | null;
  last_capture: number | null;
  written: number;
  rejected: number;
  error: string | null;
} {
  const st = globalRef.__midRecovery__;
  return {
    experiment: EXPERIMENT, enabled: midRecoveryEnabled(), running: !!st?.timer, session_start: st?.sessionStartedAt ? st.sessionStartedAt : null,
    last_capture: st?.lastCapture ?? null, written: st?.written ?? 0, rejected: st?.rejected ?? 0, error: st?.error ?? null,
  };
}

/** The experiment's receipts, oldest window first. Read only. */
export async function midRecoveryRows(sql: Sql): Promise<MidRecoveryRow[]> {
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

export async function midRecoveryReport(): Promise<{ experiment: typeof MID_RECOVERY_EXPERIMENT; health: ReturnType<typeof midRecoveryHealth>; first_receipt_at: string | null; summary: MidRecoverySummary }> {
  const sql = await getSql();
  const rows = await midRecoveryRows(sql);
  const first = rows.length ? new Date(Math.min(...rows.map((r) => r.decided_ms))).toISOString() : null;
  return { experiment: MID_RECOVERY_EXPERIMENT, health: midRecoveryHealth(), first_receipt_at: first, summary: summarizeMidRecovery(rows) };
}
