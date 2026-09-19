/**
 * Phase 1A — server-only system-event writer.
 *
 * Writes one row. No side effects. No public POST. No admin_key endpoint.
 * Decision-path modules must not import this file in Phase 1A.
 *
 * Read-only queries live in system-events-read.server.ts. They are re-exported
 * here only for compatibility with older presentation callers.
 */
import {
  validateSystemEvent,
  type RecordEventResult,
  type SystemEventInput,
} from "./system-events";

/** Compatibility exports; new read-only consumers should import the read module directly. */
export {
  listPublicSystemEvents,
  listPublicChamberEvents,
} from "./system-events-read.server";

async function db() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/**
 * Insert-once. A restart with the same event_key is a no-op.
 * Never updates, never deletes.
 */
export async function recordSystemEvent(input: SystemEventInput): Promise<RecordEventResult> {
  const ev = validateSystemEvent(input);
  const sql = await db();
  const rows = await sql<{ event_key: string }>`
    insert into desk_system_events
      (event_key, event_type, character, occurred_at, source_type, source_id, payload, public)
    values
      (
        ${ev.event_key},
        ${ev.event_type},
        ${ev.character},
        ${ev.occurred_at.toISOString()}::timestamptz,
        ${ev.source_type},
        ${ev.source_id},
        ${JSON.stringify(ev.payload)}::jsonb,
        ${ev.public}
      )
    on conflict (event_key) do nothing
    returning event_key
  `;
  return {
    inserted: rows.length > 0,
    event_key: ev.event_key,
    event_type: ev.event_type,
    character: ev.character,
    public: ev.public,
  };
}
