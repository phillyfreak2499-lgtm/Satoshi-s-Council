/**
 * SELECTOR ATTRIBUTION v1 — pure.
 *
 * THE QUESTION. The 80¢ trial's +215¢ decomposed into −415¢ paid on 91 shared
 * fills and +630¢ saved by refusing 11 cheap windows the lower floor took
 * (docs/SELECTOR_VS_FLOOR_2026-09-22.md). The edge, if it exists, is the
 * selector refusing a small set of bad windows, not the floor. This module
 * records, prospectively and window by window, every divergence between a
 * BLIND eligible opportunity (the price favourite at the live floor with a
 * tight spread, resting size and fresh feeds — no Council, no model) and the
 * Chair-selected opportunity (the production paper book's actual fill), with
 * everything the Chair could see at that instant: ask on both price lanes,
 * exact fee, Chair gate numbers, model fair, market mid, settlement-index
 * margin, model edge, feed health, quorum state, eligible seats, directional
 * votes, evidence groups and the production rejection reason. After the
 * official result: the net, and the counterfactual net under a 92¢ cap, the
 * flat-3¢ vs price-aware gate variants, and the whole-cent vs exact lane.
 *
 * WHAT A "CHAIR PROBABILITY" IS HERE. Chair confidence is a gate number, never
 * a percentage probability (its test says so). The probability-shaped fields
 * are `model_fair_yes` (the main model's fair YES value in cents, the input to
 * `edge_up/edge_down`) and `market_yes_mid` (the venue's YES mid). Both are
 * recorded beside the Chair's confidence/score/bar; none is relabelled.
 *
 * WHAT IT REFUSES TO DO. It decides nothing, writes nothing, reads no clock and
 * no database. It is called only from the shadow-lab observer with a cloned
 * frame; no seat, gate, Chair input, learner or book imports it (rail).
 */
import { GATE_VARIANTS } from "./counterfactuals.ts";
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";
import { DEPLOYED_POLICY, gateVector, reachableQuorum, supporterRows, type GateVector, type ReachableQuorum } from "./gate-vector.ts";
import { EVIDENCE_OF } from "./seats.ts";
import type { SelectiveContext } from "./selective-entry.ts";
import { nullFavIntention, scheduledCheckpoint } from "./shadow-arms.ts";
import type { CallLogRow, ChairResult, SeatId, Snapshot } from "./types";

export const SELECTOR_ATTRIBUTION_VERSION = "SELECTOR_ATTRIBUTION_V1";
/** The research band: the same 3–10 minutes the selective policy and the E1 package decide in. */
export const ATTRIBUTION_BAND_SECS = Object.freeze({ min: 180, max: 600 });
/** The blind opportunity's floor is the deployed policy's own floor (80¢), never a tuned number. */
export const ATTRIBUTION_FLOOR_CENTS: number = DEPLOYED_POLICY.params.floor_cents;
/** The external auditor's proposed hard block, recorded as a counterfactual only. */
export const CAP_COUNTERFACTUAL_CENTS = 92;
/** A side already at 99¢ is chalk: the WAIT rate is reported with and without it. */
export const CHALK_CENTS = 99;
export const WINDOW_MS = 900_000;

export type Side = "UP" | "DOWN";
export type AttributionKind = "BLIND_ELIGIBLE" | "CHAIR_FILL" | "WINDOW";
export type Divergence = "BLIND_ONLY" | "CHAIR_ONLY" | "BOTH_SAME_SIDE" | "BOTH_OPPOSITE" | "NEITHER";

// ---------------------------------------------------------------------------
// Quotes on both lanes.
// ---------------------------------------------------------------------------

export type SideQuote = {
  side: Side;
  /** Exact venue lane (falls back to the whole-cent lane when the exact field is absent). */
  ask_exact: number;
  bid_exact: number;
  size_exact: number;
  /** The whole-cent decision lane the Chair and the floor read. */
  ask_whole: number;
  bid_whole: number;
  size_whole: number;
  /** True when the exact lane was actually present on the snapshot. */
  exact_lane_present: boolean;
};

/** Both lanes for one side. YES ask depth rests on the NO bid and vice versa. */
export function sideQuote(snap: Snapshot, side: Side): SideQuote {
  const up = side === "UP";
  const askWhole = up ? snap.yes_ask : snap.no_ask;
  const bidWhole = up ? snap.yes_bid : snap.no_bid;
  const sizeWhole = up ? snap.no_bid_size : snap.yes_bid_size;
  const askExact = up ? snap.yes_ask_exact : snap.no_ask_exact;
  const bidExact = up ? snap.yes_bid_exact : snap.no_bid_exact;
  const sizeExact = up ? snap.no_bid_size_exact : snap.yes_bid_size_exact;
  return {
    side,
    ask_exact: Number.isFinite(askExact) ? (askExact as number) : askWhole,
    bid_exact: Number.isFinite(bidExact) ? (bidExact as number) : bidWhole,
    size_exact: Number.isFinite(sizeExact) ? (sizeExact as number) : sizeWhole,
    ask_whole: askWhole, bid_whole: bidWhole, size_whole: sizeWhole,
    exact_lane_present: Number.isFinite(askExact),
  };
}

// ---------------------------------------------------------------------------
// The blind opportunity.
// ---------------------------------------------------------------------------

export type BlindOpportunity = {
  side: Side;
  quote: SideQuote;
  /** Fee on the exact ask with the one fee engine. */
  fee_exact: number;
  fee_whole: number;
  feeds_ok: boolean;
  secs_left: number;
};

/**
 * The blind eligible opportunity: `nullFavIntention` at the deployed floor,
 * decided on the whole-cent lane exactly as the NULL_FAV control decides, then
 * priced on the exact lane for the economics. Null = no blind opportunity.
 */
export function blindOpportunity(snap: Snapshot, floor = ATTRIBUTION_FLOOR_CENTS, engine: FeeEngineId = DEFAULT_FEE_ENGINE): BlindOpportunity | null {
  const i = nullFavIntention(snap, floor, engine);
  if (!i) return null;
  const quote = sideQuote(snap, i.side);
  if (!realAskCents(quote.ask_exact)) return null;
  return { side: i.side, quote, fee_exact: feeCents(quote.ask_exact, engine), fee_whole: feeCents(quote.ask_whole, engine), feeds_ok: i.feeds_ok, secs_left: i.secs_left };
}

// ---------------------------------------------------------------------------
// Counterfactual flags at decision time.
// ---------------------------------------------------------------------------

export type GateVariantFlag = { id: string; threshold_cents: number; pass: boolean | null };

export type CounterfactualFlags = {
  cap_cents: number;
  cap_blocked: boolean;
  /** FLAT_3C is the production rule; the others are the price-aware variants (counterfactuals.ts). */
  gate_variants: GateVariantFlag[];
  chalk: boolean;
  max_ask_whole: number;
  price_lane: { ask_exact: number; ask_whole: number; exact_minus_whole: number; fee_exact: number; fee_whole: number; fee_delta: number; exact_lane_present: boolean };
};

/** Everything a cap, a gate variant or a lane comparison needs, computed once at decision time. */
export function counterfactualFlags(snap: Snapshot, q: SideQuote, edgeCents: number | null, engine: FeeEngineId = DEFAULT_FEE_ENGINE, cap = CAP_COUNTERFACTUAL_CENTS): CounterfactualFlags {
  const feeExact = feeCents(q.ask_exact, engine), feeWhole = feeCents(q.ask_whole, engine);
  const maxAsk = Math.max(snap.yes_ask, snap.no_ask);
  return {
    cap_cents: cap, cap_blocked: q.ask_exact > cap,
    gate_variants: GATE_VARIANTS.map((v) => {
      const threshold = v.threshold(q.ask_whole);
      return { id: v.id, threshold_cents: Math.round(threshold * 1000) / 1000, pass: edgeCents == null || !Number.isFinite(edgeCents) ? null : edgeCents >= threshold };
    }),
    chalk: maxAsk >= CHALK_CENTS, max_ask_whole: maxAsk,
    price_lane: { ask_exact: q.ask_exact, ask_whole: q.ask_whole, exact_minus_whole: Math.round((q.ask_exact - q.ask_whole) * 1000) / 1000, fee_exact: feeExact, fee_whole: feeWhole, fee_delta: feeExact - feeWhole, exact_lane_present: q.exact_lane_present },
  };
}

// ---------------------------------------------------------------------------
// What the Chair had.
// ---------------------------------------------------------------------------

export type SeatFact = { seat: SeatId; lean: string; status: string; health: string; conf: number; weight: number; skill_used: string; folded: boolean; forced_sit: boolean; family: string };

export type ProductionAudit = { checks: Array<{ id: string; label: string; pass: boolean | null }>; positioned: boolean; eligible: boolean; mode: string } | null;

export type ChairState = {
  lean: string;
  confidence: number;
  score: number;
  bar: number;
  vs_bar: number | null;
  dir_mass: number | null;
  sit_mass: number;
  hard_fail: boolean;
  quorum: { up: number; down: number; wait: number };
  seats: SeatFact[];
  /** Seats whose status/health could count toward a quorum on their side (supporterRows), both sides. */
  eligible_seats: { up: SeatId[]; down: SeatId[] };
  directional_votes: { up: SeatId[]; down: SeatId[]; wait: SeatId[] };
  evidence_groups: { up: string[]; down: string[] };
  quorum_state: { up: ReachableQuorum; down: ReachableQuorum } | null;
  /** The deployed gate vector re-evaluated on the cloned frame (null without a context). */
  gate: { mode: string; binding_reason: string | null; eligible_ignoring_confirmation: boolean; positioned: boolean; failed: string[]; not_evaluable: string[]; checks: Array<{ id: string; pass: boolean | null; value: string }> } | null;
  /** The engine's own admission audit for this tick, as the frame carried it. */
  production_audit: ProductionAudit;
  feeds: { ok: boolean; spot: string; kalshi: string; spot_ok: boolean; kalshi_ok: boolean; spot_divergent: boolean; basis_wide: boolean; spot_age_s: number; quote_age_s: number; receipt_age_s: number | null; gap: string | null };
  model_fair_yes: number;
  market_yes_mid: number;
  lab_fair_yes: number | null;
  lab_age_s: number;
  fee_yes: number;
  fee_no: number;
};

const feedsOk = (snap: Snapshot): boolean => !!snap.health && snap.health.spot_ok && snap.health.kalshi_ok && snap.health.spot === "LIVE" && snap.health.kalshi === "LIVE" && !snap.health.spot_divergent && !snap.health.basis_wide && snap.obs?.gap === "ok";

/** Model edge after fee on `side`, exactly the `snap.edge_*` the Chair's gate reads. */
export function modelEdge(snap: Snapshot, side: Side | null): number | null {
  if (!side) return null;
  const e = side === "UP" ? snap.edge_up : snap.edge_down;
  return Number.isFinite(e) ? e : null;
}

/** Settlement-index margin on `side` at `askWhole`: lab fair for the side − ask − fee; null when the lab is dark. */
export function indexMargin(snap: Snapshot, side: Side | null, askWhole: number, engine: FeeEngineId = DEFAULT_FEE_ENGINE): number | null {
  const fair = snap.lab_fair_yes;
  if (!side || fair == null || !Number.isFinite(fair) || !realAskCents(askWhole)) return null;
  return Math.round(((side === "UP" ? fair : 100 - fair) - askWhole - feeCents(askWhole, engine)) * 1000) / 1000;
}

/** Everything the Chair had at this tick, from the production Chair result and the cloned frame. */
export function chairState(snap: Snapshot, chair: ChairResult, ctx: SelectiveContext | null, productionAudit: ProductionAudit = null): ChairState {
  const rows = Array.isArray(chair.rows) ? chair.rows : [];
  const seats: SeatFact[] = rows.map((r) => ({ seat: r.seat, lean: r.lean, status: r.status, health: r.health, conf: r.conf, weight: r.weight, skill_used: r.skill_used, folded: !!r.folded, forced_sit: !!r.forced_sit, family: EVIDENCE_OF[r.seat] ?? "?" }));
  const up = supporterRows(chair, "UP").map((r) => r.seat), down = supporterRows(chair, "DOWN").map((r) => r.seat);
  let gate: GateVector | null = null;
  if (ctx) { try { gate = gateVector(snap, chair, ctx, DEPLOYED_POLICY); } catch { gate = null; } }
  const mode: "normal" | "tight" = gate?.mode ?? "normal";
  let quorumState: ChairState["quorum_state"] = null;
  try { quorumState = { up: reachableQuorum(chair, "UP", DEPLOYED_POLICY, mode), down: reachableQuorum(chair, "DOWN", DEPLOYED_POLICY, mode) }; } catch { quorumState = null; }
  const receiptAge = snap.obs && Number.isFinite(snap.obs.receipt_ts) ? (snap.as_of - snap.obs.receipt_ts) / 1000 : null;
  return {
    lean: chair.lean, confidence: chair.confidence, score: chair.score, bar: chair.bar,
    vs_bar: Number.isFinite(chair.vs_bar) ? chair.vs_bar : null, dir_mass: Number.isFinite(chair.dir_mass) ? chair.dir_mass : null, sit_mass: chair.sit_mass, hard_fail: !!chair.hard_fail,
    quorum: { up: chair.quorum?.up ?? 0, down: chair.quorum?.down ?? 0, wait: chair.quorum?.wait ?? 0 },
    seats,
    eligible_seats: { up, down },
    directional_votes: { up: rows.filter((r) => r.lean === "UP").map((r) => r.seat), down: rows.filter((r) => r.lean === "DOWN").map((r) => r.seat), wait: rows.filter((r) => r.lean === "WAIT").map((r) => r.seat) },
    evidence_groups: { up: [...new Set(up.map((s) => EVIDENCE_OF[s]))], down: [...new Set(down.map((s) => EVIDENCE_OF[s]))] },
    quorum_state: quorumState,
    gate: gate ? { mode: gate.mode, binding_reason: gate.binding_reason, eligible_ignoring_confirmation: gate.eligible_ignoring_confirmation, positioned: gate.positioned, failed: gate.failed, not_evaluable: gate.not_evaluable, checks: gate.checks.map((k) => ({ id: k.id, pass: k.pass, value: k.value })) } : null,
    production_audit: productionAudit,
    feeds: { ok: feedsOk(snap), spot: snap.health?.spot ?? "?", kalshi: snap.health?.kalshi ?? "?", spot_ok: !!snap.health?.spot_ok, kalshi_ok: !!snap.health?.kalshi_ok, spot_divergent: !!snap.health?.spot_divergent, basis_wide: !!snap.health?.basis_wide, spot_age_s: snap.spot_age_s, quote_age_s: snap.quote_age_s, receipt_age_s: receiptAge, gap: snap.obs?.gap ?? null },
    model_fair_yes: snap.fair_yes, market_yes_mid: snap.yes_mid, lab_fair_yes: snap.lab_fair_yes ?? null, lab_age_s: snap.lab_age_s, fee_yes: snap.fee_yes, fee_no: snap.fee_no,
  };
}

/** The selective context the deployed gate needs, from what the frame carries. `watch` is unknown to an observer: confirmation is reported as not evaluable, never guessed. */
export function contextFromFrame(callLog: readonly CallLogRow[] | undefined, selective: { ready?: boolean; start?: number } | undefined): SelectiveContext | null {
  if (!selective || typeof selective.ready !== "boolean" || !Number.isFinite(selective.start)) return null;
  return { calls: Array.isArray(callLog) ? callLog.map((r) => ({ ...r })) : [], ready: selective.ready, start: selective.start as number, watch: null };
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

export type AttributionRow = {
  ticker: string;
  close_ms: number;
  kind: AttributionKind;
  decided_ms: number;
  side: Side | null;
  ask_cents: number | null;
  ask_whole_cents: number | null;
  fee_engine: FeeEngineId;
  fee_cents: number | null;
  spread_cents: number | null;
  size_at_ask: number | null;
  chair_lean: string | null;
  chair_confidence: number | null;
  chair_score: number | null;
  chair_bar: number | null;
  model_fair_yes: number | null;
  market_yes_mid: number | null;
  lab_fair_yes: number | null;
  model_edge_cents: number | null;
  index_margin_cents: number | null;
  feeds_ok: boolean | null;
  quorum_up: number | null;
  quorum_down: number | null;
  quorum_wait: number | null;
  eligible: boolean | null;
  rejection_reason: string | null;
  divergence: Divergence | null;
  chalk: boolean | null;
  cap_blocked: boolean | null;
  counterfactual: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export function attributionKey(r: Pick<AttributionRow, "ticker" | "close_ms" | "kind">): string {
  return `${r.ticker}|${r.close_ms}|${r.kind}`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function baseRow(snap: Snapshot, kind: AttributionKind, side: Side | null, state: ChairState): AttributionRow {
  return {
    ticker: snap.ticker, close_ms: snap.close_time, kind, decided_ms: snap.as_of, side,
    ask_cents: null, ask_whole_cents: null, fee_engine: DEFAULT_FEE_ENGINE, fee_cents: null, spread_cents: null, size_at_ask: null,
    chair_lean: state.lean, chair_confidence: num(state.confidence), chair_score: num(state.score), chair_bar: num(state.bar),
    model_fair_yes: num(state.model_fair_yes), market_yes_mid: num(state.market_yes_mid), lab_fair_yes: num(state.lab_fair_yes),
    model_edge_cents: null, index_margin_cents: null, feeds_ok: state.feeds.ok,
    quorum_up: state.quorum.up, quorum_down: state.quorum.down, quorum_wait: state.quorum.wait,
    eligible: state.gate ? state.gate.eligible_ignoring_confirmation : (state.production_audit ? state.production_audit.eligible : null),
    rejection_reason: state.gate?.binding_reason ?? null, divergence: null, chalk: null, cap_blocked: null, counterfactual: {}, payload: {},
  };
}

/**
 * The BLIND_ELIGIBLE row: the first tick in the band where the blind rule had
 * an opportunity. `chair_same_side` says whether the Chair's read at that tick
 * was the same side; whether the Chair actually FILLED is the CHAIR_FILL row's job.
 */
export function blindEligibleRow(snap: Snapshot, opp: BlindOpportunity, state: ChairState, extra: Record<string, unknown> = {}, engine: FeeEngineId = DEFAULT_FEE_ENGINE): AttributionRow {
  const q = opp.quote;
  const edge = modelEdge(snap, opp.side);
  const cf = counterfactualFlags(snap, q, edge, engine);
  const row = baseRow(snap, "BLIND_ELIGIBLE", opp.side, state);
  row.ask_cents = q.ask_exact; row.ask_whole_cents = q.ask_whole; row.fee_engine = engine; row.fee_cents = opp.fee_exact;
  row.spread_cents = Math.round((q.ask_exact - q.bid_exact) * 1000) / 1000; row.size_at_ask = q.size_exact;
  row.model_edge_cents = edge; row.index_margin_cents = indexMargin(snap, opp.side, q.ask_whole, engine);
  row.chalk = cf.chalk; row.cap_blocked = cf.cap_blocked;
  row.counterfactual = { ...cf };
  row.payload = {
    research_version: SELECTOR_ATTRIBUTION_VERSION, secs_left: opp.secs_left, feeds_ok: opp.feeds_ok,
    chair_same_side: state.lean === opp.side, chair_opposite: state.lean === (opp.side === "UP" ? "DOWN" : "UP"),
    chair: state, price_lane: "exact_measurement", hittability: "UNKNOWN at 2s poll",
    rejection_reason_note: "deployed guard re-evaluated on the cloned frame without the engine's confirmation watch; when it names confirmation, read chair.production_audit for the engine's own verdict",
    ...extra,
  };
  return row;
}

/**
 * The CHAIR_FILL row: the production paper book holds a position in this
 * window (a call-log row). The booked ask is the ledger's whole-cent price; the
 * exact ask is what the venue showed on that side when the observer first saw
 * the position (≤ one poll later), labelled as such.
 */
export function chairFillRow(snap: Snapshot, fill: Pick<CallLogRow, "lean" | "cents" | "t">, state: ChairState, blind: { side: Side; ask_exact: number; decided_ms: number } | null, extra: Record<string, unknown> = {}, engine: FeeEngineId = DEFAULT_FEE_ENGINE): AttributionRow {
  const side = fill.lean;
  const q = sideQuote(snap, side);
  const edge = modelEdge(snap, side);
  const cf = counterfactualFlags(snap, { ...q, ask_whole: fill.cents }, edge, engine);
  const row = baseRow(snap, "CHAIR_FILL", side, state);
  row.ask_cents = realAskCents(q.ask_exact) ? q.ask_exact : fill.cents; row.ask_whole_cents = fill.cents; row.fee_engine = engine;
  row.fee_cents = feeCents(row.ask_cents, engine);
  row.spread_cents = Math.round((q.ask_exact - q.bid_exact) * 1000) / 1000; row.size_at_ask = q.size_exact;
  row.model_edge_cents = edge; row.index_margin_cents = indexMargin(snap, side, fill.cents, engine);
  row.chalk = cf.chalk; row.cap_blocked = fill.cents > CAP_COUNTERFACTUAL_CENTS;
  row.counterfactual = { ...cf, cap_blocked: fill.cents > CAP_COUNTERFACTUAL_CENTS, booked_whole_cents: fill.cents, booked_fee_whole: feeCents(fill.cents, engine) };
  row.payload = {
    research_version: SELECTOR_ATTRIBUTION_VERSION, booked_at_ms: fill.t, observed_lag_ms: Math.max(0, snap.as_of - fill.t),
    exact_ask_note: "exact ask observed at first sight of the position, not at the booking tick",
    blind_same_side: blind ? blind.side === side : null, blind_at_ms: blind?.decided_ms ?? null, blind_ask_exact: blind?.ask_exact ?? null,
    chair: state, price_lane: "exact_measurement", ...extra,
  };
  return row;
}

// ---------------------------------------------------------------------------
// The window track and its classification.
// ---------------------------------------------------------------------------

export type CheckpointFact = { secs: number; chair_lean: string; max_ask_whole: number; chalk: boolean; yes_ask: number; no_ask: number };

export type WindowTrack = {
  ticker: string;
  close_ms: number;
  first_ms: number;
  last_ms: number;
  ticks: number;
  blind: { side: Side; ask_exact: number; ask_whole: number; fee_exact: number; decided_ms: number; chair_lean_at: string; rejection_reason: string | null; eligible_at: boolean | null } | null;
  chair: { side: Side; cents: number; booked_ms: number; observed_ms: number; ask_exact_observed: number | null } | null;
  checkpoints: CheckpointFact[];
  /** Chair leans seen in the band, in order, deduplicated on change. */
  leans: string[];
  finalized: boolean;
};

export function blankTrack(snap: Pick<Snapshot, "ticker" | "close_time" | "as_of">): WindowTrack {
  return { ticker: snap.ticker, close_ms: snap.close_time, first_ms: snap.as_of, last_ms: snap.as_of, ticks: 0, blind: null, chair: null, checkpoints: [], leans: [], finalized: false };
}

/** Record this tick's Chair lean and, at the frozen checkpoints, the chalk facts. Mutates the track only. */
export function noteTick(track: WindowTrack, snap: Snapshot, chairLean: string): void {
  track.last_ms = snap.as_of; track.ticks += 1;
  if (track.leans[track.leans.length - 1] !== chairLean) track.leans.push(chairLean);
  const secs = (snap.close_time - snap.as_of) / 1000;
  const cp = scheduledCheckpoint(secs);
  if (cp != null && !track.checkpoints.some((c) => c.secs === cp)) {
    const maxAsk = Math.max(snap.yes_ask, snap.no_ask);
    track.checkpoints.push({ secs: cp, chair_lean: chairLean, max_ask_whole: maxAsk, chalk: maxAsk >= CHALK_CENTS, yes_ask: snap.yes_ask, no_ask: snap.no_ask });
  }
}

export function classify(track: Pick<WindowTrack, "blind" | "chair">): Divergence {
  if (track.blind && track.chair) return track.blind.side === track.chair.side ? "BOTH_SAME_SIDE" : "BOTH_OPPOSITE";
  if (track.blind) return "BLIND_ONLY";
  if (track.chair) return "CHAIR_ONLY";
  return "NEITHER";
}

/** The WINDOW row: one per window, written when the band closes. Carries the classification and the chalk-adjusted WAIT facts. */
export function windowRow(track: WindowTrack, engine: FeeEngineId = DEFAULT_FEE_ENGINE): AttributionRow {
  const divergence = classify(track);
  const cp = track.checkpoints;
  const waitAt = (secs: number) => { const c = cp.find((x) => x.secs === secs); return c ? c.chair_lean === "WAIT" : null; };
  const chalkAt = (secs: number) => { const c = cp.find((x) => x.secs === secs); return c ? c.chalk : null; };
  return {
    ticker: track.ticker, close_ms: track.close_ms, kind: "WINDOW", decided_ms: track.last_ms, side: null,
    ask_cents: null, ask_whole_cents: null, fee_engine: engine, fee_cents: null, spread_cents: null, size_at_ask: null,
    chair_lean: track.leans[track.leans.length - 1] ?? null, chair_confidence: null, chair_score: null, chair_bar: null,
    model_fair_yes: null, market_yes_mid: null, lab_fair_yes: null, model_edge_cents: null, index_margin_cents: null, feeds_ok: null,
    quorum_up: null, quorum_down: null, quorum_wait: null, eligible: null,
    rejection_reason: track.blind?.rejection_reason ?? null, divergence,
    chalk: cp.some((c) => c.chalk), cap_blocked: track.blind ? track.blind.ask_exact > CAP_COUNTERFACTUAL_CENTS : null,
    counterfactual: {
      blind: track.blind ? { side: track.blind.side, ask_exact: track.blind.ask_exact, ask_whole: track.blind.ask_whole, fee_exact: track.blind.fee_exact, cap_blocked: track.blind.ask_exact > CAP_COUNTERFACTUAL_CENTS } : null,
      chair: track.chair ? { side: track.chair.side, ask_whole: track.chair.cents, fee_whole: feeCents(track.chair.cents, engine), ask_exact_observed: track.chair.ask_exact_observed, cap_blocked: track.chair.cents > CAP_COUNTERFACTUAL_CENTS } : null,
      chalk_adjusted_wait: { wait_450: waitAt(450), chalk_450: chalkAt(450), wait_300: waitAt(300), chalk_300: chalkAt(300) },
    },
    payload: {
      research_version: SELECTOR_ATTRIBUTION_VERSION, divergence, ticks: track.ticks, first_ms: track.first_ms, last_ms: track.last_ms,
      leans: track.leans, checkpoints: cp, blind: track.blind, chair: track.chair,
      accepted: divergence === "BOTH_SAME_SIDE", rejected: divergence === "BLIND_ONLY",
    },
  };
}

// ---------------------------------------------------------------------------
// Settlement: the net and the counterfactual P&L.
// ---------------------------------------------------------------------------

/** One-contract HOLD net at `ask` with `fee` already charged: 100·won − ask − fee. */
export function holdNet(ask: number, fee: number, won: boolean): number {
  return Math.round(((won ? 100 : 0) - ask - fee) * 1000) / 1000;
}

export type Settled = { official_winner: Side; net_cents: number | null; counterfactual: Record<string, unknown> };

/**
 * Settle a row from the official winner. For an opportunity row the net is at
 * the exact ask with the recorded fee; the counterfactual block adds the net
 * under the 92¢ cap (0 when blocked), each gate variant (0 when it would have
 * refused), and the whole-cent lane. For a WINDOW row it adds the blind net,
 * the Chair net and their difference: the divergence's realized cost or gain.
 */
export function settleAttribution(row: Pick<AttributionRow, "kind" | "side" | "ask_cents" | "fee_cents" | "counterfactual" | "cap_blocked">, winner: Side, engine: FeeEngineId = DEFAULT_FEE_ENGINE): Settled {
  const cf = row.counterfactual ?? {};
  if (row.kind === "WINDOW") {
    const b = cf.blind as { side: Side; ask_exact: number; fee_exact: number; cap_blocked: boolean } | null | undefined;
    const c = cf.chair as { side: Side; ask_whole: number; fee_whole: number; cap_blocked: boolean } | null | undefined;
    const blindNet = b && realAskCents(b.ask_exact) ? holdNet(b.ask_exact, b.fee_exact, b.side === winner) : null;
    const chairNet = c && realAskCents(c.ask_whole) ? holdNet(c.ask_whole, c.fee_whole, c.side === winner) : null;
    return {
      official_winner: winner, net_cents: chairNet,
      counterfactual: {
        settled: {
          blind_net: blindNet, chair_net: chairNet,
          chair_minus_blind: blindNet != null && chairNet != null ? Math.round((chairNet - blindNet) * 1000) / 1000 : null,
          blind_net_under_cap: b ? (b.cap_blocked ? 0 : blindNet) : null, chair_net_under_cap: c ? (c.cap_blocked ? 0 : chairNet) : null,
        },
      },
    };
  }
  if (row.side == null || row.ask_cents == null || !realAskCents(row.ask_cents)) return { official_winner: winner, net_cents: null, counterfactual: {} };
  const won = row.side === winner;
  const fee = row.fee_cents ?? feeCents(row.ask_cents, engine);
  const net = holdNet(row.ask_cents, fee, won);
  const lane = cf.price_lane as { ask_whole?: number; fee_whole?: number } | undefined;
  const variants = (cf.gate_variants as GateVariantFlag[] | undefined) ?? [];
  const wholeNet = lane && typeof lane.ask_whole === "number" && realAskCents(lane.ask_whole) ? holdNet(lane.ask_whole, lane.fee_whole ?? feeCents(lane.ask_whole, engine), won) : null;
  return {
    official_winner: winner, net_cents: net,
    counterfactual: {
      settled: {
        net_exact: net, net_whole_lane: wholeNet, lane_delta: wholeNet != null ? Math.round((net - wholeNet) * 1000) / 1000 : null,
        net_under_cap: row.cap_blocked ? 0 : net, cap_change: row.cap_blocked ? Math.round(-net * 1000) / 1000 : 0,
        gate_variants: Object.fromEntries(variants.map((v) => [v.id, v.pass == null ? null : v.pass ? net : 0])),
      },
    },
  };
}
