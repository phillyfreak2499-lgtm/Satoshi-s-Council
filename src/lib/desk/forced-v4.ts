/**
 * FORCED_DIRECTION_V4 — one immutable shadow direction per 15-minute window.
 *
 * Research question: at one fixed T-7:30 checkpoint, how often is the desk's
 * best directional estimate right when abstention is forbidden?
 *
 * No price, fee, confidence, Chair, quorum, chalk or consensus gate can turn the
 * output into WAIT. Quotes may be recorded afterward for economics, but they do
 * not participate in the direction.
 */
import { takerFeeCents } from "./clock.ts";
import {
  predictV3,
  type V3Features,
  type V3Weights,
} from "./chair-v3.ts";

export const V4_STUDY = "FORCED_DIRECTION_V4" as const;
export const V4_VERSION = 1 as const;
export const V4_LOCK_SECS = 450;
export const V4_LOCK_GRACE_SECS = 12;
export const V4_MIN_TRAIN = 240;
export const V4_TRAIN_CAP = 1_800;

export type V4Side = "UP" | "DOWN";

export type V4Prediction = {
  p_up: number;
  side: V4Side;
  model_n: number;
  correction_logit: number;
};

export function inV4Lock(secsLeft: number): boolean {
  return Number.isFinite(secsLeft) &&
    secsLeft <= V4_LOCK_SECS &&
    secsLeft > V4_LOCK_SECS - V4_LOCK_GRACE_SECS;
}

/** Deterministic tie-break: exactly 50% goes with the same-time market prior. */
export function forcedV4Side(pUp: number, marketP = 0.5): V4Side {
  if (pUp > 0.5) return "UP";
  if (pUp < 0.5) return "DOWN";
  return marketP >= 0.5 ? "UP" : "DOWN";
}

/**
 * Reuse the frozen v3 probability learner, but use its uncapped probability.
 * V4 changes the decision experiment, not the model math: every checkpoint is
 * forced to one side instead of being filtered by economics or confidence.
 */
export function predictForcedV4(
  weights: V3Weights | null,
  marketP: number,
  features: V3Features,
): V4Prediction {
  const p = predictV3(weights, marketP, features);
  return {
    p_up: p.raw_p_up,
    side: forcedV4Side(p.raw_p_up, p.p_market),
    model_n: p.model_n,
    correction_logit: p.correction_logit,
  };
}

export function v4Hit(side: V4Side, winner: V4Side): number {
  return side === winner ? 1 : 0;
}

/**
 * Post-hoc quoted economics only. A missing/invalid ask returns null; it never
 * changes the already-frozen direction.
 */
export function v4QuotedNet(
  side: V4Side,
  entryCents: number | null,
  winner: V4Side,
): number | null {
  if (entryCents == null || !Number.isFinite(entryCents) || entryCents <= 0 || entryCents >= 100) {
    return null;
  }
  const fee = takerFeeCents(entryCents);
  return side === winner ? 100 - entryCents - fee : -entryCents - fee;
}
