/**
 * Official KXBTC15M settlement readers (pure). Moved verbatim from
 * server-feeds.ts so the official-result path can be exercised by the
 * offline test runner; behavior is unchanged.
 *
 * Grading authority is Kalshi's own `result` on the market object. Kalshi's
 * contract rule (CRYPTO terms; KXBTC15M rules_primary, strike_type
 * greater_or_equal): YES when the simple average of the 60 one-second BRTI
 * prints before close, rounded to 2 decimals, is AT LEAST the prior window's
 * average (floor_strike). "At least X means X or greater", so an exact tie
 * is YES; missing/incomplete index data resolves NO. The desk never
 * re-derives that outcome locally: it reads `result` and leaves a window
 * ungraded until Kalshi publishes it.
 */
import type { OfficialSettle } from "./types";

export type KalshiMarketRow = {
  ticker?: string;
  result?: string;
  settlement_value?: string | number;
  settlement_ts?: string;
  close_time?: string;
  expiration_time?: string;
  expiration_value?: string | number;
};

export function parseKalshiResult(row: KalshiMarketRow): "UP" | "DOWN" | null {
  const r = String(row.result ?? "").toLowerCase();
  if (r === "yes") return "UP";
  if (r === "no") return "DOWN";
  const v = Number(row.settlement_value);
  if (v === 1) return "UP";
  if (v === 0) return "DOWN";
  return null;
}

export function collectSettles(
  rows: KalshiMarketRow[] | undefined,
  receipt_ts: number,
  host: string,
  into: OfficialSettle[],
) {
  if (!rows) return;
  const seen = new Set(into.map((s) => s.ticker));
  for (const row of rows) {
    const lean = parseKalshiResult(row);
    if (!lean) continue;
    const ticker = String(row.ticker ?? "");
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const closeTs = Date.parse(String(row.close_time ?? row.expiration_time ?? "")) || 0;
    const settledAt = Date.parse(String(row.settlement_ts ?? "")) || closeTs;
    const value = Number(row.expiration_value);
    into.push({
      ticker,
      close_time: closeTs,
      lean,
      provider_ts: settledAt,
      receipt_ts,
      source: host,
      ...(Number.isFinite(value) && value > 0 ? { value } : {}),
    });
  }
}
