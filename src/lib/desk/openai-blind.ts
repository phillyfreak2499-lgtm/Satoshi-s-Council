/**
 * OPENAI_BLIND_V1 — market-blind paper-only model research contract.
 *
 * This module deliberately withholds Kalshi prices, Council votes, SATOSHI,
 * desk fair values and entry economics. The point is to measure whether the
 * same language model finds independent information in raw same-time context.
 * It cannot call OpenAI, write the DB, vote, book, size, promote, or execute.
 */
import type { Snapshot } from "./types.ts";
import {
  OPENAI_SHADOW_SCHEMA,
  openAIShadowBrier,
  openAIShadowHit,
  parseOpenAIShadowDecision,
  type OpenAIShadowDecision,
  type OpenAIShadowSide,
} from "./openai-shadow";

export const OPENAI_BLIND_STUDY = "OPENAI_BLIND_V1";
export const OPENAI_BLIND_VERSION = 1;
export const OPENAI_BLIND_PROMPT_VERSION = "blind-marketless-v1";
export const OPENAI_BLIND_DEFAULT_MODEL = "gpt-5.6-terra";
export const OPENAI_BLIND_LOCK_SECS = 450;
export const OPENAI_BLIND_LOCK_GRACE_SECS = 12;
export const OPENAI_BLIND_MAX_CAPTURES = 500;

export {
  OPENAI_SHADOW_SCHEMA as OPENAI_BLIND_SCHEMA,
  openAIShadowBrier as openAIBlindBrier,
  openAIShadowHit as openAIBlindHit,
  parseOpenAIShadowDecision as parseOpenAIBlindDecision,
};
export type OpenAIBlindDecision = OpenAIShadowDecision;
export type OpenAIBlindSide = OpenAIShadowSide;

export function inOpenAIBlindLock(secsLeft: number): boolean {
  return (
    Number.isFinite(secsLeft) &&
    secsLeft <= OPENAI_BLIND_LOCK_SECS &&
    secsLeft > OPENAI_BLIND_LOCK_SECS - OPENAI_BLIND_LOCK_GRACE_SECS
  );
}

const bounded = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The blind packet intentionally has no market, council, Chair or entry object.
 * Keep the omission structural rather than depending on prompt instructions.
 */
export function buildOpenAIBlindPacket(snap: Snapshot) {
  return {
    protocol: OPENAI_BLIND_STUDY,
    prompt_version: OPENAI_BLIND_PROMPT_VERSION,
    frozen_at: new Date(snap.as_of).toISOString(),
    window: {
      ticker: snap.ticker,
      close_time: new Date(snap.close_time).toISOString(),
      phase: snap.phase,
      secs_left: bounded(snap.secs_left),
      session: snap.session,
      regime: snap.regime_key,
      clock: snap.clock_key,
    },
    bitcoin: {
      spot: bounded(snap.spot),
      index_px: bounded(snap.index_px),
      perp: bounded(snap.perp),
      strike: bounded(snap.strike),
      distance_usd: bounded(snap.spot) - bounded(snap.strike),
      ret5: bounded(snap.ret5),
      ret15: bounded(snap.ret15),
      ret30: bounded(snap.ret30),
      ret1h: bounded(snap.ret1h),
      atr_pct: bounded(snap.atr_pct),
      vol_percentile: bounded(snap.vol_percentile),
      range_pos: bounded(snap.range_pos),
      location: snap.location,
      spot_lead_bps: bounded(snap.spot_lead_bps),
      basis_bps: bounded(snap.basis_bps),
    },
    derivatives: {
      funding_apr: bounded(snap.funding_apr),
      oi_delta_3m: bounded(snap.oi_delta_3m),
      oi_delta_10m: bounded(snap.oi_delta_10m),
      oi_delta_1h: bounded(snap.oi_delta_1h),
      oi_usd_delta_10m: bounded(snap.oi_usd_delta_10m),
      liq_long_usd: bounded(snap.liq_long_usd),
      liq_short_usd: bounded(snap.liq_short_usd),
      liquidation_count: bounded(snap.liq_n),
      cascade_proxy: Boolean(snap.cascade_proxy),
    },
    context: {
      fear_greed: bounded(snap.fear_greed),
      fear_greed_label: String(snap.fear_greed_label ?? "").slice(0, 80),
      spot_health: snap.health.spot,
      spot_age_s: bounded(snap.spot_age_s),
    },
  };
}
