/**
 * KXBTC15M order-book depth COLLECTOR (server only). Instrument first, no
 * decision use.
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureBookDepth`; it returns
 * "disabled" unless RESEARCH_BOOK_DEPTH_ENABLED=true (the literal string).
 *
 * READS the Lab's rebuilt Kalshi book through `labBookDepth` (a copy: it
 * never subscribes, requests or mutates anything) and the engine's quote from
 * the frame it already published. WRITES only desk_research_book_depth: one
 * insert-once row per window at each fixed clock (T-600, 300, 180, 60), with
 * quality flags. A missing book is recorded as a missing book: collection
 * quality is the first deliverable.
 */
import { getSql } from "@/lib/db";
import { depthClockAt, depthSnapshot, type BookRead, type DepthSnapshot, type EngineQuote } from "./book-depth.ts";

export const BOOK_DEPTH_POLL_MS = 2_000;
export const BOOK_DEPTH_ENV_FLAG = "RESEARCH_BOOK_DEPTH_ENABLED";
/** An engine quote older than this at snapshot time is flagged. */
export const MAX_QUOTE_AGE_MS = 10_000;
const runningBuildSha = (): string => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

export function bookDepthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[BOOK_DEPTH_ENV_FLAG] === "true";
}

type State = { timer: ReturnType<typeof setInterval> | null; busy: boolean; window: { key: string; done: Set<number>; last: DepthSnapshot | null } | null; written: number; missing: number; error: string | null };
const g = globalThis as typeof globalThis & { __bookDepth__?: State };
const state = (): State => g.__bookDepth__ ??= { timer: null, busy: false, window: null, written: 0, missing: 0, error: null };

/** One poll. Exported for the harness; the timer calls it. */
export async function bookDepthTick(now: number = Date.now()): Promise<DepthSnapshot | null> {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const snap = frame.snap;
    if (!snap || snap.demo || !Number.isFinite(snap.close_time) || !Number.isFinite(snap.as_of) || snap.as_of >= snap.close_time) return null;
    const secsLeft = (snap.close_time - now) / 1000;
    const clock = depthClockAt(secsLeft);
    if (clock == null) return null;
    const key = `${snap.ticker}|${snap.close_time}`;
    if (!st.window || st.window.key !== key) st.window = { key, done: new Set(), last: null };
    const w = st.window;
    if (w.done.has(clock)) return null;
    const { labBookDepth } = await import("./lab.server");
    const book = labBookDepth(snap.ticker) as BookRead | null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const quote: EngineQuote = {
      ticker: snap.ticker, as_of: now, close_time: snap.close_time, yes_bid: num(snap.yes_bid), yes_ask: num(snap.yes_ask), no_bid: num(snap.no_bid), no_ask: num(snap.no_ask),
      yes_mid: num(snap.yes_mid), quote_seq: num(snap.quote_seq),
    };
    const shot = depthSnapshot(clock, quote, book, w.last);
    if (now - snap.as_of > MAX_QUOTE_AGE_MS) { shot.quality.flags.push("ENGINE_QUOTE_OLD"); shot.quality.clean = false; }
    const sql = await getSql();
    const rows = await sql<{ ok: number }>`
      insert into desk_research_book_depth (ticker, close_time, clock_secs, as_of, secs_left, clean, quality, features, levels, market, build_sha)
      values (${shot.ticker}, ${new Date(shot.close_ms).toISOString()}::timestamptz, ${clock}, ${new Date(now).toISOString()}::timestamptz, ${shot.secs_left},
        ${shot.quality.clean}, ${JSON.stringify(shot.quality)}::jsonb, ${shot.features == null ? null : JSON.stringify(shot.features)}::jsonb,
        ${shot.levels == null ? null : JSON.stringify(shot.levels)}::jsonb, ${JSON.stringify(shot.market)}::jsonb, ${runningBuildSha()})
      on conflict (ticker, close_time, clock_secs) do nothing returning 1 as ok`;
    w.done.add(clock);
    w.last = shot;
    st.written += rows.length;
    if (!book) st.missing += 1;
    st.error = null;
    return shot;
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    st.busy = false;
  }
}

export function ensureBookDepth(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!bookDepthEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.timer = setInterval(() => void bookDepthTick(), BOOK_DEPTH_POLL_MS);
  st.timer.unref?.();
  return "started";
}

export function bookDepthHealth() {
  const st = g.__bookDepth__;
  return { env_flag: BOOK_DEPTH_ENV_FLAG, enabled: bookDepthEnabled(), running: !!st?.timer, written: st?.written ?? 0, book_missing: st?.missing ?? 0, error: st?.error ?? null, decision_use: "NONE" };
}
