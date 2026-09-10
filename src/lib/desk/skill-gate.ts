/**
 * The research hold: how a new or high-stakes hypothesis earns the right to be
 * heard, separately from how well it happens to be doing.
 *
 * WHY THIS EXISTS. A SHADOW card was never a quarantine. The seat's selection
 * pool is LIVE plus SHADOW, and SHADOW cards carry a *larger* exploration bonus
 * than LIVE ones, so a brand-new hypothesis could be chosen as the seat's vote
 * and reach the chair's score within a handful of windows. That is the right
 * behaviour for a small variation on a proven read, and the wrong behaviour for
 * a genuinely new predictive feature that is supposed to prove itself first.
 *
 * So a card may carry a gate. A gated card is still evaluated every tick and
 * still graded at every settle — it rides the seat's paper list, which the
 * learner credits in full — it simply cannot be the read the chair hears until
 * its own bar is met. Evidence accumulates prospectively; authority waits.
 *
 * THREE KINDS OF BAR, all optional, all absent on existing cards so nothing
 * already proven changes behaviour:
 *
 *   manual_hold      never heard until a human clears it. For a hypothesis
 *                    whose release should be a decision, not a threshold.
 *   min_walkforward_n graded directional observations before it may be heard.
 *   min_regime_n     graded observations *in the regime being traded* before it
 *                    may be heard there. A signal with a perfect record built
 *                    entirely in one regime has earned nothing in another.
 *
 * A perfect record on a small sample is not evidence, which is the whole point:
 * 20 for 20 across four regimes with nine in the best of them is a hypothesis,
 * not a seat that should be steering the desk.
 *
 * Pure module: no state, no clock, no database.
 */
import type { SkillCard } from "./types";

/** The optional bars a card can carry. Absent means ungated, which is every existing card. */
export type SkillGate = {
  /** Never selectable until a human clears it. Never released by a threshold. */
  manual_hold?: boolean;
  /** Graded directional observations required before the chair may hear it. */
  min_walkforward_n?: number;
  /** Graded observations required *in the regime being traded* before it may be heard there. */
  min_regime_n?: number;
  /** Why the bar is there, shown on the card and in the research report. */
  held_why?: string;
};

/** Graded directional observations this card has in one regime bucket. */
export function regimeN(card: Pick<SkillCard, "pocket">, regimeKey: string): number {
  const p = card.pocket?.[regimeKey];
  return p ? (Number(p.n) || 0) : 0;
}

/** The best-evidenced regime bucket's count — "it has earned this much somewhere". */
export function bestRegimeN(card: Pick<SkillCard, "pocket">): number {
  let best = 0;
  for (const p of Object.values(card.pocket ?? {})) {
    const n = Number(p?.n) || 0;
    if (n > best) best = n;
  }
  return best;
}

type Gated = Pick<SkillCard, "n" | "pocket"> & SkillGate;

/**
 * Why this card may not be the read the chair hears in this regime, or null
 * when nothing is holding it. The regime key is the one being traded right now.
 */
export function voteHeldReason(card: Gated, regimeKey: string): string | null {
  if (card.manual_hold) return card.held_why || "held by hand";
  const needN = card.min_walkforward_n ?? 0;
  if (needN > 0 && card.n < needN) return `${card.n}/${needN} graded`;
  const needR = card.min_regime_n ?? 0;
  if (needR > 0) {
    const have = regimeN(card, regimeKey);
    if (have < needR) return `${have}/${needR} in ${regimeKey || "this regime"}`;
  }
  return null;
}

/** May the chair hear this card in this regime? */
export function voteEligible(card: Gated, regimeKey: string): boolean {
  return voteHeldReason(card, regimeKey) === null;
}

/**
 * Why this card may not be promoted to LIVE, or null when nothing is holding it.
 * Promotion has no regime in hand, so the regime bar is read against the best
 * bucket: a card must have earned its sample in *some* regime before it is a
 * standing part of the desk.
 */
export function promoteHeldReason(card: Gated): string | null {
  if (card.manual_hold) return card.held_why || "held by hand";
  const needN = card.min_walkforward_n ?? 0;
  if (needN > 0 && card.n < needN) return `${card.n}/${needN} graded`;
  const needR = card.min_regime_n ?? 0;
  if (needR > 0) {
    const have = bestRegimeN(card);
    if (have < needR) return `${have}/${needR} in its best regime`;
  }
  return null;
}

/** May this card be promoted to LIVE? */
export function promoteEligible(card: Gated): boolean {
  return promoteHeldReason(card) === null;
}

/** Does this card carry any research bar at all? */
export function isGated(card: SkillGate): boolean {
  return Boolean(card.manual_hold || card.min_walkforward_n || card.min_regime_n);
}

/**
 * INDEX's bar. The settlement index is the thing the contract actually resolves
 * against, so a working INDEX read would be the most valuable seat on the desk —
 * which is exactly why it must not be promoted off a short perfect run. Kalshi
 * settles on the average of sixty one-second prints in the final minute, and how
 * that average behaves differs by session, so the sample has to be earned in the
 * regime being traded.
 */
export const INDEX_MIN_REGIME_N = 24;
