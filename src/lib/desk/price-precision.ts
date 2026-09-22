/**
 * Price precision on this market, and where the desk loses it.
 *
 * OBSERVED (DB_VERIFIED 2026-09-22, desk_lag_events.ask_before, 98,209 rows):
 *   0.1¢ ticks appear below 10¢ (3,849 fractional rows under 50¢, all < 10¢)
 *   and at or above 90¢ (2,446 of 3,561 rows: 90.1, 91.3, 92.5, 95.4, 98.6 …).
 *   No fractional ask was ever observed between 10¢ and 90¢. The lag capture
 *   reads the raw order book and keeps the decimal.
 *
 * PRODUCTION DECISION LANE remains coerced to whole cents:
 *   server-feeds.ts `cents()` → Math.round; kalshi-book.ts `clampC` → Math.round
 *   (bounded 1–99). A separate exact quote lane is now carried prospectively
 *   into Snapshot and the shadow observer; no Chair/seat/gate consumer reads it.
 *   replay.server.ts rounds the path to 0.1¢. Historical desk_ledger
 *   (0 of 190 fills fractional), desk_decision_snapshots (0 of 1,086) and the
 *   call-quality receipts (0 of 1,193) hold whole cents only. For the 28
 *   historical fills booked at 90¢ or above the exact ask is UNKNOWN: it may
 *   have been up to 0.5¢ away from the stored value, in either direction.
 *
 * This module changes nothing in production. It names the tick schedule, says
 * what precision a stored number can claim, and keeps the fee and HOLD
 * arithmetic exact on fractional asks so the shadow lab can price deci-cent
 * quotes without a second rounding.
 */
import { DEFAULT_FEE_ENGINE, feeCents, holdNetCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";

export const PRICE_PRECISION_CONTRACT = Object.freeze({
  tick_cents_below_10: 0.1,
  tick_cents_10_to_90: 1,
  tick_cents_90_and_above: 0.1,
  observed_from: "desk_lag_events.ask_before (raw order book), 2026-09-06 → 2026-09-22",
  coercion_sites: Object.freeze(["src/lib/desk/server-feeds.ts cents()", "src/lib/desk/kalshi-book.ts clampC()", "src/lib/desk/replay.server.ts (0.1¢)"]),
  whole_cent_surfaces: Object.freeze(["desk_ledger.entry_cents", "desk_decision_snapshots.yes_ask/no_ask", "desk_call_quality.receipt.quotes", "desk_samples.market"]),
});

export type PricePrecision = "exact_deci_cent" | "whole_cent_exact" | "whole_cent_coerced_unknown_fraction";

/** What precision a stored ask can claim, given where it came from. */
export function describeStoredPrecision(ask: number, source: "raw_book" | "snapshot" | "ledger" | "replay"): PricePrecision {
  if (source === "raw_book") return "exact_deci_cent";
  if (ask < 10 || ask >= 90) return "whole_cent_coerced_unknown_fraction";
  return "whole_cent_exact";
}

/** Is `ask` on the market's tick grid? */
export function onTickGrid(ask: number): boolean {
  if (!realAskCents(ask)) return false;
  const tick = ask < 10 || ask >= 90 ? 0.1 : 1;
  const k = ask / tick;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/** Round-trip a deci-cent ask through the economics without losing it: fee, all-in, HOLD net. */
export function deciCentEconomics(ask: number, wonOfficially: boolean, engine: FeeEngineId = DEFAULT_FEE_ENGINE): { ask: number; fee: number; all_in: number; net: number; on_grid: boolean } {
  const fee = feeCents(ask, engine);
  return { ask, fee, all_in: Math.round((ask + fee) * 1000) / 1000, net: Math.round(holdNetCents(ask, wonOfficially, engine) * 1000) / 1000, on_grid: onTickGrid(ask) };
}

/** The worst-case cents a whole-cent stored ask may be off by, given the tick schedule. */
export function storedAskUncertaintyCents(ask: number): number {
  return ask < 10 || ask >= 90 ? 0.5 : 0;
}
