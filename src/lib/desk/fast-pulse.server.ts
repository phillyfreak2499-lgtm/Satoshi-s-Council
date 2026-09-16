import { interpretKalshiBook } from "./kalshi-book";
import type { DeskPulse } from "./server-engine";
import type { Snapshot } from "./types";

/**
 * Viewer-only fast lane.
 *
 * The Chair, seats and paper book never import this module. Their 4s research
 * cadence stays untouched. This exists only so the numbers viewers see are a
 * fresh projection of the SAME Kalshi order book the desk uses, rather than the
 * slower market-list summary fields that can trail the actual book by many cents.
 */
const CACHE_MS = 750;
const TIMEOUT_MS = 2_500;
const UA = "SatoshiCouncil/1.0 (paper research)";
const DEFAULT_KALSHI = "https://external-api.kalshi.com/trade-api/v2";
const KALSHI_HOSTS = new Set([
  DEFAULT_KALSHI,
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://api.kalshi.com/trade-api/v2",
]);
const COINBASE = "https://api.exchange.coinbase.com/products/BTC-USD/ticker";

type Cache = { ticker: string; at: number; value: DeskPulse };
let cache: Cache | null = null;
let inflight: { ticker: string; promise: Promise<DeskPulse> } | null = null;

function hostOf(snap: Snapshot): string {
  const h = String(snap.kalshi_host ?? "").replace(/\/$/, "");
  return KALSHI_HOSTS.has(h) ? h : DEFAULT_KALSHI;
}

async function json(url: string): Promise<{ body: unknown; fetchedAt: number }> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": UA },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const body = await r.json();
  return { body, fetchedAt: Date.now() };
}

function fallback(snap: Snapshot, spot: number | null, now: number): DeskPulse {
  return {
    as_of: snap.as_of,
    fetched_at: now,
    ticker: snap.ticker,
    spot,
    yes_bid: snap.yes_bid,
    yes_ask: snap.yes_ask,
    no_bid: snap.no_bid,
    no_ask: snap.no_ask,
    close_time: snap.close_time,
    strike: snap.strike,
    stale: true,
  };
}

export async function fetchFastPulse(snap: Snapshot): Promise<DeskPulse> {
  const now = Date.now();
  const ticker = snap.ticker;
  if (!ticker || !/^KXBTC15M-[A-Z0-9-]+$/.test(ticker)) return fallback(snap, null, now);

  if (cache?.ticker === ticker && now - cache.at < CACHE_MS) return cache.value;
  if (inflight?.ticker === ticker) return inflight.promise;

  const promise = (async (): Promise<DeskPulse> => {
    const host = hostOf(snap);
    const [bookResult, spotResult] = await Promise.allSettled([
      json(`${host}/markets/${encodeURIComponent(ticker)}/orderbook?depth=1`),
      json(COINBASE),
    ]);

    const spot = spotResult.status === "fulfilled"
      ? Number((spotResult.value.body as { price?: string })?.price)
      : NaN;
    const cleanSpot = Number.isFinite(spot) && spot > 0 ? spot : null;

    // The order book is the source of truth for the displayed contract quote.
    // If it fails, mark the pulse stale so clients fall back to the full frame;
    // never substitute a market-list summary and make a lagging quote look live.
    if (bookResult.status !== "fulfilled") return fallback(snap, cleanSpot, Date.now());

    const q = interpretKalshiBook(bookResult.value.body, {
      yes_bid: snap.yes_bid,
      yes_ask: snap.yes_ask,
      no_bid: snap.no_bid,
      no_ask: snap.no_ask,
    });
    const valid = q.yes_bid > 0 && q.yes_ask > 0 && q.no_bid > 0 && q.no_ask > 0;
    if (!valid) return fallback(snap, cleanSpot, Date.now());

    const fetchedAt = Math.max(
      bookResult.value.fetchedAt,
      spotResult.status === "fulfilled" ? spotResult.value.fetchedAt : 0,
    );
    return {
      as_of: bookResult.value.fetchedAt,
      fetched_at: fetchedAt,
      ticker,
      spot: cleanSpot,
      yes_bid: q.yes_bid,
      yes_ask: q.yes_ask,
      no_bid: q.no_bid,
      no_ask: q.no_ask,
      close_time: snap.close_time,
      strike: snap.strike,
      stale: false,
    };
  })();

  inflight = { ticker, promise };
  try {
    const value = await promise;
    // Cache only fresh orderbook reads. A failure should be retried on the next
    // viewer request rather than held for the cache window.
    if (!value.stale) cache = { ticker, at: Date.now(), value };
    return value;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

/** Test/reset hook. No production consumer needs it. */
export function resetFastPulseCache(): void {
  cache = null;
  inflight = null;
}
