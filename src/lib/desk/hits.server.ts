/**
 * First-party traffic counts (server only): a handful of named events,
 * counted in memory and flushed to Postgres every thirty seconds as one
 * row per Chicago day and event. No IPs, no user agents, no cookies, no
 * people — just enough to know whether anyone is in the room.
 */
async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

export const HIT_EVENTS = [
  "room_view",
  "desk_view",
  "lock",
  "tour_start",
  "tour_done",
  "gloss_open",
  "welcome_tour",
  "welcome_floor",
  "palette_open",
  "share",
  "settle_alert",
] as const;
export type HitEvent = (typeof HIT_EVENTS)[number];
const EVENTS = new Set<string>(HIT_EVENTS);
const FLUSH_MS = 30_000;

const H: { pending: Map<string, number>; timer: ReturnType<typeof setTimeout> | null; lastError: string | null; hooked: boolean } = {
  pending: new Map(),
  timer: null,
  lastError: null,
  hooked: false,
};

export function isHitEvent(v: unknown): v is HitEvent {
  return typeof v === "string" && EVENTS.has(v);
}

/** Count one event. Cheap and synchronous; the write happens later. */
export function hit(event: string, n = 1): void {
  if (!EVENTS.has(event) || !(n > 0)) return;
  H.pending.set(event, (H.pending.get(event) ?? 0) + n);
  if (!H.timer) {
    H.timer = setTimeout(() => void flushHits(), FLUSH_MS);
    H.timer.unref?.();
  }
  if (!H.hooked) {
    H.hooked = true;
    process.once("SIGTERM", () => void flushHits());
  }
}

export async function flushHits(): Promise<void> {
  if (H.timer) {
    clearTimeout(H.timer);
    H.timer = null;
  }
  if (!H.pending.size) return;
  const batch = [...H.pending];
  H.pending.clear();
  try {
    const db = await sql();
    for (const [event, n] of batch) {
      await db`
        insert into desk_hits (day, event, n)
        values ((now() at time zone 'America/Chicago')::date, ${event}, ${n})
        on conflict (day, event) do update set n = desk_hits.n + excluded.n
      `;
    }
    H.lastError = null;
  } catch (err) {
    for (const [event, n] of batch) H.pending.set(event, (H.pending.get(event) ?? 0) + n);
    H.lastError = err instanceof Error ? err.message : String(err);
    if (!H.timer) {
      H.timer = setTimeout(() => void flushHits(), FLUSH_MS * 2);
      H.timer.unref?.();
    }
  }
}

export type HitsDay = { day: string; events: Record<string, number> };
export type HitsSummary = { days: HitsDay[]; totals: Record<string, number>; last_error: string | null };

/** The last N Chicago days, newest first, plus totals. Flushes first so today is current. */
export async function hitsSummary(days = 7): Promise<HitsSummary> {
  await flushHits();
  const db = await sql();
  const rows = await db<{ day: string; event: string; n: number }>`
    select day::text as day, event, n
      from desk_hits
     where day > (now() at time zone 'America/Chicago')::date - ${days}::int
     order by day desc, event
  `;
  const byDay = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const d = byDay.get(r.day) ?? {};
    d[r.event] = (d[r.event] ?? 0) + r.n;
    byDay.set(r.day, d);
    totals[r.event] = (totals[r.event] ?? 0) + r.n;
  }
  return { days: [...byDay].map(([day, events]) => ({ day, events })), totals, last_error: H.lastError };
}
