/**
 * One inventory of the information the desk already collects.
 *
 * This file grants no authority. It documents authority that exists elsewhere
 * and fails closed when an entry is inconsistent. Adding a row here cannot make
 * a seat speak, change a threshold, or expose a feature to either Chair.
 */
import type { EvidenceFamily } from "./seats";
import type { SeatId } from "./types";

export type FeatureAuthority = "live" | "shadow" | "measurement" | "retired";
export type FeatureTimeframe =
  | "tick"
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "window"
  | "session"
  | "daily";

export type FeatureRegistryEntry = {
  id: string;
  label: string;
  family: EvidenceFamily;
  owner: SeatId | null;
  source: string;
  timeframe: FeatureTimeframe;
  authority: FeatureAuthority;
  /**
   * True only when the production Council/Chair path is permitted to consume
   * this information today. The registry describes that permission; it never
   * creates it.
   */
  chair_visible: boolean;
  consumers: string[];
  stale_after_ms: number | null;
  version: number;
  note: string;
};

const f = (
  entry: Omit<FeatureRegistryEntry, "version"> & { version?: number },
): FeatureRegistryEntry => ({ ...entry, version: entry.version ?? 1 });

export const FEATURE_REGISTRY: readonly FeatureRegistryEntry[] = [
  f({ id: "spot.candles_1m", label: "BTC one-minute candles", family: "candle", owner: "WICK", source: "spot klines", timeframe: "1m", authority: "live", chair_visible: true, consumers: ["WICK", "PULSE", "WHALE", "VOLT"], stale_after_ms: 90_000, note: "Primary closed-candle structure and volume stream." }),
  f({ id: "spot.candles_5m", label: "BTC five-minute candles", family: "candle", owner: "EXHAUST", source: "spot klines", timeframe: "5m", authority: "live", chair_visible: true, consumers: ["WICK", "EXHAUST", "PULSE"], stale_after_ms: 360_000, note: "Higher-timeframe confirmation and exhaustion context." }),
  f({ id: "spot.ret_5m", label: "Five-minute return", family: "candle", owner: "DRIFT", source: "spot candles", timeframe: "5m", authority: "live", chair_visible: true, consumers: ["DRIFT"], stale_after_ms: 90_000, note: "Short momentum leg." }),
  f({ id: "spot.ret_15m", label: "Fifteen-minute return", family: "candle", owner: "DRIFT", source: "spot candles", timeframe: "15m", authority: "live", chair_visible: true, consumers: ["DRIFT", "CHAIN"], stale_after_ms: 90_000, note: "Primary directional return." }),
  f({ id: "spot.ret_30m", label: "Thirty-minute return", family: "candle", owner: "DRIFT", source: "spot candles", timeframe: "30m", authority: "live", chair_visible: true, consumers: ["DRIFT"], stale_after_ms: 90_000, note: "Multi-timeframe alignment." }),
  f({ id: "spot.ret_1h", label: "One-hour return", family: "candle", owner: "EXHAUST", source: "spot candles", timeframe: "1h", authority: "live", chair_visible: true, consumers: ["EXHAUST"], stale_after_ms: 90_000, note: "Trend maturity and reversal context; not an hourly market call." }),
  f({ id: "spot.volume", label: "Volume level and percentile", family: "candle", owner: "PULSE", source: "spot candles", timeframe: "1m", authority: "live", chair_visible: true, consumers: ["PULSE", "WHALE", "CASCADE"], stale_after_ms: 90_000, note: "Activity, climax and proxy confirmation." }),
  f({ id: "spot.atr", label: "ATR volatility regime", family: "candle", owner: "VOLT", source: "spot candles", timeframe: "15m", authority: "live", chair_visible: true, consumers: ["VOLT", "STRIKE"], stale_after_ms: 90_000, note: "Volatility state and strike-distance scaling." }),
  f({ id: "spot.range_location", label: "Range position", family: "candle", owner: "WICK", source: "spot candles", timeframe: "window", authority: "live", chair_visible: true, consumers: ["WICK"], stale_after_ms: 90_000, note: "HIGH, LOW or MID pattern context." }),
  f({ id: "market.strike_distance", label: "Spot distance from strike", family: "book", owner: "STRIKE", source: "spot + Kalshi contract", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["STRIKE", "CLOCK"], stale_after_ms: 30_000, note: "Distance, ATR-normalized distance and clock ownership." }),
  f({ id: "market.clock_phase", label: "Window clock and phase", family: "context", owner: "CLOCK", source: "contract close time", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["CLOCK", "Chair"], stale_after_ms: null, note: "ENTRY, MID and FINAL timing gates." }),
  f({ id: "kalshi.touch", label: "Kalshi bid, ask and spread", family: "book", owner: "ODDS", source: "Kalshi order book", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["ODDS", "CHEAP", "FADE", "Chair"], stale_after_ms: 30_000, note: "Market probability, economics and bookability." }),
  f({ id: "kalshi.imbalance", label: "Touch-size imbalance", family: "book", owner: "TAPE", source: "Kalshi order book", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["TAPE"], stale_after_ms: 30_000, note: "Persistent touch imbalance and flips." }),
  f({ id: "kalshi.yes_path", label: "YES midpoint path", family: "book", owner: "VEL", source: "Kalshi midpoint samples", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["VEL", "FADE"], stale_after_ms: 30_000, note: "Approximately 30/60/120-second market movement." }),
  f({ id: "derivs.funding", label: "Perpetual funding", family: "derivs", owner: "CARRY", source: "perpetual derivatives feed", timeframe: "window", authority: "live", chair_visible: true, consumers: ["CARRY"], stale_after_ms: 900_000, note: "Funding persistence, extremes and normalization." }),
  f({ id: "derivs.open_interest", label: "Open-interest change", family: "derivs", owner: "CHAIN", source: "perpetual derivatives feed", timeframe: "window", authority: "live", chair_visible: true, consumers: ["CHAIN", "CASCADE"], stale_after_ms: 900_000, note: "Three-, ten- and sixty-minute participation changes." }),
  f({ id: "derivs.liquidations", label: "Liquidations and cascade proxy", family: "derivs", owner: "CASCADE", source: "liquidation feed + volume proxy", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["CASCADE"], stale_after_ms: 120_000, note: "Real liquidation events when available; conservative proxy otherwise." }),
  f({ id: "derivs.basis", label: "Spot-perpetual basis", family: "derivs", owner: "CARRY", source: "spot + perpetual", timeframe: "tick", authority: "live", chair_visible: true, consumers: ["CARRY", "feed health"], stale_after_ms: 90_000, note: "Carry context and divergence health." }),
  f({ id: "history.settlement_streak", label: "Prior settlement streak", family: "history", owner: "STREAK", source: "official settlements", timeframe: "window", authority: "live", chair_visible: true, consumers: ["STREAK"], stale_after_ms: null, note: "Recent settlement sequence and current market agreement." }),
  f({ id: "context.session_events", label: "Session and scheduled-event context", family: "context", owner: "CLOCK", source: "desk market calendar", timeframe: "session", authority: "live", chair_visible: true, consumers: ["CLOCK"], stale_after_ms: null, note: "Session, weekend, FOMC and scheduled data-print context." }),

  f({ id: "lab.settlement_fair", label: "Settlement-rule fair value", family: "book", owner: "INDEX", source: "BRTI final-minute lab", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["INDEX shadow", "Replay"], stale_after_ms: 30_000, note: "Research fair value; INDEX remains held from production authority." }),
  f({ id: "lab.microprice", label: "Microprice", family: "book", owner: "TAPE", source: "Kalshi depth", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["TAPE 2.0", "Replay"], stale_after_ms: 30_000, note: "Recorded shadow microstructure trace." }),
  f({ id: "lab.ofi", label: "Order-flow imbalance", family: "book", owner: "TAPE", source: "Kalshi deltas", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["TAPE 2.0", "Replay"], stale_after_ms: 30_000, note: "Recorded shadow microstructure trace." }),
  f({ id: "lab.cancellations", label: "Cancellation pressure", family: "book", owner: "TAPE", source: "Kalshi deltas", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["TAPE 2.0", "Replay"], stale_after_ms: 30_000, note: "Recorded shadow microstructure trace." }),
  f({ id: "lab.trade_flow", label: "Aggressive trade flow", family: "book", owner: "TAPE", source: "Kalshi trades", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["TAPE 2.0", "Replay"], stale_after_ms: 30_000, note: "Recorded shadow microstructure trace." }),
  f({ id: "lab.vel_residual", label: "Spot-versus-market residual", family: "book", owner: "VEL", source: "spot + Kalshi", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["VEL 2.0", "Replay"], stale_after_ms: 30_000, note: "Binary-delta residual under prospective study." }),
  f({ id: "lab.lead_lag", label: "Spot/Kalshi lead-lag", family: "book", owner: "VEL", source: "spot + Kalshi", timeframe: "tick", authority: "shadow", chair_visible: false, consumers: ["VEL 2.0", "Replay"], stale_after_ms: 30_000, note: "Who moved first over the recorded horizon." }),
  f({ id: "lab.absorption", label: "Aggressive-flow absorption", family: "book", owner: "TAPE", source: "Kalshi trades + depth", timeframe: "tick", authority: "measurement", chair_visible: false, consumers: ["Absorption study"], stale_after_ms: 30_000, note: "Continuous research grid; explicitly non-voting." }),
  f({ id: "lab.timestamped_path", label: "Timestamp-correct market path", family: "book", owner: null, source: "Kalshi candle timestamps", timeframe: "tick", authority: "measurement", chair_visible: false, consumers: ["Path parity", "Replay"], stale_after_ms: null, note: "Measurement-only path beside the legacy decision path." }),
  f({ id: "lab.candle_timestamp_quality", label: "Candle timestamp quality", family: "context", owner: "WARDEN", source: "feed receipts", timeframe: "tick", authority: "measurement", chair_visible: false, consumers: ["Path parity", "readiness"], stale_after_ms: null, note: "Operational evidence; WARDEN is pit crew, not a voter." }),
  f({ id: "context.fear_greed", label: "Fear and Greed context", family: "context", owner: "WIRE", source: "sentiment feed", timeframe: "daily", authority: "measurement", chair_visible: false, consumers: ["WIRE pit tag"], stale_after_ms: 172_800_000, note: "Presentation context only after WIRE moved to pit crew." }),
  f({ id: "context.regime_tag", label: "Desk regime tag", family: "context", owner: "ORBIT", source: "session + phase", timeframe: "session", authority: "measurement", chair_visible: false, consumers: ["ORBIT pit tag", "research stratification"], stale_after_ms: null, note: "Research grouping and presentation only after ORBIT moved to pit crew." }),

  f({ id: "candidate.path_strike_crossings", label: "Strike-crossing count", family: "candle", owner: "WICK", source: "timestamped spot path", timeframe: "window", authority: "retired", chair_visible: false, consumers: [], stale_after_ms: null, note: "Not collected as a complete feature yet; reserved candidate identifier." }),
  f({ id: "candidate.path_time_above", label: "Time above and below strike", family: "candle", owner: "WICK", source: "timestamped spot path", timeframe: "window", authority: "retired", chair_visible: false, consumers: [], stale_after_ms: null, note: "Not collected as a complete feature yet; reserved candidate identifier." }),
  f({ id: "candidate.path_smoothness", label: "Window path smoothness", family: "candle", owner: "DRIFT", source: "timestamped spot path", timeframe: "window", authority: "retired", chair_visible: false, consumers: [], stale_after_ms: null, note: "Not collected as a complete feature yet; reserved candidate identifier." }),
  f({ id: "candidate.regime_4h", label: "Four-hour regime", family: "context", owner: "EXHAUST", source: "spot candles", timeframe: "session", authority: "retired", chair_visible: false, consumers: [], stale_after_ms: null, note: "Not collected as a registered decision feature yet." }),
] as const;

const PIT_CREW = new Set<SeatId>(["WARDEN", "ORBIT", "WIRE"]);

export function validateFeatureRegistry(
  rows: readonly FeatureRegistryEntry[] = FEATURE_REGISTRY,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) errors.push(`duplicate feature id: ${row.id}`);
    seen.add(row.id);
    if (row.version < 1 || !Number.isInteger(row.version))
      errors.push(`${row.id}: version must be a positive integer`);
    if (row.chair_visible && row.authority !== "live")
      errors.push(`${row.id}: only live features may be Chair-visible`);
    if (row.authority === "live" && !row.owner)
      errors.push(`${row.id}: a live feature must have an accountable owner`);
    if (row.owner && PIT_CREW.has(row.owner) && row.chair_visible)
      errors.push(`${row.id}: pit-crew owner ${row.owner} cannot be Chair-visible`);
    if (row.authority === "retired" && row.consumers.length)
      errors.push(`${row.id}: retired/reserved features cannot have consumers`);
  }
  return errors;
}

export type FeatureRegistryReport = {
  ok: boolean;
  generated_at: string;
  rows: readonly FeatureRegistryEntry[];
  tally: Record<FeatureAuthority, number>;
  errors: string[];
  note: string;
};

export function featureRegistryReport(now = Date.now()): FeatureRegistryReport {
  const tally: Record<FeatureAuthority, number> = {
    live: 0,
    shadow: 0,
    measurement: 0,
    retired: 0,
  };
  for (const row of FEATURE_REGISTRY) tally[row.authority] += 1;
  const errors = validateFeatureRegistry();
  return {
    ok: errors.length === 0,
    generated_at: new Date(now).toISOString(),
    rows: FEATURE_REGISTRY,
    tally,
    errors,
    note:
      "Read-only authority inventory. This report cannot promote a feature, alter a seat, " +
      "change Chair inputs, or create a call. RETIRED candidate rows are reserved/missing work, " +
      "not previously-live features.",
  };
}
