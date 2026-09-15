const WINDOW_MS = 15 * 60 * 1000;

export function streamMillis(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}

/** Presentation only: never carry a prior window or a future candle into the trace. */
export function streamPoints(
  input: {
    closeTime: number;
    asOf: number;
    spot: number;
    candles: Array<{ t: number; close: number }>;
  },
  includeSpot: boolean,
): Array<{ progress: number; price: number }> {
  const close = streamMillis(input.closeTime);
  const open = close - WINDOW_MS;
  const now = streamMillis(input.asOf);
  if (!close || now < open || now > close) return [];
  const prices = new Map<number, number>();
  for (const candle of input.candles) {
    const time = streamMillis(candle.t);
    if (time >= open && time <= now && Number.isFinite(candle.close) && candle.close > 0) {
      prices.set(time, candle.close);
    }
  }
  if (includeSpot && Number.isFinite(input.spot) && input.spot > 0) prices.set(now, input.spot);
  return [...prices]
    .sort(([a], [b]) => a - b)
    .map(([time, price]) => ({
      progress: (time - open) / WINDOW_MS,
      price,
    }));
}
