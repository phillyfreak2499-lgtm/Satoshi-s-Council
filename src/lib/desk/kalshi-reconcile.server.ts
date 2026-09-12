/**
 * S2-7 — independent historical reconciliation, server runner (read-only).
 *
 * The judgement lives in the pure kalshi-reconcile.ts; this file is only the two
 * I/O edges it needs: a read-only SELECT of desk_ledger windows, and an
 * independent public Kalshi market GET. It performs NO writes (no INSERT/UPDATE/
 * DELETE/ALTER), imports no seat/Chair/learner/decision module, and adds no order
 * or auth path. The external truth comes exclusively from the Kalshi public
 * market-data endpoints — never from a desk_ledger field.
 */
// Relative import (not the usual `@/lib/db`) on purpose: the read-only audit CLI
// (scripts/reconcile-kalshi.ts) loads this module under `node --experimental-strip-types`,
// which resolves relative `.ts` paths but not the tsconfig `@/` alias. Same target
// (src/lib/db.ts); Vite and tsc resolve it identically.
import { getSql } from "../db.ts";
import {
  type FetchDeps,
  type FetchOutcome,
  type FetchPacing,
  type LedgerWindow,
  type MarketAttempt,
  type OfficialMarket,
  type ReconReport,
  classifyHttpStatus,
  fetchMarketViaHosts,
  RECONCILE_CONCURRENCY_DEFAULT,
  reconcileWindows,
  summarize,
} from "./kalshi-reconcile.ts";

/** Public Kalshi market-data hosts, in failover order. No credentials: market data
 *  is public, and a historical reconciliation must not require trading auth. */
const KALSHI_HOSTS = [
  "https://external-api.kalshi.com/trade-api/v2",
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://api.kalshi.com/trade-api/v2",
];
const UA = "SatoshiCouncil/1.0 (paper research reconciliation)";

const DEFAULT_TIMEOUT_MS = 4500;
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * ONE real HTTP attempt against `url`, mapped to a MarketAttempt for the pure
 * orchestrator. 404 → `not_found` (rotate hosts, never backed off); 429/5xx/
 * timeout/network/malformed → `retryable` (429 carries a parsed `Retry-After`);
 * 200 with a market object → `ok`. Never throws — a thrown fetch is `retryable`.
 * Exactly the same exact endpoint as before: `/markets/{ticker}`.
 */
async function httpAttempt(url: string, timeoutMs: number): Promise<MarketAttempt> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": UA } });
    // Status → attempt is the pure classifier: 404 → not_found; 429 OR any 5xx →
    // retryable carrying the parsed Retry-After (honored for BOTH, not just 429);
    // any other non-ok → fatal. A 2xx returns null so we read the body below.
    const byStatus = classifyHttpStatus(res.status, res.ok, res.headers.get("retry-after"), Date.now());
    if (byStatus) return byStatus;
    const json = (await res.json()) as { market?: Record<string, unknown> };
    const market = json?.market;
    if (!market || typeof market !== "object") return { status: "retryable", retryAfterMs: null }; // malformed
    return { status: "ok", market: market as OfficialMarket };
  } catch {
    return { status: "retryable", retryAfterMs: null }; // timeout / network
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch ONE market by exact ticker from the public API — conservatively. The
 * judgement (bounded attempt budget, host rotation, backoff, `Retry-After`) lives in
 * the pure `fetchMarketViaHosts`; this wrapper only injects the real HTTP attempt and
 * a real sleep. A 404 is `not_found`; an exhausted budget is `unavailable` — never a
 * mismatch. `attempt`/`sleep` are injectable so tests drive it without the network or
 * real waiting.
 */
export async function kalshiFetchMarket(
  ticker: string,
  opts: { timeoutMs?: number; attempt?: FetchDeps["attempt"]; sleep?: FetchDeps["sleep"] } & FetchPacing = {},
): Promise<FetchOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempt = opts.attempt ?? ((url: string) => httpAttempt(url, timeoutMs));
  const sleep = opts.sleep ?? realSleep;
  return fetchMarketViaHosts(KALSHI_HOSTS, ticker, { attempt, sleep }, opts);
}

/** Read-only SELECT of the windows to audit. `winner` and `official_value` are the
 *  internal side being audited; they are NEVER used as the external truth. */
export async function selectLedgerWindows(days = 90): Promise<LedgerWindow[]> {
  const db = await getSql();
  const rows = await db<{ ticker: string; ms: number; winner: string; official_value: number | null }>`
    select ticker,
           (extract(epoch from close_time) * 1000)::bigint as ms,
           winner,
           official_value
      from desk_ledger
     where close_time > now() - (${days}::text || ' days')::interval
     order by close_time
  `;
  return rows.map((r) => ({
    ticker: r.ticker,
    close_time_ms: Number(r.ms),
    winner: r.winner,
    official_value: r.official_value == null ? null : Number(r.official_value),
  }));
}

/**
 * Run the independent reconciliation over the requested window. SELECT + external
 * GET only. `fetchMarket` is injectable so tests drive it with fixtures and the
 * live path stays the one public client above. The `ReconReport` shape and its
 * renderer live in the pure module.
 */
export async function runReconciliation(
  opts: { days?: number; concurrency?: number; delayMs?: number; fetchMarket?: (t: string) => Promise<FetchOutcome> } = {},
): Promise<ReconReport> {
  const days = opts.days ?? 90;
  const rows = await selectLedgerWindows(days);
  // Conservative by default: sequential (concurrency 1) with inter-market spacing, so
  // a bulk run never bursts into Kalshi's rate limiter. Callers may override.
  const results = await reconcileWindows(rows, opts.fetchMarket ?? kalshiFetchMarket, {
    concurrency: opts.concurrency ?? RECONCILE_CONCURRENCY_DEFAULT,
    delayMs: opts.delayMs,
  });
  const closes = rows.map((r) => r.close_time_ms).filter((n) => Number.isFinite(n));
  return {
    period_days: days,
    earliest_ms: closes.length ? Math.min(...closes) : null,
    latest_ms: closes.length ? Math.max(...closes) : null,
    summary: summarize(results),
    results,
  };
}
