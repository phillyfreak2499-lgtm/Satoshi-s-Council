/**
 * OPENAI_LUNA_V1 — low-cost market-aware model benchmark.
 *
 * Uses the exact OPENAI_SHADOW_V1 packet/schema so the comparison with Terra is
 * a model-tier ablation rather than a different research question.
 */
import {
  OPENAI_SHADOW_SCHEMA,
  buildOpenAIShadowPacket,
  openAIShadowBrier,
  openAIShadowHit,
  parseOpenAIShadowDecision,
  type OpenAIShadowDecision,
  type OpenAIShadowSide,
} from "./openai-shadow";

export const OPENAI_LUNA_STUDY = "OPENAI_LUNA_V1";
export const OPENAI_LUNA_VERSION = 1;
export const OPENAI_LUNA_PROMPT_VERSION = "market-aware-luna-v1";
export const OPENAI_LUNA_DEFAULT_MODEL = "gpt-5.6-luna";
export const OPENAI_LUNA_LOCK_SECS = 450;
export const OPENAI_LUNA_LOCK_GRACE_SECS = 12;
export const OPENAI_LUNA_MAX_CAPTURES = 500;

export {
  OPENAI_SHADOW_SCHEMA as OPENAI_LUNA_SCHEMA,
  buildOpenAIShadowPacket as buildOpenAILunaPacket,
  openAIShadowBrier as openAILunaBrier,
  openAIShadowHit as openAILunaHit,
  parseOpenAIShadowDecision as parseOpenAILunaDecision,
};
export type OpenAILunaDecision = OpenAIShadowDecision;
export type OpenAILunaSide = OpenAIShadowSide;

export function inOpenAILunaLock(secsLeft: number): boolean {
  return (
    Number.isFinite(secsLeft) &&
    secsLeft <= OPENAI_LUNA_LOCK_SECS &&
    secsLeft > OPENAI_LUNA_LOCK_SECS - OPENAI_LUNA_LOCK_GRACE_SECS
  );
}
