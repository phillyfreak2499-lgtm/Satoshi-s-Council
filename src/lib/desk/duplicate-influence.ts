/**
 * Duplicate influence between seats: co-speaking, conditioned on the market.
 *
 * WHY THIS EXISTS. CARRY and CHAIN agreed on 54 of 54 windows where both
 * spoke at the grade frame. That is a review trigger, not a verdict: two seats
 * that both restate the market direction will agree with each other whether or
 * not they share information. This module reports pairwise agreement, splits it
 * by whether the market already implied the same side, and says whether the
 * Chair's family fold already collapses the pair. Flags are REVIEW only. Nothing
 * here mutes, fades, merges, or reweights.
 *
 * Pure module: no clock, no state, no database.
 */
import { EVIDENCE_OF, type EvidenceFamily } from "./seats.ts";
import { wilsonLower } from "./math.ts";
import type { SeatId } from "./types";

export const DUPLICATE_REVIEW = Object.freeze({ min_n: 50, agree_rate: 0.9 });

export type CoSpeak = {
  /** Window identity, e.g. `ticker|close_ms`. */
  window: string;
  seat: SeatId;
  side: "UP" | "DOWN";
  /** The market's implied side at the same instant; null when no quote. */
  market_side: "UP" | "DOWN" | null;
  /** Optional horizon/pocket label so cohorts are not pooled silently. */
  cohort?: string;
};

export type PairInfluence = {
  cohort: string;
  a: SeatId;
  b: SeatId;
  family_a: EvidenceFamily;
  family_b: EvidenceFamily;
  same_family: boolean;
  /** The Chair folds same-side, same-family seats to one weight; the quorum counts families, so a same-family pair is already one group. */
  fold_already_applies: boolean;
  n_both: number;
  agree: number;
  agree_rate: number | null;
  agree_wilson_lo: number | null;
  /** Windows where both seats took the market's side: agreement here is explained by the price. */
  both_with_market: number;
  /** Windows where at least one seat was against the market: agreement here is the residual signal. */
  either_against_market: number;
  agree_given_either_against: number;
  agree_rate_given_either_against: number | null;
  flag: "REVIEW" | "none";
  flag_reason: string;
};

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Pairwise agreement over windows where both seats spoke, per cohort. */
export function pairInfluence(rows: readonly CoSpeak[], review = DUPLICATE_REVIEW): PairInfluence[] {
  const byCohort = new Map<string, CoSpeak[]>();
  for (const r of rows) {
    const k = r.cohort ?? "all";
    byCohort.set(k, [...(byCohort.get(k) ?? []), r]);
  }
  const out: PairInfluence[] = [];
  for (const [cohort, list] of byCohort) {
    const byWindow = new Map<string, CoSpeak[]>();
    for (const r of list) byWindow.set(r.window, [...(byWindow.get(r.window) ?? []), r]);
    const acc = new Map<string, { a: SeatId; b: SeatId; n: number; agree: number; bwm: number; eam: number; agreeEam: number }>();
    for (const speakers of byWindow.values()) {
      for (let i = 0; i < speakers.length; i += 1) {
        for (let j = i + 1; j < speakers.length; j += 1) {
          const x = speakers[i]!, y = speakers[j]!;
          if (x.seat === y.seat) continue;
          const [ka, kb] = pairKey(x.seat, y.seat);
          const key = `${ka}|${kb}`;
          const cur = acc.get(key) ?? { a: ka as SeatId, b: kb as SeatId, n: 0, agree: 0, bwm: 0, eam: 0, agreeEam: 0 };
          const agree = x.side === y.side;
          cur.n += 1;
          if (agree) cur.agree += 1;
          const bothWith = x.market_side != null && x.side === x.market_side && y.side === y.market_side;
          if (bothWith) cur.bwm += 1;
          else if (x.market_side != null) { cur.eam += 1; if (agree) cur.agreeEam += 1; }
          acc.set(key, cur);
        }
      }
    }
    for (const v of acc.values()) {
      const rate = v.n ? v.agree / v.n : null;
      const fa = EVIDENCE_OF[v.a], fb = EVIDENCE_OF[v.b];
      const same = fa === fb;
      const trigger = v.n >= review.min_n && rate != null && rate >= review.agree_rate;
      out.push({
        cohort, a: v.a, b: v.b, family_a: fa, family_b: fb, same_family: same, fold_already_applies: same,
        n_both: v.n, agree: v.agree, agree_rate: rate == null ? null : Math.round(rate * 1000) / 1000,
        agree_wilson_lo: v.n ? Math.round(wilsonLower(v.agree, v.n) * 1000) / 1000 : null,
        both_with_market: v.bwm, either_against_market: v.eam, agree_given_either_against: v.agreeEam,
        agree_rate_given_either_against: v.eam ? Math.round((v.agreeEam / v.eam) * 1000) / 1000 : null,
        flag: trigger ? "REVIEW" : "none",
        flag_reason: trigger
          ? same
            ? `${Math.round(rate! * 100)}% on n=${v.n}; same family (${fa}) — the Chair fold already collapses the pair to one weight and one group`
            : `${Math.round(rate! * 100)}% on n=${v.n} across families (${fa}/${fb}); ${v.eam ? `${v.agreeEam}/${v.eam} agree when either is against the market` : "no against-market windows: agreement fully explained by the price"}`
          : v.n < review.min_n ? `n=${v.n} < ${review.min_n}` : `${Math.round((rate ?? 0) * 100)}% on n=${v.n}`,
      });
    }
  }
  return out.sort((x, y) => y.n_both - x.n_both);
}
