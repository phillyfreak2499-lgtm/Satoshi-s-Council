/**
 * One versioned fee engine for every paper-economics read.
 *
 * WHY THIS EXISTS. The desk computes the Kalshi taker fee in at least three
 * places: `takerFeeCents` (whole cents, `clock.ts`), `takerFeeCentsExact`
 * (centicents, `clock.ts`) and an inline `ceil(0.07 * p * (100 - p) / 100)` in
 * the Books SQL. All three agree on the whole-cent value today, but nothing
 * pinned that agreement, and a paired experiment whose two arms are priced by
 * two implementations is not paired. This module names each implementation,
 * fingerprints it, and is the only fee path the reconciliation, the MID review
 * and the shadow lab may use.
 *
 * STATUS: ASSUMED. The venue's live fee metadata (rate, rounding unit, effective
 * date) could not be fetched from this environment; the 7% × P × (1 − P),
 * rounded up to the cent, schedule is the repository's documented rule, not a
 * verified venue record. Promotion on uncertain economics is blocked by the lab
 * gates; this module only makes the assumption explicit and reproducible.
 *
 * Pure module: no clock, no state, no database.
 */
import { takerFeeCents, takerFeeCentsExact } from "./clock.ts";

export type FeeEngineId = "KALSHI_TAKER_7PCT_CEIL_CENT_V1" | "KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1";

export type FeeEngine = {
  id: FeeEngineId;
  /** Taker rate applied to P × (1 − P) per contract. */
  rate: number;
  rounding: "ceil_whole_cent" | "ceil_centicent";
  /** Where the rule came from. Never "venue" until the metadata is fetched and recorded. */
  provenance: "ASSUMED";
  why: string;
};

export const FEE_ENGINES: Readonly<Record<FeeEngineId, FeeEngine>> = Object.freeze({
  KALSHI_TAKER_7PCT_CEIL_CENT_V1: Object.freeze({
    id: "KALSHI_TAKER_7PCT_CEIL_CENT_V1",
    rate: 0.07,
    rounding: "ceil_whole_cent",
    provenance: "ASSUMED",
    why: "the paper book's charged fee: ceil(7 · p · (1 − p)) whole cents per contract; conservative vs the centicent schedule",
  }),
  KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1: Object.freeze({
    id: "KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1",
    rate: 0.07,
    rounding: "ceil_centicent",
    provenance: "ASSUMED",
    why: "the lab's edge measurement: ceil to 0.01¢, the documented venue schedule to the letter",
  }),
});

/** The engine the paper book has always charged. Every reconciliation defaults to it. */
export const DEFAULT_FEE_ENGINE: FeeEngineId = "KALSHI_TAKER_7PCT_CEIL_CENT_V1";

/** A real, payable ask: a price, not a certainty or a hole. */
export function realAskCents(ask: number): boolean {
  return Number.isFinite(ask) && ask > 0 && ask < 100;
}

/** Fee in cents for one contract at `ask` cents. Delegates to the single existing arithmetic path per engine. */
export function feeCents(ask: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number {
  if (!realAskCents(ask)) return NaN;
  return engine === "KALSHI_TAKER_7PCT_CEIL_CENTICENT_V1" ? takerFeeCentsExact(ask) : takerFeeCents(ask);
}

/** `id|rate|rounding`: what an observation's fee column means. Pinned by a freeze test. */
export function feeFingerprint(engine: FeeEngineId = DEFAULT_FEE_ENGINE): string {
  const e = FEE_ENGINES[engine];
  return `${e.id}|rate=${e.rate}|${e.rounding}|${e.provenance}`;
}

/** What a one-contract fill held to settlement puts at risk: ask plus fee. */
export function allInCostCents(ask: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number {
  return realAskCents(ask) ? ask + feeCents(ask, engine) : NaN;
}

/** Net cents = 100 · I(booked side won officially) − ask − fee. The accounting identity for HOLD. */
export function holdNetCents(ask: number, wonOfficially: boolean, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number {
  const cost = allInCostCents(ask, engine);
  if (!Number.isFinite(cost)) return NaN;
  return (wonOfficially ? 100 : 0) - cost;
}

/** Needed win rate, percent: Σ(ask + fee) / (100 · n). Null with no asks. */
export function neededWinRatePct(asks: readonly number[], engine: FeeEngineId = DEFAULT_FEE_ENGINE): number | null {
  const real = asks.filter(realAskCents);
  if (!real.length) return null;
  const cost = real.reduce((s, a) => s + allInCostCents(a, engine), 0);
  return Math.round(((100 * cost) / (100 * real.length)) * 100) / 100;
}

/**
 * Edge in cents for a genuine side probability `p` (0–1) against `ask`:
 * 100p − ask − fee. The fee is charged exactly once here; callers must not
 * subtract it again.
 */
export function edgeCents(pSide: number, ask: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number {
  if (!Number.isFinite(pSide) || pSide < 0 || pSide > 1 || !realAskCents(ask)) return NaN;
  return 100 * pSide - ask - feeCents(ask, engine);
}

/** The whole-cent fee schedule as a table, for a report. */
export function feeTable(engine: FeeEngineId = DEFAULT_FEE_ENGINE): Array<{ ask: number; fee: number; all_in: number; win_pays: number }> {
  const out: Array<{ ask: number; fee: number; all_in: number; win_pays: number }> = [];
  for (let ask = 1; ask <= 99; ask += 1) {
    const fee = feeCents(ask, engine);
    out.push({ ask, fee, all_in: ask + fee, win_pays: 100 - ask - fee });
  }
  return out;
}
