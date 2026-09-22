/**
 * The frozen decision rules of the three shadow arms. Pure: each function maps
 * an observed frame to an intention, and none can reach the paper Floor.
 */
import { EVIDENCE_OF, type EvidenceFamily } from "./seats.ts";
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";
import { SETTLE_BASIS, normCdf } from "./clock.ts";
import { clamp } from "./math.ts";
import type { Learner, SeatId, Snapshot, Vote } from "./types";

// ---------------------------------------------------------------------------
// NULL_FAV — the non-promotable price-favourite benchmark.
// ---------------------------------------------------------------------------

export const NULL_FAV_SCHEDULE_SECS = Object.freeze([450, 300] as const);
export const NULL_FAV_GRACE_SECS = 12;

export type Intention = {
  side: "UP" | "DOWN";
  ask_cents: number;
  fee_cents: number;
  size_at_ask: number;
  spread_cents: number;
  feeds_ok: boolean;
  secs_left: number;
};

/** Is `secsLeft` inside one of the arm's frozen checkpoints? Returns the checkpoint or null. */
export function scheduledCheckpoint(secsLeft: number, schedule: readonly number[] = NULL_FAV_SCHEDULE_SECS, grace = NULL_FAV_GRACE_SECS): number | null {
  for (const s of schedule) if (secsLeft <= s && secsLeft > s - grace) return s;
  return null;
}

export function feedsFresh(snap: Pick<Snapshot, "health" | "obs" | "as_of" | "spot_age_s">, maxReceiptAgeS = 10, maxSpotAgeS = 15): boolean {
  const age = (snap.as_of - snap.obs?.receipt_ts) / 1000;
  return snap.health.spot_ok && snap.health.kalshi_ok && snap.health.spot === "LIVE" && snap.health.kalshi === "LIVE" && !snap.health.spot_divergent &&
    !snap.health.basis_wide && snap.obs?.gap === "ok" && Number.isFinite(age) && age >= 0 && age <= maxReceiptAgeS && Number.isFinite(snap.spot_age_s) && snap.spot_age_s >= 0 && snap.spot_age_s <= maxSpotAgeS;
}

/**
 * Buy the favourite (the higher ask) when it is at or above the floor, under
 * 99, with spread ≤ 2¢ and at least one resting contract, on fresh feeds. No
 * Council, no opposition, no model edge. Null = no intention this checkpoint.
 */
export function nullFavIntention(snap: Snapshot, floorCents: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): Intention | null {
  const up = snap.yes_ask >= snap.no_ask;
  const ask = up ? snap.yes_ask : snap.no_ask;
  const bid = up ? snap.yes_bid : snap.no_bid;
  const size = up ? snap.no_bid_size : snap.yes_bid_size;
  if (!realAskCents(ask) || ask < floorCents || ask >= 99) return null;
  if (!Number.isFinite(bid) || bid < 0 || bid > ask || ask - bid > 2) return null;
  if (!(size >= 1)) return null;
  if (snap.yes_ask + snap.no_ask < 100) return null;
  const ok = feedsFresh(snap);
  if (!ok) return null;
  return { side: up ? "UP" : "DOWN", ask_cents: ask, fee_cents: feeCents(ask, engine), size_at_ask: size, spread_cents: ask - bid, feeds_ok: ok, secs_left: (snap.close_time - snap.as_of) / 1000 };
}

// ---------------------------------------------------------------------------
// E1 — the reconstructed era-B speaking package, shadow only.
// ---------------------------------------------------------------------------

/** The verified card ids of the package (live learner state, 2026-09-22). Missing ids stay flagged, never replaced. */
export const E1_ROSTER_CARDS = Object.freeze([
  "STRIKE.itm_time", "STREAK.continue_young", "CHAIN.oi_with_price", "CARRY.trend_carry", "DRIFT.aligned_3h", "DRIFT.pullback_in_trend",
] as const);

/** STREAK.continue_young reads the YES book; for the quorum it is a book read, not independent history. CARRY and CHAIN are one derivs group already. */
export const E1_FAMILY_OVERRIDE: Readonly<Partial<Record<SeatId, EvidenceFamily>>> = Object.freeze({ STREAK: "book" });

export function e1FamilyOf(seat: SeatId): EvidenceFamily {
  return E1_FAMILY_OVERRIDE[seat] ?? EVIDENCE_OF[seat];
}

export type UnmutedVotes = { votes: Vote[]; learner: Learner; released: string[]; missing: string[] };

/**
 * Shadow-only roster override: give ONLY the listed cards an eligible LIVE
 * twin so the same Chair math can hear them. Every other card keeps its live
 * status. Nothing is written back to the real learner.
 */
export function unmuteRoster(inputVotes: readonly Vote[], inputLearner: Learner, cards: readonly string[] = E1_ROSTER_CARDS): UnmutedVotes {
  const learner: Learner = { ...inputLearner, skills: { ...inputLearner.skills } };
  const missing = cards.filter((id) => !inputLearner.skills[id]);
  const released: string[] = [];
  const votes = inputVotes.map((v) => {
    const raw = v.raw_lean ?? v.lean;
    const cardId = v.skill_used;
    if (!cards.includes(cardId) || (raw !== "UP" && raw !== "DOWN")) return { ...v };
    const original = inputLearner.skills[cardId];
    if (!original) return { ...v };
    const twin = `E1_UNMUTE::${cardId}`;
    learner.skills[twin] = { ...original, id: twin, status: "LIVE", n: Math.max(50, original.n), ev_n: Math.max(50, original.ev_n), wilson: Math.max(0.61, original.wilson), ev: Math.max(1.01, original.ev), manual_hold: false, min_walkforward_n: undefined, min_regime_n: undefined, held_why: undefined };
    released.push(cardId);
    return { ...v, lean: raw, confidence: v.raw_conf ?? v.confidence, forced_sit: false, skill_used: twin, skill_status: "LIVE" as const };
  });
  return { votes, learner, released, missing };
}

// ---------------------------------------------------------------------------
// E2 — WARDEN_JUMP_VETO: a fixed cooldown after an ask shock.
// ---------------------------------------------------------------------------

export const JUMP_VETO = Object.freeze({ threshold_cents: 2, primary_cooldown_ms: 8_000, secondary_cooldown_ms: [15_000, 30_000] as const });

export type JumpVetoState = { yes_ask: number | null; no_ask: number | null; last_shock_ms: number | null; last_shock_side: "UP" | "DOWN" | null; last_shock_cents: number | null };

export const blankJumpVeto = (): JumpVetoState => ({ yes_ask: null, no_ask: null, last_shock_ms: null, last_shock_side: null, last_shock_cents: null });

/** Observe one quote. A change of ≥ threshold on either ask records a shock; unchanged quotes are not new events. */
export function observeJump(prev: JumpVetoState, yesAsk: number, noAsk: number, nowMs: number, threshold: number = JUMP_VETO.threshold_cents): JumpVetoState {
  const next: JumpVetoState = { ...prev, yes_ask: yesAsk, no_ask: noAsk };
  if (prev.yes_ask != null && Math.abs(yesAsk - prev.yes_ask) >= threshold) { next.last_shock_ms = nowMs; next.last_shock_side = "UP"; next.last_shock_cents = yesAsk - prev.yes_ask; }
  if (prev.no_ask != null && Math.abs(noAsk - prev.no_ask) >= threshold) { next.last_shock_ms = nowMs; next.last_shock_side = "DOWN"; next.last_shock_cents = noAsk - prev.no_ask; }
  return next;
}

export function vetoActive(st: JumpVetoState, nowMs: number, cooldownMs: number = JUMP_VETO.primary_cooldown_ms): boolean {
  return st.last_shock_ms != null && nowMs - st.last_shock_ms < cooldownMs;
}

// ---------------------------------------------------------------------------
// E3 — SETTLE_BASIS_MEASURED: the settlement-basis allowance as a parameter.
// ---------------------------------------------------------------------------

/** What the constant is: a 1σ noise term (fraction of spot) added to σ in quadrature. */
export const SETTLE_BASIS_ROLE = "uncertainty_buffer_1sigma_added_in_quadrature" as const;
export const SETTLE_BASIS_CANDIDATES_BPS = Object.freeze({ primary: 7, secondary: [5, 9] as const, live: SETTLE_BASIS * 10_000 });

/** The live fair with the basis as a parameter. At `basisFrac = SETTLE_BASIS` it must equal `fairYesCents(snap)` exactly. */
export function fairYesCentsWithBasis(snap: Pick<Snapshot, "spot" | "strike" | "atr" | "mins_left">, basisFrac: number): number {
  const dist = snap.spot - snap.strike;
  const atr = Math.max(snap.atr, 1);
  const mins = Math.max(snap.mins_left, 0.35);
  const basis = basisFrac * Math.max(snap.spot, 1);
  const sigma = Math.sqrt((atr * Math.sqrt(mins)) ** 2 + basis ** 2);
  const signed = sigma > 0 ? dist / sigma : 0;
  return clamp(normCdf(signed) * 100, 1, 99);
}

/** Side edge under a basis variant, fee charged once. */
export function edgeUnderBasis(snap: Pick<Snapshot, "spot" | "strike" | "atr" | "mins_left" | "yes_ask" | "no_ask">, side: "UP" | "DOWN", basisBps: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number {
  const fair = fairYesCentsWithBasis(snap, basisBps / 10_000);
  const ask = side === "UP" ? snap.yes_ask : snap.no_ask;
  if (!realAskCents(ask)) return NaN;
  return (side === "UP" ? fair : 100 - fair) - ask - feeCents(ask, engine);
}
