import { E1_ROSTER_CARDS, unmuteRoster, type UnmutedVotes } from "./shadow-arms";
import type { EvaluatedCandidateFrame } from "./bots";
import type { Learner, SeatId, Vote } from "./types";

export const CALL_RECOVERY_CANDIDATE = Object.freeze({
  version: "E1_RECOVERY_V1_INACTIVE",
  active: false,
  authority: "research-only-simulated",
  policy: "first directional E1 roster card in frozen roster order; at most one per real seat",
} as const);

export type RecoveryCandidate = Readonly<{
  card_id: string;
  seat: SeatId;
  original_status: Vote["skill_status"];
  vote: Vote;
}>;

export type RecoveryProjection = Readonly<{
  version: typeof CALL_RECOVERY_CANDIDATE.version;
  active: false;
  ticker: string;
  close_time: number;
  as_of: number;
  candidates: readonly RecoveryCandidate[];
  simulated: UnmutedVotes;
}>;

/**
 * Builds an inactive E1 projection from full votes captured by the producer.
 * No evidence is borrowed from a selected SIT vote. Absent or raw-WAIT cards
 * remain absent, and the real frame, votes, and learner are never modified.
 */
export function projectInactiveE1Recovery(
  frame: EvaluatedCandidateFrame,
  learner: Learner,
): RecoveryProjection {
  const rank = new Map<string, number>(E1_ROSTER_CARDS.map((id, index) => [id, index]));
  const directional = frame.evaluated
    .filter((vote) => rank.has(vote.skill_used) && (vote.raw_lean ?? vote.lean) !== "WAIT")
    .sort((a, b) => (rank.get(a.skill_used)! - rank.get(b.skill_used)!) || a.skill_used.localeCompare(b.skill_used));
  const candidates: RecoveryCandidate[] = [];
  const heard = new Set<SeatId>();
  for (const vote of directional) {
    if (heard.has(vote.seat)) continue;
    heard.add(vote.seat);
    candidates.push({ card_id: vote.skill_used, seat: vote.seat, original_status: vote.skill_status, vote });
  }
  const bySeat = new Map(candidates.map((candidate) => [candidate.seat, candidate.vote]));
  const projectedVotes = frame.votes.map((vote) => bySeat.get(vote.seat) ?? vote);
  return {
    version: CALL_RECOVERY_CANDIDATE.version,
    active: false,
    ticker: frame.ticker,
    close_time: frame.close_time,
    as_of: frame.as_of,
    candidates,
    simulated: unmuteRoster(projectedVotes, learner),
  };
}
