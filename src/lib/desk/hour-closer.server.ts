/**
 * The hourly closer (server only). A sidecar beside the 15-minute grader.
 *
 * Every few minutes it names each hour that closed inside the lookback, reads
 * that hour's whole KXBTCD ladder from Kalshi's public, unsigned market list
 * (one event at a time, every page), and writes one WAIT sit per closed hour
 * into desk_hour_ledger on the rung nearest the official close. It is kicked
 * from the health check the way the other research observers are, runs on
 * its own timer, swallows its own errors, and has no path into the 15-minute
 * floor: it never imports the engine, the Chair, the learner, or the paper
 * book, and it writes only its own table. Re-running on the same hour writes
 * nothing twice; a sit already stored on a wrong rung for that hour is moved
 * to the right one, still a WAIT, still with no fill. Authority: none.
 */
import { HOUR_DAYS } from "./hour";
import {
  closeHourLadder,
  HOUR_CLOSER_EVERY_MS,
  HOUR_CLOSER_FIRST_DELAY_MS,
  HOUR_CLOSER_LOOKBACK_MS,
  hourEventsInLookback,
  hourEventTicker,
  type HourClose,
  type HourEvent,
  type HourLadder,
  type HourSkip,
} from "./hour-closer";
import type { HourMarketRow } from "./hour";

const KALSHI_HOSTS = [
  "https://external-api.kalshi.com/trade-api/v2",
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://api.kalshi.com/trade-api/v2",
];
const UA = "SatoshiCouncil/1.0 (paper research)";
/** Kalshi's largest page; one hour's ladder fits in one, and the cursor is followed regardless. */
const PAGE = 1000;
const MAX_PAGES = 10;
/** The boot audit of stored sits is paced so it never bursts the public hosts. */
const AUDIT_SPACING_MS = 250;
const AUDIT_MAX_ROWS = 200;

type Closer = {
  timer: ReturnType<typeof setInterval> | null;
  first: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  lastRun: number | null;
  lastWrite: number | null;
  written: number;
  rewritten: number;
  skipped: number;
  audited: boolean;
  error: string | null;
};
const globalRef = globalThis as typeof globalThis & { __hourCloser__?: Closer };
const state = (): Closer =>
  (globalRef.__hourCloser__ ??= { timer: null, first: null, busy: false, lastRun: null, lastWrite: null, written: 0, rewritten: 0, skipped: 0, audited: false, error: null });

function buildSha(): string {
  const sha = String(process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}

async function page(host: string, eventTicker: string, cursor: string | null): Promise<{ markets: HourMarketRow[]; cursor: string | null } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const url = `${host}/markets?event_ticker=${encodeURIComponent(eventTicker)}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": UA } });
    if (!res.ok) return null;
    const json = (await res.json()) as { markets?: HourMarketRow[]; cursor?: unknown };
    if (!Array.isArray(json?.markets)) return null;
    const next = typeof json.cursor === "string" && json.cursor.trim() ? json.cursor : null;
    return { markets: json.markets, cursor: next };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * One hour's whole ladder: every market on the event, every page, from the
 * first public host whose first page answers. A page that fails leaves the
 * ladder marked incomplete, and an incomplete ladder is never graded.
 */
export async function eventLadder(eventTicker: string): Promise<HourLadder> {
  for (const host of KALSHI_HOSTS) {
    const first = await page(host, eventTicker, null);
    if (!first) continue;
    const markets = [...first.markets];
    let cursor = first.cursor;
    for (let i = 1; cursor && i < MAX_PAGES; i++) {
      const more = await page(host, eventTicker, cursor);
      if (!more) return { markets, complete: false };
      markets.push(...more.markets);
      cursor = more.cursor;
    }
    return { markets, complete: cursor == null };
  }
  return { markets: [], complete: false };
}

type WriteOutcome = "written" | "rewritten" | "kept";

/**
 * Write one sit for a closed hour. A sit already stored for that close on a
 * different rung is moved to the rung nearest the official close; its lean
 * stays WAIT and its fill columns stay null. A row that carries any fill is
 * never touched. A row already on the right rung is left alone.
 */
async function writeClose(row: HourClose): Promise<WriteOutcome> {
  const { getSql } = await import("@/lib/db");
  const db = await getSql();
  const moved = await db<{ id: number }>`
    update desk_hour_ledger
    set ticker = ${row.ticker}, event_ticker = ${row.event_ticker}, strike = ${row.strike}, question = ${row.question},
      result = ${row.result}, official_value = ${row.official_value}, source = ${row.source}, graded_at = now(), build_sha = ${buildSha()}
    where close_time = ${row.close_time}::timestamptz and ticker <> ${row.ticker}
      and entry_side is null and entry_cents is null and entry_fee_cents is null and settle_cents is null and ev_cents is null
    returning id
  `;
  if (moved.length) return "rewritten";
  const written = await db<{ id: number }>`
    insert into desk_hour_ledger
      (ticker, event_ticker, close_time, strike, question, chair_lean,
       entry_side, entry_cents, entry_fee_cents, settle_cents, ev_cents,
       result, official_value, source, graded_at, build_sha)
    select ${row.ticker}, ${row.event_ticker}, ${row.close_time}::timestamptz, ${row.strike}, ${row.question}, ${row.chair_lean},
      null, null, null, null, null,
      ${row.result}, ${row.official_value}, ${row.source}, now(), ${buildSha()}
    where not exists (select 1 from desk_hour_ledger h where h.close_time = ${row.close_time}::timestamptz)
    on conflict (ticker, close_time) do nothing
    returning id
  `;
  return written.length ? "written" : "kept";
}

export type HourCloserPass = { rows: HourClose[]; skipped: HourSkip[]; outcomes: Record<string, WriteOutcome> };

async function gradeHours(hours: HourEvent[], spacingMs = 0): Promise<HourCloserPass> {
  const st = state();
  const pass: HourCloserPass = { rows: [], skipped: [], outcomes: {} };
  for (const hour of hours) {
    if (spacingMs) await new Promise((r) => setTimeout(r, spacingMs));
    const outcome = closeHourLadder(hour, await eventLadder(hour.event_ticker));
    if (outcome.skip) {
      pass.skipped.push(outcome.skip);
      continue;
    }
    pass.rows.push(outcome.row);
    const wrote = await writeClose(outcome.row);
    pass.outcomes[hour.event_ticker] = wrote;
    if (wrote === "written") st.written += 1;
    if (wrote === "rewritten") st.rewritten += 1;
    if (wrote !== "kept") st.lastWrite = Date.now();
  }
  st.skipped += pass.skipped.length;
  return pass;
}

/** One pass: every hour closed inside the lookback, graded from its own whole ladder. The timer calls it; the smoke may too. */
export async function closeHoursOnce(now = Date.now()): Promise<HourCloserPass | null> {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    st.lastRun = now;
    const pass = await gradeHours(hourEventsInLookback(now));
    st.error = null;
    return pass;
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    st.busy = false;
  }
}

/**
 * Once per boot: revisit the sits already stored in the book's window and
 * move any that sit on a wrong rung. Reads its own table only; a row with a
 * fill is never a candidate. Paced, bounded, and never raced with a pass.
 */
export async function auditStoredSits(now = Date.now()): Promise<HourCloserPass | null> {
  const st = state();
  if (st.busy || st.audited) return null;
  st.busy = true;
  st.audited = true;
  try {
    const { getSql } = await import("@/lib/db");
    const db = await getSql();
    const stored = await db<{ close_time: Date | string }>`
      select close_time from desk_hour_ledger
      where entry_side is null and entry_cents is null and ev_cents is null
        and close_time > now() - (${HOUR_DAYS}::int * interval '1 day') and close_time <= now()
      order by close_time desc limit ${AUDIT_MAX_ROWS}
    `;
    const hours: HourEvent[] = stored
      .map((r) => (r.close_time instanceof Date ? r.close_time.getTime() : Date.parse(String(r.close_time))))
      .filter((ms) => Number.isFinite(ms) && ms <= now)
      .map((ms) => ({ event_ticker: hourEventTicker(ms), close_ms: ms, close_time: new Date(ms).toISOString() }));
    const pass = await gradeHours(hours, AUDIT_SPACING_MS);
    st.error = null;
    return pass;
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    st.busy = false;
  }
}

/** Idempotent boot. Kicked from the health check beside the other observers; never awaited by the floor. */
export function ensureHourCloser(): void {
  const st = state();
  if (st.timer) return;
  st.timer = setInterval(() => void closeHoursOnce(), HOUR_CLOSER_EVERY_MS);
  st.first = setTimeout(() => {
    void closeHoursOnce().then(() => auditStoredSits());
  }, HOUR_CLOSER_FIRST_DELAY_MS);
}

/** Read-only diagnostics for the closer; nothing here is a score. */
export function hourCloserStatus() {
  const st = state();
  return {
    started: Boolean(st.timer),
    every_ms: HOUR_CLOSER_EVERY_MS,
    lookback_ms: HOUR_CLOSER_LOOKBACK_MS,
    last_run: st.lastRun ? new Date(st.lastRun).toISOString() : null,
    last_write: st.lastWrite ? new Date(st.lastWrite).toISOString() : null,
    written: st.written,
    rewritten: st.rewritten,
    skipped: st.skipped,
    audited: st.audited,
    error: st.error,
  };
}
