/**
 * Skill-status transition log: the drainer (server only).
 *
 * Kicked from server/routes/healthz.get.ts beside the other observers. Every
 * few seconds it takes the transitions the engine queued (status-transitions.ts)
 * and writes each as one insert-once system event (event_key unique, type
 * DESK_UPDATE, character COACH, public false). It never imports the engine,
 * the learner or the Chair, and nothing reads its output on a decision path.
 * Errors are counted into its own health record; they can reach neither the
 * engine nor the tick. Kill switch: SKILL_STATUS_LOG_DISABLED=true.
 */
import { recordSystemEvent } from "./system-events.server.ts";
import { drainStatusTransitions, statusTransitionBufferStats, transitionEvent } from "./status-transitions.ts";

export const STATUS_LOG_KILL_FLAG = "SKILL_STATUS_LOG_DISABLED";
export const STATUS_LOG_DRAIN_MS = 5_000;

type Drainer = { timer: ReturnType<typeof setInterval> | null; busy: boolean; written: number; failed: number; error: string | null; lastWrite: number | null };
const ref = globalThis as typeof globalThis & { __skillStatusDrainer__?: Drainer };
const state = (): Drainer => ref.__skillStatusDrainer__ ??= { timer: null, busy: false, written: 0, failed: 0, error: null, lastWrite: null };

export function statusLogEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[STATUS_LOG_KILL_FLAG] !== "true";
}

/** One drain pass. Exported for the harness; the timer calls it. Never throws. */
export async function drainStatusTransitionLog(now = Date.now()): Promise<number> {
  const st = state();
  if (st.busy) return 0;
  st.busy = true;
  let written = 0;
  try {
    for (const t of drainStatusTransitions()) {
      try {
        await recordSystemEvent(transitionEvent(t));
        written += 1;
        st.written += 1;
        st.lastWrite = now;
      } catch (error) {
        st.failed += 1;
        st.error = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
  } finally {
    st.busy = false;
  }
  return written;
}

/** Start the drainer. Returns why it did not start when it did not. */
export function ensureStatusTransitionLog(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!statusLogEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.timer = setInterval(() => void drainStatusTransitionLog(), STATUS_LOG_DRAIN_MS);
  return "started";
}

export function statusTransitionLogHealth(): { enabled: boolean; running: boolean; written: number; failed: number; error: string | null; buffer: ReturnType<typeof statusTransitionBufferStats> } {
  const st = ref.__skillStatusDrainer__;
  return { enabled: statusLogEnabled(), running: !!st?.timer, written: st?.written ?? 0, failed: st?.failed ?? 0, error: st?.error ?? null, buffer: statusTransitionBufferStats() };
}
