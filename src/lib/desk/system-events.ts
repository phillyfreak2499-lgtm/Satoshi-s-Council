/**
 * Phase 1A — structured system-event types and identity authority.
 *
 * Pure. No DB, no Chair, no learner, no Floor. The server writer
 * (system-events.server.ts) is the only module allowed to persist a row.
 *
 * PIT CREW is a presentation group for WARDEN + WRENCH + SWEEP + COACH.
 * It is reserved on the public Board so nobody can wear the group name,
 * but it is not a persisted event author.
 */

export const SYSTEM_CHARACTERS = [
  "SATOSHI",
  "ALCHEMIST",
  "WARDEN",
  "WRENCH",
  "SWEEP",
  "COACH",
  "DESK",
] as const;

export type SystemCharacter = (typeof SYSTEM_CHARACTERS)[number];

export const SYSTEM_EVENT_TYPES = [
  "CHAIR_DIRECTIONAL",
  "CHAIR_WAIT_MILESTONE",
  "EXPERIMENT_STARTED",
  "EXPERIMENT_EVIDENCE_MILESTONE",
  "EXPERIMENT_REVIEW_READY",
  "EXPERIMENT_REJECTED",
  "EXPERIMENT_INCONCLUSIVE",
  "SYSTEM_HEALTH_ALERT",
  "SYSTEM_HEALTH_RECOVERED",
  "DESK_UPDATE",
] as const;

export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

/** Allowed source kinds — enough to trace, not a second product surface. */
export const SYSTEM_SOURCE_TYPES = [
  "ticker",
  "window",
  "candidate",
  "experiment",
  "health",
  "desk_update",
  "board",
  "desk_state",
] as const;

export type SystemSourceType = (typeof SYSTEM_SOURCE_TYPES)[number];

export const PIT_CREW_MEMBERS = ["WARDEN", "WRENCH", "SWEEP", "COACH"] as const;

/** Names a public Board poster may not wear. Compared case-insensitively. */
export const RESERVED_BOARD_IDENTITIES = [
  "SATOSHI",
  "ALCHEMIST",
  "THE ALCHEMIST",
  "WARDEN",
  "WRENCH",
  "SWEEP",
  "COACH",
  "DESK",
  "PIT CREW",
  "PIT_CREW",
] as const;

const CHAR_SET = new Set<string>(SYSTEM_CHARACTERS);
const TYPE_SET = new Set<string>(SYSTEM_EVENT_TYPES);
const SOURCE_SET = new Set<string>(SYSTEM_SOURCE_TYPES);

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PAYLOAD_MAX = 8192;

export type SystemEventInput = {
  event_key: string;
  event_type: string;
  character: string;
  occurred_at: Date | string | number;
  source_type: string;
  source_id: string;
  payload?: unknown;
  public?: boolean;
};

export type SystemEventRecord = {
  event_key: string;
  event_type: SystemEventType;
  character: SystemCharacter;
  occurred_at: Date;
  source_type: SystemSourceType;
  source_id: string;
  payload: Record<string, unknown>;
  public: boolean;
};

export type RecordEventResult = {
  inserted: boolean;
  event_key: string;
  event_type: SystemEventType;
  character: SystemCharacter;
  public: boolean;
};

export type PublicSystemEvent = {
  event_key: string;
  event_type: SystemEventType;
  character: SystemCharacter;
  occurred_at: string;
  source_type: SystemSourceType;
  source_id: string;
  payload: Record<string, unknown>;
};

export function isSystemCharacter(v: string): v is SystemCharacter {
  return CHAR_SET.has(v);
}

export function isSystemEventType(v: string): v is SystemEventType {
  return TYPE_SET.has(v);
}

export function isSystemSourceType(v: string): v is SystemSourceType {
  return SOURCE_SET.has(v);
}

/** Fold Board display names for reservation checks. */
export function normalizeBoardWho(who: string): string {
  return String(who ?? "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function isReservedBoardIdentity(who: string): boolean {
  const n = normalizeBoardWho(who);
  if (!n) return false;
  for (const reserved of RESERVED_BOARD_IDENTITIES) {
    if (normalizeBoardWho(reserved) === n) return true;
  }
  return false;
}

/**
 * Public Board posters may not wear a canonical character or the Pit Crew
 * group label.
 *
 * The one Board-POST exception is a valid admin kind:update wearing DESK —
 * the legacy changelog voice. SATOSHI / ALCHEMIST / pit-crew names stay
 * rejected even with the admin key. Direct syncUpdates / weeklyRecap
 * inserts do not go through this function.
 */
export function assertPublicBoardWho(who: string, adminDeskUpdate = false): void {
  if (adminDeskUpdate && normalizeBoardWho(who) === "DESK") return;
  if (isReservedBoardIdentity(who)) {
    throw new Error("That name is reserved for the desk.");
  }
}

function asOccurredAt(v: Date | string | number): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) throw new Error("occurred_at is not a real time");
  return d;
}

function hasDangerousKeys(value: unknown, depth = 0): boolean {
  if (value == null || typeof value !== "object" || depth > 6) return false;
  if (Array.isArray(value)) return value.some((item) => hasDangerousKeys(item, depth + 1));
  for (const key of Object.keys(value as object)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/** Structured JSON only. Drops functions; refuses prototype tricks and huge blobs. */
export function sanitizeEventPayload(payload: unknown): Record<string, unknown> {
  if (payload == null) return {};
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be a JSON object");
  }
  if (hasDangerousKeys(payload)) throw new Error("payload rejected");
  let raw: string;
  try {
    raw = JSON.stringify(payload);
  } catch {
    throw new Error("payload is not JSON-safe");
  }
  if (raw.length > PAYLOAD_MAX) throw new Error("payload too large");
  const parsed = JSON.parse(raw) as unknown;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload must be a JSON object");
  }
  if (hasDangerousKeys(parsed)) throw new Error("payload rejected");
  return parsed as Record<string, unknown>;
}

export function validateSystemEvent(input: SystemEventInput): SystemEventRecord {
  const event_key = String(input.event_key ?? "").trim();
  if (!KEY_RE.test(event_key)) throw new Error("event_key is not a valid logical id");
  if (!isSystemEventType(input.event_type)) throw new Error("event_type is not in the Phase 1A taxonomy");
  if (!isSystemCharacter(input.character)) throw new Error("character is not a canonical system identity");
  if (!isSystemSourceType(input.source_type)) throw new Error("source_type is not a known evidence kind");
  const source_id = String(input.source_id ?? "").trim();
  if (!source_id) throw new Error("source_id is required");
  if (source_id.length > 160) throw new Error("source_id is too long");
  return {
    event_key,
    event_type: input.event_type,
    character: input.character,
    occurred_at: asOccurredAt(input.occurred_at),
    source_type: input.source_type,
    source_id,
    payload: sanitizeEventPayload(input.payload),
    public: input.public === true,
  };
}
