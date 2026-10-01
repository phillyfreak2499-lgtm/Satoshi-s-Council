/** No wall-clock fallback may manufacture a contract from an expired ticker. */
export function recordedMarketIdentity(
  market: { ticker: string; close_time: number } | null | undefined,
  previous: { ticker: string; close_time: number } | null,
): { ticker: string; close_time: number } {
  for (const observed of [market, previous]) {
    if (observed?.ticker && Number.isFinite(observed.close_time) && observed.close_time > 0) {
      return { ticker: observed.ticker, close_time: observed.close_time };
    }
  }
  // Explicitly unknown, not a synthetic next quarter-hour or replacement ticker.
  return { ticker: "", close_time: 0 };
}
