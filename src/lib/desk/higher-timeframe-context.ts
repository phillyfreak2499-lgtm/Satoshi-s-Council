/**
 * Decision-time higher-timeframe context (pure; measurement only).
 *
 * This calculator turns the hourly candles already present on a finalized
 * Snapshot into compact 4-hour and 24-hour facts. It has no imports, clock,
 * feed, database, seat, Chair, threshold, or prediction. The decision-snapshot
 * writer is the only intended production caller, so these values can be studied
 * beside a later grade without entering the live decision path.
 */

export const HIGHER_TIMEFRAME_CONTEXT_VERSION = "higher-context-1";

const HOUR_MS = 60 * 60_000;
const MAX_FRESH_AGE_MS = 90 * 60_000;
const MAX_HOURLY_GAP_MS = 90 * 60_000;

export type HigherTimeframeCandle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closed?: boolean;
  source?: string;
};

export type HigherTimeframeContextInput = {
  as_of_ms: number;
  spot: number;
  ret_15m: number;
  ret_30m: number;
  ret_1h: number;
  candles_1h: readonly HigherTimeframeCandle[];
};

export type HigherTimeframeCoverage = {
  bars: number;
  span_ms: number | null;
  max_gap_ms: number | null;
  complete: boolean;
};

export type HigherTimeframeRange = {
  low: number | null;
  high: number | null;
  position: number | null;
};

export type HigherTimeframeContext = {
  version: typeof HIGHER_TIMEFRAME_CONTEXT_VERSION;
  authority: "measurement";
  quality: "complete" | "partial" | "unavailable";
  n_1h: number;
  sources: string[];
  latest_open_ms: number | null;
  latest_age_s: number | null;
  latest_closed: boolean | null;
  returns: {
    ret_15m: number | null;
    ret_30m: number | null;
    ret_1h: number | null;
    ret_4h: number | null;
    ret_24h: number | null;
  };
  ranges: {
    h4: HigherTimeframeRange;
    h24: HigherTimeframeRange;
  };
  coverage: {
    h4: HigherTimeframeCoverage;
    h24: HigherTimeframeCoverage;
  };
};

type CleanCandle = Required<Pick<HigherTimeframeCandle, "t" | "open" | "high" | "low" | "close">> & {
  closed: boolean | null;
  source: string;
};

type WindowMeasurement = {
  ret: number | null;
  range: HigherTimeframeRange;
  coverage: HigherTimeframeCoverage;
};

const EMPTY_RANGE: HigherTimeframeRange = { low: null, high: null, position: null };
const EMPTY_COVERAGE: HigherTimeframeCoverage = {
  bars: 0,
  span_ms: null,
  max_gap_ms: null,
  complete: false,
};

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanCandles(rows: readonly HigherTimeframeCandle[], asOf: number): CleanCandle[] {
  const byOpen = new Map<number, CleanCandle>();
  for (const row of rows ?? []) {
    const t = finite(row?.t);
    const open = finite(row?.open);
    const high = finite(row?.high);
    const low = finite(row?.low);
    const close = finite(row?.close);
    if (
      t == null ||
      t <= 0 ||
      t > asOf ||
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < low
    ) {
      continue;
    }
    byOpen.set(t, {
      t,
      open,
      high,
      low,
      close,
      closed: typeof row.closed === "boolean" ? row.closed : null,
      source: typeof row.source === "string" ? row.source : "",
    });
  }
  return [...byOpen.values()].sort((a, b) => a.t - b.t);
}

function measureWindow(
  rows: readonly CleanCandle[],
  asOf: number,
  spot: number,
  hours: 4 | 24,
  latestAgeMs: number,
): WindowMeasurement {
  const target = asOf - hours * HOUR_MS;
  let anchor = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]!.t <= target) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) {
    return { ret: null, range: { ...EMPTY_RANGE }, coverage: { ...EMPTY_COVERAGE } };
  }

  const window = rows.slice(anchor);
  const spanMs = asOf - window[0]!.t;
  let maxGapMs = 0;
  for (let i = 1; i < window.length; i += 1) {
    maxGapMs = Math.max(maxGapMs, window[i]!.t - window[i - 1]!.t);
  }

  const low = Math.min(spot, ...window.map((c) => c.low));
  const high = Math.max(spot, ...window.map((c) => c.high));
  const position = high > low ? (spot - low) / (high - low) : 0.5;
  const base = window[0]!.open;
  const expectedBars = hours + 1;
  const complete =
    latestAgeMs <= MAX_FRESH_AGE_MS &&
    spanMs >= hours * HOUR_MS &&
    spanMs < (hours + 1) * HOUR_MS &&
    window.length >= expectedBars &&
    maxGapMs <= MAX_HOURLY_GAP_MS;

  return {
    ret: (spot - base) / base,
    range: { low, high, position },
    coverage: { bars: window.length, span_ms: spanMs, max_gap_ms: maxGapMs, complete },
  };
}

/**
 * Measure 4-hour and 24-hour context using only values available at `as_of_ms`.
 * Future-stamped candles are ignored. A horizon is `complete` only when it has
 * its anchor, the expected hourly bar count, no >90-minute gap, and a fresh
 * latest bar; otherwise the numeric facts remain useful but are marked partial.
 */
export function measureHigherTimeframeContext(
  input: HigherTimeframeContextInput,
): HigherTimeframeContext {
  const asOf = finite(input.as_of_ms);
  const spot = finite(input.spot);
  const empty = (): HigherTimeframeContext => ({
    version: HIGHER_TIMEFRAME_CONTEXT_VERSION,
    authority: "measurement",
    quality: "unavailable",
    n_1h: 0,
    sources: [],
    latest_open_ms: null,
    latest_age_s: null,
    latest_closed: null,
    returns: {
      ret_15m: finite(input.ret_15m),
      ret_30m: finite(input.ret_30m),
      ret_1h: finite(input.ret_1h),
      ret_4h: null,
      ret_24h: null,
    },
    ranges: { h4: { ...EMPTY_RANGE }, h24: { ...EMPTY_RANGE } },
    coverage: { h4: { ...EMPTY_COVERAGE }, h24: { ...EMPTY_COVERAGE } },
  });

  if (asOf == null || asOf <= 0 || spot == null || spot <= 0) return empty();
  const rows = cleanCandles(input.candles_1h ?? [], asOf);
  if (!rows.length) return empty();

  const latest = rows.at(-1)!;
  const latestAgeMs = asOf - latest.t;
  const h4 = measureWindow(rows, asOf, spot, 4, latestAgeMs);
  const h24 = measureWindow(rows, asOf, spot, 24, latestAgeMs);
  const quality = h4.coverage.complete && h24.coverage.complete ? "complete" : "partial";

  return {
    version: HIGHER_TIMEFRAME_CONTEXT_VERSION,
    authority: "measurement",
    quality,
    n_1h: rows.length,
    sources: [...new Set(rows.map((c) => c.source).filter(Boolean))].sort(),
    latest_open_ms: latest.t,
    latest_age_s: latestAgeMs / 1000,
    latest_closed: latest.closed,
    returns: {
      ret_15m: finite(input.ret_15m),
      ret_30m: finite(input.ret_30m),
      ret_1h: finite(input.ret_1h),
      ret_4h: h4.ret,
      ret_24h: h24.ret,
    },
    ranges: { h4: h4.range, h24: h24.range },
    coverage: { h4: h4.coverage, h24: h24.coverage },
  };
}
