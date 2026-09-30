/**
 * The production DECISION TAPE observer (server only).
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureDecisionTape`; it returns
 * "disabled" unless RESEARCH_DECISION_TAPE_ENABLED=true (the literal string).
 *
 * WHAT IT READS. A structuredClone of the frame the engine already published:
 * the snapshot, the Chair, the admission audit, the daily admission state and
 * the paper call log, all from the same tick. It never assigns into the frame,
 * recomputes nothing production decided, and has no path back into the engine.
 *
 * WHAT IT WRITES. Only desk_research_decision_tape: one insert-once row per
 * recorded frame, at each designated checkpoint and at every change of the
 * decision label or funnel stage (capped per window). A window already open
 * when this process started is recorded but marked partial_window, so its
 * first blocker and dwell times are never counted.
 *
 * COST. The engine publishes the frame anyway; this reads it every 2 s,
 * classifies it (microseconds), and writes only on a checkpoint or a change —
 * typically 10–30 rows per window.
 */
import { getSql } from "@/lib/db";
import { MAX_EVENTS_PER_WINDOW, classifyTape, observeE1Paper, shouldRecord, tapeIdentityQuality, type Audit, type TapeFrame, type TapeIdentityReason, type TapeRecord } from "./research-factory-tape.ts";

export const TAPE_POLL_MS = 2_000;
export const TAPE_ENV_FLAG = "RESEARCH_DECISION_TAPE_ENABLED";
const runningBuildSha = (): string => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

export function decisionTapeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[TAPE_ENV_FLAG] === "true";
}

type WindowMemory = { key: string; last: { label: string; stage_index: number } | null; checkpoints: Set<number>; events: number; partial: boolean };
type State = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  sessionStartedAt: number;
  window: WindowMemory | null;
  written: number;
  error: string | null;
  lastAsOf: number | null;
  identityRejected: number;
  lastIdentityRejection: { ticker: string; close_ms: number; reasons: TapeIdentityReason[] } | null;
};
const g = globalThis as typeof globalThis & { __decisionTape__?: State };
const state = (): State => g.__decisionTape__ ??= { timer: null, busy: false, sessionStartedAt: 0, window: null, written: 0, error: null, lastAsOf: null, identityRejected: 0, lastIdentityRejection: null };

/** One observation. Exported for the harness; the timer calls it. */
export async function decisionTapeTick(now: number = Date.now()): Promise<TapeRecord | null> {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    if (!frame.snap || !frame.chair || frame.snap.demo) return null;
    const f = structuredClone({
      snap: frame.snap, chair: frame.chair, votes: frame.votes, audit: (frame.selective?.audit ?? null) as Audit | null, daily: frame.selective?.daily ?? null,
      call_log: (frame.call_log ?? []).slice(0, 50),
    }) as TapeFrame;
    const snap = f.snap;
    if (!Number.isFinite(snap.as_of) || !Number.isFinite(snap.close_time) || snap.as_of >= snap.close_time || snap.as_of > now + 5_000) return null;
    const identity = tapeIdentityQuality(snap.ticker, snap.close_time);
    if (!identity.reportable) {
      st.identityRejected += 1;
      st.lastIdentityRejection = { ticker: snap.ticker, close_ms: snap.close_time, reasons: identity.reasons };
      return null;
    }
    if (st.lastAsOf === snap.as_of) return null; // the same published frame: nothing new
    st.lastAsOf = snap.as_of;
    const key = `${snap.ticker}|${snap.close_time}`;
    if (!st.window || st.window.key !== key) {
      st.window = { key, last: null, checkpoints: new Set(), events: 0, partial: st.sessionStartedAt > 0 && snap.close_time - 15 * 60_000 < st.sessionStartedAt };
    }
    const w = st.window;
    if (w.events >= MAX_EVENTS_PER_WINDOW) return null;
    const rec = classifyTape(f);
    const decision = shouldRecord(rec, w.last, w.checkpoints);
    if (!decision.record) return null;
    // Seat reads ride along on checkpoints only (signal-value research); change events stay compact.
    const record: TapeRecord = decision.checkpoint != null
      ? { ...rec, seats: (f.chair.rows ?? []).map((r) => ({ seat: r.seat, lean: r.lean, conf: typeof r.conf === "number" ? r.conf : null, status: String(r.status), weight: typeof r.weight === "number" ? r.weight : null, folded: r.folded === true })), e1_paper: observeE1Paper(f.votes) }
      : rec;
    const sql = await getSql();
    const rows = await sql<{ ok: number }>`
      insert into desk_research_decision_tape (ticker, close_time, as_of, secs_left, checkpoint_secs, state, label, stage, primary_blocker, blockers, partial_window, record, build_sha)
      values (${snap.ticker}, ${new Date(snap.close_time).toISOString()}::timestamptz, ${new Date(snap.as_of).toISOString()}::timestamptz, ${rec.secs_left}, ${decision.checkpoint},
        ${rec.state}, ${rec.label}, ${rec.stage}, ${rec.primary_blocker}, array(select jsonb_array_elements_text(${JSON.stringify(rec.blockers)}::jsonb)),
        ${w.partial}, ${JSON.stringify(record)}::jsonb, ${runningBuildSha()})
      on conflict (ticker, close_time, as_of) do nothing returning 1 as ok`;
    if (decision.checkpoint != null) w.checkpoints.add(decision.checkpoint);
    w.last = { label: rec.label, stage_index: rec.stage_index };
    w.events += 1;
    st.written += rows.length;
    st.error = null;
    return rec;
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    st.busy = false;
  }
}

export function ensureDecisionTape(env: Record<string, string | undefined> = process.env, now: number = Date.now()): "started" | "already" | "disabled" {
  if (!decisionTapeEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.sessionStartedAt = now;
  st.timer = setInterval(() => void decisionTapeTick(), TAPE_POLL_MS);
  st.timer.unref?.();
  return "started";
}

export function decisionTapeHealth() {
  const st = g.__decisionTape__;
  return { env_flag: TAPE_ENV_FLAG, enabled: decisionTapeEnabled(), running: !!st?.timer, session_start: st?.sessionStartedAt || null, written: st?.written ?? 0,
    identity_rejected: st?.identityRejected ?? 0, last_identity_rejection: st?.lastIdentityRejection ?? null,
    error: st?.error ?? null, production_authority: "NONE" };
}
