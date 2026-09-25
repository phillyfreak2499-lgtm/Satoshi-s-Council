/**
 * MID_RECOVERY_V1_INACTIVE — the inactive mid-roster recovery experiment (pure).
 *
 * QUESTION. In the MID band (180–600 s before the close), how often would the
 * frozen E1 roster, heard through the ALREADY-MERGED inactive recovery path
 * (bots.runBotsWithEvaluatedCandidates → call-recovery-candidate
 * .projectInactiveE1Recovery → the actual Chair), have turned a production WAIT
 * into a directional read that survives every production entry rule, and what
 * would that simulated opportunity have been worth against the blind
 * favourite? This module measures; it decides nothing.
 *
 * THREE ARMS, ONE WINDOW IDENTITY (ticker + close_time).
 *   BASELINE       the production Chair and selective-entry result, read from
 *                  the frame, never recomputed; a fill only when the production
 *                  paper book itself holds the window.
 *   RECOVERED_MID  the E1 projection through the actual downstream path: the
 *                  producer's health treatment and Brier/EV calibration are
 *                  already on the captured vote; explicit clock/in-window holds
 *                  are excluded by the projection; the actual Chair folds
 *                  families and builds rows; eligibleSupportRows/gateVector
 *                  apply the deployed policy (80¢ floor, ceiling < 99, spread
 *                  ≤ 2, resting size ≥ 1, fees, feeds, settlement index,
 *                  opposition, day risk, selective math); STREAK is counted as
 *                  a book read (E1_FAMILY_OVERRIDE); its own confirmation
 *                  latch; then a SIMULATED booking at the production `bookable`
 *                  floor. Never a real booking.
 *   NULL_FAV_80    the existing favourite benchmark (`nullFavIntention`) at
 *                  the same identity and the same settlement sweep.
 *
 * WHAT IT NEVER DOES. It does not lower a threshold, alter learner promotion,
 * touch the frozen E1/E2/E3 evidence, the public Floor/Chair, follower fields,
 * Training, or the paper book. The real votes, learner and Chair are inputs it
 * reads; the recovery path builds its own clones. No settlement is ever
 * invented here: `simulated.settlement`, `win`, `net` stay null until the
 * official ledger row exists (settleShadowReceipts).
 *
 * Pure module: no clock, no state, no database. The three real functions of the
 * downstream path are injected by the observer (and by the harness tests) so
 * this file never imports the engine; there is no second recovery path.
 */
import type { EvaluatedCandidateFrame } from "./bots";
import type { RecoveryProjection } from "./call-recovery-candidate";
import { bookable, floorBreakevenPct } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { DEFAULT_FEE_ENGINE, feeCents, neededWinRatePct, realAskCents } from "./fee-engine.ts";
import { DEPLOYED_POLICY, gateVector, supporterRows, type GateVector } from "./gate-vector.ts";
import { maxDrawdown, mean } from "./promotion-gates.ts";
import type { EvidenceFamily } from "./seats.ts";
import { hasPaperPosition, type EntryWatch, type SelectiveContext } from "./selective-entry.ts";
import { E1_FAMILY_OVERRIDE, E1_ROSTER_CARDS, e1FamilyOf, nullFavIntention } from "./shadow-arms.ts";
import type { CallLogRow, ChairResult, Learner, Lean, LedgerCite, SeatId, Settings, Snapshot, Vote } from "./types";

// ---------------------------------------------------------------------------
// The frozen experiment.
// ---------------------------------------------------------------------------

export const MID_RECOVERY_EXPERIMENT = Object.freeze({
  id: "MID_RECOVERY_V1_INACTIVE",
  version: 1,
  /** Never collects unless an owner sets the env flag; never books, promotes or tunes. */
  active_by_default: false,
  authority: "research-only-simulated",
  arms: Object.freeze({ baseline: "BASELINE", recovered: "RECOVERED_MID", null_fav: "NULL_FAV_80" } as const),
  /** The frozen E1 roster, unchanged (shadow-arms.ts). */
  roster: E1_ROSTER_CARDS,
  family_override: E1_FAMILY_OVERRIDE,
  band_secs: Object.freeze({ min: 180, max: 600 } as const),
  floor_cents: 80,
  policy_id: DEPLOYED_POLICY.id,
  recovery_version: "E1_RECOVERY_V1_INACTIVE",
  fee_engine: DEFAULT_FEE_ENGINE,
} as const);

export const MID_RECOVERY_ENV_FLAG = "MID_RECOVERY_SHADOW_ENABLED";

/** The bottleneck funnel, in the order the actual downstream path applies it. */
export const MID_RECOVERY_STAGES = Object.freeze([
  "observed", "candidate", "directional", "team", "support", "quote", "economics", "eligible", "confirmed", "simulated_booked",
] as const);
export type MidRecoveryStage = (typeof MID_RECOVERY_STAGES)[number];

// ---------------------------------------------------------------------------
// Inputs: the real downstream functions are injected, never re-implemented.
// ---------------------------------------------------------------------------

export type MidRecoveryDeps = {
  runBotsWithEvaluatedCandidates: (snap: Snapshot, learner: Learner) => EvaluatedCandidateFrame;
  projectInactiveE1Recovery: (frame: EvaluatedCandidateFrame, learner: Learner) => RecoveryProjection;
  runChair: (votes: Vote[], snap: Snapshot, learner: Learner, settings: Settings, lastLean: Lean, cites: readonly LedgerCite[]) => ChairResult;
};

export type MidRecoveryInput = {
  snap: Snapshot;
  /** The production Chair of this tick, read only. */
  chair: ChairResult;
  learner: Learner;
  settings: Partial<Settings>;
  /** The production paper history: the baseline's own risk history and its actual bookings. */
  call_log: readonly CallLogRow[];
  /** The production admission audit for this tick, when the engine published one. */
  audit: { eligible: boolean; checks: ReadonlyArray<{ id: string; pass: boolean | null }> } | null;
  ready: boolean;
  start: number;
  /** The recovered arm's own simulated risk history (its own fills, never the production book). */
  recovered_calls: readonly CallLogRow[];
  /** The recovered arm's own confirmation latch from the previous tick. */
  watch: EntryWatch | null;
};

export type MidRecoveryCandidate = {
  seat: SeatId;
  card_id: string;
  family: EvidenceFamily;
  original_status: Vote["skill_status"];
  /** The producer's read before the whisper filter (absent on a captured card: the captured vote IS the read). */
  raw_lean: Lean;
  raw_conf: number | null;
  /** After the producer's source-health treatment and Brier/EV calibration. */
  calibrated_lean: Lean;
  calibrated_conf: number;
  health: Vote["health"];
  hypothesis: string;
  /** The actual Chair's row for this seat after family folding. */
  survived_fold: boolean;
  chair_row_status: string | null;
  chair_weight: number | null;
  /** Counted by eligibleSupportRows on the recovered side. */
  counted_as_support: boolean;
};

export type MidRecoveryEvaluation = {
  version: typeof MID_RECOVERY_EXPERIMENT.id;
  recovery_version: typeof MID_RECOVERY_EXPERIMENT.recovery_version;
  ticker: string;
  close_time: number;
  as_of: number;
  secs_left: number;
  in_band: boolean;
  baseline: {
    lean: Lean;
    confidence: number;
    state: "WAIT" | "DIRECTIONAL";
    side: "UP" | "DOWN" | null;
    /** Production selective result this tick (confirmation included), or null when the engine published no audit. */
    selective_eligible: boolean | null;
    blocker: string | null;
    supporters: SeatId[];
    families: EvidenceFamily[];
    quorum: { up: number; down: number; wait: number };
    /** The production paper book's own row for this window, when it exists. Never invented. */
    booked: { side: "UP" | "DOWN"; ask_cents: number; decided_ms: number } | null;
  };
  candidates: MidRecoveryCandidate[];
  recovery: {
    released: string[];
    missing: string[];
    /** Seats whose selected vote was an explicit clock-owned or in-window revision hold. */
    held_seats: SeatId[];
    /** Evaluated roster cards that were directional but lost the one-per-seat rule (correlated cards). */
    correlated_cards_dropped: string[];
  };
  recovered: {
    lean: Lean;
    confidence: number;
    state: "WAIT" | "DIRECTIONAL";
    side: "UP" | "DOWN" | null;
    quorum: { up: number; down: number; wait: number };
    supporters: SeatId[];
    /** Families under the E1 override (STREAK is a book read). */
    families: EvidenceFamily[];
    families_ok: boolean;
    opposition: number;
    mode: "normal" | "tight";
    /** Every production check except confirmation and the (overridden) families check passed. */
    eligible: boolean;
    blocker: string | null;
    checks: Array<{ id: string; pass: boolean | null }>;
    failed: string[];
  };
  confirmation: {
    frames: number;
    seconds: number;
    need_frames: number;
    need_seconds: number;
    confirmed: boolean;
    /** The latch to carry into the next tick (null when not eligible). */
    watch: EntryWatch | null;
  };
  economics: {
    side: "UP" | "DOWN" | null;
    ask_cents: number | null;
    bid_cents: number | null;
    spread_cents: number | null;
    touch_size: number | null;
    fee_cents: number | null;
    model_edge_cents: number | null;
    fair_yes: number | null;
    index_fair_yes: number | null;
    index_margin_cents: number | null;
    breakeven_pct: number | null;
    floor_cents: number;
    floor_ok: boolean | null;
    ceiling_ok: boolean | null;
    spread_ok: boolean | null;
    size_ok: boolean | null;
    feeds_ok: boolean;
  };
  simulated: {
    qualified: boolean;
    booked: boolean;
    side: "UP" | "DOWN" | null;
    price_cents: number | null;
    fee_cents: number | null;
    /** Filled only by the official settlement sweep, never here. */
    settlement: null;
    win: null;
    net_cents: null;
    authority: typeof MID_RECOVERY_EXPERIMENT.authority;
  };
  null_fav: {
    eligible: boolean;
    side: "UP" | "DOWN" | null;
    ask_cents: number | null;
    fee_cents: number | null;
    size_at_ask: number | null;
    spread_cents: number | null;
    settlement: null;
    net_cents: null;
  };
  flags: {
    recovered_agrees_with_favourite: boolean | null;
    baseline_agrees_with_favourite: boolean | null;
    recovered_agrees_with_baseline: boolean | null;
    wait_to_directional: boolean;
    funnel_stage: MidRecoveryStage;
    funnel_stage_index: number;
  };
};

const dir = (lean: Lean): "UP" | "DOWN" | null => (lean === "UP" || lean === "DOWN" ? lean : null);
function uniq<T>(xs: readonly T[]): T[] { return [...new Set(xs)]; }
const fin = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Every measured leaf of an evaluation, dotted, so the ≥ 36 field promise is checkable. */
export function evaluationFields(e: MidRecoveryEvaluation): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) { out.push(path); return; }
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k); return; }
    out.push(path);
  };
  walk(e, "");
  return out;
}

// ---------------------------------------------------------------------------
// One tick, three arms.
// ---------------------------------------------------------------------------

export function evaluateMidRecovery(input: MidRecoveryInput, deps: MidRecoveryDeps): MidRecoveryEvaluation {
  const { snap } = input;
  const secs = (snap.close_time - snap.as_of) / 1000;
  const inBand = Number.isFinite(secs) && secs >= MID_RECOVERY_EXPERIMENT.band_secs.min && secs <= MID_RECOVERY_EXPERIMENT.band_secs.max;
  const p = DEPLOYED_POLICY.params;

  // A) BASELINE — read, never recomputed. The production selective gate carries its own reason.
  const chair = input.chair;
  const baselineSide = dir(chair.lean);
  const baselineRows = baselineSide ? supporterRows(chair, baselineSide) : [];
  const selectiveGate = Array.isArray(chair.gates) ? chair.gates.find((g) => g.id === "selective") : undefined;
  const bookedRow = input.call_log.find((r) => r.ticker === snap.ticker && r.close_time === snap.close_time) ?? null;
  const baseline: MidRecoveryEvaluation["baseline"] = {
    lean: chair.lean,
    confidence: chair.confidence,
    state: baselineSide ? "DIRECTIONAL" : "WAIT",
    side: baselineSide,
    selective_eligible: input.audit ? input.audit.eligible : null,
    blocker: selectiveGate ? (selectiveGate.pass ? null : selectiveGate.value) : (input.audit ? (input.audit.checks.find((k) => k.pass === false)?.id ?? null) : null),
    supporters: uniq(baselineRows.map((r) => r.seat)),
    families: uniq(baselineRows.map((r) => e1FamilyOf(r.seat))),
    quorum: { up: chair.quorum.up, down: chair.quorum.down, wait: chair.quorum.wait },
    booked: bookedRow ? { side: bookedRow.lean, ask_cents: bookedRow.cents, decided_ms: bookedRow.t } : null,
  };

  // B) RECOVERED_MID — the merged inactive path, then the actual Chair on its own clones.
  const frame = deps.runBotsWithEvaluatedCandidates(snap, input.learner);
  const projection = deps.projectInactiveE1Recovery(frame, input.learner);
  const fullSettings = {
    ...input.settings, poll_ms: 2_000, source: "live", show_faded: false, show_shadow: false, tz: "America/Chicago",
    mutes: input.settings.mutes ?? [], bar_override: input.settings.bar_override ?? null, adaptive_bar: input.settings.adaptive_bar ?? true, beast: input.settings.beast ?? false,
  } as Settings;
  const simulated = deps.runChair(projection.simulated.votes, snap, projection.simulated.learner, fullSettings, "WAIT", []);
  const side = dir(simulated.lean);
  const ctx: SelectiveContext = { calls: [...input.recovered_calls], ready: input.ready, start: input.start, watch: input.watch };
  const vector: GateVector = gateVector(snap, simulated, ctx, DEPLOYED_POLICY);
  const rows = side ? supporterRows(simulated, side) : [];
  const supporters = uniq(rows.map((r) => r.seat));
  const families = uniq(rows.map((r) => e1FamilyOf(r.seat)));
  const minFamilies = vector.mode === "tight" ? p.tight_min_families : p.min_families;
  const familiesOk = side != null && families.length >= minFamilies;
  const check = (id: string) => vector.checks.find((k) => k.id === id)?.pass ?? null;
  const eligible = side != null && familiesOk && vector.checks.filter((k) => k.id !== "confirmation" && k.id !== "families").every((k) => k.pass === true);
  const opposition = side ? (side === "UP" ? simulated.quorum.down : simulated.quorum.up) : 0;
  let blocker: string | null = null;
  if (side == null) blocker = "waiting for a directional setup";
  else if (!familiesOk) blocker = "E1 family de-duplication: needs two evidence groups with STREAK counted as a book read";
  else if (!eligible) blocker = vector.binding_reason ?? vector.checks.find((k) => k.pass === false && k.id !== "confirmation")?.label ?? null;

  const heldSeats = uniq(frame.votes.filter((v) => v.hypothesis === "clock-owned window" || v.hypothesis === "in-window path revision").map((v) => v.seat));
  const held = new Set<SeatId>(heldSeats);
  const rosterRank = new Set<string>(E1_ROSTER_CARDS);
  const chosen = new Set(projection.candidates.map((c) => c.card_id));
  const correlatedDropped = uniq(frame.evaluated
    .filter((v) => rosterRank.has(v.skill_used) && dir(v.lean) != null && !held.has(v.seat) && !chosen.has(v.skill_used))
    .map((v) => v.skill_used));
  const candidates: MidRecoveryCandidate[] = projection.candidates.map((c) => {
    const row = simulated.rows.find((r) => r.seat === c.seat) ?? null;
    return {
      seat: c.seat, card_id: c.card_id, family: e1FamilyOf(c.seat), original_status: c.original_status,
      raw_lean: c.vote.raw_lean ?? c.vote.lean, raw_conf: c.vote.raw_conf ?? null,
      calibrated_lean: c.vote.lean, calibrated_conf: c.vote.confidence, health: c.vote.health, hypothesis: c.vote.hypothesis,
      survived_fold: !!row && !row.folded, chair_row_status: row ? row.status : null, chair_weight: row ? row.weight : null,
      counted_as_support: supporters.includes(c.seat),
    };
  });

  // Confirmation: the arm's own latch, the production frames/seconds, never the production latch.
  const tight = vector.mode === "tight";
  const needFrames = tight ? p.tight_confirmation_frames : p.confirmation_frames;
  const needSecs = tight ? p.tight_confirmation_seconds : p.confirmation_seconds;
  let watch: EntryWatch | null = null;
  if (eligible && side) {
    const key = `${snap.ticker}|${snap.close_time}`;
    const old = input.watch;
    watch = old && old.key === key && old.side === side && old.mode === vector.mode && snap.as_of >= old.last && snap.as_of - old.last <= 10_000
      ? { ...old, last: snap.as_of, frames: old.frames + Number(snap.as_of > old.last) }
      : { key, side, since: snap.as_of, last: snap.as_of, frames: 1, mode: vector.mode };
  }
  const frames = watch ? watch.frames : 0;
  const seconds = watch ? (snap.as_of - watch.since) / 1000 : 0;
  const confirmed = !!watch && frames >= needFrames && seconds >= needSecs;

  // Book economics on the recovered side, from the same snapshot fields the production guard reads.
  const ask = side === "UP" ? snap.yes_ask : side === "DOWN" ? snap.no_ask : NaN;
  const bid = side === "UP" ? snap.yes_bid : side === "DOWN" ? snap.no_bid : NaN;
  const touch = side === "UP" ? snap.no_bid_size : side === "DOWN" ? snap.yes_bid_size : NaN;
  const edge = side === "UP" ? snap.edge_up : side === "DOWN" ? snap.edge_down : NaN;
  const fair = fin(snap.lab_fair_yes);
  const indexMargin = side && fair != null && realAskCents(ask) ? (side === "UP" ? fair : 100 - fair) - ask - takerFeeCents(ask) : null;
  const feedsOk = check("feeds") === true;
  const economics: MidRecoveryEvaluation["economics"] = {
    side, ask_cents: fin(ask), bid_cents: fin(bid), spread_cents: fin(ask - bid), touch_size: fin(touch),
    fee_cents: realAskCents(ask) ? feeCents(ask) : null, model_edge_cents: fin(edge), fair_yes: fin(snap.fair_yes), index_fair_yes: fair,
    index_margin_cents: indexMargin, breakeven_pct: realAskCents(ask) ? floorBreakevenPct(ask) : null,
    floor_cents: MID_RECOVERY_EXPERIMENT.floor_cents,
    floor_ok: side ? ask >= p.floor_cents : null, ceiling_ok: side ? ask < 99 : null,
    spread_ok: side ? Number.isFinite(bid) && bid >= 0 && bid <= ask && ask - bid <= p.max_spread_cents : null,
    size_ok: side ? touch >= 1 : null, feeds_ok: feedsOk,
  };
  const qualified = eligible && confirmed && side != null && !hasPaperPosition(ctx.calls, snap);
  const booked = qualified && bookable(ask);

  // C) NULL_FAV_80 — the existing benchmark, same identity.
  const nf = nullFavIntention(snap, MID_RECOVERY_EXPERIMENT.floor_cents);
  const nullFav: MidRecoveryEvaluation["null_fav"] = {
    eligible: nf != null, side: nf?.side ?? null, ask_cents: nf?.ask_cents ?? null, fee_cents: nf?.fee_cents ?? null,
    size_at_ask: nf?.size_at_ask ?? null, spread_cents: nf?.spread_cents ?? null, settlement: null, net_cents: null,
  };

  // The funnel: the deepest stage reached, in path order; a failed stage stays failed.
  const supportOk = check("supporters") === true && familiesOk && check("opposition") === true;
  const economicsOk = ["risk_history", "daily_risk", "complete_window", "time", "feeds", "profit_reserve", "model_edge", "index_fresh", "index_edge"].every((id) => check(id) === true);
  const reached: Record<MidRecoveryStage, boolean> = {
    observed: true, candidate: candidates.length > 0, directional: side != null, team: check("team") === true,
    support: supportOk, quote: check("quote") === true, economics: economicsOk, eligible, confirmed: eligible && confirmed, simulated_booked: booked,
  };
  let stageIndex = 0;
  for (let i = 0; i < MID_RECOVERY_STAGES.length; i += 1) { if (!reached[MID_RECOVERY_STAGES[i]!]) break; stageIndex = i; }

  return {
    version: MID_RECOVERY_EXPERIMENT.id, recovery_version: MID_RECOVERY_EXPERIMENT.recovery_version,
    ticker: snap.ticker, close_time: snap.close_time, as_of: snap.as_of, secs_left: secs, in_band: inBand,
    baseline, candidates,
    recovery: { released: [...projection.simulated.released], missing: [...projection.simulated.missing], held_seats: heldSeats, correlated_cards_dropped: correlatedDropped },
    recovered: {
      lean: simulated.lean, confidence: simulated.confidence, state: side ? "DIRECTIONAL" : "WAIT", side,
      quorum: { up: simulated.quorum.up, down: simulated.quorum.down, wait: simulated.quorum.wait },
      supporters, families, families_ok: familiesOk, opposition, mode: vector.mode, eligible, blocker,
      checks: vector.checks.map((k) => ({ id: k.id, pass: k.pass })), failed: [...vector.failed],
    },
    confirmation: { frames, seconds, need_frames: needFrames, need_seconds: needSecs, confirmed, watch },
    economics,
    simulated: { qualified, booked, side: booked ? side : null, price_cents: booked ? ask : null, fee_cents: booked ? feeCents(ask) : null, settlement: null, win: null, net_cents: null, authority: MID_RECOVERY_EXPERIMENT.authority },
    null_fav: nullFav,
    flags: {
      recovered_agrees_with_favourite: side && nf ? side === nf.side : null,
      baseline_agrees_with_favourite: baselineSide && nf ? baselineSide === nf.side : null,
      recovered_agrees_with_baseline: side && baselineSide ? side === baselineSide : null,
      wait_to_directional: baselineSide == null && side != null,
      funnel_stage: MID_RECOVERY_STAGES[stageIndex]!, funnel_stage_index: stageIndex,
    },
  };
}

// ---------------------------------------------------------------------------
// Reading the receipts back: funnel, quality, NULL comparison, breakdown.
// ---------------------------------------------------------------------------

/** One desk_shadow_receipts row of this experiment, as the report reads it. */
export type MidRecoveryRow = {
  arm: string;
  ticker: string;
  close_ms: number;
  kind: "intention" | "fill" | "no_fill" | "veto" | "wait" | "settle";
  decided_ms: number;
  side: "UP" | "DOWN" | null;
  ask_cents: number | null;
  fee_cents: number | null;
  official_winner: "UP" | "DOWN" | null;
  net_cents: number | null;
  payload: Record<string, unknown> | null;
};

export type ArmQuality = {
  arm: string;
  fills: number;
  settled: number;
  unsettled: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_ask_cents: number | null;
  avg_fee_cents: number | null;
  needed_win_rate_pct: number | null;
  net_cents: number | null;
  avg_net_per_fill_cents: number | null;
  max_drawdown_cents: number | null;
  /** Brier of the market-implied probability (ask/100) on settled fills: a genuine probability. */
  brier_market_implied: number | null;
  /** Chair confidence is not a calibrated probability: no Brier is reported for it. */
  brier_confidence: null;
  brier_confidence_note: string;
};

export type MidRecoverySummary = {
  experiment: typeof MID_RECOVERY_EXPERIMENT.id;
  windows: number;
  observed_windows: number;
  funnel: Array<{ stage: MidRecoveryStage; windows: number; conversion_pct: number | null }>;
  window_flow: {
    baseline_wait: number;
    baseline_directional: number;
    baseline_filled: number;
    recovered_directional: number;
    wait_to_directional: number;
    recovered_eligible: number;
    recovered_confirmed: number;
    recovered_simulated_booked: number;
    recovered_agrees_with_baseline: number;
    recovered_disagrees_with_baseline: number;
  };
  quality: { baseline: ArmQuality; recovered: ArmQuality; null_fav: ArmQuality };
  null_comparison: {
    overlap_windows: number;
    side_agreement: number;
    side_agreement_pct: number | null;
    settled_overlap: number;
    recovered_net_on_overlap: number | null;
    null_net_on_overlap: number | null;
    incremental_net_cents: number | null;
    recovered_only_windows: number;
    recovered_only_net_cents: number | null;
    null_only_windows: number;
    recovered_win_rate_pct: number | null;
    recovered_needed_win_rate_pct: number | null;
    null_win_rate_pct: number | null;
    null_needed_win_rate_pct: number | null;
  };
  breakdown: {
    by_seat: Array<BreakdownRow & { seat: string }>;
    by_card: Array<BreakdownRow & { card_id: string; seat: string }>;
    by_family: Array<BreakdownRow & { family: string }>;
  };
  promotion: { auto_promotion: false; note: string };
};

export type BreakdownRow = {
  candidate_windows: number;
  survived_fold: number;
  counted_as_support: number;
  in_simulated_fills: number;
  settled_fills: number;
  wins: number;
  net_cents: number | null;
};

const ARMS = MID_RECOVERY_EXPERIMENT.arms;
const windowKeyOf = (r: Pick<MidRecoveryRow, "ticker" | "close_ms">) => `${r.ticker}|${r.close_ms}`;
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const sum = (xs: readonly number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10 : null);
const round1 = (x: number | null): number | null => (x == null ? null : Math.round(x * 10) / 10);

export function armQuality(arm: string, rows: readonly MidRecoveryRow[]): ArmQuality {
  const fills = rows.filter((r) => r.arm === arm && r.kind === "fill" && r.side != null && r.ask_cents != null).sort((a, b) => a.close_ms - b.close_ms);
  const settled = fills.filter((r) => r.official_winner != null && r.net_cents != null);
  const wins = settled.filter((r) => r.official_winner === r.side).length;
  const nets = settled.map((r) => r.net_cents!);
  const asks = fills.map((r) => r.ask_cents!);
  const brier = settled.length ? mean(settled.map((r) => ((r.ask_cents! / 100) - (r.official_winner === r.side ? 1 : 0)) ** 2)) : null;
  return {
    arm, fills: fills.length, settled: settled.length, unsettled: fills.length - settled.length, wins, losses: settled.length - wins,
    win_rate_pct: pct(wins, settled.length), avg_ask_cents: round1(mean(asks)), avg_fee_cents: round1(mean(fills.map((r) => r.fee_cents ?? feeCents(r.ask_cents!)))),
    needed_win_rate_pct: asks.length ? round1(neededWinRatePct(asks)) : null, net_cents: sum(nets), avg_net_per_fill_cents: round1(mean(nets)),
    max_drawdown_cents: nets.length ? maxDrawdown(nets) : null,
    brier_market_implied: brier == null ? null : Math.round(brier * 10_000) / 10_000, brier_confidence: null,
    brier_confidence_note: "Chair confidence is a score, not a calibrated probability; a Brier on it would be invented.",
  };
}

const stageOf = (payload: Record<string, unknown> | null): number => {
  const idx = payload?.funnel_stage_index;
  return typeof idx === "number" && Number.isFinite(idx) ? Math.max(0, Math.min(MID_RECOVERY_STAGES.length - 1, Math.floor(idx))) : 0;
};

export function summarizeMidRecovery(rows: readonly MidRecoveryRow[]): MidRecoverySummary {
  const windows = new Map<string, MidRecoveryRow[]>();
  for (const r of rows) { const k = windowKeyOf(r); const list = windows.get(k) ?? []; list.push(r); windows.set(k, list); }

  // Funnel: one stage per window, the deepest the recovered arm reached (a fill is the last stage by construction).
  let observed = 0;
  const reached = MID_RECOVERY_STAGES.map(() => 0);
  const flow: MidRecoverySummary["window_flow"] = {
    baseline_wait: 0, baseline_directional: 0, baseline_filled: 0, recovered_directional: 0, wait_to_directional: 0, recovered_eligible: 0,
    recovered_confirmed: 0, recovered_simulated_booked: 0, recovered_agrees_with_baseline: 0, recovered_disagrees_with_baseline: 0,
  };
  const seat = new Map<string, BreakdownRow>();
  const card = new Map<string, BreakdownRow & { seat: string }>();
  const family = new Map<string, BreakdownRow>();
  const bump = <T extends BreakdownRow>(m: Map<string, T>, key: string, make: () => T, f: (row: T) => void) => { const cur = m.get(key) ?? make(); f(cur); m.set(key, cur); };
  const blank = (): BreakdownRow => ({ candidate_windows: 0, survived_fold: 0, counted_as_support: 0, in_simulated_fills: 0, settled_fills: 0, wins: 0, net_cents: null });

  for (const list of windows.values()) {
    const recovered = list.filter((r) => r.arm === ARMS.recovered);
    if (!recovered.length) continue;
    observed += 1;
    const fill = recovered.find((r) => r.kind === "fill") ?? null;
    const stage = fill ? MID_RECOVERY_STAGES.length - 1 : Math.max(...recovered.map((r) => stageOf(r.payload)));
    for (let i = 0; i <= stage; i += 1) reached[i]! += 1;
    // The last written record of the window carries the terminal evaluation.
    const last = [...recovered].sort((a, b) => b.decided_ms - a.decided_ms)[0]!;
    const ev = (last.payload ?? {}) as Partial<MidRecoveryEvaluation>;
    const baseSide = ev.baseline?.side ?? null;
    const recSide = fill?.side ?? ev.recovered?.side ?? null;
    if (baseSide) flow.baseline_directional += 1; else flow.baseline_wait += 1;
    if (list.some((r) => r.arm === ARMS.baseline && r.kind === "fill")) flow.baseline_filled += 1;
    if (recSide) flow.recovered_directional += 1;
    if (!baseSide && recSide) flow.wait_to_directional += 1;
    if (stage >= MID_RECOVERY_STAGES.indexOf("eligible")) flow.recovered_eligible += 1;
    if (stage >= MID_RECOVERY_STAGES.indexOf("confirmed")) flow.recovered_confirmed += 1;
    if (fill) flow.recovered_simulated_booked += 1;
    if (baseSide && recSide) { if (baseSide === recSide) flow.recovered_agrees_with_baseline += 1; else flow.recovered_disagrees_with_baseline += 1; }
    const cands = Array.isArray(ev.candidates) ? ev.candidates : [];
    const settledFill = fill && fill.official_winner != null && fill.net_cents != null ? fill : null;
    for (const c of cands) {
      const apply = (row: BreakdownRow) => {
        row.candidate_windows += 1;
        if (c.survived_fold) row.survived_fold += 1;
        if (c.counted_as_support) row.counted_as_support += 1;
        if (fill && c.counted_as_support) row.in_simulated_fills += 1;
        if (settledFill && c.counted_as_support) {
          row.settled_fills += 1;
          if (settledFill.official_winner === settledFill.side) row.wins += 1;
          row.net_cents = Math.round(((row.net_cents ?? 0) + settledFill.net_cents!) * 10) / 10;
        }
      };
      bump(seat, c.seat, blank, apply);
      bump(card, c.card_id, () => ({ ...blank(), seat: c.seat }), apply);
      bump(family, c.family, blank, apply);
    }
  }
  const funnel = MID_RECOVERY_STAGES.map((stage, i) => ({ stage, windows: reached[i]!, conversion_pct: i === 0 ? null : pct(reached[i]!, reached[i - 1]!) }));

  // NULL comparison on the same identity.
  let overlap = 0, agree = 0, settledOverlap = 0, recoveredOnly = 0, nullOnly = 0;
  const recOverlapNets: number[] = [], nullOverlapNets: number[] = [], recOnlyNets: number[] = [];
  for (const list of windows.values()) {
    const rec = list.find((r) => r.arm === ARMS.recovered && r.kind === "fill") ?? null;
    const nul = list.find((r) => r.arm === ARMS.null_fav && r.kind === "fill") ?? null;
    if (rec && nul) {
      overlap += 1;
      if (rec.side === nul.side) agree += 1;
      if (rec.net_cents != null && nul.net_cents != null) { settledOverlap += 1; recOverlapNets.push(rec.net_cents); nullOverlapNets.push(nul.net_cents); }
    } else if (rec) { recoveredOnly += 1; if (rec.net_cents != null) recOnlyNets.push(rec.net_cents); }
    else if (nul) nullOnly += 1;
  }
  const recovered = armQuality(ARMS.recovered, rows);
  const nullFav = armQuality(ARMS.null_fav, rows);
  const recNet = sum(recOverlapNets), nulNet = sum(nullOverlapNets);
  return {
    experiment: MID_RECOVERY_EXPERIMENT.id, windows: windows.size, observed_windows: observed, funnel, window_flow: flow,
    quality: { baseline: armQuality(ARMS.baseline, rows), recovered, null_fav: nullFav },
    null_comparison: {
      overlap_windows: overlap, side_agreement: agree, side_agreement_pct: pct(agree, overlap), settled_overlap: settledOverlap,
      recovered_net_on_overlap: recNet, null_net_on_overlap: nulNet, incremental_net_cents: recNet != null && nulNet != null ? Math.round((recNet - nulNet) * 10) / 10 : null,
      recovered_only_windows: recoveredOnly, recovered_only_net_cents: sum(recOnlyNets), null_only_windows: nullOnly,
      recovered_win_rate_pct: recovered.win_rate_pct, recovered_needed_win_rate_pct: recovered.needed_win_rate_pct,
      null_win_rate_pct: nullFav.win_rate_pct, null_needed_win_rate_pct: nullFav.needed_win_rate_pct,
    },
    breakdown: {
      by_seat: [...seat.entries()].map(([s, row]) => ({ seat: s, ...row })).sort((a, b) => a.seat.localeCompare(b.seat)),
      by_card: [...card.entries()].map(([id, row]) => ({ card_id: id, ...row })).sort((a, b) => a.card_id.localeCompare(b.card_id)),
      by_family: [...family.entries()].map(([f, row]) => ({ family: f, ...row })).sort((a, b) => a.family.localeCompare(b.family)),
    },
    promotion: { auto_promotion: false, note: "Measurement only. Nothing here promotes, books, or changes a threshold; the owner reads the counts." },
  };
}
