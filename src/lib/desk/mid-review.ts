/**
 * MID-entry economics review: what a card's reads were worth at the ask it
 * fired against, inside the window the paper book may actually enter.
 *
 * WHY THIS EXISTS. Skill cards are graded at the final tick with a strength
 * score, so STRIKE.itm_time carries 1,284 grades of which 1,195 sit in FINAL
 * pockets, where the favourite costs 95–99¢. A card that is right there is not
 * evidence that it was worth paying for at T−7 minutes. This review keeps the
 * MID pocket (3–10 minutes left, the entry window) apart from FINAL and ENTRY,
 * prices every observation at its own fire-time ask with the versioned fee
 * engine, and grades on the official result. Fifty valid MID observations with
 * negative net raise a REVIEW flag. The flag has no authority: it cannot
 * demote, promote, replace the frozen review rule, or touch the Chair.
 *
 * Strength is not probability. A receipt may carry both; only `probability`
 * is a forecast and only when it was produced before the outcome.
 *
 * Pure module: no clock, no state, no database.
 */
import { DEFAULT_FEE_ENGINE, feeFingerprint, holdNetCents, neededWinRatePct, realAskCents, type FeeEngineId } from "./fee-engine.ts";

export const MID_REVIEW_VERSION = "MID_ENTRY_REVIEW_V1";
export const MID_REVIEW_MIN_N = 50;

export type Pocket = "ENTRY" | "MID" | "FINAL";

/** ENTRY > 600 s, MID 180–600 s (the paper entry window), FINAL < 180 s. */
export function pocketOf(secsLeft: number): Pocket | null {
  if (!Number.isFinite(secsLeft) || secsLeft < 0) return null;
  if (secsLeft > 600) return "ENTRY";
  if (secsLeft >= 180) return "MID";
  return "FINAL";
}

export type ObservationKind = "raw_observation" | "diagnostic_counterfactual" | "qualified_shadow_fill" | "main_paper_fill";

export type FireReceipt = {
  card_id: string;
  seat: string;
  ticker: string;
  close_ms: number;
  fire_ms: number;
  secs_left: number;
  side: "UP" | "DOWN";
  /** Ask of the fired side at fire time; null when no executable quote was recorded. */
  ask_cents: number | null;
  health: "LIVE" | "STALE" | "DOWN" | string;
  /** Spread ≤ 2, size ≥ 1, feeds fresh at fire time; null when not measured. */
  execution_qualified: boolean | null;
  official_winner: "UP" | "DOWN" | null;
  kind: ObservationKind;
  /** Heuristic signal strength 0–100. Never a probability. */
  strength: number | null;
  /** A prospective side probability 0–1 produced before the outcome, else null. */
  probability: number | null;
  /** True when the probability could have seen the outcome (post-close input). Such rows never score calibration. */
  probability_after_close?: boolean;
};

export type PocketEconomics = {
  n: number;
  valid_n: number;
  invalid_reasons: Record<string, number>;
  wins: number;
  wr_pct: number | null;
  needed_wr_pct: number | null;
  net_cents: number;
  net_per_obs: number | null;
  avg_ask: number | null;
  qualified_n: number;
  qualified_net_cents: number;
  by_kind: Record<ObservationKind, number>;
};

export type CardReview = {
  version: typeof MID_REVIEW_VERSION;
  authority: "none";
  fee_fingerprint: string;
  card_id: string;
  seat: string;
  entry: PocketEconomics;
  mid: PocketEconomics;
  final: PocketEconomics;
  flag: "REVIEW_NEGATIVE_MID" | "INSUFFICIENT_MID" | "MID_OK";
  flag_reason: string;
  /** Brier of `probability` vs outcome on MID rows with a pre-close probability; null otherwise. */
  mid_brier: number | null;
  mid_brier_n: number;
  attribution_note: string;
};

const EMPTY_KINDS = (): Record<ObservationKind, number> => ({ raw_observation: 0, diagnostic_counterfactual: 0, qualified_shadow_fill: 0, main_paper_fill: 0 });

function pocketEconomics(rows: readonly FireReceipt[], engine: FeeEngineId): PocketEconomics {
  const invalid: Record<string, number> = {};
  const valid: Array<{ r: FireReceipt; net: number }> = [];
  const kinds = EMPTY_KINDS();
  for (const r of rows) {
    kinds[r.kind] += 1;
    let why: string | null = null;
    if (r.ask_cents == null || !realAskCents(r.ask_cents)) why = "no_executable_ask";
    else if (r.official_winner == null) why = "no_official_result";
    else if (r.health !== "LIVE") why = "feed_not_live";
    if (why) { invalid[why] = (invalid[why] ?? 0) + 1; continue; }
    valid.push({ r, net: holdNetCents(r.ask_cents!, r.side === r.official_winner, engine) });
  }
  const wins = valid.filter((v) => v.r.side === v.r.official_winner).length;
  const net = valid.reduce((s, v) => s + v.net, 0);
  const asks = valid.map((v) => v.r.ask_cents!);
  const qualified = valid.filter((v) => v.r.execution_qualified === true);
  return {
    n: rows.length, valid_n: valid.length, invalid_reasons: invalid, wins,
    wr_pct: valid.length ? Math.round((1000 * wins) / valid.length) / 10 : null,
    needed_wr_pct: neededWinRatePct(asks, engine),
    net_cents: Math.round(net * 10) / 10,
    net_per_obs: valid.length ? Math.round((net / valid.length) * 100) / 100 : null,
    avg_ask: asks.length ? Math.round((asks.reduce((s, a) => s + a, 0) / asks.length) * 10) / 10 : null,
    qualified_n: qualified.length,
    qualified_net_cents: Math.round(qualified.reduce((s, v) => s + v.net, 0) * 10) / 10,
    by_kind: kinds,
  };
}

/** Review one card's receipts. FINAL rows never satisfy the MID minimum. */
export function reviewCard(cardId: string, receipts: readonly FireReceipt[], engine: FeeEngineId = DEFAULT_FEE_ENGINE): CardReview {
  const mine = receipts.filter((r) => r.card_id === cardId);
  const by = (p: Pocket) => mine.filter((r) => pocketOf(r.secs_left) === p);
  const mid = pocketEconomics(by("MID"), engine);
  const brierRows = by("MID").filter((r) => r.probability != null && !r.probability_after_close && r.official_winner != null);
  const brier = brierRows.length
    ? brierRows.reduce((s, r) => s + (r.probability! - (r.side === r.official_winner ? 1 : 0)) ** 2, 0) / brierRows.length
    : null;
  let flag: CardReview["flag"];
  let reason: string;
  if (mid.valid_n < MID_REVIEW_MIN_N) { flag = "INSUFFICIENT_MID"; reason = `${mid.valid_n}/${MID_REVIEW_MIN_N} valid MID observations`; }
  else if (mid.net_cents < 0) { flag = "REVIEW_NEGATIVE_MID"; reason = `MID net ${mid.net_cents}¢ on ${mid.valid_n} valid observations (WR ${mid.wr_pct}% vs needed ${mid.needed_wr_pct}%)`; }
  else { flag = "MID_OK"; reason = `MID net ${mid.net_cents}¢ on ${mid.valid_n} valid observations; not a promotion`; }
  return {
    version: MID_REVIEW_VERSION, authority: "none", fee_fingerprint: feeFingerprint(engine), card_id: cardId,
    seat: mine[0]?.seat ?? cardId.split(".")[0] ?? "?",
    entry: pocketEconomics(by("ENTRY"), engine), mid, final: pocketEconomics(by("FINAL"), engine),
    flag, flag_reason: reason, mid_brier: brier == null ? null : Math.round(brier * 10_000) / 10_000, mid_brier_n: brierRows.length,
    attribution_note: "observations on a shared window are not independent profits; card nets are never summed into desk P&L",
  };
}

export function reviewCards(receipts: readonly FireReceipt[], engine: FeeEngineId = DEFAULT_FEE_ENGINE): CardReview[] {
  const ids = [...new Set(receipts.map((r) => r.card_id))].sort();
  return ids.map((id) => reviewCard(id, receipts, engine));
}
