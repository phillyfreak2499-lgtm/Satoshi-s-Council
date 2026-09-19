/**
 * Pure helpers for the prospective Chair ablation study.
 *
 * These helpers only clone/filter research inputs. They never mutate the live
 * learner, the live votes, Chair state, paper-book state, or any threshold.
 */
import type { Learner, Lean, Vote } from "./types";

export const CHAIR_ABLATION_STUDY = "CHAIR_ABLATION_V1";
export const CHAIR_ABLATION_VERSION = 1;
export const CHAIR_ABLATION_VARIANTS = [
  "control_core",
  "tape_off",
  "carry_off_when_chain",
  "authority_release",
  "raw_release",
  "reviewed_paper_rescue",
] as const;

export type ChairAblationVariant = (typeof CHAIR_ABLATION_VARIANTS)[number];

export const SEP15_REVIEWED_DIRECTIONAL_IDS = new Set<string>([
  "WICK.amd", "STREAK.mid_hold", "EXHAUST.1h_run_5m_flip", "WHALE.proxy",
  "CARRY.persist_fade", "CHAIN.oi_stall", "CASCADE.proxy_flush", "VOLT.dead_sit",
  "CLOCK.session_prior", "CLOCK.final_sit", "STRIKE.rethink_zj9p",
  "WHALE.cluster", "CHAIN.oi_against",
  "VEL.spot_lead", "ODDS.cheap_yes", "CHEAP.value", "FADE.60s_rip",
]);

const isDirectional = (lean: Lean | undefined): lean is "UP" | "DOWN" =>
  lean === "UP" || lean === "DOWN";

export function tapeOff(votes: readonly Vote[]): Vote[] {
  return votes.filter((vote) => vote.seat !== "TAPE").map((vote) => ({ ...vote }));
}

export function carryOffWhenChain(votes: readonly Vote[]): Vote[] {
  const chainSpeaks = votes.some((vote) => vote.seat === "CHAIN" && isDirectional(vote.lean));
  return votes
    .filter((vote) => !(chainSpeaks && vote.seat === "CARRY"))
    .map((vote) => ({ ...vote }));
}

export type ReleasedAuthority = {
  votes: Vote[];
  learner: Learner;
  released: Array<{ seat: string; skill: string; lean: "UP" | "DOWN"; restored_raw: boolean }>;
};

/**
 * Counterfactual only. Give every already-directional read an eligible synthetic
 * skill card so runChair can measure the same Chair math without the 2026-09-15
 * directional authority layer. When restoreRaw=true, also restore a directional
 * pre-whisper read, producing an explicit upper-bound arm.
 *
 * Synthetic ids keep CLOSED_DIRECTIONAL_CARDS from silently reapplying the very
 * policy being measured. Nothing is written back to the real learner.
 */
export function releaseDirectionalAuthority(
  inputVotes: readonly Vote[],
  inputLearner: Learner,
  restoreRaw = false,
): ReleasedAuthority {
  const learner: Learner = {
    ...inputLearner,
    skills: { ...inputLearner.skills },
  };
  const released: ReleasedAuthority["released"] = [];

  const votes = inputVotes.map((input) => {
    const restored = restoreRaw && isDirectional(input.raw_lean);
    const lean = restored ? input.raw_lean! : input.lean;
    if (!isDirectional(lean)) return { ...input };

    const original = inputLearner.skills[input.skill_used];
    if (!original) return { ...input, lean };

    const syntheticId = `ABLATION_RELEASE::${input.skill_used}`;
    const minN = Math.max(50, original.min_walkforward_n ?? 0, original.n ?? 0);
    learner.skills[syntheticId] = {
      ...original,
      id: syntheticId,
      status: "LIVE",
      n: minN,
      ev_n: Math.max(50, original.ev_n ?? 0),
      wilson: Math.max(0.61, original.wilson ?? 0),
      ev: Math.max(1.01, original.ev ?? 0),
      manual_hold: false,
      min_walkforward_n: undefined,
      min_regime_n: undefined,
      held_why: undefined,
    };
    released.push({
      seat: input.seat,
      skill: input.skill_used,
      lean,
      restored_raw: restored,
    });
    return {
      ...input,
      lean,
      confidence: restored ? (input.raw_conf ?? input.confidence) : input.confidence,
      forced_sit: false,
      skill_used: syntheticId,
      skill_status: "LIVE" as const,
    };
  });

  return { votes, learner, released };
}

export function reviewedPaperDirectionals(votes: readonly Vote[]) {
  return votes.flatMap((vote) =>
    (vote.paper ?? [])
      .filter((paper) => SEP15_REVIEWED_DIRECTIONAL_IDS.has(paper.id) && isDirectional(paper.lean))
      .map((paper) => ({
        seat: vote.seat,
        skill: paper.id,
        lean: paper.lean as "UP" | "DOWN",
        confidence: paper.confidence,
        status: paper.status,
      })),
  );
}

/**
 * Conservative Sep-15 diagnosis: only rescue a seat that is currently silent.
 * The research paper list contains the exact SHADOW/BENCH rules that still fired
 * on this frozen snapshot. We take the highest-confidence reviewed directional
 * paper read and give only that cloned read synthetic authority.
 *
 * This is intentionally NOT called a pre-review replay: the historical selector
 * used UCB, while the paper receipt does not retain that selector score. The arm
 * asks a narrower causal question: "are reviewed-away rules still seeing
 * directional setups on windows where their seat is now silent?"
 */
export function rescueReviewedPaper(
  inputVotes: readonly Vote[],
  inputLearner: Learner,
): ReleasedAuthority {
  const learner: Learner = {
    ...inputLearner,
    skills: { ...inputLearner.skills },
  };
  const released: ReleasedAuthority["released"] = [];

  const votes = inputVotes.map((input) => {
    if (isDirectional(input.lean)) return { ...input };
    const paper = [...(input.paper ?? [])]
      .filter((p) => SEP15_REVIEWED_DIRECTIONAL_IDS.has(p.id) && isDirectional(p.lean))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!paper || !isDirectional(paper.lean)) return { ...input };

    const original = inputLearner.skills[paper.id];
    if (!original) return { ...input };
    const syntheticId = `ABLATION_SEP15_RESCUE::${paper.id}`;
    const minN = Math.max(50, original.min_walkforward_n ?? 0, original.n ?? 0);
    learner.skills[syntheticId] = {
      ...original,
      id: syntheticId,
      status: "LIVE",
      n: minN,
      ev_n: Math.max(50, original.ev_n ?? 0),
      wilson: Math.max(0.61, original.wilson ?? 0),
      ev: Math.max(1.01, original.ev ?? 0),
      manual_hold: false,
      min_walkforward_n: undefined,
      min_regime_n: undefined,
      held_why: undefined,
    };
    released.push({
      seat: input.seat,
      skill: paper.id,
      lean: paper.lean,
      restored_raw: true,
    });
    return {
      ...input,
      lean: paper.lean,
      raw_lean: paper.lean,
      confidence: paper.confidence,
      raw_conf: paper.confidence,
      forced_sit: false,
      skill_used: syntheticId,
      skill_status: "LIVE" as const,
    };
  });

  return { votes, learner, released };
}

export function rawDirectionalSeats(votes: readonly Vote[]): string[] {
  return votes
    .filter((vote) => isDirectional(vote.raw_lean))
    .map((vote) => vote.seat);
}
