/**
 * RESEARCH FACTORY — per-window analysis (pure).
 *
 * Phase 2, WINDOW FACTS. For one settled window, re-grade every experiment arm
 * from the records stored AT DECISION TIME (desk_shadow_receipts) and the
 * official settlement (desk_ledger_research). Nothing is recomputed from a
 * later frame, and a missing input is never substituted:
 *
 *   EXACT        the arm's decision is re-derived from its stored decision-time
 *                record and matches what was recorded, and the window has an
 *                official settlement.
 *   PARTIAL      a record exists but some input the decision reads is not
 *                stored (or the re-derivation disagrees); reasons say which.
 *   UNAVAILABLE  no record, or no official settlement.
 *
 * What is NOT replayable, historically, is candidate GENERATION: the producer's
 * inputs (candles, OI/funding series, learner state) are not stored, so the
 * recovery candidates themselves cannot be regenerated for a past window. Every
 * fact says so (`candidate_replay: "UNAVAILABLE"`); EXACT refers to the
 * decision re-derived from the candidates that were recorded.
 *
 * Phase 3, INTEGRITY. Every receipt gets integrity_status CLEAN / SUSPECT /
 * INVALID / UNVERIFIABLE with machine-readable reason codes. Suspect history is
 * annotated, never deleted or rewritten. The P2 finding (PR #330, unresolved):
 * a LIVE E1 card that the producer's EXPLOIT quality guard skipped is still
 * captured on the paper path, so recovery can hear a card the producer
 * rejected. The stored records do not carry the learner phase or the card's
 * n/wilson, so a recovered LIVE card that the producer did not select is
 * SUSPECT (P2_LIVE_CARD_NOT_SELECTED) unless stored counters clear it.
 */
import { bookable } from "./book-floor.ts";
import { wilsonLower } from "./math.ts";
import { DEPLOYED_POLICY } from "./gate-vector.ts";
import { E1_ROSTER_CARDS, e1FamilyOf } from "./shadow-arms.ts";
import type { SeatId } from "./types";
import { KNOWN_EXPERIMENTS, netOf, RESEARCH_FACTORY } from "./research-factory.ts";

const MID_RECOVERY_EXPERIMENT = KNOWN_EXPERIMENTS.mid_recovery_v1;
const MID_RECOVERY_LOCKS_EXPERIMENT = KNOWN_EXPERIMENTS.mid_recovery_locks_v1;

// ---------------------------------------------------------------------------
// Inputs, as the server module reads them.
// ---------------------------------------------------------------------------

export type ReceiptRow = {
  experiment: string;
  arm: string;
  ticker: string;
  close_ms: number;
  kind: "intention" | "fill" | "no_fill" | "veto" | "wait" | "settle";
  decided_ms: number;
  recorded_ms: number;
  side: "UP" | "DOWN" | null;
  ask_cents: number | null;
  fee_cents: number | null;
  official_winner: "UP" | "DOWN" | null;
  net_cents: number | null;
  build_sha: string;
  payload: Record<string, unknown> | null;
};

/** The official research-valid ledger row for the window (desk_ledger_research). */
export type LedgerRow = {
  ticker: string;
  close_ms: number;
  winner: "UP" | "DOWN";
  chair_lean: string;
  entry_cents: number | null;
  entry_fee_cents: number | null;
  entry_lean: "UP" | "DOWN" | null;
  entry_build_sha: string | null;
};

/** The OPENING decision snapshot: decision-time context only (never the close). */
export type OpeningRow = {
  regime_key: string;
  atr: number | null;
  yes_ask: number | null;
  no_ask: number | null;
  spot: number | null;
  strike: number | null;
  decision_ms: number;
};

/** Stored counters for a card at grading input (skill_score_audit), when the audit covers it. */
export type CardCounters = { id: string; status_at_input: string; n: number | null; hits: number | null };

export type WindowInput = {
  ticker: string;
  close_ms: number;
  receipts: readonly ReceiptRow[];
  ledger: LedgerRow | null;
  opening: OpeningRow | null;
  counters: readonly CardCounters[];
};

// ---------------------------------------------------------------------------
// Payload readers. Every field is optional: older receipts carry fewer.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const arr = (x: unknown): unknown[] | null => (Array.isArray(x) ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const dir = (x: unknown): "UP" | "DOWN" | null => (x === "UP" || x === "DOWN" ? x : null);

export type Candidate = {
  seat: string;
  card_id: string;
  original_status: string | null;
  calibrated_lean: string | null;
  calibrated_conf: number | null;
  health: string | null;
  hypothesis: string | null;
  survived_fold: boolean;
  counted_as_support: boolean;
};

export function candidatesOf(payload: Obj | null): Candidate[] | null {
  const list = arr(payload?.candidates);
  if (!list) return null;
  return list.map((c) => {
    const o = obj(c) ?? {};
    return {
      seat: str(o.seat) ?? "", card_id: str(o.card_id) ?? "", original_status: str(o.original_status),
      calibrated_lean: str(o.calibrated_lean), calibrated_conf: num(o.calibrated_conf), health: str(o.health), hypothesis: str(o.hypothesis),
      survived_fold: o.survived_fold === true, counted_as_support: o.counted_as_support === true,
    };
  });
}

/** A recovered-path record: it carries the evaluator's `recovered` block. */
export const isRecoveredRecord = (payload: Obj | null): boolean => !!obj(payload?.recovered);

/** Recovery experiments whose receipts carry candidate provenance. */
export const RECOVERY_EXPERIMENTS: ReadonlySet<string> = new Set([MID_RECOVERY_EXPERIMENT.id, MID_RECOVERY_LOCKS_EXPERIMENT.id]);
export const DIAGNOSTIC_ONLY_ARMS: ReadonlySet<string> = new Set([`${MID_RECOVERY_LOCKS_EXPERIMENT.id}|COMBINED_DIAG`]);
export const isDiagnosticOnly = (experiment: string, arm: string): boolean => DIAGNOSTIC_ONLY_ARMS.has(`${experiment}|${arm}`);

/** The stage funnel, in the order the deployed path applies it. */
export const FUNNEL = [
  "OBSERVED", "CANDIDATE", "DIRECTIONAL", "TEAM", "SUPPORTERS", "FAMILIES", "QUOTE", "ECONOMICS", "INDEX_EDGE", "CONFIRMATION", "QUALIFIED", "SIMULATED_BOOKED",
] as const;
export type FunnelStage = (typeof FUNNEL)[number];
/** Which recorded gate checks belong to which funnel stage. */
export const STAGE_CHECKS: Readonly<Partial<Record<FunnelStage, readonly string[]>>> = Object.freeze({
  TEAM: ["team"],
  SUPPORTERS: ["supporters", "opposition"],
  QUOTE: ["quote"],
  ECONOMICS: ["risk_history", "daily_risk", "complete_window", "time", "feeds", "profit_reserve", "model_edge"],
  INDEX_EDGE: ["index_fresh", "index_edge"],
});

export type StageRead = { stage: FunnelStage; stage_index: number; first_blocker: FunnelStage | null; blockers: string[] };

/**
 * The deepest stage one recorded evaluation reached, the first stage that
 * blocked it, and every failing check (not just the first). Reads only the
 * record; never the settlement.
 */
export function stageOfRecord(payload: Obj | null): StageRead | null {
  const rec = obj(payload?.recovered);
  if (!rec) return null;
  const cands = candidatesOf(payload) ?? [];
  const checks = new Map<string, boolean | null>((arr(rec.checks) ?? []).map((c) => { const o = obj(c) ?? {}; return [str(o.id) ?? "", o.pass === true ? true : o.pass === false ? false : null]; }));
  const side = dir(rec.side);
  const conf = obj(payload?.confirmation);
  const sim = obj(payload?.simulated);
  const pass: Record<FunnelStage, boolean> = {
    OBSERVED: true,
    CANDIDATE: cands.length > 0,
    DIRECTIONAL: side != null,
    TEAM: checks.get("team") === true,
    SUPPORTERS: (STAGE_CHECKS.SUPPORTERS ?? []).every((id) => checks.get(id) === true),
    FAMILIES: rec.families_ok === true,
    QUOTE: checks.get("quote") === true,
    ECONOMICS: (STAGE_CHECKS.ECONOMICS ?? []).every((id) => checks.get(id) === true),
    INDEX_EDGE: (STAGE_CHECKS.INDEX_EDGE ?? []).every((id) => checks.get(id) === true),
    CONFIRMATION: conf?.confirmed === true,
    QUALIFIED: sim?.qualified === true,
    SIMULATED_BOOKED: sim?.booked === true,
  };
  let idx = 0;
  for (let i = 1; i < FUNNEL.length; i += 1) { if (!pass[FUNNEL[i]!]) break; idx = i; }
  const first = idx < FUNNEL.length - 1 ? FUNNEL[idx + 1]! : null;
  const blockers = [...checks.entries()].filter(([id, ok]) => ok === false && id !== "confirmation").map(([id]) => id).sort();
  if (side == null) blockers.unshift("direction");
  if (side != null && rec.families_ok !== true) blockers.push("families");
  if (side != null && conf && conf.confirmed !== true && rec.eligible === true) blockers.push("confirmation");
  return { stage: FUNNEL[idx]!, stage_index: idx, first_blocker: first, blockers: [...new Set(blockers)] };
}

// ---------------------------------------------------------------------------
// Phase 2: window facts.
// ---------------------------------------------------------------------------

export type ReplayQuality = "EXACT" | "PARTIAL" | "UNAVAILABLE";

export type WindowFact = {
  ticker: string;
  close_ms: number;
  experiment: string;
  arm: string;
  fact_version: number;
  replay_quality: ReplayQuality;
  quality_reasons: string[];
  experiment_version: number | null;
  source_build_sha: string | null;
  decided_ms: number | null;
  observed: boolean;
  terminal_kind: string | null;
  side: "UP" | "DOWN" | null;
  ask_cents: number | null;
  fee_cents: number | null;
  official_winner: "UP" | "DOWN" | null;
  net_cents: number | null;
  production_lean: string | null;
  production_booked: boolean | null;
  funnel_stage: FunnelStage | null;
  first_blocker: FunnelStage | null;
  blockers: string[];
  facts: Obj;
};

/** Terminal precedence: what the arm finally did in the window. */
const KIND_RANK: Record<string, number> = { fill: 5, intention: 4, veto: 3, no_fill: 2, wait: 1, settle: 0 };
const experimentVersion = (experiment: string): number | null =>
  experiment === MID_RECOVERY_EXPERIMENT.id ? MID_RECOVERY_EXPERIMENT.version : experiment === MID_RECOVERY_LOCKS_EXPERIMENT.id ? MID_RECOVERY_LOCKS_EXPERIMENT.version : null;

const bucket = (x: number | null, width: number): string | null => (x == null ? null : `${Math.floor(x / width) * width}-${Math.floor(x / width) * width + width}`);
const chicago = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false, weekday: "short" });

/** Decision-time context used by the breakdowns and pockets. Opening snapshot only: never the close. */
export function contextOf(input: WindowInput): Obj {
  const o = input.opening;
  const fav = o && o.yes_ask != null && o.no_ask != null ? Math.max(o.yes_ask, o.no_ask) : null;
  const parts = chicago.formatToParts(new Date(input.close_ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN) % 24;
  const day = parts.find((p) => p.type === "weekday")?.value ?? null;
  const dist = o && o.spot != null && o.strike != null && o.atr != null && o.atr > 0 ? (o.spot - o.strike) / o.atr : null;
  return {
    regime: o?.regime_key || null,
    favorite_cents_bucket: bucket(fav, 5),
    strike_distance_atr_bucket: dist == null ? null : bucket(Math.max(-3, Math.min(3, dist)), 0.5),
    hour_block_chicago: Number.isFinite(hour) ? `${Math.floor(hour / 4) * 4}-${Math.floor(hour / 4) * 4 + 4}h` : null,
    weekday_chicago: day,
    opening_decision_ms: o?.decision_ms ?? null,
  };
}

/**
 * Re-derive the recorded decision from the stored record, using the deployed
 * rules the record's own checks already encode. Returns the reasons it could
 * not, or did not, reproduce the recorded outcome.
 */
export function rederive(payload: Obj | null, kind: string, ask: number | null): { exact: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const rec = obj(payload?.recovered);
  const conf = obj(payload?.confirmation);
  const sim = obj(payload?.simulated);
  const econ = obj(payload?.economics);
  if (!rec) return { exact: false, reasons: ["NO_EVALUATION_RECORD"] };
  if (!arr(rec.checks)) reasons.push("MISSING_CHECKS");
  if (!conf) reasons.push("MISSING_CONFIRMATION");
  if (!sim) reasons.push("MISSING_SIMULATED");
  if (!econ) reasons.push("MISSING_ECONOMICS");
  if (!obj(rec.chair_trace)) reasons.push("MISSING_CHAIR_TRACE");
  if (!candidatesOf(payload)) reasons.push("MISSING_CANDIDATES");
  if (reasons.length) return { exact: false, reasons };
  const checks = (arr(rec.checks) ?? []).map((c) => obj(c) ?? {});
  const side = dir(rec.side);
  const eligible = side != null && rec.families_ok === true && checks.filter((c) => c.id !== "confirmation" && c.id !== "families").every((c) => c.pass === true);
  if (eligible !== (rec.eligible === true)) reasons.push("REDERIVED_ELIGIBLE_MISMATCH");
  const decisionAsk = num(econ!.ask_cents);
  const booked = eligible && conf!.confirmed === true && sim!.qualified === true && decisionAsk != null && bookable(decisionAsk);
  if (booked !== (sim!.booked === true)) reasons.push("REDERIVED_BOOKED_MISMATCH");
  if (kind === "fill" && !(sim!.booked === true)) reasons.push("FILL_WITHOUT_BOOKED_RECORD");
  if (kind === "fill" && ask != null && !bookable(ask)) reasons.push("FILL_BELOW_FLOOR");
  return { exact: reasons.length === 0, reasons };
}

export function windowFacts(input: WindowInput): WindowFact[] {
  const out: WindowFact[] = [];
  const ctx = contextOf(input);
  const winner = input.ledger?.winner ?? null;
  const groups = new Map<string, ReceiptRow[]>();
  for (const r of input.receipts) { if (r.ticker !== input.ticker || r.close_ms !== input.close_ms) continue; const k = `${r.experiment}|${r.arm}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const base = (experiment: string, arm: string): WindowFact => ({
    ticker: input.ticker, close_ms: input.close_ms, experiment, arm, fact_version: RESEARCH_FACTORY.fact_version, replay_quality: "UNAVAILABLE", quality_reasons: [],
    experiment_version: experimentVersion(experiment), source_build_sha: null, decided_ms: null, observed: false, terminal_kind: null, side: null, ask_cents: null, fee_cents: null,
    official_winner: winner, net_cents: null, production_lean: input.ledger?.chair_lean ?? null, production_booked: input.ledger ? input.ledger.entry_cents != null : null,
    funnel_stage: null, first_blocker: null, blockers: [], facts: { context: ctx, candidate_replay: "UNAVAILABLE: producer inputs (candles, OI/funding series, learner state) are not stored" },
  });

  for (const [key, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [experiment, arm] = key.split("|") as [string, string];
    const f = base(experiment, arm);
    f.observed = true;
    const terminal = [...rows].sort((a, b) => (KIND_RANK[b.kind] ?? 0) - (KIND_RANK[a.kind] ?? 0) || b.decided_ms - a.decided_ms)[0]!;
    f.terminal_kind = terminal.kind;
    f.decided_ms = terminal.decided_ms;
    f.source_build_sha = [...new Set(rows.map((r) => r.build_sha))].sort().join(",") || null;
    const fill = rows.find((r) => r.kind === "fill" && r.side != null && r.ask_cents != null) ?? null;
    if (fill) {
      f.side = fill.side; f.ask_cents = fill.ask_cents; f.fee_cents = fill.fee_cents;
      f.net_cents = winner && fill.fee_cents != null ? netOf({ side: fill.side!, ask_cents: fill.ask_cents!, fee_cents: fill.fee_cents, winner, close_ms: fill.close_ms }) : null;
    }
    // The deepest recorded evaluation of the window, for the funnel.
    const reads = rows.map((r) => ({ r, s: stageOfRecord(r.payload) })).filter((x) => x.s != null) as Array<{ r: ReceiptRow; s: StageRead }>;
    const best = reads.sort((a, b) => b.s.stage_index - a.s.stage_index || b.r.decided_ms - a.r.decided_ms)[0] ?? null;
    if (best) {
      f.funnel_stage = fill ? "SIMULATED_BOOKED" : best.s.stage;
      f.first_blocker = fill ? null : best.s.first_blocker;
      f.blockers = fill ? [] : best.s.blockers;
      const p = best.r.payload ?? {};
      const rec = obj(p.recovered) ?? {};
      const econ = obj(p.economics) ?? {};
      const cands = candidatesOf(p) ?? [];
      f.facts = {
        ...f.facts,
        record_kind: best.r.kind,
        record_decided_ms: best.r.decided_ms,
        recorded_side: dir(rec.side),
        recorded_confidence: num(rec.confidence),
        supporters: arr(rec.supporters) ?? [],
        families: arr(rec.families) ?? [],
        candidate_count: cands.length,
        candidate_seats: cands.map((c) => c.seat),
        candidate_cards: cands.map((c) => c.card_id),
        candidate_hypotheses: [...new Set(cands.map((c) => c.hypothesis).filter(Boolean))],
        decision_ask_cents: num(econ.ask_cents),
        decision_spread_cents: num(econ.spread_cents),
        model_edge_cents: num(econ.model_edge_cents),
        index_margin_cents: num(econ.index_margin_cents),
        quote_parts: { floor_ok: econ.floor_ok ?? null, ceiling_ok: econ.ceiling_ok ?? null, spread_ok: econ.spread_ok ?? null, size_ok: econ.size_ok ?? null },
        secs_left: num(p.secs_left) ?? num(obj(p)?.secs_left),
        baseline_side: dir(obj(p.baseline)?.side),
        chair_trace: obj(rec.chair_trace) ? { score: num(obj(rec.chair_trace)!.score), bar: num(obj(rec.chair_trace)!.bar), vs_bar: num(obj(rec.chair_trace)!.vs_bar), hard_fail: obj(rec.chair_trace)!.hard_fail === true, sit_term: num(obj(obj(rec.chair_trace)!.bar_breakdown)?.sit_mass) } : null,
        checks: (arr(rec.checks) ?? []).map((c) => { const o = obj(c) ?? {}; return { id: str(o.id), pass: o.pass === true ? true : o.pass === false ? false : null }; }),
        families_ok: rec.families_ok === true,
        mode: str(rec.mode),
        wait_to_directional: !dir(obj(p.baseline)?.side) && !!dir(rec.side),
        diagnostic_only: isDiagnosticOnly(experiment, arm),
      };
    } else {
      f.facts = { ...f.facts, record_kind: terminal.kind, diagnostic_only: isDiagnosticOnly(experiment, arm), checkpoint: num(terminal.payload?.checkpoint) };
    }

    // Replay quality.
    const reasons: string[] = [];
    if (!input.ledger) reasons.push("NO_OFFICIAL_SETTLEMENT");
    if (isRecoveredRecord(terminal.payload) || reads.length) {
      const target = fill ?? best?.r ?? terminal;
      const d = rederive(target.payload, target.kind, target.ask_cents);
      reasons.push(...d.reasons);
      if (terminal.payload?.receipt_only === true && !isRecoveredRecord(terminal.payload)) reasons.push("RECEIPT_ONLY_WITHOUT_RECORD");
    } else if (fill) {
      // A benchmark fill carries its own side, ask and fee at the checkpoint: the fill is re-derivable.
      if (fill.fee_cents == null) reasons.push("MISSING_FEE");
      if (!bookable(fill.ask_cents!)) reasons.push("FILL_BELOW_FLOOR");
    } else {
      // A benchmark sit: the book at its checkpoint is not stored with the receipt.
      reasons.push("NO_BOOK_AT_CHECKPOINT");
    }
    f.quality_reasons = [...new Set(reasons)];
    f.replay_quality = !input.ledger ? "UNAVAILABLE" : f.quality_reasons.length === 0 ? "EXACT" : "PARTIAL";
    out.push(f);
  }

  // Production, from the official ledger: recorded, not re-derived.
  if (input.ledger) {
    const l = input.ledger;
    const f = base("PRODUCTION", "FLOOR");
    f.observed = true;
    f.terminal_kind = l.entry_cents != null ? "fill" : "no_fill";
    f.source_build_sha = l.entry_build_sha;
    if (l.entry_cents != null && l.entry_lean) {
      f.side = l.entry_lean; f.ask_cents = l.entry_cents; f.fee_cents = l.entry_fee_cents;
      f.net_cents = l.entry_fee_cents != null ? netOf({ side: l.entry_lean, ask_cents: l.entry_cents, fee_cents: l.entry_fee_cents, winner: l.winner, close_ms: l.close_ms }) : null;
    }
    f.quality_reasons = l.entry_cents != null && l.entry_fee_cents == null ? ["MISSING_FEE"] : [];
    f.replay_quality = f.quality_reasons.length ? "PARTIAL" : "EXACT";
    f.facts = { ...f.facts, source: "desk_ledger_research", recorded_not_rederived: true };
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 3: integrity.
// ---------------------------------------------------------------------------

export type IntegrityStatus = "CLEAN" | "SUSPECT" | "INVALID" | "UNVERIFIABLE";
export type Annotation = {
  experiment: string;
  arm: string;
  ticker: string;
  close_ms: number;
  kind: string;
  auditor_version: number;
  integrity_status: IntegrityStatus;
  reason_codes: string[];
  details: Obj;
};

/** Every reason code the auditor can emit, with its severity. */
export const REASONS = Object.freeze({
  // INVALID: the record contradicts itself, its identity, or the frozen rules.
  IDENTITY_MISMATCH: "INVALID",
  EXPERIMENT_MISMATCH: "INVALID",
  ARM_MISMATCH: "INVALID",
  DECIDED_AFTER_CLOSE: "INVALID",
  DECIDED_AFTER_CUTOFF: "INVALID",
  FUTURE_FRAME: "INVALID",
  DUPLICATE_SEAT: "INVALID",
  DUPLICATE_CARD: "INVALID",
  NON_ROSTER_CARD: "INVALID",
  HELD_SEAT_RECOVERED: "INVALID",
  HOLD_HYPOTHESIS_RECOVERED: "INVALID",
  CANDIDATE_NOT_IN_SOURCE: "INVALID",
  CANDIDATE_DIFFERS_FROM_SOURCE: "INVALID",
  UNHEALTHY_SUPPORT: "INVALID",
  SIDE_CONFLICT: "INVALID",
  WINNER_MISMATCH: "INVALID",
  NET_MISMATCH: "INVALID",
  FILL_BELOW_FLOOR: "INVALID",
  FILL_WITHOUT_BOOKED_RECORD: "INVALID",
  FILL_FROM_INVALID_CANDIDATE: "INVALID",
  // SUSPECT: consistent with a known defect or a boundary problem, not proven.
  /** The producer selected this card for the seat but forced it to SIT; recovery heard it directional. Benign causes exist, so not proven. */
  SELECTED_SIT_REUSED: "SUSPECT",
  P2_LIVE_CARD_NOT_SELECTED: "SUSPECT",
  P2_EXPLOIT_REJECT_LIKELY: "SUSPECT",
  /** Unresolved P1 (PR #333): the Chair counts STREAK and STRIKE as two supporters although E1 treats both as one book read, and without the double count the supporter gate would have failed. */
  E1_FAMILY_SUPPORT_DOUBLE_COUNT: "SUSPECT",
  BUILD_CROSSED_WINDOW: "SUSPECT",
  LATE_WRITE: "SUSPECT",
  REDERIVATION_MISMATCH: "SUSPECT",
  // UNVERIFIABLE: the record lacks what the check needs.
  NO_EVALUATION_RECORD: "UNVERIFIABLE",
  MISSING_PROVENANCE: "UNVERIFIABLE",
  NOT_SETTLED: "UNVERIFIABLE",
} as const);
export type ReasonCode = keyof typeof REASONS;
const RANK: Record<IntegrityStatus, number> = { CLEAN: 0, UNVERIFIABLE: 1, SUSPECT: 2, INVALID: 3 };
export function worst(codes: readonly ReasonCode[]): IntegrityStatus {
  return codes.reduce<IntegrityStatus>((w, c) => (RANK[REASONS[c]] > RANK[w] ? REASONS[c] : w), "CLEAN");
}

const HOLD_HYPOTHESES = new Set(["clock-owned window", "in-window path revision"]);
const ROSTER = new Set<string>(E1_ROSTER_CARDS);
/** The recorders' entry band: nothing may be decided in the last 180 s. */
const DECISION_CUTOFF_MS = KNOWN_EXPERIMENTS.decision_cutoff_secs * 1000;
const LATE_WRITE_MS = 30_000;
const FUTURE_TOLERANCE_MS = 5_000;
/** The producer's EXPLOIT quality guard (bots.ts pickLiveAndPaper): LIVE, n >= 16, wilson < 0.42. */
const EXPLOIT_GUARD = Object.freeze({ min_n: 16, max_wilson: 0.42 });

export function auditWindow(input: WindowInput): Annotation[] {
  const out: Annotation[] = [];
  const winner = input.ledger?.winner ?? null;
  const counters = new Map(input.counters.map((c) => [c.id, c]));
  // Window-level context per experiment: builds seen and directional sides committed.
  const builds = new Map<string, Set<string>>();
  const sides = new Map<string, Set<string>>();
  for (const r of input.receipts) {
    if (r.ticker !== input.ticker || r.close_ms !== input.close_ms) continue;
    builds.set(r.experiment, (builds.get(r.experiment) ?? new Set()).add(r.build_sha));
    if ((r.kind === "fill" || r.kind === "intention") && r.side) sides.set(`${r.experiment}|${r.arm}`, (sides.get(`${r.experiment}|${r.arm}`) ?? new Set()).add(r.side));
  }

  for (const r of input.receipts) {
    const codes: ReasonCode[] = [];
    const details: Obj = {};
    const p = r.payload ?? {};
    // Identity: the record must be about the row it sits in.
    if (r.ticker !== input.ticker || r.close_ms !== input.close_ms) codes.push("IDENTITY_MISMATCH");
    const pt = str(p.ticker), pc = num(p.close_time);
    if ((pt != null && pt !== r.ticker) || (pc != null && pc !== r.close_ms)) codes.push("IDENTITY_MISMATCH");
    if (str(p.experiment) != null && p.experiment !== r.experiment) codes.push("EXPERIMENT_MISMATCH");
    if (str(p.arm) != null && p.arm !== r.arm) codes.push("ARM_MISMATCH");
    if (r.experiment === MID_RECOVERY_LOCKS_EXPERIMENT.id && str(p.version) != null && p.version !== MID_RECOVERY_LOCKS_EXPERIMENT.id) codes.push("EXPERIMENT_MISMATCH");
    if (r.experiment === MID_RECOVERY_EXPERIMENT.id && isRecoveredRecord(p) && str(p.version) != null && p.version !== MID_RECOVERY_EXPERIMENT.id) codes.push("EXPERIMENT_MISMATCH");
    // Clock.
    if (r.decided_ms >= r.close_ms) codes.push("DECIDED_AFTER_CLOSE");
    const mirrored = p.source === "production_call_log";
    if (RECOVERY_EXPERIMENTS.has(r.experiment) && !mirrored && (r.kind === "fill" || r.kind === "intention") && r.decided_ms > r.close_ms - DECISION_CUTOFF_MS) codes.push("DECIDED_AFTER_CUTOFF");
    const asOf = num(p.as_of);
    if (asOf != null && asOf > r.recorded_ms + FUTURE_TOLERANCE_MS) codes.push("FUTURE_FRAME");
    if (!mirrored && r.recorded_ms - r.decided_ms > LATE_WRITE_MS) { codes.push("LATE_WRITE"); details.write_lag_ms = r.recorded_ms - r.decided_ms; }
    if ((builds.get(r.experiment)?.size ?? 0) > 1) { codes.push("BUILD_CROSSED_WINDOW"); details.builds = [...builds.get(r.experiment)!].sort(); }
    if ((sides.get(`${r.experiment}|${r.arm}`)?.size ?? 0) > 1) codes.push("SIDE_CONFLICT");
    // Settlement.
    if (r.kind === "fill") {
      if (!winner) codes.push("NOT_SETTLED");
      else {
        if (r.official_winner != null && r.official_winner !== winner) codes.push("WINNER_MISMATCH");
        if (r.net_cents != null && r.side && r.ask_cents != null && r.fee_cents != null) {
          const expect = netOf({ side: r.side, ask_cents: r.ask_cents, fee_cents: r.fee_cents, winner, close_ms: r.close_ms })!;
          if (Math.abs(expect - r.net_cents) > 0.01) { codes.push("NET_MISMATCH"); details.expected_net_cents = expect; }
        }
      }
      if (RECOVERY_EXPERIMENTS.has(r.experiment) && r.ask_cents != null && !bookable(r.ask_cents)) codes.push("FILL_BELOW_FLOOR");
    }

    // Recovery provenance.
    if (RECOVERY_EXPERIMENTS.has(r.experiment) && (isRecoveredRecord(p) || (r.arm !== "BASELINE" && r.arm !== "NULL_FAV_80"))) {
      const cands = candidatesOf(p);
      if (!isRecoveredRecord(p) || !cands) codes.push("NO_EVALUATION_RECORD");
      else {
        const recovery = obj(p.recovery);
        const roster = arr(recovery?.evaluated_roster)?.map((x) => obj(x) ?? {}) ?? null;
        const held = new Set((arr(recovery?.held_seats) ?? []).map(String));
        const released = arr(recovery?.released)?.map(String) ?? null;
        if (!roster || !released) codes.push("MISSING_PROVENANCE");
        const seats = new Set<string>(), cards = new Set<string>();
        const invalidCards: string[] = [];
        const p2: string[] = [];
        for (const c of cands) {
          const mine: ReasonCode[] = [];
          if (seats.has(c.seat)) mine.push("DUPLICATE_SEAT");
          if (cards.has(c.card_id)) mine.push("DUPLICATE_CARD");
          seats.add(c.seat); cards.add(c.card_id);
          if (!ROSTER.has(c.card_id)) mine.push("NON_ROSTER_CARD");
          if (held.has(c.seat)) mine.push("HELD_SEAT_RECOVERED");
          if (c.hypothesis && HOLD_HYPOTHESES.has(c.hypothesis)) mine.push("HOLD_HYPOTHESIS_RECOVERED");
          if (c.counted_as_support && c.health !== "LIVE") mine.push("UNHEALTHY_SUPPORT");
          if (released && !released.includes(c.card_id)) mine.push("CANDIDATE_NOT_IN_SOURCE");
          const src = roster?.find((x) => x.card_id === c.card_id) ?? null;
          if (roster) {
            if (!src || src.evaluated_lean == null) mine.push("CANDIDATE_NOT_IN_SOURCE");
            else {
              if (src.evaluated_lean !== c.calibrated_lean || (num(src.evaluated_conf) != null && c.calibrated_conf != null && num(src.evaluated_conf) !== c.calibrated_conf)
                || (str(src.evaluated_health) != null && c.health != null && src.evaluated_health !== c.health)) mine.push("CANDIDATE_DIFFERS_FROM_SOURCE");
              if (src.selected_skill_used === c.card_id && src.selected_forced_sit === true) mine.push("SELECTED_SIT_REUSED");
              // P2: the producer had this card LIVE and did not select it — exploit-rejection or pool exclusion is possible.
              if (c.original_status === "LIVE" && src.selected_skill_used !== c.card_id) {
                const k = counters.get(c.card_id);
                const n = k?.n ?? null, hits = k?.hits ?? null;
                if (k && k.status_at_input === "LIVE" && n != null && hits != null) {
                  const w = n > 0 ? wilsonLower(hits, n) : 0;
                  if (n >= EXPLOIT_GUARD.min_n && w < EXPLOIT_GUARD.max_wilson) { mine.push("P2_EXPLOIT_REJECT_LIKELY"); p2.push(c.card_id); }
                  else details[`p2_cleared_${c.card_id}`] = { n, wilson: Math.round(w * 1000) / 1000, note: "stored counters are outside the EXPLOIT guard; learner phase not needed" };
                } else { mine.push("P2_LIVE_CARD_NOT_SELECTED"); p2.push(c.card_id); }
              }
            }
          }
          if (mine.some((m) => REASONS[m] === "INVALID") && (c.counted_as_support || c.survived_fold)) invalidCards.push(c.card_id);
          codes.push(...mine);
        }
        if (p2.length) details.p2_cards = p2;
        if (invalidCards.length) details.invalid_cards = invalidCards;
        if ((r.kind === "fill" || r.kind === "intention") && invalidCards.length) codes.push("FILL_FROM_INVALID_CANDIDATE");
        // P1: supporters that are one E1 family counted as independent supporters.
        const rec = obj(p.recovered);
        const supporters = (arr(rec?.supporters) ?? []).map(String);
        if ((r.kind === "fill" || r.kind === "intention") && supporters.length) {
          // Only the overlap the E1 override creates: STREAK (a book read under E1) alongside another book seat.
          const overlap = supporters.includes("STREAK") && supporters.some((seat) => seat !== "STREAK" && e1FamilyOf(seat as SeatId) === "book") ? 1 : 0;
          const distinct = supporters.length - overlap;
          const need = str(rec?.mode) === "tight" ? DEPLOYED_POLICY.params.tight_min_speaking : DEPLOYED_POLICY.params.min_speaking;
          if (distinct < supporters.length && distinct < need) { codes.push("E1_FAMILY_SUPPORT_DOUBLE_COUNT"); details.e1_supporters = { counted: supporters.length, independent: distinct, required: need }; }
        }
        if (r.kind === "fill") {
          const d = rederive(p, r.kind, r.ask_cents);
          if (d.reasons.includes("FILL_WITHOUT_BOOKED_RECORD")) codes.push("FILL_WITHOUT_BOOKED_RECORD");
          if (d.reasons.some((x) => x.startsWith("REDERIVED_"))) codes.push("REDERIVATION_MISMATCH");
        }
      }
    }
    const unique = [...new Set(codes)].sort() as ReasonCode[];
    out.push({
      experiment: r.experiment, arm: r.arm, ticker: r.ticker, close_ms: r.close_ms, kind: r.kind, auditor_version: RESEARCH_FACTORY.auditor_version,
      integrity_status: worst(unique), reason_codes: unique, details: { ...details, diagnostic_only: isDiagnosticOnly(r.experiment, r.arm) },
    });
  }
  return out;
}

/**
 * A result counts as promotion-quality evidence only when every receipt the
 * arm wrote in the window is CLEAN, the replay is EXACT, and the arm is not
 * diagnostic-only. Everything else may be reported, labelled, never promoted.
 */
export function evidenceEligible(fact: Pick<WindowFact, "experiment" | "arm" | "replay_quality">, statuses: readonly IntegrityStatus[]): boolean {
  return fact.replay_quality === "EXACT" && statuses.length > 0 && statuses.every((s) => s === "CLEAN") && !isDiagnosticOnly(fact.experiment, fact.arm);
}
