import type { Learner, Vote } from "./types";

/** Owner review of the September 15 public record. Applied once to saved labels;
 * counters, pockets, weights, and historical grades are left intact. */
export const AUTHORITY_REVIEW_V1 = "SEAT_REVIEW_2026_09_15_V1";

const DEMOTE_DIRECTIONAL = [
  "WICK.amd", "STREAK.mid_hold", "EXHAUST.1h_run_5m_flip", "WHALE.proxy",
  "CARRY.persist_fade", "CHAIN.oi_stall", "CASCADE.proxy_flush", "VOLT.dead_sit",
  "CLOCK.session_prior", "CLOCK.final_sit", "STRIKE.rethink_zj9p",
] as const;
const NEW_BENCH = ["WHALE.cluster", "CHAIN.oi_against"] as const;
export const CLOSED_DIRECTIONAL_CARDS = new Set<string>([
  "VEL.spot_lead", "ODDS.cheap_yes", "CHEAP.value", "FADE.60s_rip",
]);

export function applyAuthorityReview(learner: Learner): boolean {
  if (learner.authority_review_version === AUTHORITY_REVIEW_V1) return false;
  for (const id of DEMOTE_DIRECTIONAL) {
    const card = learner.skills[id];
    if (card?.status === "LIVE") card.status = "SHADOW";
  }
  for (const id of NEW_BENCH) {
    const card = learner.skills[id];
    if (card && (card.status === "LIVE" || card.status === "SHADOW")) card.status = "BENCH";
  }
  for (const id of CLOSED_DIRECTIONAL_CARDS) {
    const card = learner.skills[id];
    if (card) card.status = "BENCH";
  }
  // WARDEN, ORBIT and WIRE are non-voting guards/context. A predictive grade is
  // not evidence that disabling their veto or tag function would be safe.
  learner.authority_review_version = AUTHORITY_REVIEW_V1;
  return true;
}

type AuthorityLearner = Pick<Learner, "skills">;

/** A directional read must have a real, eligible LIVE card with mature evidence.
 * The old skill Brier is a strength score, so it grants no new authority here. */
export function directionalHoldReason(
  vote: Pick<Vote, "lean" | "skill_used" | "skill_status">,
  learner: AuthorityLearner,
  regimeKey: string,
): string | null {
  if (vote.lean === "WAIT") return null;
  const card = learner.skills[vote.skill_used];
  if (!card || card.status !== "LIVE" || vote.skill_status !== "LIVE")
    return "no LIVE predictive card";
  if (card.manual_hold) return card.held_why || "held by owner";
  if (card.min_walkforward_n && card.n < card.min_walkforward_n)
    return `${card.n}/${card.min_walkforward_n} graded`;
  if (card.min_regime_n && (card.pocket?.[regimeKey]?.n ?? 0) < card.min_regime_n)
    return `${card.pocket?.[regimeKey]?.n ?? 0}/${card.min_regime_n} in ${regimeKey}`;
  if (card.n < 50 || card.ev_n < 50) return "fewer than 50 graded economic reads";
  if (card.wilson < 0.60 || card.ev <= 1.0) return "Wilson or after-fee EV below owner bar";
  return null;
}

const NON_VOTERS = new Set(["WARDEN", "ORBIT", "WIRE"]);

/** Normalize before *every* Chair consumer, including quorum and book guards.
 * The original vote is kept by the learner for paper grading; a disallowed side
 * is shown as a forced sit and contributes neither direction nor sit mass. */
export function admitCouncilVotes(votes: Vote[], learner: AuthorityLearner, regimeKey: string): Vote[] {
  return votes.map((vote) => {
    if (NON_VOTERS.has(vote.seat)) return vote;
    const reason = directionalHoldReason(vote, learner, regimeKey);
    if (!reason) return vote;
    return {
      ...vote,
      lean: "WAIT",
      forced_sit: true,
      raw_lean: vote.raw_lean ?? vote.lean,
      raw_conf: vote.raw_conf ?? vote.confidence,
      confidence: Math.max(70, vote.confidence),
      reasoning: `${vote.reasoning} · eligibility sit (${reason})`,
    };
  });
}
