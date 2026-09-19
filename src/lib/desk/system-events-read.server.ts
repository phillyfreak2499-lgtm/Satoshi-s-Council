/**
 * Read-only system-event queries.
 *
 * Kept separate from system-events.server.ts so presentation/research consumers
 * can inspect persisted public events without importing the event writer.
 */
import type { PublicSystemEvent } from "./system-events";

async function db() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const PUBLIC_CAP = 40;

type StoredPublicEvent = {
  event_key: string;
  event_type: string;
  character: string;
  occurred_at: Date | string;
  source_type: string;
  source_id: string;
  payload: unknown;
};

function publicEvent(r: StoredPublicEvent): PublicSystemEvent {
  const occurred =
    r.occurred_at instanceof Date ? r.occurred_at.toISOString() : new Date(r.occurred_at).toISOString();
  const payload =
    r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : {};
  return {
    event_key: r.event_key,
    event_type: r.event_type as PublicSystemEvent["event_type"],
    character: r.character as PublicSystemEvent["character"],
    occurred_at: occurred,
    source_type: r.source_type as PublicSystemEvent["source_type"],
    source_id: r.source_id,
    payload,
  };
}

export async function listPublicSystemEvents(limit = 20): Promise<PublicSystemEvent[]> {
  const take = Math.max(1, Math.min(PUBLIC_CAP, Math.round(Number(limit) || 20)));
  const sql = await db();
  const rows = await sql<StoredPublicEvent>`
    select event_key, event_type, character, occurred_at, source_type, source_id, payload
      from desk_system_events
     where public = true
     order by occurred_at desc, id desc
     limit ${take}
  `;
  return rows.map(publicEvent);
}

/**
 * Read-only Chamber history balanced by speaking character.
 *
 * A frequent SATOSHI milestone must not crowd real but intentionally sparse
 * WARDEN, ALCHEMIST, or SWEEP evidence out of the visible conversation.
 */
export async function listPublicChamberEvents(perCharacter = 5): Promise<PublicSystemEvent[]> {
  const each = Math.max(1, Math.min(5, Math.round(Number(perCharacter) || 5)));
  const sql = await db();
  const rows = await sql<StoredPublicEvent>`
    select event_key, event_type, character, occurred_at, source_type, source_id, payload
      from (
        select
          id,
          event_key,
          event_type,
          character,
          occurred_at,
          source_type,
          source_id,
          payload,
          row_number() over (partition by character order by occurred_at desc, id desc) as speaker_rank
        from desk_system_events
        where public = true
          and character in ('SATOSHI', 'WARDEN', 'ALCHEMIST', 'SWEEP')
      ) ranked
     where speaker_rank <= ${each}
     order by occurred_at desc, id desc
     limit ${each * 4}
  `;
  return rows.map(publicEvent);
}
