/**
 * OPENAI_SHADOW_V1 — paper-only model research contract.
 *
 * This module is intentionally pure. It builds a bounded frozen packet and
 * validates the model's structured result. It cannot call OpenAI, write the DB,
 * vote, book, size, promote, or alter the Chair.
 */
import type { Snapshot, Vote } from "./types.ts";

export const OPENAI_SHADOW_STUDY = "OPENAI_SHADOW_V1";
export const OPENAI_SHADOW_VERSION = 1;
export const OPENAI_SHADOW_PROMPT_VERSION = "market-aware-v1";
export const OPENAI_SHADOW_DEFAULT_MODEL = "gpt-5.6-terra";
export const OPENAI_SHADOW_LOCK_SECS = 450;
export const OPENAI_SHADOW_LOCK_GRACE_SECS = 12;

export type OpenAIShadowSide = "UP" | "DOWN";
export type OpenAIShadowDataQuality = "GOOD" | "DEGRADED" | "POOR";

export type OpenAIShadowDecision = {
  p_up: number;
  side: OpenAIShadowSide;
  conviction: number;
  regime: string;
  strongest_evidence: string[];
  contradictions: string[];
  data_quality: OpenAIShadowDataQuality;
  would_abstain: boolean;
};

export const OPENAI_SHADOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    p_up: { type: "number", minimum: 0, maximum: 1 },
    side: { type: "string", enum: ["UP", "DOWN"] },
    conviction: { type: "integer", minimum: 0, maximum: 100 },
    regime: { type: "string", minLength: 1, maxLength: 120 },
    strongest_evidence: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 180 },
    },
    contradictions: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 180 },
    },
    data_quality: { type: "string", enum: ["GOOD", "DEGRADED", "POOR"] },
    would_abstain: { type: "boolean" },
  },
  required: [
    "p_up",
    "side",
    "conviction",
    "regime",
    "strongest_evidence",
    "contradictions",
    "data_quality",
    "would_abstain",
  ],
} as const;

export function inOpenAIShadowLock(secsLeft: number): boolean {
  return (
    Number.isFinite(secsLeft) &&
    secsLeft <= OPENAI_SHADOW_LOCK_SECS &&
    secsLeft > OPENAI_SHADOW_LOCK_SECS - OPENAI_SHADOW_LOCK_GRACE_SECS
  );
}

const bounded = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const maybe = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function compactVote(v: Vote) {
  return {
    seat: v.seat,
    lean: v.lean,
    confidence: Math.max(0, Math.min(100, bounded(v.confidence))),
    raw_lean: v.raw_lean ?? v.lean,
    raw_confidence: Math.max(0, Math.min(100, bounded(v.raw_conf ?? v.confidence))),
    health: v.health,
    feed_age_s: bounded(v.feed_age_s),
    reasoning: String(v.reasoning ?? "").slice(0, 240),
    evidence: (v.evidence ?? []).slice(0, 3).map((s) => String(s).slice(0, 160)),
    counter: String(v.counter ?? "").slice(0, 180),
  };
}

/**
 * Bounded same-time packet. No Chair result is accepted by this function, so
 * the shadow analyst cannot simply copy the Chair. No historical winner or
 * post-close field exists here.
 */
export function buildOpenAIShadowPacket(snap: Snapshot, votes: Vote[]) {
  return {
    protocol: OPENAI_SHADOW_STUDY,
    prompt_version: OPENAI_SHADOW_PROMPT_VERSION,
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
    market: {
      yes_bid: bounded(snap.yes_bid),
      yes_ask: bounded(snap.yes_ask),
      no_bid: bounded(snap.no_bid),
      no_ask: bounded(snap.no_ask),
      yes_mid: bounded(snap.yes_mid),
      fair_yes: bounded(snap.fair_yes),
      spread_cents: bounded(snap.spread_cents),
      combined_ask_cents: bounded(snap.combined_ask_cents),
      yes_bid_size: bounded(snap.yes_bid_size),
      no_bid_size: bounded(snap.no_bid_size),
      quote_age_s: bounded(snap.quote_age_s),
      kalshi_taker_yes: bounded(snap.kalshi_taker_yes),
      kalshi_trade_n: bounded(snap.kalshi_trade_n),
      edge_up: bounded(snap.edge_up),
      edge_down: bounded(snap.edge_down),
      fee_yes: bounded(snap.fee_yes),
      fee_no: bounded(snap.fee_no),
      settlement_fair_yes: maybe(snap.lab_fair_yes),
      settlement_fair_age_s: bounded(snap.lab_age_s),
      settlement_locked_prints: bounded(snap.lab_locked),
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
      chalk: Boolean(snap.chalk),
      health: snap.health,
      spot_age_s: bounded(snap.spot_age_s),
      quote_age_s: bounded(snap.quote_age_s),
    },
    council: votes.map(compactVote),
  };
}

export function parseOpenAIShadowDecision(value: unknown): OpenAIShadowDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const p = Number(v.p_up);
  const conviction = Number(v.conviction);
  const side = v.side;
  const quality = v.data_quality;
  const evidence = v.strongest_evidence;
  const contradictions = v.contradictions;
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  if (side !== "UP" && side !== "DOWN") return null;
  if ((p >= 0.5 ? "UP" : "DOWN") !== side) return null;
  if (!Number.isInteger(conviction) || conviction < 0 || conviction > 100) return null;
  if (quality !== "GOOD" && quality !== "DEGRADED" && quality !== "POOR") return null;
  if (typeof v.regime !== "string" || !v.regime.trim()) return null;
  if (!Array.isArray(evidence) || !evidence.every((x) => typeof x === "string")) return null;
  if (!Array.isArray(contradictions) || !contradictions.every((x) => typeof x === "string")) return null;
  if (typeof v.would_abstain !== "boolean") return null;
  return {
    p_up: p,
    side,
    conviction,
    regime: v.regime.slice(0, 120),
    strongest_evidence: evidence.slice(0, 4).map((x) => x.slice(0, 180)),
    contradictions: contradictions.slice(0, 4).map((x) => x.slice(0, 180)),
    data_quality: quality,
    would_abstain: v.would_abstain,
  };
}

export function openAIShadowHit(side: OpenAIShadowSide, winner: OpenAIShadowSide): number {
  return side === winner ? 1 : 0;
}

export function openAIShadowBrier(pUp: number, winner: OpenAIShadowSide): number {
  const y = winner === "UP" ? 1 : 0;
  return (pUp - y) ** 2;
}
