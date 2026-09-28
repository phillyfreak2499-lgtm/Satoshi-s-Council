/**
 * Spot and perp signed trade-flow COLLECTOR (server only). Instrument first,
 * no decision use.
 *
 * WIRED, ENV-GATED, DEFAULT OFF. healthz kicks `ensureTradeFlow`; it returns
 * "disabled" unless RESEARCH_TRADE_FLOW_ENABLED=true (the literal string).
 *
 * READS the venues' free, public, unauthenticated recent-trades endpoints
 * (Coinbase Exchange BTC-USD; OKX BTC-USDT-SWAP), the same hosts the desk
 * already polls for prices; no key, no paid API. It pages back when a poll
 * does not reach the trades it saw last, a bounded number of pages, and
 * records a GAP if it still cannot. Also reads the engine's quote from the
 * frame it already published, at the fixed clocks, as the same-time price
 * control.
 *
 * WRITES only desk_research_flow_minutes (insert-once, per venue per sealed
 * minute) and desk_research_flow_marks (insert-once, per window per clock).
 *
 * COST. Two small GETs every 2 s (well under both venues' public limits),
 * a few hundred trades folded into a handful of in-memory buckets, and about
 * two row inserts a minute per venue.
 */
import { getSql } from "@/lib/db";
import { depthClockAt } from "./book-depth.ts";
import {
  FLOW_DEF, FLOW_VENUES, applyPoll, freshVenue, okxContractMatches, overlaps, parseCoinbaseTrades, parseOkxTrades, sealReady,
  type FlowMinute, type FlowVenue, type NormTrade, type Parsed, type VenueState,
} from "./trade-flow.ts";

export const TRADE_FLOW_POLL_MS = 2_000;
export const TRADE_FLOW_ENV_FLAG = "RESEARCH_TRADE_FLOW_ENABLED";
/** A minute is sealed only by a poll landing this long after its end. */
export const SEAL_LAG_MS = 10_000;
/** Older pages fetched per poll, at most, to close a continuity break. */
export const MAX_BACKFILL_PAGES = 5;
const FETCH_TIMEOUT_MS = 4_000;
const UA = "SatoshiCouncil/1.0 (paper research)";
const runningBuildSha = (): string => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

/** The only hosts this collector ever contacts: public market data. */
export const FLOW_HOSTS = Object.freeze(["api.exchange.coinbase.com", "www.okx.com"]);

type Api = { newest: string; older: (beforeId: number) => string; parse: (raw: unknown) => Parsed };
const API: Record<FlowVenue, Api> = {
  COINBASE_SPOT: {
    newest: "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000",
    older: (id) => `https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000&after=${id}`,
    parse: parseCoinbaseTrades,
  },
  OKX_PERP: {
    newest: "https://www.okx.com/api/v5/market/trades?instId=BTC-USDT-SWAP&limit=500",
    older: (id) => `https://www.okx.com/api/v5/market/history-trades?instId=BTC-USDT-SWAP&type=1&after=${id}&limit=100`,
    parse: (raw) => parseOkxTrades(raw),
  },
};
const OKX_INSTRUMENT = "https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP";

export type FetchJson = (url: string) => Promise<unknown>;
const fetchJson: FetchJson = async (url) => {
  if (!FLOW_HOSTS.includes(new URL(url).host)) throw new Error(`host not allowed: ${url}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": UA } });
    if (!res.ok) throw new Error(`${res.status} ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

export function tradeFlowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[TRADE_FLOW_ENV_FLAG] === "true";
}

type VenueRun = { vs: VenueState; halted: string | null; checked: boolean; written: number; errors: number; error: string | null };
type State = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  venues: Record<FlowVenue, VenueRun>;
  marks: { key: string; done: Set<number> } | null;
  marks_written: number;
  error: string | null;
};
const g = globalThis as typeof globalThis & { __tradeFlow__?: State };
const freshRun = (v: FlowVenue): VenueRun => ({ vs: freshVenue(v), halted: null, checked: v !== "OKX_PERP", written: 0, errors: 0, error: null });
const state = (): State => g.__tradeFlow__ ??= { timer: null, busy: false, venues: { COINBASE_SPOT: freshRun("COINBASE_SPOT"), OKX_PERP: freshRun("OKX_PERP") }, marks: null, marks_written: 0, error: null };

/** One venue poll: the newest page, then older pages until it reaches trades already seen (bounded). */
async function pollVenue(run: VenueRun, get: FetchJson, now: number): Promise<FlowMinute[]> {
  if (run.halted) return [];
  if (!run.checked) {
    if (!okxContractMatches(await get(OKX_INSTRUMENT))) { run.halted = "CONTRACT_SPEC_MISMATCH: BTC-USDT-SWAP ctVal is not the frozen 0.01 BTC"; return []; }
    run.checked = true;
  }
  const api = API[run.vs.venue];
  const first = api.parse(await get(api.newest));
  run.vs.counters.rejected += first.rejected;
  if (!first.trades.length) throw new Error("empty trades page");
  const all: NormTrade[] = [...first.trades];
  let overlapped = overlaps(run.vs, all);
  for (let page = 0; !overlapped && page < MAX_BACKFILL_PAGES; page += 1) {
    const oldest = all.reduce((a, t) => Math.min(a, t.id), Infinity);
    const older = api.parse(await get(api.older(oldest)));
    run.vs.counters.rejected += older.rejected;
    if (!older.trades.length) break;
    all.push(...older.trades);
    overlapped = overlaps(run.vs, older.trades);
  }
  applyPoll(run.vs, all, overlapped, now);
  return sealReady(run.vs, SEAL_LAG_MS);
}

async function writeMinutes(rows: readonly FlowMinute[]): Promise<number> {
  if (!rows.length) return 0;
  const sql = await getSql();
  let n = 0;
  for (const r of rows) {
    const out = await sql<{ ok: number }>`
      insert into desk_research_flow_minutes (venue, minute, def_version, complete, flags, n_buy, n_sell, buy_base, sell_base, buy_quote, sell_quote,
        open_px, close_px, high_px, low_px, max_trade_base, first_trade_id, last_trade_id, build_sha)
      values (${r.venue}, ${new Date(r.minute_ms).toISOString()}::timestamptz, ${r.def_version}, ${r.complete}, array(select jsonb_array_elements_text(${JSON.stringify(r.flags)}::jsonb)),
        ${r.n_buy}, ${r.n_sell}, ${r.buy_base}, ${r.sell_base}, ${r.buy_quote}, ${r.sell_quote},
        ${r.open_px}, ${r.close_px}, ${r.high_px}, ${r.low_px}, ${r.max_trade_base}, ${r.first_trade_id}, ${r.last_trade_id}, ${runningBuildSha()})
      on conflict (venue, minute) do nothing returning 1 as ok`;
    n += out.length;
  }
  return n;
}

/** The engine's quote at a fixed clock: the same-time price control. */
async function markTick(st: State, now: number): Promise<void> {
  const { getServerFrame } = await import("./server-engine");
  const snap = (await getServerFrame()).snap;
  if (!snap || snap.demo || !Number.isFinite(snap.close_time) || !Number.isFinite(snap.as_of) || snap.as_of >= snap.close_time) return;
  const clock = depthClockAt((snap.close_time - now) / 1000);
  if (clock == null) return;
  const key = `${snap.ticker}|${snap.close_time}`;
  if (!st.marks || st.marks.key !== key) st.marks = { key, done: new Set() };
  if (st.marks.done.has(clock)) return;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const sql = await getSql();
  const rows = await sql<{ ok: number }>`
    insert into desk_research_flow_marks (ticker, close_time, clock_secs, as_of, quote_age_ms, yes_bid, yes_ask, no_bid, no_ask, yes_mid, build_sha)
    values (${snap.ticker}, ${new Date(snap.close_time).toISOString()}::timestamptz, ${clock}, ${new Date(now).toISOString()}::timestamptz, ${Math.max(0, Math.round(now - snap.as_of))},
      ${num(snap.yes_bid)}, ${num(snap.yes_ask)}, ${num(snap.no_bid)}, ${num(snap.no_ask)}, ${num(snap.yes_mid)}, ${runningBuildSha()})
    on conflict (ticker, close_time, clock_secs) do nothing returning 1 as ok`;
  st.marks.done.add(clock);
  st.marks_written += rows.length;
}

/** One tick: both venues, then the price mark. Exported for the harness; the timer calls it. */
export async function tradeFlowTick(now: number = Date.now(), get: FetchJson = fetchJson): Promise<Record<FlowVenue, FlowMinute[]> | null> {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    const sealed = {} as Record<FlowVenue, FlowMinute[]>;
    await Promise.all(FLOW_VENUES.map(async (v) => {
      const run = st.venues[v];
      sealed[v] = [];
      try {
        sealed[v] = await pollVenue(run, get, now);
        run.written += await writeMinutes(sealed[v]);
        run.error = null;
      } catch (error) {
        run.errors += 1;
        run.error = error instanceof Error ? error.message : String(error);
      }
    }));
    try {
      await markTick(st, now);
      st.error = null;
    } catch (error) {
      st.error = error instanceof Error ? error.message : String(error);
    }
    return sealed;
  } finally {
    st.busy = false;
  }
}

export function ensureTradeFlow(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!tradeFlowEnabled(env)) return "disabled";
  const st = state();
  if (st.timer) return "already";
  st.timer = setInterval(() => void tradeFlowTick(), TRADE_FLOW_POLL_MS);
  st.timer.unref?.();
  return "started";
}

export function tradeFlowHealth() {
  const st = g.__tradeFlow__;
  const venue = (v: FlowVenue) => {
    const r = st?.venues[v];
    return r ? { halted: r.halted, written: r.written, errors: r.errors, error: r.error, last_poll_at: r.vs.lastPollAt, last_trade_id: r.vs.lastId, open_buckets: r.vs.buckets.size, ...r.vs.counters } : null;
  };
  return { env_flag: TRADE_FLOW_ENV_FLAG, enabled: tradeFlowEnabled(), running: !!st?.timer, def: FLOW_DEF.id, venues: { COINBASE_SPOT: venue("COINBASE_SPOT"), OKX_PERP: venue("OKX_PERP") }, marks_written: st?.marks_written ?? 0, error: st?.error ?? null, decision_use: "NONE" };
}
