/**
 * RESEARCH FACTORY — the production DECISION TAPE (pure).
 *
 * Every production WAIT becomes a structured observation, and every designated
 * checkpoint becomes a FRAME BRIEF: what blocks the decision now, the exact
 * current and required values, and the machine-readable conditions that would
 * move it one funnel stage further. After the window settles the briefs are
 * graded: did the stated condition occur, did the blocker clear, what blocked
 * next, did the Council become directional, qualify, book.
 *
 * READ ONLY. Everything here is read from the production frame the engine
 * already published on that tick: the Chair (score, bar, vs_bar, sit mass,
 * rows, gates), the admission audit (every production check), the daily
 * admission state and the paper call log. Nothing is recomputed that
 * production decided, and no requirement is invented: a value the frame does
 * not publish (the production confirmation latch) is recorded as unknown.
 *
 * Authority NONE. Pure module: no clock, no state, no database.
 */
import { takerFeeCents } from "./clock.ts";
import { EVIDENCE_OF } from "./seats.ts";
import { admissionRequirements } from "./selective-entry.ts";
import type { dailyAdmission } from "./selective-entry.ts";
import { SELECTIVE_PARAMS } from "./floor-policy.ts";
import { eligibleSupportRows } from "./support-eligibility.ts";
import { chairWaitReason } from "./telemetry.ts";
import type { CallLogRow, ChairResult, Snapshot } from "./types";
import { onGrid, tickerAgrees } from "./window-identity.ts";

// ---------------------------------------------------------------------------
// Taxonomy.
// ---------------------------------------------------------------------------

/** Deterministic WAIT reasons. UNKNOWN is used rather than a guess. */
export const WAIT_REASONS = [
  "NO_RESEARCH_READ", "STATUS_OR_AUTHORITY_SUPPRESSED", "DIRECTION_BELOW_BAR", "DIRECTION_CONFLICT",
  "TEAM_FAIL", "SUPPORTER_FAIL", "FAMILY_DIVERSITY_FAIL", "OPPOSITION_FAIL", "QUOTE_FAIL", "ENTRY_PRICE_FAIL",
  "MODEL_EDGE_FAIL", "INDEX_EDGE_FAIL", "CONFIRMATION_INCOMPLETE", "FEED_OR_DATA_HEALTH_FAIL", "TIME_WINDOW_FAIL",
  "DAILY_RISK_FAIL", "OTHER_EXPLICIT", "UNKNOWN",
] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

/**
 * The production funnel, in order. A window's tape LABEL is its primary
 * blocker while it waits, QUALIFIED when admission passes, PRODUCTION_BOOKED
 * once the paper book holds it.
 */
export const TAPE_STAGES = [
  "OBSERVED", "CANDIDATE", "DIRECTIONAL", "TEAM", "SUPPORTERS", "FAMILIES", "OPPOSITION", "QUOTE", "ECONOMICS", "INDEX_EDGE", "CONFIRMATION", "QUALIFIED", "PRODUCTION_BOOKED",
] as const;
export type TapeStage = (typeof TAPE_STAGES)[number];

/** The stage each blocker holds a window at (the next stage it cannot pass). */
export const BLOCKER_STAGE: Readonly<Record<WaitReason, TapeStage>> = Object.freeze({
  NO_RESEARCH_READ: "OBSERVED", STATUS_OR_AUTHORITY_SUPPRESSED: "CANDIDATE", DIRECTION_BELOW_BAR: "CANDIDATE", DIRECTION_CONFLICT: "CANDIDATE",
  TEAM_FAIL: "DIRECTIONAL", SUPPORTER_FAIL: "TEAM", FAMILY_DIVERSITY_FAIL: "SUPPORTERS", OPPOSITION_FAIL: "FAMILIES",
  QUOTE_FAIL: "OPPOSITION", ENTRY_PRICE_FAIL: "OPPOSITION", MODEL_EDGE_FAIL: "QUOTE", DAILY_RISK_FAIL: "QUOTE", TIME_WINDOW_FAIL: "QUOTE", FEED_OR_DATA_HEALTH_FAIL: "QUOTE",
  INDEX_EDGE_FAIL: "ECONOMICS", CONFIRMATION_INCOMPLETE: "INDEX_EDGE", OTHER_EXPLICIT: "OBSERVED", UNKNOWN: "OBSERVED",
});

/** Admission check id -> reason, in the order the primary blocker is chosen. */
const ADMISSION_ORDER: ReadonlyArray<[string, WaitReason]> = [
  ["risk_history", "DAILY_RISK_FAIL"], ["daily_risk", "DAILY_RISK_FAIL"], ["complete_window", "TIME_WINDOW_FAIL"], ["time", "TIME_WINDOW_FAIL"], ["feeds", "FEED_OR_DATA_HEALTH_FAIL"],
  ["team", "TEAM_FAIL"], ["supporters", "SUPPORTER_FAIL"], ["families", "FAMILY_DIVERSITY_FAIL"], ["opposition", "OPPOSITION_FAIL"],
  ["quote", "QUOTE_FAIL"], ["model_edge", "MODEL_EDGE_FAIL"], ["profit_reserve", "DAILY_RISK_FAIL"], ["index_fresh", "FEED_OR_DATA_HEALTH_FAIL"], ["index_edge", "INDEX_EDGE_FAIL"],
  ["confirmation", "CONFIRMATION_INCOMPLETE"],
];

/** Hard Chair gates -> reason. An unmapped gate keeps its raw id under OTHER_EXPLICIT. */
export const CHAIR_GATE_REASON: Readonly<Record<string, WaitReason>> = Object.freeze({
  warden: "FEED_OR_DATA_HEALTH_FAIL", semantic: "FEED_OR_DATA_HEALTH_FAIL", seq: "FEED_OR_DATA_HEALTH_FAIL", derivs: "FEED_OR_DATA_HEALTH_FAIL",
  quote: "QUOTE_FAIL", spread: "QUOTE_FAIL", leftover: "QUOTE_FAIL", chalk: "QUOTE_FAIL",
  early: "TIME_WINDOW_FAIL", late: "TIME_WINDOW_FAIL", edge: "MODEL_EDGE_FAIL", law: "DAILY_RISK_FAIL",
  top3: "DIRECTION_CONFLICT", bar: "DIRECTION_BELOW_BAR",
});

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

export type AuditCheck = { id: string; label?: string; pass: boolean | null; blocking?: boolean };
export type Audit = { checks: readonly AuditCheck[]; positioned: boolean; eligible: boolean; mode: "normal" | "tight" };
export type TapeFrame = {
  snap: Snapshot;
  chair: ChairResult;
  audit: Audit | null;
  daily: ReturnType<typeof dailyAdmission> | null;
  call_log: readonly CallLogRow[];
};

// ---------------------------------------------------------------------------
// Conditions.
// ---------------------------------------------------------------------------

/**
 * One machine-readable condition that would move the window past its primary
 * blocker. `required` is only set when it comes from production's own logic.
 */
export type Condition = {
  metric: string;
  op: ">=" | ">" | "<=" | "<" | "pass" | "in_range";
  current: number | boolean | null;
  required: number | boolean | [number, number] | null;
  /** Can this change inside the window at all (a daily-risk lock cannot)? */
  changeable_within_window: boolean;
  note?: string;
};

/** Evaluate a condition against a later frame's measured values; null when that frame did not measure it. */
export function conditionMet(c: Condition, values: Readonly<Record<string, number | boolean | null>>): boolean | null {
  const v = values[c.metric];
  if (v == null || c.required == null) return null;
  switch (c.op) {
    case ">=": return typeof v === "number" && typeof c.required === "number" ? v >= c.required : null;
    case ">": return typeof v === "number" && typeof c.required === "number" ? v > c.required : null;
    case "<=": return typeof v === "number" && typeof c.required === "number" ? v <= c.required : null;
    case "<": return typeof v === "number" && typeof c.required === "number" ? v < c.required : null;
    case "pass": return v === true;
    case "in_range": return typeof v === "number" && Array.isArray(c.required) ? v >= c.required[0] && v <= c.required[1] : null;
  }
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

export type TapeRecord = {
  ticker: string;
  close_ms: number;
  as_of: number;
  secs_left: number;
  quote_seq: number | null;
  state: "WAIT" | "DIRECTIONAL" | "QUALIFIED" | "BOOKED";
  label: WaitReason | "QUALIFIED" | "PRODUCTION_BOOKED";
  stage: TapeStage;
  stage_index: number;
  primary_blocker: WaitReason | null;
  blockers: WaitReason[];
  /** Production's own words, preserved verbatim (chair_wait is telemetry's chairWaitReason, the same string desk_chair_evals stores). */
  raw: { chair_wait: string; failing_checks: Array<{ id: string; label: string | null }>; failing_chair_gates: Array<{ id: string; value: string }>; mode: string | null };
  conditions: Condition[];
  /** Every measured value a condition can be graded against later. */
  values: Record<string, number | boolean | null>;
  evidence: {
    side: "UP" | "DOWN" | null;
    raw_side: "UP" | "DOWN" | null;
    score: number | null; vs_bar: number | null; bar: number | null; sit_mass: number | null; sit_term: number | null; dir_mass: number | null;
    aggressiveness: number | null; directional_seats: string[]; supporters: string[]; families: string[]; opposing: number | null;
    /** The bar the Chair's own breakdown gives without its sit-mass term (clamped at 0.24). A LEVER for survival analysis, never a graded condition. */
    bar_without_sit: number | null;
  };
  market: { yes_ask: number | null; no_ask: number | null; yes_bid: number | null; no_bid: number | null; yes_mid: number | null; favorite_ask: number | null; regime: string | null };
  /** Compact seat reads for signal-value research (checkpoints only). */
  seats?: Array<{ seat: string; lean: string; conf: number | null; status: string; weight: number | null; folded: boolean }>;
};

const fin = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const dir = (x: unknown): "UP" | "DOWN" | null => (x === "UP" || x === "DOWN" ? x : null);

export function classifyTape(f: TapeFrame): TapeRecord {
  const { snap, chair, audit } = f;
  const secs = (snap.close_time - snap.as_of) / 1000;
  const side = dir(chair.lean);
  const rows = Array.isArray(chair.rows) ? chair.rows : [];
  const dirRows = rows.filter((r) => (r.lean === "UP" || r.lean === "DOWN") && !r.forced_sit);
  const rawSide = fin(chair.score) == null || chair.score === 0 ? null : chair.score > 0 ? "UP" : "DOWN";
  const req = f.daily ? admissionRequirements(f.daily) : null;
  const p = SELECTIVE_PARAMS;
  const checks = new Map((audit?.checks ?? []).map((c) => [c.id, c]));
  const failing = (audit?.checks ?? []).filter((c) => c.pass === false);
  const hardGates = (Array.isArray(chair.gates) ? chair.gates : []).filter((g) => g.hard && !g.pass);
  const supporterRows = side ? eligibleSupportRows(chair, side) : [];
  const supporters = [...new Set(supporterRows.map((r) => r.seat))];
  const families = [...new Set(supporterRows.map((r) => EVIDENCE_OF[r.seat]))];
  const opposing = side ? (side === "UP" ? chair.quorum?.down : chair.quorum?.up) ?? null : null;
  const sideAsk = side === "UP" ? snap.yes_ask : side === "DOWN" ? snap.no_ask : NaN;
  const sideBid = side === "UP" ? snap.yes_bid : side === "DOWN" ? snap.no_bid : NaN;
  const touch = side === "UP" ? snap.no_bid_size : side === "DOWN" ? snap.yes_bid_size : NaN;
  const edge = side === "UP" ? snap.edge_up : side === "DOWN" ? snap.edge_down : NaN;
  const fair = fin(snap.lab_fair_yes);
  // The same margin production's index_edge check computes (admission-audit.ts), with the same fee function.
  const indexMargin = side && fair != null && Number.isFinite(sideAsk) ? (side === "UP" ? fair : 100 - fair) - sideAsk - takerFeeCents(sideAsk) : null;
  const sitTerm = fin(chair.bar_breakdown?.sit_mass);
  const barPre = fin(chair.bar_breakdown?.pre_clamp);

  // Values every later frame is graded against (null where production did not measure).
  const values: Record<string, number | boolean | null> = {
    directional_seats: dirRows.length,
    dir_mass: fin(chair.dir_mass),
    vs_bar_minus_bar: fin(chair.vs_bar) != null && fin(chair.bar) != null ? chair.vs_bar - chair.bar : null,
    chair_directional: side != null,
    top3_pass: (chair.gates ?? []).find((g) => g.id === "top3")?.pass ?? null,
    team_pass: checks.get("team")?.pass ?? null,
    supporters: side ? supporters.length : null,
    families: side ? families.length : null,
    opposing: opposing,
    ask_cents: side && Number.isFinite(sideAsk) ? sideAsk : null,
    spread_cents: side && Number.isFinite(sideAsk - sideBid) ? sideAsk - sideBid : null,
    touch_size: side && Number.isFinite(touch) ? touch : null,
    quote_pass: checks.get("quote")?.pass ?? null,
    model_edge_cents: side && Number.isFinite(edge) ? edge : null,
    index_margin_cents: indexMargin,
    index_fresh_pass: checks.get("index_fresh")?.pass ?? null,
    feeds_pass: checks.get("feeds")?.pass ?? null,
    confirmation_pass: checks.get("confirmation")?.pass ?? null,
    secs_left: secs,
    daily_risk_pass: checks.get("daily_risk")?.pass ?? null,
    profit_reserve_pass: checks.get("profit_reserve")?.pass ?? null,
    eligible: audit ? audit.eligible : null,
    positioned: audit ? audit.positioned : null,
  };

  // The Chair's own WAIT reason, when it waits.
  let directionReason: WaitReason | null = null;
  if (!side) {
    if (dirRows.length === 0) directionReason = "NO_RESEARCH_READ";
    else if (!(fin(chair.dir_mass) != null && chair.dir_mass > 0)) directionReason = "STATUS_OR_AUTHORITY_SUPPRESSED";
    else if (hardGates.some((g) => g.id !== "bar")) directionReason = CHAIR_GATE_REASON[hardGates.find((g) => g.id !== "bar")!.id] ?? "OTHER_EXPLICIT";
    else if ((chair.gates ?? []).some((g) => g.id === "top3" && !g.pass)) directionReason = "DIRECTION_CONFLICT";
    else if (fin(chair.vs_bar) != null && fin(chair.bar) != null && chair.vs_bar < chair.bar) directionReason = "DIRECTION_BELOW_BAR";
    else directionReason = "UNKNOWN";
  }
  const reasonOf = (id: string): WaitReason => {
    if (id === "quote") return side && Number.isFinite(sideAsk) && sideAsk < p.floor_cents ? "ENTRY_PRICE_FAIL" : "QUOTE_FAIL";
    if (id === "direction") return directionReason ?? "UNKNOWN";
    if (id.startsWith("chair:")) return CHAIR_GATE_REASON[id.slice(6)] ?? "OTHER_EXPLICIT";
    return ADMISSION_ORDER.find(([k]) => k === id)?.[1] ?? "OTHER_EXPLICIT";
  };
  const blockers: WaitReason[] = [];
  const push = (r: WaitReason) => { if (!blockers.includes(r)) blockers.push(r); };
  // Preconditions first (they block unconditionally), then the Chair's direction, then admission in funnel order.
  for (const [id] of ADMISSION_ORDER.slice(0, 5)) if (checks.get(id)?.pass === false) push(reasonOf(id));
  if (directionReason) push(directionReason);
  for (const [id] of ADMISSION_ORDER.slice(5)) if (checks.get(id)?.pass === false) push(reasonOf(id));
  for (const c of failing) if (c.id.startsWith("chair:") && c.blocking && c.id !== "chair:bar") push(reasonOf(c.id));
  if (!audit && !directionReason && side) push("UNKNOWN");

  const booked = audit?.positioned === true || f.call_log.some((r) => r.ticker === snap.ticker && r.close_time === snap.close_time);
  const qualified = !booked && audit?.eligible === true;
  const state: TapeRecord["state"] = booked ? "BOOKED" : qualified ? "QUALIFIED" : side ? "DIRECTIONAL" : "WAIT";
  const primary = booked || qualified ? null : blockers[0] ?? "UNKNOWN";

  // Deepest stage reached: consecutive passes in funnel order.
  const pass = (id: string) => checks.get(id)?.pass === true;
  const precond = ["risk_history", "daily_risk", "complete_window", "time", "feeds"].every(pass);
  const reached: boolean[] = [
    true, dirRows.length > 0, side != null, pass("team"), pass("supporters"), pass("families"), pass("opposition"), pass("quote"),
    precond && pass("model_edge") && pass("profit_reserve"), pass("index_fresh") && pass("index_edge"), pass("confirmation"), qualified || booked, booked,
  ];
  let stageIndex = 0;
  for (let i = 1; i < reached.length; i += 1) { if (!reached[i]) break; stageIndex = i; }

  return {
    ticker: snap.ticker, close_ms: snap.close_time, as_of: snap.as_of, secs_left: secs, quote_seq: fin(snap.quote_seq),
    state, label: booked ? "PRODUCTION_BOOKED" : qualified ? "QUALIFIED" : primary!, stage: TAPE_STAGES[stageIndex]!, stage_index: stageIndex,
    primary_blocker: primary, blockers,
    raw: {
      chair_wait: chairWaitReason(chair),
      failing_checks: failing.map((c) => ({ id: c.id, label: c.label ?? null })),
      failing_chair_gates: hardGates.map((g) => ({ id: g.id, value: String(g.value ?? "") })),
      mode: audit?.mode ?? null,
    },
    conditions: primary ? conditionsFor(primary, values, { req, sitTerm, barPre, bar: fin(chair.bar), vsBar: fin(chair.vs_bar) }) : [],
    values,
    evidence: {
      side, raw_side: rawSide, score: fin(chair.score), vs_bar: fin(chair.vs_bar), bar: fin(chair.bar), sit_mass: fin(chair.sit_mass), sit_term: sitTerm, dir_mass: fin(chair.dir_mass),
      aggressiveness: fin(chair.aggressiveness), directional_seats: dirRows.map((r) => r.seat), supporters, families, opposing,
      bar_without_sit: sitTerm != null && barPre != null ? Math.min(0.72, Math.max(0.24, barPre - sitTerm)) : null,
    },
    market: {
      yes_ask: fin(snap.yes_ask), no_ask: fin(snap.no_ask), yes_bid: fin(snap.yes_bid), no_bid: fin(snap.no_bid), yes_mid: fin(snap.yes_mid),
      favorite_ask: fin(snap.yes_ask) != null && fin(snap.no_ask) != null ? Math.max(snap.yes_ask, snap.no_ask) : null, regime: snap.regime_key || null,
    },
  };
}

type CondCtx = { req: ReturnType<typeof admissionRequirements> | null; sitTerm: number | null; barPre: number | null; bar: number | null; vsBar: number | null };

/** The conditions production's own logic says would clear this blocker. Nothing is invented. */
export function conditionsFor(r: WaitReason, v: Record<string, number | boolean | null>, c: CondCtx): Condition[] {
  const p = SELECTIVE_PARAMS;
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  switch (r) {
    case "NO_RESEARCH_READ": return [{ metric: "directional_seats", op: ">=", current: n("directional_seats"), required: 1, changeable_within_window: true, note: "any seat speaks directionally" }];
    case "STATUS_OR_AUTHORITY_SUPPRESSED": return [{ metric: "dir_mass", op: ">", current: n("dir_mass"), required: 0, changeable_within_window: true, note: "a directional read carries weight (status/authority/health)" }];
    case "DIRECTION_BELOW_BAR":
      return [{ metric: "vs_bar_minus_bar", op: ">=", current: n("vs_bar_minus_bar"), required: 0, changeable_within_window: true, note: c.sitTerm != null ? `|score| x aggressiveness reaches the bar: more same-side weighted evidence, a higher time factor, or a lower bar (the sit-mass term is ${c.sitTerm.toFixed(3)} of it)` : "|score| x aggressiveness reaches the bar" }];
    case "DIRECTION_CONFLICT": return [{ metric: "top3_pass", op: "pass", current: v.top3_pass as boolean | null, required: true, changeable_within_window: true, note: "the top-3 loud seats stop disagreeing" }];
    case "TEAM_FAIL": return [{ metric: "team_pass", op: "pass", current: v.team_pass as boolean | null, required: true, changeable_within_window: true }];
    case "SUPPORTER_FAIL": return [{ metric: "supporters", op: ">=", current: n("supporters"), required: c.req?.min_speaking ?? null, changeable_within_window: true, note: "healthy LIVE/FADED unfolded supporters on the side" }];
    case "FAMILY_DIVERSITY_FAIL": return [{ metric: "families", op: ">=", current: n("families"), required: c.req?.min_families ?? null, changeable_within_window: true }];
    case "OPPOSITION_FAIL": return [{ metric: "opposing", op: "<=", current: n("opposing"), required: p.max_opposing, changeable_within_window: true }];
    case "ENTRY_PRICE_FAIL": return [{ metric: "ask_cents", op: ">=", current: n("ask_cents"), required: p.floor_cents, changeable_within_window: true, note: "the side's ask reaches the production floor" }];
    case "QUOTE_FAIL": {
      const out: Condition[] = [];
      if (n("spread_cents") != null && n("spread_cents")! > p.max_spread_cents) out.push({ metric: "spread_cents", op: "<=", current: n("spread_cents"), required: p.max_spread_cents, changeable_within_window: true });
      if (n("touch_size") != null && n("touch_size")! < 1) out.push({ metric: "touch_size", op: ">=", current: n("touch_size"), required: 1, changeable_within_window: true });
      if (n("ask_cents") != null && n("ask_cents")! >= 99) out.push({ metric: "ask_cents", op: "<", current: n("ask_cents"), required: 99, changeable_within_window: true });
      return out.length ? out : [{ metric: "quote_pass", op: "pass", current: v.quote_pass as boolean | null, required: true, changeable_within_window: true, note: "book validity" }];
    }
    case "MODEL_EDGE_FAIL": return [{ metric: "model_edge_cents", op: ">=", current: n("model_edge_cents"), required: c.req?.min_edge_cents ?? null, changeable_within_window: true }];
    case "INDEX_EDGE_FAIL": return [{ metric: "index_margin_cents", op: ">", current: n("index_margin_cents"), required: c.req?.min_index_edge_cents ?? null, changeable_within_window: true }];
    case "CONFIRMATION_INCOMPLETE": return [{ metric: "confirmation_pass", op: "pass", current: false, required: true, changeable_within_window: true, note: `needs ${c.req?.confirmation_frames ?? "?"} frames over ${c.req?.confirmation_seconds ?? "?"} s; the production latch count is not published in the frame` }];
    case "TIME_WINDOW_FAIL": return [{ metric: "secs_left", op: "in_range", current: n("secs_left"), required: [p.min_seconds_left, p.max_seconds_left], changeable_within_window: true, note: "clock-driven" }];
    case "FEED_OR_DATA_HEALTH_FAIL": return [{ metric: "feeds_pass", op: "pass", current: v.feeds_pass as boolean | null, required: true, changeable_within_window: true }];
    case "DAILY_RISK_FAIL": return [{ metric: "daily_risk_pass", op: "pass", current: v.daily_risk_pass as boolean | null, required: true, changeable_within_window: false, note: "a daily risk lock does not change inside the window" }];
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Recording policy.
// ---------------------------------------------------------------------------

/** Designated frame-brief checkpoints, seconds before the close. */
export const CHECKPOINTS = [600, 450, 300, 240, 180, 120, 60] as const;
export const CHECKPOINT_GRACE_S = 12;
export const MAX_EVENTS_PER_WINDOW = 80;

export function checkpointAt(secsLeft: number): number | null {
  for (const c of CHECKPOINTS) if (secsLeft <= c && secsLeft > c - CHECKPOINT_GRACE_S) return c;
  return null;
}

/** A frame is recorded at each checkpoint (once) and whenever the label or stage changes. */
export function shouldRecord(rec: TapeRecord, prev: { label: string; stage_index: number } | null, doneCheckpoints: ReadonlySet<number>): { record: boolean; checkpoint: number | null; change: boolean } {
  const cp = checkpointAt(rec.secs_left);
  const checkpoint = cp != null && !doneCheckpoints.has(cp) ? cp : null;
  const change = !prev || prev.label !== rec.label || prev.stage_index !== rec.stage_index;
  return { record: checkpoint != null || change, checkpoint, change };
}

// ---------------------------------------------------------------------------
// Grading one settled window.
// ---------------------------------------------------------------------------

export type TapeEvent = TapeRecord & { checkpoint: number | null; partial_window: boolean; build_sha: string };

export type TapeIdentityReason = "WINDOW_OFF_GRID" | "TICKER_CLOSE_TIME_MISMATCH";
export type TapeIdentityQuality = { reportable: boolean; on_grid: boolean; ticker_time_ok: boolean | null; reasons: TapeIdentityReason[] };

/** Reuses the production window-identity witnesses without rewriting source rows. */
export function tapeIdentityQuality(ticker: string, closeMs: number): TapeIdentityQuality {
  const grid = onGrid(closeMs);
  const tickerTimeOk = tickerAgrees(ticker, closeMs);
  const reasons: TapeIdentityReason[] = [];
  if (!grid) reasons.push("WINDOW_OFF_GRID");
  if (tickerTimeOk === false) reasons.push("TICKER_CLOSE_TIME_MISMATCH");
  return { reportable: reasons.length === 0, on_grid: grid, ticker_time_ok: tickerTimeOk, reasons };
}

export type BriefGrade = {
  checkpoint: number;
  secs_left: number;
  primary_blocker: string;
  gradable: boolean;
  condition_met: boolean;
  condition_met_secs_left: number | null;
  blocker_cleared: boolean;
  blocker_cleared_secs_left: number | null;
  next_blocker: string | null;
  advanced_stage: boolean;
  correct_transition: boolean;
  false_hope: boolean;
  unexplained_clear: boolean;
  became_directional: boolean;
  qualified: boolean;
  booked: boolean;
  /** The official settlement of the window, so every graded brief stands on its own. */
  official_winner: "UP" | "DOWN" | null;
};

export type WindowTimeline = {
  /** Raw append-only source count, including identity-excluded rows. */
  source_events: number;
  identity_excluded_events: number;
  identity_exclusion_reasons: TapeIdentityReason[];
  partial_window: boolean;
  events: number;
  labels: Array<{ label: string; stage_index: number; from_secs_left: number; dwell_s: number }>;
  transitions: Array<{ from: string; to: string; secs_left: number; regression: boolean }>;
  first_blocker: string | null;
  terminal_label: string | null;
  deepest_stage: TapeStage | null;
  became_directional: boolean;
  qualified: boolean;
  booked: boolean;
  briefs: BriefGrade[];
  winner: "UP" | "DOWN" | null;
  first_directional_side: "UP" | "DOWN" | null;
  /** Blockers seen before the first directional frame (for conversion analysis). */
  blockers_before_directional: string[];
};

const stageIdx = (label: string): number => {
  if (label === "PRODUCTION_BOOKED") return TAPE_STAGES.indexOf("PRODUCTION_BOOKED");
  if (label === "QUALIFIED") return TAPE_STAGES.indexOf("QUALIFIED");
  return TAPE_STAGES.indexOf(BLOCKER_STAGE[label as WaitReason] ?? "OBSERVED");
};

export function gradeWindow(events: readonly TapeEvent[], winner: "UP" | "DOWN" | null): WindowTimeline {
  const source = [...events].sort((a, b) => a.as_of - b.as_of);
  const excluded = source.filter((e) => !tapeIdentityQuality(e.ticker, e.close_ms).reportable);
  const ev = source.filter((e) => tapeIdentityQuality(e.ticker, e.close_ms).reportable);
  const closeMs = ev[0]?.close_ms ?? 0;
  const labels: WindowTimeline["labels"] = [];
  const transitions: WindowTimeline["transitions"] = [];
  for (let i = 0; i < ev.length; i += 1) {
    const e = ev[i]!;
    const last = labels[labels.length - 1];
    if (!last || last.label !== e.label) {
      if (last) transitions.push({ from: last.label, to: e.label, secs_left: e.secs_left, regression: stageIdx(e.label) < stageIdx(last.label) });
      labels.push({ label: e.label, stage_index: e.stage_index, from_secs_left: e.secs_left, dwell_s: 0 });
    }
  }
  for (let i = 0; i < labels.length; i += 1) {
    const end = i + 1 < labels.length ? labels[i + 1]!.from_secs_left : Math.max(0, (closeMs - (ev[ev.length - 1]?.as_of ?? closeMs)) / 1000);
    labels[i]!.dwell_s = Math.max(0, labels[i]!.from_secs_left - end);
  }
  const firstDir = ev.find((e) => e.evidence.side != null) ?? null;
  const briefs: BriefGrade[] = [];
  for (const e of ev) {
    if (e.checkpoint == null || !e.primary_blocker) continue;
    const later = ev.filter((l) => l.as_of > e.as_of);
    let metAt: TapeEvent | null = null;
    for (const l of later) { if (e.conditions.some((c) => conditionMet(c, l.values) === true)) { metAt = l; break; } }
    const clearAt = later.find((l) => l.primary_blocker !== e.primary_blocker && !l.blockers.includes(e.primary_blocker as WaitReason)) ?? null;
    const gradable = e.conditions.some((c) => c.required != null && c.changeable_within_window);
    const advanced = later.some((l) => l.stage_index > e.stage_index);
    briefs.push({
      checkpoint: e.checkpoint, secs_left: e.secs_left, primary_blocker: e.primary_blocker, gradable,
      condition_met: !!metAt, condition_met_secs_left: metAt?.secs_left ?? null,
      blocker_cleared: !!clearAt, blocker_cleared_secs_left: clearAt?.secs_left ?? null,
      next_blocker: clearAt ? clearAt.primary_blocker ?? clearAt.label : null,
      advanced_stage: advanced,
      correct_transition: !!metAt && !!clearAt,
      false_hope: !!metAt && !advanced,
      unexplained_clear: !!clearAt && !metAt,
      became_directional: later.some((l) => l.evidence.side != null),
      qualified: later.some((l) => l.state === "QUALIFIED" || l.state === "BOOKED"),
      booked: later.some((l) => l.state === "BOOKED"),
      official_winner: winner,
    });
  }
  const deepest = ev.reduce<TapeEvent | null>((m, e) => (!m || e.stage_index > m.stage_index ? e : m), null);
  const before = firstDir ? ev.filter((e) => e.as_of < firstDir.as_of) : ev;
  return {
    source_events: source.length,
    identity_excluded_events: excluded.length,
    identity_exclusion_reasons: [...new Set(excluded.flatMap((e) => tapeIdentityQuality(e.ticker, e.close_ms).reasons))],
    partial_window: ev.some((e) => e.partial_window), events: ev.length, labels, transitions,
    first_blocker: ev[0]?.label ?? null, terminal_label: ev[ev.length - 1]?.label ?? null, deepest_stage: deepest?.stage ?? null,
    became_directional: !!firstDir, qualified: ev.some((e) => e.state === "QUALIFIED" || e.state === "BOOKED"), booked: ev.some((e) => e.state === "BOOKED"),
    briefs, winner, first_directional_side: firstDir?.evidence.side ?? null,
    blockers_before_directional: [...new Set(before.flatMap((e) => e.blockers))],
  };
}
