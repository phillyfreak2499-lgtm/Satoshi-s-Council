/**
 * REACHABILITY-A — can the CURRENT roster book a qualified paper call at all?
 *
 * Research diagnostic only (authority: NONE). Pure: no clock, no database, no
 * writes, and nothing here is imported by the tick, the Chair or the book.
 *
 * Two layers, deliberately separate:
 *
 *  1. `structuralReachability` reads only the learner/settings the desk would
 *     load and answers a necessary-condition question per regime: how many
 *     distinct seats, from how many evidence families, could EVER supply an
 *     eligible entry supporter inside the 3–10 minute band? If that maximum is
 *     below the admission requirement, no market input can produce a fill —
 *     STRUCTURALLY_BLOCKED. If it is at or above it, the answer is only
 *     POSSIBLE: a witness from real frames is still required.
 *
 *  2. `classifyReplayFrame` labels one real-path replay frame (produced by the
 *     harness through runBots → stickyVotes → decideChair → applyEntryMode →
 *     noteCall) with raw/heard/eligible counts and the gate vector, so blocker
 *     counts come from the production functions, not a re-implementation.
 *
 * What this never does: lower a bar, boost a card, manufacture a vote, or read
 * a hypothetical side as if it were an observed one.
 */
import { takerFeeCents } from "./clock";
import { CLOSED_DIRECTIONAL_CARDS, directionalHoldReason } from "./council-authority";
import { RETIRED_SEATS } from "./crew";
import { SKILL_RULES } from "./dsl";
import { SELECTIVE_ENTRY_ID, SELECTIVE_PARAMS } from "./floor-policy";
import { DEPLOYED_POLICY, gateVector, maxReachableQuorum, type GateVector } from "./gate-vector";
import { calibNOf, phaseMult, SPEAK_CONF, WARM_N } from "./math";
import { EVIDENCE_OF, SEATS, type EvidenceFamily } from "./seats";
import { dailyAdmission, type SelectiveContext } from "./selective-entry";
import { voteHeldReason } from "./skill-gate";
import { threshOf } from "./thresholds";
import { onGrid, tickerAgrees } from "./window-identity";
import type { ChairResult, Learner, Pred, SeatId, Settings, SkillRule, Snapshot, Vote } from "./types";

export const REACHABILITY_VERSION = "REACHABILITY_A_V1";

/** Seats the Chair never counts as voters (chair.ts CHAIR_NON_VOTERS). */
const CHAIR_NON_VOTERS = new Set<string>(["WARDEN", "ORBIT", "WIRE"]);
/** brti.ts SETTLE_WINDOW_S: settlement prints exist only inside the final 60 s. */
const SETTLE_WINDOW_S = 60;

export type CardTiming = "unrestricted" | "final_minute_only";

export type CardAssessment = {
  card_id: string;
  seat: SeatId;
  family: EvidenceFamily;
  status: string;
  /** directionalHoldReason (Chair admission) for a directional read of this card in this regime. */
  authority_hold: string | null;
  /** voteHeldReason (pickLiveAndPaper pool filter) in this regime. */
  pool_hold: string | null;
  timing: CardTiming;
  timing_why: string;
  eligible_in_band: boolean;
};

export type SeatAssessment = {
  seat: SeatId;
  family: EvidenceFamily;
  calib_n: number;
  calibrated: boolean;
  benched_until: number | null;
  muted: boolean;
  speak_bar: number;
  edge_mult: number;
  in_band_cards: string[];
  can_support: boolean;
  blockers: string[];
};

export type RegimeReachability = {
  regime: string;
  supporters_possible: SeatId[];
  families_possible: EvidenceFamily[];
  normal: { required_supporters: number; required_families: number; possible: boolean };
  tight: { required_supporters: number; required_families: number; possible: boolean };
  verdict: "STRUCTURALLY_BLOCKED" | "POSSIBLE_NEEDS_WITNESS";
  seats: SeatAssessment[];
  cards: CardAssessment[];
};

export type StructuralReport = {
  version: typeof REACHABILITY_VERSION;
  as_of: number;
  learn_phase: string;
  live_directional_cards: string[];
  regimes: RegimeReachability[];
  /** Minimum |ret15| for DRIFT.aligned_3h to clear its speak bar, by phase, when that card is in the roster. */
  drift_speak_floor: { MID: number | null; FINAL: number | null; ret15_min: number } | null;
  /** Minimum settlement-index fair for INDEX.settle_fair to fire at the 80¢ floor. */
  index_fair_floor_at_floor_ask: { UP: number; DOWN: number; index_edge: number } | null;
  notes: string[];
};

function ruleOf(learner: Learner, id: string): SkillRule | undefined {
  return learner.skills[id]?.rule ?? SKILL_RULES[id];
}

/**
 * A rule that requires locked settlement prints (`lab_locked >= t`, t > 0) can
 * only pass inside the final SETTLE_WINDOW_S seconds: brti.settleFair counts
 * prints in [close − 60 s, close], so k = 0 at 180 s or more before close.
 */
export function cardTiming(learner: Learner, id: string, regime: string): { timing: CardTiming; why: string } {
  const rule = ruleOf(learner, id);
  const preds: Pred[] = rule?.all ?? [];
  for (const p of preds) {
    if (p.feat !== "lab_locked" || p.op !== "gte") continue;
    const t = p.thresh ? threshOf(learner, p.thresh, regime) : Number(p.value);
    if (Number.isFinite(t) && t > 0) {
      return {
        timing: "final_minute_only",
        why: `needs lab_locked ≥ ${t}; locked settlement prints exist only in the last ${SETTLE_WINDOW_S}s, entry band starts at ${SELECTIVE_PARAMS.min_seconds_left}s`,
      };
    }
  }
  return { timing: "unrestricted", why: "no static timing restriction found in the card rule" };
}

/** Regime keys worth evaluating: every pocket a LIVE card has seen, plus any supplied. */
export function regimesOf(learner: Learner, extra: readonly string[] = []): string[] {
  const out = new Set<string>(extra.filter(Boolean));
  if (learner.last_regime) out.add(learner.last_regime);
  for (const card of Object.values(learner.skills)) {
    if (card.status !== "LIVE") continue;
    for (const k of Object.keys(card.pocket ?? {})) out.add(k);
  }
  return [...out].sort();
}

export function structuralReachability(
  learner: Learner,
  settings: Pick<Settings, "mutes">,
  opts: { asOf: number; regimes?: readonly string[] },
): StructuralReport {
  const muted = new Set<string>(settings.mutes ?? []);
  const regimes = regimesOf(learner, opts.regimes ?? []);
  const voting = SEATS.map((s) => s.id).filter((id) =>
    !CHAIR_NON_VOTERS.has(id) && !RETIRED_SEATS[id] && EVIDENCE_OF[id] !== "context");
  const liveDirectional = Object.values(learner.skills)
    .filter((c) => c.status === "LIVE" && voting.includes(c.owner) && !CLOSED_DIRECTIONAL_CARDS.has(c.id))
    .map((c) => c.id).sort();

  const perRegime: RegimeReachability[] = regimes.map((regime) => {
    const cards: CardAssessment[] = [];
    const seats: SeatAssessment[] = voting.map((seat) => {
      const family = EVIDENCE_OF[seat];
      const calibN = calibNOf(learner.seat_n?.[seat] ?? 0, learner.seat_calib_debt?.[seat] ?? 0);
      const knob = learner.knobs?.[seat];
      const benched = knob && knob.benched_until > opts.asOf ? knob.benched_until : null;
      const own = Object.values(learner.skills).filter((c) => c.owner === seat && c.status === "LIVE" && !CLOSED_DIRECTIONAL_CARDS.has(c.id));
      const inBand: string[] = [];
      for (const card of own) {
        const authority = directionalHoldReason({ lean: "UP", skill_used: card.id, skill_status: "LIVE" }, learner, regime);
        const pool = voteHeldReason(card, regime);
        const t = cardTiming(learner, card.id, regime);
        const ok = !authority && !pool && t.timing === "unrestricted";
        if (ok) inBand.push(card.id);
        cards.push({ card_id: card.id, seat, family, status: card.status, authority_hold: authority, pool_hold: pool,
          timing: t.timing, timing_why: t.why, eligible_in_band: ok });
      }
      const blockers: string[] = [];
      if (!own.length) blockers.push("no LIVE directional card");
      else if (!inBand.length) blockers.push("no LIVE card eligible inside the entry band in this regime");
      if (calibN < WARM_N) blockers.push(`UNCALIBRATED (${calibN}/${WARM_N}) — Chair status excludes it from entry support`);
      if (benched) blockers.push(`benched by COACH until ${new Date(benched).toISOString()}`);
      if (muted.has(seat)) blockers.push("muted in settings");
      return {
        seat, family, calib_n: calibN, calibrated: calibN >= WARM_N, benched_until: benched, muted: muted.has(seat),
        speak_bar: SPEAK_CONF + (knob?.speak_offset ?? 0), edge_mult: knob?.edge_mult ?? 1,
        in_band_cards: inBand, can_support: blockers.length === 0, blockers,
      };
    });
    const supporters = seats.filter((s) => s.can_support).map((s) => s.seat);
    const families = [...new Set(supporters.map((s) => EVIDENCE_OF[s]))];
    const p = SELECTIVE_PARAMS;
    const normal = { required_supporters: p.min_speaking, required_families: p.min_families,
      possible: supporters.length >= p.min_speaking && families.length >= p.min_families };
    const tight = { required_supporters: p.tight_min_speaking, required_families: p.tight_min_families,
      possible: supporters.length >= p.tight_min_speaking && families.length >= p.tight_min_families };
    return { regime, supporters_possible: supporters, families_possible: families, normal, tight,
      verdict: normal.possible ? "POSSIBLE_NEEDS_WITNESS" : "STRUCTURALLY_BLOCKED", seats, cards };
  });

  const regimeForThresh = learner.last_regime ?? "";
  let driftFloor: StructuralReport["drift_speak_floor"] = null;
  if (learner.skills["DRIFT.aligned_3h"]?.status === "LIVE") {
    const knob = learner.knobs?.DRIFT;
    const bar = SPEAK_CONF + (knob?.speak_offset ?? 0);
    const mult = knob?.edge_mult ?? 1;
    // conf = round(100 · clamp(clamp(|ret15|/0.008) · edge_mult) · phaseMult · health); health 1 when LIVE.
    const need = (phase: "MID" | "FINAL") => {
      const edge = (bar - 0.5) / (100 * phaseMult(phase));
      if (!(mult > 0) || edge / mult > 1) return null;
      return Math.round((edge / mult) * 0.008 * 1e6) / 1e6;
    };
    driftFloor = { MID: need("MID"), FINAL: need("FINAL"), ret15_min: threshOf(learner, "ret15.min", regimeForThresh) };
  }
  let indexFloor: StructuralReport["index_fair_floor_at_floor_ask"] = null;
  if (learner.skills["INDEX.settle_fair"]?.status === "LIVE") {
    const t = threshOf(learner, "index.edge", regimeForThresh);
    const ask = SELECTIVE_PARAMS.floor_cents;
    const feeCents = takerFeeCents(ask);
    indexFloor = { UP: ask + feeCents + t, DOWN: 100 - (ask + feeCents + t), index_edge: t };
  }

  const notes = [
    "Necessary conditions only: POSSIBLE_NEEDS_WITNESS is not evidence that a fill will occur.",
    "Brier/EV confidence scaling (bots.ts brierScale) and quote/edge/confirmation are frame-dependent and are judged only by replay.",
    "AUTO_SKILL_PROMOTION_ENABLED=false and acceptCandidate adds SHADOW only: no code path returns a card to LIVE, so elapsed time cannot enlarge this roster.",
  ];
  return {
    version: REACHABILITY_VERSION, as_of: opts.asOf, learn_phase: learner.learn_phase,
    live_directional_cards: liveDirectional, regimes: perRegime,
    drift_speak_floor: driftFloor, index_fair_floor_at_floor_ask: indexFloor, notes,
  };
}

// ---------------------------------------------------------------------------
// Replay-frame classification (inputs come from the real tick functions)
// ---------------------------------------------------------------------------

export type ReplayStage =
  | "no_raw_direction"
  | "raw_direction_not_heard"
  | "heard_below_quorum"
  | "chair_wait"
  | "chair_directional_blocked"
  | "awaiting_confirmation"
  | "booked"
  | "already_positioned"
  | "outside_band";

export type ReplayFrameResult = {
  ticker: string;
  close_time: number;
  as_of: number;
  secs_left: number;
  regime: string;
  raw_directional: { seat: SeatId; lean: "UP" | "DOWN"; card: string }[];
  heard_directional: { seat: SeatId; lean: "UP" | "DOWN"; card: string }[];
  forced_sit_reasons: Record<string, string>;
  chair_raw_lean: string;
  chair_lean: string;
  best_quorum: { side: "UP" | "DOWN"; supporters: SeatId[]; families: string[]; opposition: number; reachable: boolean };
  gate_vector: Pick<GateVector, "side" | "mode" | "failed" | "not_evaluable" | "binding_reason" | "eligible_ignoring_confirmation">;
  booked_now: boolean;
  stage: ReplayStage;
  /** Only when the recorded production frame carried votes/chair. */
  parity: { votes_compared: number; vote_lean_mismatch: string[]; chair_lean_match: boolean | null } | null;
};

const dirOf = (l: unknown): "UP" | "DOWN" | null => (l === "UP" || l === "DOWN" ? l : null);

export function classifyReplayFrame(input: {
  snap: Snapshot;
  votes: Vote[];
  rawChair: ChairResult;
  chair: ChairResult;
  ctx: SelectiveContext;
  bookedBefore: boolean;
  bookedAfter: boolean;
  recorded?: { votes?: Vote[] | null; chair?: Pick<ChairResult, "lean"> | null } | null;
}): ReplayFrameResult {
  const { snap, votes, rawChair, chair, ctx } = input;
  const secs = (snap.close_time - snap.as_of) / 1000;
  const raw = votes
    .filter((v) => !CHAIR_NON_VOTERS.has(v.seat) && EVIDENCE_OF[v.seat] !== "context")
    .map((v) => ({ seat: v.seat, lean: dirOf(v.raw_lean ?? v.lean), card: v.skill_used }))
    .filter((v): v is { seat: SeatId; lean: "UP" | "DOWN"; card: string } => v.lean != null);
  // Heard = what the Chair itself counts after admission: its rows are post-admitCouncilVotes.
  const heard = chair.rows
    .filter((r) => !r.forced_sit && dirOf(r.lean) && EVIDENCE_OF[r.seat] !== "context")
    .map((r) => ({ seat: r.seat, lean: r.lean as "UP" | "DOWN", card: r.skill_used }));
  const forced: Record<string, string> = {};
  for (const r of chair.rows) if (r.forced_sit) forced[r.seat] = r.why.split(" · ").slice(-1)[0] ?? "forced sit";
  const q = maxReachableQuorum(chair, DEPLOYED_POLICY, dailyAdmission(ctx.calls, snap.as_of).tightened ? "tight" : "normal").best;
  const gv = gateVector(snap, chair, ctx, DEPLOYED_POLICY);
  let stage: ReplayStage;
  const inBand = secs >= SELECTIVE_PARAMS.min_seconds_left && secs <= SELECTIVE_PARAMS.max_seconds_left;
  if (input.bookedBefore) stage = "already_positioned";
  else if (input.bookedAfter) stage = "booked";
  else if (!inBand) stage = "outside_band";
  else if (!raw.length) stage = "no_raw_direction";
  else if (!heard.length) stage = "raw_direction_not_heard";
  else if (!q.reachable) stage = "heard_below_quorum";
  else if (!dirOf(chair.lean)) stage = "chair_wait";
  else if (gv.eligible_ignoring_confirmation) stage = "awaiting_confirmation";
  else stage = "chair_directional_blocked";

  let parity: ReplayFrameResult["parity"] = null;
  if (input.recorded && (input.recorded.votes || input.recorded.chair)) {
    const recVotes = input.recorded.votes ?? [];
    const mism: string[] = [];
    for (const rv of recVotes) {
      const mine = votes.find((v) => v.seat === rv.seat);
      if (!mine) { mism.push(`${rv.seat}: missing`); continue; }
      if (mine.lean !== rv.lean || mine.skill_used !== rv.skill_used) mism.push(`${rv.seat}: recorded ${rv.lean}/${rv.skill_used} replay ${mine.lean}/${mine.skill_used}`);
    }
    parity = { votes_compared: recVotes.length, vote_lean_mismatch: mism,
      chair_lean_match: input.recorded.chair ? input.recorded.chair.lean === chair.lean : null };
  }

  return {
    ticker: snap.ticker, close_time: snap.close_time, as_of: snap.as_of, secs_left: Math.round(secs * 10) / 10,
    regime: snap.regime_key ?? "", raw_directional: raw, heard_directional: heard, forced_sit_reasons: forced,
    chair_raw_lean: rawChair.lean, chair_lean: chair.lean,
    best_quorum: { side: q.side, supporters: q.supporters, families: q.families, opposition: q.opposition, reachable: q.reachable },
    gate_vector: { side: gv.side, mode: gv.mode, failed: gv.failed, not_evaluable: gv.not_evaluable,
      binding_reason: gv.binding_reason, eligible_ignoring_confirmation: gv.eligible_ignoring_confirmation },
    booked_now: input.bookedAfter && !input.bookedBefore, stage, parity,
  };
}

// ---------------------------------------------------------------------------
// Input, provenance and identity — fail closed for current-state claims
// ---------------------------------------------------------------------------

export const REACHABILITY_INPUT_SCHEMA = "REACHABILITY_A_INPUT_V2";

/** What the report may claim. Only CURRENT_STATE may carry a REACHABLE / STRUCTURALLY_BLOCKED current-state verdict. */
export type EvidenceClass = "CURRENT_STATE" | "MECHANICAL_ONLY" | "SYNTHETIC";

export type ReachabilityFrame = {
  snap: Snapshot;
  /** Production sticky votes recorded with this snapshot (e.g. `/frame`.votes). Required for a current-state witness. */
  votes?: Vote[] | null;
  /** Production post-entry-mode Chair recorded with this snapshot (e.g. `/frame`.chair). Required for a current-state witness. */
  chair?: Pick<ChairResult, "lean"> | null;
  /** Deployed commit that produced this frame. Required, and equal to source.build_sha, for a current-state witness. */
  build_sha?: string | null;
};

export type ReachabilityInput = {
  schema: typeof REACHABILITY_INPUT_SCHEMA;
  /** current_state: fail closed on any missing context. mechanical: allowed substitutions, never a current-state verdict. */
  mode: "current_state" | "mechanical";
  source: {
    kind: "desk_state_row" | "public_frame_poll" | "synthetic" | "other";
    captured_at: string;
    build_sha?: string | null;
    note?: string;
  };
  /** Where state.risk_calls came from. Only a primary desk_state row is exact. */
  risk_provenance: "primary_desk_state" | "unavailable";
  /** desk_state.state exactly as persisted. */
  state: Record<string, unknown>;
  frames?: ReachabilityFrame[];
  /** Optional primary desk_state.state per window key `${ticker}|${close_time}`, captured at that window's open. */
  window_states?: Record<string, Record<string, unknown>>;
};

const SNAP_REQUIRED = [
  "as_of", "close_time", "ticker", "mins_left", "secs_left", "phase", "regime_key", "yes_ask", "no_ask", "yes_bid", "no_bid",
  "yes_bid_size", "no_bid_size", "edge_up", "edge_down", "fair_yes", "fee_yes", "fee_no", "spread_cents", "leftover_cents",
  "spot", "strike", "spot_age_s", "quote_age_s", "obs", "health", "ret5", "ret15", "ret30", "candles_1m", "lab_age_s",
] as const;

const SHA40 = /^[0-9a-f]{40}$/;

/** Shape validation: anything missing here means the harness cannot run at all. */
export function validateReachabilityInput(raw: unknown): { ok: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];
  const o = raw as Partial<ReachabilityInput> | null;
  if (!o || typeof o !== "object") return { ok: false, missing: ["input object"], warnings };
  if (o.schema !== REACHABILITY_INPUT_SCHEMA) missing.push(`schema = ${REACHABILITY_INPUT_SCHEMA}`);
  if (o.mode !== "current_state" && o.mode !== "mechanical") missing.push("mode = current_state | mechanical");
  if (!o.source?.captured_at) missing.push("source.captured_at");
  if (!o.source?.kind) missing.push("source.kind");
  if (o.risk_provenance !== "primary_desk_state" && o.risk_provenance !== "unavailable") missing.push("risk_provenance = primary_desk_state | unavailable");
  const st = o.state as Record<string, unknown> | undefined;
  if (!st || typeof st !== "object") missing.push("state (desk_state.state)");
  else {
    const learner = st.learner as Record<string, unknown> | undefined;
    if (!learner || typeof learner !== "object") missing.push("state.learner");
    else {
      for (const k of ["skills", "seat_n", "learn_phase", "knobs", "thresholds"]) if (!(k in learner)) missing.push(`state.learner.${k}`);
      if (!("seat_calib_debt" in learner)) warnings.push("state.learner.seat_calib_debt absent: treated as zero debt, as mergeLearner does");
      const skills = learner.skills as Record<string, { status?: unknown; pocket?: unknown }> | undefined;
      if (skills && typeof skills === "object") {
        const live = Object.values(skills).filter((c) => c?.status === "LIVE");
        if (!live.length) warnings.push("no LIVE cards in state.learner.skills");
        if (live.some((c) => c.pocket == null)) missing.push("state.learner.skills[*].pocket for LIVE cards (per-regime holds)");
      }
    }
  }
  const frames = o.frames ?? [];
  if (!frames.length) warnings.push("no frames: structural analysis only; no replay witness possible");
  frames.forEach((f, i) => {
    const s = f?.snap as Record<string, unknown> | undefined;
    if (!s) { missing.push(`frames[${i}].snap`); return; }
    for (const k of SNAP_REQUIRED) if (!(k in s)) missing.push(`frames[${i}].snap.${k}`);
    if (i > 0) {
      const prev = frames[i - 1]!.snap as unknown as Snapshot;
      if (!(Number((s as unknown as Snapshot).as_of) > Number(prev.as_of))) missing.push(`frames[${i}] is not later than frames[${i - 1}] (frames must be strictly time-ordered)`);
    }
  });
  return { ok: missing.length === 0, missing, warnings };
}

export type Provenance = {
  requested_mode: ReachabilityInput["mode"];
  evidence_class: EvidenceClass;
  /** True only when every current-state requirement is met. */
  current_state_ok: boolean;
  /** Each unmet requirement, labelled UNRECONSTRUCTABLE. Empty when current_state_ok. */
  failures: string[];
};

/**
 * Current-state requirements (all must hold): mode current_state; a primary
 * desk_state row; risk history from that row, valid; actual settings; the
 * deployed build; the active selective policy and its start. Anything missing
 * makes the run MECHANICAL_ONLY — its bookings are never a current-state witness.
 */
export function assessProvenance(input: ReachabilityInput): Provenance {
  const failures: string[] = [];
  const st = input.state ?? {};
  const settings = st.settings as Record<string, unknown> | undefined;
  if (input.source?.kind !== "desk_state_row") failures.push(`UNRECONSTRUCTABLE state: source.kind is ${input.source?.kind ?? "absent"}, not a primary desk_state row`);
  if (input.risk_provenance !== "primary_desk_state") failures.push(`UNRECONSTRUCTABLE risk history: risk_provenance ${input.risk_provenance ?? "absent"}`);
  if (!Array.isArray(st.risk_calls)) failures.push("UNRECONSTRUCTABLE risk history: state.risk_calls is not the persisted array");
  if (st.risk_history_valid !== true) failures.push("UNRECONSTRUCTABLE risk readiness: state.risk_history_valid is not true");
  if (!settings || typeof settings !== "object" || !("adaptive_bar" in settings) || !("mutes" in settings) || !("bar_override" in settings)) {
    failures.push("UNRECONSTRUCTABLE settings: state.settings must carry the actual adaptive_bar, bar_override and mutes");
  }
  if (!SHA40.test(String(input.source?.build_sha ?? "").toLowerCase())) failures.push("UNRECONSTRUCTABLE build: source.build_sha is not a 40-hex deployed commit");
  if (st.selective_policy !== SELECTIVE_ENTRY_ID) failures.push(`UNRECONSTRUCTABLE admission: state.selective_policy is ${String(st.selective_policy ?? "absent")}, not ${SELECTIVE_ENTRY_ID}`);
  if (!(Number.isFinite(st.selective_start) && Number(st.selective_start) > 0)) failures.push("UNRECONSTRUCTABLE admission: state.selective_start absent");
  const synthetic = input.source?.kind === "synthetic";
  const currentOk = input.mode === "current_state" && !synthetic && failures.length === 0;
  if (input.mode !== "current_state") failures.unshift("mode is mechanical: no current-state verdict is issued");
  return {
    requested_mode: input.mode,
    evidence_class: synthetic ? "SYNTHETIC" : currentOk ? "CURRENT_STATE" : "MECHANICAL_ONLY",
    current_state_ok: currentOk,
    failures: currentOk ? [] : failures,
  };
}

/**
 * A frame's window identity: the ticker's own embedded close must agree with
 * close_time, close_time must sit on the 15-minute grid, and as_of must precede
 * close. A stale-rollover pairing (previous ticker, new close) fails here.
 */
export function frameIdentity(snap: Pick<Snapshot, "ticker" | "close_time" | "as_of">): { ok: boolean; reason: string | null } {
  const agrees = tickerAgrees(String(snap.ticker ?? ""), Number(snap.close_time));
  if (agrees === null) return { ok: false, reason: "TICKER_UNPARSEABLE" };
  if (!agrees) return { ok: false, reason: "TICKER_CLOSE_TIME_MISMATCH" };
  if (!onGrid(Number(snap.close_time))) return { ok: false, reason: "CLOSE_OFF_GRID" };
  if (!(Number(snap.as_of) < Number(snap.close_time))) return { ok: false, reason: "AS_OF_NOT_BEFORE_CLOSE" };
  return { ok: true, reason: null };
}

/** Longest gap tolerated by the active normal-mode confirmation latch. A
 * single-frame policy has no inter-frame latch whose continuity can be lost. */
export const MAX_WITNESS_GAP_MS = SELECTIVE_PARAMS.confirmation_frames > 1 ? 10_000 : Infinity;

export type WindowEvidence = {
  key: string;
  ticker: string;
  close_time: number;
  frames_replayed: number;
  identity_rejected: { as_of: number; ticker: string; close_time: number; reason: string }[];
  state_fidelity: "initial_state" | "window_state" | "none";
  first_secs_left: number | null;
  max_gap_ms: number;
  build_mismatch_frames: number;
  parity_checked_frames: number;
  parity_missing_frames: number;
  parity_mismatch_frames: number;
  /** Why this window cannot supply a current-state witness; empty means it can. */
  diagnostic_reasons: string[];
};

/** Judge one window's frames (up to and including a witness, if any) for current-state witness eligibility. */
export function judgeWindow(w: Omit<WindowEvidence, "diagnostic_reasons">, prov: Provenance, sourceBuild: string | null | undefined): string[] {
  const why: string[] = [];
  if (!prov.current_state_ok) why.push(`evidence class ${prov.evidence_class}`);
  if (w.identity_rejected.length) why.push(`identity-incomplete: ${w.identity_rejected.length} frame(s) with mismatched ticker/close for this close_time`);
  if (w.state_fidelity === "none") why.push("no per-window primary state: the learner was not graded across the preceding rollover");
  if ((SELECTIVE_PARAMS.confirmation_frames > 1 || SELECTIVE_PARAMS.confirmation_seconds > 0) &&
      (w.first_secs_left == null || !(w.first_secs_left > SELECTIVE_PARAMS.max_seconds_left))) {
    why.push("coverage starts inside the entry band: confirmation/stick state before capture is unknown");
  }
  if (Number.isFinite(MAX_WITNESS_GAP_MS) && w.max_gap_ms > MAX_WITNESS_GAP_MS) {
    why.push(`frame gap ${Math.round(w.max_gap_ms / 1000)}s exceeds the ${MAX_WITNESS_GAP_MS / 1000}s latch limit`);
  }
  if (!SHA40.test(String(sourceBuild ?? "").toLowerCase())) why.push("no deployed build to compare frames against");
  if (w.build_mismatch_frames) why.push(`${w.build_mismatch_frames} frame(s) lack build_sha or differ from source.build_sha`);
  if (w.parity_missing_frames) why.push(`${w.parity_missing_frames} frame(s) lack recorded production votes/chair`);
  if (w.parity_mismatch_frames) why.push(`${w.parity_mismatch_frames} frame(s) where replay differs from recorded production votes/chair`);
  return why;
}
