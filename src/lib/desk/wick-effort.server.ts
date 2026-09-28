/**
 * Formalized-WICK SHADOW recorder (server only). Research, no decision use.
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureWickShadow`; it returns
 * "disabled" unless RESEARCH_WICK_SHADOW_ENABLED=true (the literal string).
 *
 * READS a copy of the frame the engine already published: the 1m spot
 * candles, the Chair's WICK row and the quote. It evaluates the frozen
 * WICK_EFFORT_RESULT_V1 predicate (wick-effort.ts) at the fixed clocks and
 * WRITES only desk_research_wick_shadow, one insert-once row per window per
 * clock. It never touches the WICK seat, its learner or the Chair.
 *
 * COST. The candles are already in memory; the predicate is a few dozen
 * arithmetic operations; four inserts per window.
 */
import { getSql } from "@/lib/db";
import { depthClockAt } from "./book-depth.ts";
import { EFFORT_RESULT, effortResult, type ShadowMarket, type WickSeatRead } from "./wick-effort.ts";
import type { Candle } from "./types.ts";

export const WICK_SHADOW_POLL_MS = 2_000;
export const WICK_SHADOW_ENV_FLAG = "RESEARCH_WICK_SHADOW_ENABLED";
/** An engine quote older than this is flagged. */
export const MAX_QUOTE_AGE_MS = 10_000;
const runningBuildSha = (): string => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

export function wickShadowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[WICK_SHADOW_ENV_FLAG] === "true";
}

type State = { timer: ReturnType<typeof setInterval> | null; busy: boolean; window: { key: string; done: Set<number> } | null; written: number; fired: number; error: string | null };
const g = globalThis as typeof globalThis & { __wickShadow__?: State };
const state = (): State => g.__wickShadow__ ??= { timer: null, busy: false, window: null, written: 0, fired: 0, error: null };

/** One poll. Exported for the harness; the timer calls it. */
export async function wickShadowTick(now: number = Date.now()) {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const snap = frame.snap;
    if (!snap || snap.demo || !Number.isFinite(snap.close_time) || !Number.isFinite(snap.as_of) || snap.as_of >= snap.close_time) return null;
    const clock = depthClockAt((snap.close_time - now) / 1000);
    if (clock == null) return null;
    const key = `${snap.ticker}|${snap.close_time}`;
    if (!st.window || st.window.key !== key) st.window = { key, done: new Set() };
    if (st.window.done.has(clock)) return null;
    const candles = structuredClone((snap.candles_1m ?? []) as Candle[]);
    const read = effortResult(candles, snap.as_of);
    const quoteAge = Math.max(0, Math.round(now - snap.as_of));
    if (quoteAge > MAX_QUOTE_AGE_MS) { read.quality.flags.push("ENGINE_QUOTE_OLD"); read.quality.clean = false; }
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const row = ((frame.chair?.rows ?? []) as Array<Record<string, unknown>>).find((r) => r.seat === "WICK");
    const wick: WickSeatRead = row ? { lean: String(row.lean), status: String(row.status), conf: num(row.conf), folded: row.folded === true } : null;
    const market: ShadowMarket = { yes_bid: num(snap.yes_bid), yes_ask: num(snap.yes_ask), no_bid: num(snap.no_bid), no_ask: num(snap.no_ask), yes_mid: num(snap.yes_mid), quote_age_ms: quoteAge };
    const sql = await getSql();
    const rows = await sql<{ ok: number }>`
      insert into desk_research_wick_shadow (ticker, close_time, clock_secs, as_of, def_version, clean, quality, label, stance, features, wick, market, build_sha)
      values (${snap.ticker}, ${new Date(snap.close_time).toISOString()}::timestamptz, ${clock}, ${new Date(snap.as_of).toISOString()}::timestamptz, ${EFFORT_RESULT.version},
        ${read.quality.clean}, ${JSON.stringify(read.quality)}::jsonb, ${read.label}, ${read.stance}, ${read.features == null ? null : JSON.stringify(read.features)}::jsonb,
        ${wick == null ? null : JSON.stringify(wick)}::jsonb, ${JSON.stringify(market)}::jsonb, ${runningBuildSha()})
      on conflict (ticker, close_time, clock_secs) do nothing returning 1 as ok`;
    st.window.done.add(clock);
    st.written += rows.length;
    if (read.stance) st.fired += 1;
    st.error = null;
    return { clock, ...read, wick, market };
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    st.busy = false;
  }
}

export function ensureWickShadow(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!wickShadowEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.timer = setInterval(() => void wickShadowTick(), WICK_SHADOW_POLL_MS);
  st.timer.unref?.();
  return "started";
}

export function wickShadowHealth() {
  const st = g.__wickShadow__;
  return { env_flag: WICK_SHADOW_ENV_FLAG, enabled: wickShadowEnabled(), running: !!st?.timer, def: EFFORT_RESULT.id, written: st?.written ?? 0, fired: st?.fired ?? 0, error: st?.error ?? null, decision_use: "NONE" };
}
