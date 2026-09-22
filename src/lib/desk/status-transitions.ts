/**
 * Skill-card status transitions, as append-only events.
 *
 * The learner keeps only a card's current status; the seat review and the
 * huddle overwrite it in place, and the huddle log that quoted the change is
 * capped at 20 lines. This module diffs a before/after snapshot of card
 * statuses and shapes one immutable event per transition. The event key is
 * deterministic in (card, from, to, at-ms), shaped `SKILL_STATUS:<card>:<from>_to_<to>:<ms>`
 * so it satisfies the system-event logical-id charset, so a restart or a retry writes
 * nothing twice. It never changes a status.
 *
 * The engine never imports a writer: it queues transitions in a bounded
 * in-memory buffer (queueStatusTransitions) and a healthz-kicked drainer
 * (status-transitions.server.ts) persists them. A full buffer drops the oldest
 * entry and counts the drop; nothing here can throw into the engine.
 *
 * Pure module (the buffer is process state, never decision state).
 */
import type { Learner, SkillStatus } from "./types";
import type { SystemEventInput } from "./system-events.ts";

export const STATUS_TRANSITION_BUFFER_MAX = 500;
type Buffer = { queue: StatusTransition[]; dropped: number; queued: number };
const bufferRef = globalThis as typeof globalThis & { __skillStatusTransitions__?: Buffer };
const buffer = (): Buffer => bufferRef.__skillStatusTransitions__ ??= { queue: [], dropped: 0, queued: 0 };

export type StatusSnapshot = Record<string, SkillStatus>;

export function skillStatusSnapshot(learner: Pick<Learner, "skills">): StatusSnapshot {
  const out: StatusSnapshot = {};
  for (const [id, c] of Object.entries(learner.skills)) out[id] = c.status;
  return out;
}

export type StatusTransition = { card: string; seat: string; from: SkillStatus | "NEW"; to: SkillStatus | "REMOVED"; at_ms: number; writer: string };

export function diffStatuses(before: StatusSnapshot, after: StatusSnapshot, atMs: number, writer: string): StatusTransition[] {
  const out: StatusTransition[] = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of [...ids].sort()) {
    const f = before[id] ?? "NEW", t = after[id] ?? "REMOVED";
    if (f !== t) out.push({ card: id, seat: id.split(".")[0] ?? "?", from: f, to: t, at_ms: atMs, writer });
  }
  return out;
}

/** Engine-side hook: diff two snapshots and queue every transition. Never throws. */
export function queueStatusTransitions(before: StatusSnapshot, after: StatusSnapshot, writer: string, atMs = Date.now()): number {
  try {
    const b = buffer();
    const ts = diffStatuses(before, after, atMs, writer);
    for (const t of ts) {
      if (b.queue.length >= STATUS_TRANSITION_BUFFER_MAX) { b.queue.shift(); b.dropped += 1; }
      b.queue.push(t);
      b.queued += 1;
    }
    return ts.length;
  } catch {
    return 0;
  }
}

/** Drainer-side: take up to `max` queued transitions (oldest first). */
export function drainStatusTransitions(max = STATUS_TRANSITION_BUFFER_MAX): StatusTransition[] {
  const b = buffer();
  return b.queue.splice(0, Math.max(0, max));
}

export function statusTransitionBufferStats(): { pending: number; queued: number; dropped: number } {
  const b = buffer();
  return { pending: b.queue.length, queued: b.queued, dropped: b.dropped };
}

/** One immutable, idempotent system event per transition (type DESK_UPDATE, character COACH, not public). */
export function transitionEvent(t: StatusTransition): SystemEventInput {
  return {
    event_key: `SKILL_STATUS:${t.card}:${t.from}_to_${t.to}:${t.at_ms}`,
    event_type: "DESK_UPDATE",
    character: "COACH",
    occurred_at: new Date(t.at_ms),
    source_type: "desk_state",
    source_id: t.card,
    public: false,
    payload: { kind: "skill-status-transition", card: t.card, seat: t.seat, from: t.from, to: t.to, writer: t.writer, authority: "none" },
  };
}
