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
import { getSql } from "@/lib/db";
import {
  type FetchOutcome,
  type LedgerWindow,
  type ReconResult,
  type ReconSummary,
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

/**
 * Fetch ONE market by exact ticker from the public API, with host failover. A 404
 * is `not_found`; any other HTTP/timeout/parse failure is `unavailable` — never a
 * mismatch. Returns the raw payload for the pure classifier to judge identity.
 */
export async function kalshiFetchMarket(ticker: string, timeoutMs = 4500): Promise<FetchOutcome> {
  let sawNotFound = false;
  for (const host of KALSHI_HOSTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}/markets/${encodeURIComponent(ticker)}`, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": UA },
      });
      if (res.status === 404) {
        sawNotFound = true;
        continue; // try the next host before concluding the market is absent
      }
      if (!res.ok) continue; // transport/5xx/429 → try next host
      const json = (await res.json()) as { market?: Record<string, unknown> };
      const market = json?.market;
      if (!market || typeof market !== "object") continue; // malformed → next host
      return { ok: true, market };
    } catch {
      // timeout/network → try next host
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, reason: sawNotFound ? "not_found" : "unavailable" };
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

export type ReconReport = {
  period_days: number;
  earliest_ms: number | null;
  latest_ms: number | null;
  summary: ReconSummary;
  results: ReconResult[];
};

/**
 * Run the independent reconciliation over the requested window. SELECT + external
 * GET only. `fetchMarket` is injectable so tests drive it with fixtures and the
 * live path stays the one public client above.
 */
export async function runReconciliation(
  opts: { days?: number; concurrency?: number; fetchMarket?: (t: string) => Promise<FetchOutcome> } = {},
): Promise<ReconReport> {
  const days = opts.days ?? 90;
  const rows = await selectLedgerWindows(days);
  const results = await reconcileWindows(rows, opts.fetchMarket ?? kalshiFetchMarket, {
    concurrency: opts.concurrency ?? 4,
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
