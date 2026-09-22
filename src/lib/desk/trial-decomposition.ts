/**
 * The 80¢-vs-70¢ trial, decomposed so the arithmetic sums exactly.
 *
 * Two books on identical windows: the live book at the 80¢ floor and the
 * shadow book at the old 70¢ floor. Their difference is exactly:
 *   A  shared windows: (price component) Σ −(live_ask − shadow_ask)
 *                     + (fee component)   Σ −(fee(live_ask) − fee(shadow_ask))
 *   B  windows only the lower floor filled: −Σ shadow_net   (what the higher floor avoided)
 *   C  windows only the higher floor filled: +Σ live_net
 *   D  settlement/accounting differences: 0 by construction (same official result, same engine)
 * and live_total − shadow_total = A + C − (B as avoided) is checked to the cent.
 *
 * Pure module.
 */
import { DEFAULT_FEE_ENGINE, feeCents, type FeeEngineId } from "./fee-engine.ts";

export type TrialRow = {
  ticker: string;
  close_ms: number;
  live_ask: number | null;
  live_net: number | null;
  shadow_ask: number | null;
  shadow_net: number | null;
  winner: "UP" | "DOWN";
};

export type TrialDecomposition = {
  windows: number;
  shared: number;
  shadow_only: number;
  live_only: number;
  no_fill: number;
  live_total: number;
  shadow_total: number;
  difference_live_minus_shadow: number;
  A_price_component: number;
  A_fee_component: number;
  A_total: number;
  B_avoided_by_higher_floor: number;
  B_shadow_only_net: number;
  B_shadow_only_wins: number;
  C_live_only_net: number;
  D_settlement_accounting: 0;
  sums_exactly: boolean;
  fee_engine: FeeEngineId;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

export function decomposeTrial(rows: readonly TrialRow[], engine: FeeEngineId = DEFAULT_FEE_ENGINE): TrialDecomposition {
  let shared = 0, shadowOnly = 0, liveOnly = 0, noFill = 0, live = 0, shadow = 0, aPrice = 0, aFee = 0, aTotal = 0, bNet = 0, bWins = 0, cNet = 0;
  for (const r of rows) {
    const L = r.live_ask != null && r.live_net != null, S = r.shadow_ask != null && r.shadow_net != null;
    if (L) live += r.live_net!;
    if (S) shadow += r.shadow_net!;
    if (L && S) {
      shared += 1;
      aPrice += -(r.live_ask! - r.shadow_ask!);
      aFee += -(feeCents(r.live_ask!, engine) - feeCents(r.shadow_ask!, engine));
      aTotal += r.live_net! - r.shadow_net!;
    } else if (S) { shadowOnly += 1; bNet += r.shadow_net!; if (r.shadow_net! > 0) bWins += 1; }
    else if (L) { liveOnly += 1; cNet += r.live_net!; }
    else noFill += 1;
  }
  const diff = live - shadow;
  const reconstructed = aTotal + cNet - bNet;
  return {
    windows: rows.length, shared, shadow_only: shadowOnly, live_only: liveOnly, no_fill: noFill,
    live_total: r1(live), shadow_total: r1(shadow), difference_live_minus_shadow: r1(diff),
    A_price_component: r1(aPrice), A_fee_component: r1(aFee), A_total: r1(aTotal),
    B_avoided_by_higher_floor: r1(-bNet), B_shadow_only_net: r1(bNet), B_shadow_only_wins: bWins,
    C_live_only_net: r1(cNet), D_settlement_accounting: 0,
    sums_exactly: Math.abs(aPrice + aFee - aTotal) < 0.051 && Math.abs(reconstructed - diff) < 0.051,
    fee_engine: engine,
  };
}
