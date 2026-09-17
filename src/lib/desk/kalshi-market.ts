import { tickerCloseMs } from "./window-identity";

export type OpenKalshiMarket = {
  ticker?: unknown;
  close_time?: unknown;
  expiration_time?: unknown;
  [key: string]: unknown;
};

/**
 * Pick the nearest internally consistent KXBTC15M market that has not closed.
 *
 * Kalshi can briefly keep the just-expired contract in status=open. Never turn
 * that stale ticker into a future window: the ticker and provider close time
 * must identify the same instant before the market may feed the desk.
 */
export function selectOpenKalshiMarket<T extends OpenKalshiMarket>(
  rows: readonly T[] | undefined,
  now = Date.now(),
): T | null {
  const valid = (rows ?? []).flatMap((row) => {
    const ticker = String(row.ticker ?? "");
    const providerClose = Date.parse(String(row.close_time ?? row.expiration_time ?? ""));
    const encodedClose = tickerCloseMs(ticker);
    if (!ticker.startsWith("KXBTC15M-") || !Number.isFinite(providerClose) || encodedClose == null) return [];
    if (Math.abs(encodedClose - providerClose) > 1_000) return [];
    if (providerClose <= now) return [];
    return [{ row, providerClose }];
  });
  valid.sort((a, b) => a.providerClose - b.providerClose);
  return valid[0]?.row ?? null;
}
