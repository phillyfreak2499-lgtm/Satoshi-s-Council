/**
 * Vote correlation on identical eligible timestamps.
 *
 * Two seats are compared only where BOTH were observed at the same instant.
 * A missing observation is never agreement; a WAIT is agreement only in the
 * "including WAIT" column. Phi is computed on the 2×2 directional table
 * (UP/DOWN × UP/DOWN) and is null when a margin is empty.
 *
 * Pure module. Reports; never mutes.
 */
import { EVIDENCE_OF, type EvidenceFamily } from "./seats.ts";
import type { SeatId } from "./types";

export type VoteObservation = { window: string; at_ms: number; seat: SeatId; lean: "UP" | "DOWN" | "WAIT"; heard: boolean; healthy: boolean };

export type PairCorrelation = {
  cohort: string;
  a: SeatId; b: SeatId;
  family_a: EvidenceFamily; family_b: EvidenceFamily; same_family: boolean;
  n_both_observed: number;
  agree_incl_wait: number; agree_incl_wait_pct: number | null;
  n_both_directional: number; directional_agree: number; directional_agree_pct: number | null;
  uu: number; ud: number; du: number; dd: number;
  phi: number | null;
  /** Instants where both were heard, directional, same side and cross-family: both could count toward the quorum at once. */
  both_quorum_eligible_same_side: number;
};

export function pairCorrelations(obs: readonly VoteObservation[], cohort = "all"): PairCorrelation[] {
  const byInstant = new Map<string, VoteObservation[]>();
  for (const o of obs) { const k = `${o.window}|${o.at_ms}`; byInstant.set(k, [...(byInstant.get(k) ?? []), o]); }
  const acc = new Map<string, { a: SeatId; b: SeatId; n: number; agreeAll: number; uu: number; ud: number; du: number; dd: number; quorum: number }>();
  for (const list of byInstant.values()) {
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const [x, y] = list[i]!.seat < list[j]!.seat ? [list[i]!, list[j]!] : [list[j]!, list[i]!];
      if (x.seat === y.seat) continue;
      const key = `${x.seat}|${y.seat}`;
      const c = acc.get(key) ?? { a: x.seat, b: y.seat, n: 0, agreeAll: 0, uu: 0, ud: 0, du: 0, dd: 0, quorum: 0 };
      c.n += 1;
      if (x.lean === y.lean) c.agreeAll += 1;
      if (x.lean === "UP" && y.lean === "UP") c.uu += 1; else if (x.lean === "UP" && y.lean === "DOWN") c.ud += 1;
      else if (x.lean === "DOWN" && y.lean === "UP") c.du += 1; else if (x.lean === "DOWN" && y.lean === "DOWN") c.dd += 1;
      if (x.heard && y.heard && x.healthy && y.healthy && x.lean !== "WAIT" && x.lean === y.lean && EVIDENCE_OF[x.seat] !== EVIDENCE_OF[y.seat]) c.quorum += 1;
      acc.set(key, c);
    }
  }
  return [...acc.values()].map((c) => {
    const nd = c.uu + c.ud + c.du + c.dd;
    const den = Math.sqrt((c.uu + c.ud) * (c.du + c.dd) * (c.uu + c.du) * (c.ud + c.dd));
    const phi = den > 0 ? Math.round(((c.uu * c.dd - c.ud * c.du) / den) * 1000) / 1000 : null;
    return {
      cohort, a: c.a, b: c.b, family_a: EVIDENCE_OF[c.a], family_b: EVIDENCE_OF[c.b], same_family: EVIDENCE_OF[c.a] === EVIDENCE_OF[c.b],
      n_both_observed: c.n, agree_incl_wait: c.agreeAll, agree_incl_wait_pct: c.n ? Math.round((1000 * c.agreeAll) / c.n) / 10 : null,
      n_both_directional: nd, directional_agree: c.uu + c.dd, directional_agree_pct: nd ? Math.round((1000 * (c.uu + c.dd)) / nd) / 10 : null,
      uu: c.uu, ud: c.ud, du: c.du, dd: c.dd, phi, both_quorum_eligible_same_side: c.quorum,
    };
  }).sort((x, y) => y.n_both_directional - x.n_both_directional);
}
