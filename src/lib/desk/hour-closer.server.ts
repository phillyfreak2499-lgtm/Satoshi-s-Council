/**
 * The hourly closer (server only). A sidecar beside the 15-minute grader.
 *
 * Every few minutes it asks Kalshi's public, unsigned market list for hourly
 * KXBTCD contracts that have settled, and writes one WAIT sit per closed hour
 * into desk_hour_ledger. It is kicked from the health check the way the other
 * research observers are, runs on its own timer, swallows its own errors, and
 * has no path into the 15-minute floor: it never imports the engine, the
 * Chair, the learner, or the paper book, and it writes only its own table.
 * Re-running on the same hour writes nothing twice. Authority: none.
 */
import { HOUR_SERIES } from "./hour";
import { closeHourWindows, HOUR_CLOSER_EVERY_MS, HOUR_CLOSER_FIRST_DELAY_MS, HOUR_CLOSER_LOOKBACK_MS, type HourClose, type HourCloserPass } from "./hour-closer";
import type { HourMarketRow } from "./hour";

const KALSHI_HOSTS = [
  "https://external-api.kalshi.com/trade-api/v2",
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://api.kalshi.com/trade-api/v2",
];
const UA = "SatoshiCouncil/1.0 (paper research)";

type Closer = {
  timer: ReturnType<typeof setInterval> | null;
  first: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  lastRun: number | null;
  lastWrite: number | null;
  written: number;
  skipped: number;
  error: string | null;
};
const globalRef = globalThis as typeof globalThis & { __hourCloser__?: Closer };
const state = (): Closer => (globalRef.__hourCloser__ ??= { timer: null, first: null, busy: false, lastRun: null, lastWrite: null, written: 0, skipped: 0, error: null });

function buildSha(): string {
  const sha = String(process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}

/** Settled hourly contracts that closed since `sinceMs`, from the first public host that answers; null when none does. */
async function settledHourMarkets(sinceMs: number): Promise<HourMarketRow[] | null> {
  const minClose = Math.floor(sinceMs / 1000);
  for (const host of KALSHI_HOSTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6_000);
    try {
      const res = await fetch(`${host}/markets?series_ticker=${HOUR_SERIES}&status=settled&min_close_ts=${minClose}&limit=200`, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": UA },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { markets?: HourMarketRow[] };
      if (Array.isArray(json?.markets)) return json.markets;
    } catch {
      /* try the next host */
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

/** Write one sit for a closed hour. Nothing is written when the hour already has a row, on any rung. */
async function writeClose(row: HourClose): Promise<boolean> {
  const { getSql } = await import("@/lib/db");
  const db = await getSql();
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
  return written.length > 0;
}

/** One pass: read the settled record, grade each closed hour once, skip the unknown. Exported for the smoke; the timer calls it. */
export async function closeHoursOnce(now = Date.now()): Promise<HourCloserPass | null> {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    const markets = await settledHourMarkets(now - HOUR_CLOSER_LOOKBACK_MS);
    st.lastRun = now;
    if (!markets) {
      st.error = "the public settled record did not answer";
      return null;
    }
    const pass = closeHourWindows(markets, now);
    for (const row of pass.rows) {
      if (await writeClose(row)) {
        st.written += 1;
        st.lastWrite = Date.now();
      }
    }
    st.skipped += pass.skipped.length;
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
  st.first = setTimeout(() => void closeHoursOnce(), HOUR_CLOSER_FIRST_DELAY_MS);
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
    skipped: st.skipped,
    error: st.error,
  };
}
