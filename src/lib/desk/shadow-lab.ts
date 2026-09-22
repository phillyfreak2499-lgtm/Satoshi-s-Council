/**
 * The shared shadow recorder and evaluator: one machinery for exactly three
 * frozen hypotheses, paired on a predeclared window universe, priced by one
 * fee engine, judged by the frozen gates.
 *
 * WHAT IT REFUSES TO DO. It cannot book on the paper Floor, cannot change a
 * seat or card status, cannot veto the production Chair, cannot promote. A
 * verdict here is a report; the actuator does not exist (promotion-gates.ts).
 *
 * WHAT IT INSISTS ON.
 *   - One receipt per (experiment, arm, window, kind): repeated polling,
 *     restarts and concurrent workers cannot manufacture a second fill.
 *   - A real WAIT is a net of zero; missing data is a separate state.
 *   - Each arm is priced at ITS OWN admissible decision time; "same window"
 *     never copies a favourable quote across timestamps.
 *   - Availability at 150/500 ms is a documented execution simulation, not a fill.
 *   - Promotion needs ALL frozen gates: ≥ 250 prospective qualified fills AND
 *     ≥ 30 calendar days AND ≥ 25 paired control-loss windows, positive absolute
 *     net, positive incremental net against Chair + HOLD on the same universe,
 *     the registered primary benchmark, tails and drawdown. Missing support is
 *     BLOCKED, never a verdict.
 *
 * Pure module: no clock, no state, no database.
 */
import { chicagoDayOf, chicagoWeekKey } from "./economics-book.ts";
import { DEFAULT_FEE_ENGINE, feeFingerprint, holdNetCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";
import { COMPONENT_MIN, ECONOMIC, RISK, correctedAlpha, cvar, dayBlockCI, maxDrawdown, mean, type Interval, type Pair } from "./promotion-gates.ts";

export const SHADOW_LAB_VERSION = "SHADOW_LAB_V1";
export const SHADOW_HARD_DD_STOP_CENTS = -258;
export const SHADOW_MAX_DD_WORSE_THAN_CONTROL_CENTS = 50;
export const SHADOW_FUTILITY_LOOK_FILLS = 150;
export const SHADOW_OPERATOR_ALERT_DD_CENTS = -150;

// ---------------------------------------------------------------------------
// Manifests.
// ---------------------------------------------------------------------------

export type ArmRole = "candidate" | "control" | "secondary" | "reference";
export type ManifestStatus = "CANDIDATE" | "SHADOW" | "PAUSED" | "BLOCKED" | "KILLED";

export type ShadowArm = {
  id: string;
  role: ArmRole;
  description: string;
  /** When the arm decides, in seconds before the close (first element primary, later ones frozen fallbacks). */
  decision_schedule_secs: readonly number[];
  params: Readonly<Record<string, number | string | boolean | readonly string[]>>;
  promotable: boolean;
};

export type ShadowManifest = {
  version: typeof SHADOW_LAB_VERSION;
  id: string;
  experiment_version: number;
  status: ManifestStatus;
  frozen_at: string;
  /** Set only by an owner-approved activation, in the database, never here. */
  prospective_start_at: null;
  hypothesis: string;
  fingerprints: { fee: string; policy: string; model: string; roster: string; source_sha: string };
  arms: readonly ShadowArm[];
  primary_contrast: { candidate: string; control: string; metric: "paired_net_per_100_windows_and_per_week" };
  secondary_contrasts: readonly { candidate: string; control: string; label: string }[];
  eligible_population: string;
  training_cutoff: string | null;
  pairing: "window";
  latency_assumption: string;
  size: { contracts: 1 };
  risk: { hard_dd_stop_cents: number; max_dd_worse_than_control_cents: number; operator_alert_dd_cents: number };
  gates: { min_fills: number; min_days: number; min_paired_control_losses: number; futility_look_fills: number; min_paired_delta_cents: number; confidence: number };
  multiplicity: { method: "bonferroni"; contrasts: number };
  kill_criteria: readonly string[];
  authority: "none";
};

/** djb2 over sorted JSON: deterministic and dependency-free. The server adds sha256. */
export function manifestFingerprint(m: ShadowManifest): string {
  const stable = JSON.stringify(m, Object.keys(flatten(m)).sort());
  let h = 5381;
  for (let i = 0; i < stable.length; i += 1) h = ((h << 5) + h + stable.charCodeAt(i)) >>> 0;
  return `${m.id}|v${m.experiment_version}|${h.toString(16).padStart(8, "0")}|${m.arms.length}arms`;
}

function flatten(v: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (Array.isArray(v)) v.forEach((x) => flatten(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out[k] = true; flatten(x, out); }
  return out;
}

// ---------------------------------------------------------------------------
// Receipts.
// ---------------------------------------------------------------------------

export type ReceiptKind = "intention" | "fill" | "no_fill" | "veto" | "wait" | "settle";

export type ShadowReceipt = {
  experiment: string;
  arm: string;
  ticker: string;
  close_ms: number;
  kind: ReceiptKind;
  decided_ms: number;
  side: "UP" | "DOWN" | null;
  ask_cents: number | null;
  fee_engine: FeeEngineId;
  fee_cents: number | null;
  size_at_ask: number | null;
  spread_cents: number | null;
  feeds_ok: boolean | null;
  /** Execution simulation only; null when the capture cannot resolve sub-second availability. */
  hittable_150ms: boolean | null;
  hittable_500ms: boolean | null;
  official_winner: "UP" | "DOWN" | null;
  net_cents: number | null;
  note: string | null;
};

/** The idempotent key. One booking per arm per economic window, whatever polls or restarts. */
export function receiptKey(r: Pick<ShadowReceipt, "experiment" | "arm" | "ticker" | "close_ms" | "kind">): string {
  return `${r.experiment}|${r.arm}|${r.ticker}|${r.close_ms}|${r.kind}`;
}

/** Price a fill receipt at its own ask with the one fee engine; null until the official result is known. */
export function settleReceipt(r: ShadowReceipt, winner: "UP" | "DOWN"): ShadowReceipt {
  if (r.kind !== "fill" || r.side == null || r.ask_cents == null || !realAskCents(r.ask_cents)) return { ...r, official_winner: winner };
  return { ...r, official_winner: winner, net_cents: holdNetCents(r.ask_cents, r.side === winner, r.fee_engine) };
}

// ---------------------------------------------------------------------------
// Pairing on the predeclared universe.
// ---------------------------------------------------------------------------

export type ArmOutcome = {
  /** null = data missing (not a WAIT). */
  net: number | null;
  filled: boolean;
  /** Only fills that were execution-qualified count toward the fill gates. */
  qualified: boolean;
  day: string;
  regime?: string;
};

export type PairedUniverse = {
  universe: number;
  shared: number;
  candidate_only: number;
  control_only: number;
  unavailable: number;
  pairs: Pair[];
  candidate_nets: number[];
  control_nets: number[];
  candidate_fills: number;
  candidate_qualified_fills: number;
  control_fills: number;
  paired_control_losses: number;
  days: number;
};

/**
 * Pair candidate and control on every predeclared window. A real WAIT is net 0
 * and pairs; a missing outcome on either side is "unavailable" and never pairs.
 */
export function pairUniverse(universe: readonly string[], candidate: ReadonlyMap<string, ArmOutcome>, control: ReadonlyMap<string, ArmOutcome>): PairedUniverse {
  const out: PairedUniverse = { universe: universe.length, shared: 0, candidate_only: 0, control_only: 0, unavailable: 0, pairs: [], candidate_nets: [], control_nets: [], candidate_fills: 0, candidate_qualified_fills: 0, control_fills: 0, paired_control_losses: 0, days: 0 };
  const days = new Set<string>();
  for (const w of universe) {
    const c = candidate.get(w), k = control.get(w);
    const cOk = c != null && c.net != null, kOk = k != null && k.net != null;
    if (cOk && kOk) {
      out.shared += 1;
      out.pairs.push({ day: c.day, candidate_net: c.net!, champion_net: k.net!, regime: c.regime });
      out.candidate_nets.push(c.net!);
      out.control_nets.push(k.net!);
      if (k.net! < 0) out.paired_control_losses += 1;
      days.add(c.day);
    } else if (cOk) out.candidate_only += 1;
    else if (kOk) out.control_only += 1;
    else out.unavailable += 1;
    if (c?.filled) { out.candidate_fills += 1; if (c.qualified) out.candidate_qualified_fills += 1; }
    if (k?.filled) out.control_fills += 1;
  }
  out.days = days.size;
  return out;
}

export type PairedMetrics = {
  n_pairs: number;
  universe: number;
  delta_per_100_windows: number | null;
  delta_per_week_mean: number | null;
  weeks: number;
  ci: Interval | null;
  alpha: number;
  candidate_abs_net: number;
  control_abs_net: number;
  candidate_dd: number;
  control_dd: number;
  candidate_cvar10: number | null;
  control_cvar10: number | null;
  candidate_net_per_fill: number | null;
};

/** The primary metrics: paired incremental net per 100 windows and per calendar (Chicago) week, with a day-block CI. */
export function pairedMetrics(p: PairedUniverse, competitors: number, seed = ECONOMIC.bootstrap_seed): PairedMetrics {
  const deltas = p.pairs.map((x) => x.candidate_net - x.champion_net);
  const total = deltas.reduce((s, d) => s + d, 0);
  const byWeek = new Map<string, number>();
  for (const x of p.pairs) { const k = chicagoWeekKey(x.day); byWeek.set(k, (byWeek.get(k) ?? 0) + x.candidate_net - x.champion_net); }
  const weekly = [...byWeek.values()];
  const alpha = correctedAlpha(ECONOMIC.confidence, competitors);
  const candAbs = p.candidate_nets.reduce((s, x) => s + x, 0);
  return {
    n_pairs: p.pairs.length, universe: p.universe,
    delta_per_100_windows: p.universe ? Math.round((total / p.universe) * 1000) / 10 : null,
    delta_per_week_mean: weekly.length ? Math.round((mean(weekly) ?? 0) * 10) / 10 : null,
    weeks: weekly.length,
    ci: dayBlockCI(p.pairs, alpha, ECONOMIC.bootstrap_iters, seed),
    alpha,
    candidate_abs_net: Math.round(candAbs * 10) / 10,
    control_abs_net: Math.round(p.control_nets.reduce((s, x) => s + x, 0) * 10) / 10,
    candidate_dd: maxDrawdown(p.candidate_nets), control_dd: maxDrawdown(p.control_nets),
    candidate_cvar10: cvar(p.candidate_nets, RISK.cvar_pct), control_cvar10: cvar(p.control_nets, RISK.cvar_pct),
    candidate_net_per_fill: p.candidate_fills ? Math.round((candAbs / p.candidate_fills) * 100) / 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Looks, stops and the verdict.
// ---------------------------------------------------------------------------

export type Futility = { due: boolean; verdict: "not_due" | "continue" | "bench"; at_fills: number; mean_delta: number | null };

/** One predeclared look at 150 qualified fills: it can bench, never promote. */
export function futilityLook(p: PairedUniverse, m: PairedMetrics, atFills = SHADOW_FUTILITY_LOOK_FILLS): Futility {
  const md = m.n_pairs ? Math.round(((m.candidate_abs_net - m.control_abs_net) / m.n_pairs) * 100) / 100 : null;
  if (p.candidate_qualified_fills < atFills) return { due: false, verdict: "not_due", at_fills: atFills, mean_delta: md };
  return { due: true, verdict: md != null && md <= 0 ? "bench" : "continue", at_fills: atFills, mean_delta: md };
}

export type RiskStop = { breached: boolean; operator_alert: boolean; reasons: string[] };

/** The frozen hard stop and the control-relative stop; −150¢ is an operator alert, not a stop. */
export function riskStop(m: PairedMetrics, hardStop = SHADOW_HARD_DD_STOP_CENTS, worseThanControl = SHADOW_MAX_DD_WORSE_THAN_CONTROL_CENTS): RiskStop {
  const reasons: string[] = [];
  if (m.candidate_dd <= hardStop) reasons.push(`candidate drawdown ${m.candidate_dd}¢ ≤ hard stop ${hardStop}¢`);
  if (m.candidate_dd < m.control_dd - worseThanControl) reasons.push(`candidate drawdown ${m.candidate_dd}¢ is more than ${worseThanControl}¢ worse than control ${m.control_dd}¢`);
  return { breached: reasons.length > 0, operator_alert: m.candidate_dd <= SHADOW_OPERATOR_ALERT_DD_CENTS, reasons };
}

export type Verdict = {
  status: "BLOCKED" | "PROMOTION_READY" | "INVALID";
  gates: Array<{ id: string; state: "pass" | "fail" | "insufficient"; detail: string }>;
  blocked_by: string[];
};

export type VerdictInput = {
  primary: PairedUniverse;
  primary_metrics: PairedMetrics;
  /** The same candidate paired against the current Chair + HOLD on the same universe. */
  vs_chair_hold: PairedUniverse;
  vs_chair_hold_metrics: PairedMetrics;
  invalidations: readonly string[];
  min_paired_delta_cents?: number;
};

/**
 * ALL gates, AND-ed. "insufficient" is not a pass. The verdict never says
 * "promote": PROMOTION_READY is a precondition an owner acts on.
 */
export function promotionVerdict(v: VerdictInput): Verdict {
  const gates: Verdict["gates"] = [];
  const g = (id: string, state: "pass" | "fail" | "insufficient", detail: string) => gates.push({ id, state, detail });
  if (v.invalidations.length) return { status: "INVALID", gates: v.invalidations.map((why) => ({ id: "invalidated", state: "fail" as const, detail: why })), blocked_by: [...v.invalidations] };
  const p = v.primary, m = v.primary_metrics;
  const minDelta = v.min_paired_delta_cents ?? ECONOMIC.min_paired_delta_cents;
  g("fills", p.candidate_qualified_fills >= COMPONENT_MIN.fills ? "pass" : "insufficient", `${p.candidate_qualified_fills}/${COMPONENT_MIN.fills} prospective qualified fills`);
  g("days", p.days >= COMPONENT_MIN.days ? "pass" : "insufficient", `${p.days}/${COMPONENT_MIN.days} calendar days`);
  g("control_losses", p.paired_control_losses >= COMPONENT_MIN.paired_control_losses ? "pass" : "insufficient", `${p.paired_control_losses}/${COMPONENT_MIN.paired_control_losses} paired control-loss windows`);
  g("absolute_net", m.candidate_abs_net > 0 ? "pass" : "fail", `candidate absolute net ${m.candidate_abs_net}¢`);
  g("primary_ci", m.ci ? (m.ci.lo > 0 ? "pass" : "fail") : "insufficient", m.ci ? `paired delta ${m.ci.point}¢/pair, ${Math.round((1 - m.alpha) * 100)}% CI [${m.ci.lo}, ${m.ci.hi}] over ${m.ci.days} days` : "no interval (fewer than two days)");
  g("paired_delta", (m.ci?.point ?? -Infinity) >= minDelta ? "pass" : "fail", `paired delta ${m.ci?.point ?? "—"}¢ vs required ≥ ${minDelta}¢`);
  const c = v.vs_chair_hold_metrics;
  g("vs_chair_hold", c.ci ? (c.ci.lo > 0 ? "pass" : "fail") : "insufficient", c.ci ? `incremental vs Chair + HOLD ${c.ci.point}¢/pair, CI [${c.ci.lo}, ${c.ci.hi}]` : "no interval vs Chair + HOLD");
  const stop = riskStop(m);
  g("drawdown", stop.breached ? "fail" : m.control_dd === 0 ? "insufficient" : m.candidate_dd >= m.control_dd * RISK.max_drawdown_ratio ? "pass" : "fail",
    m.control_dd === 0 ? "control drawdown is zero: the ratio is undefined, not passed" : `candidate DD ${m.candidate_dd}¢ vs control ${m.control_dd}¢ (ratio ≤ ${RISK.max_drawdown_ratio} required)`);
  g("tail", m.candidate_cvar10 == null || m.control_cvar10 == null ? "insufficient" : m.candidate_cvar10 >= m.control_cvar10 * (1 - RISK.cvar_improvement) ? "pass" : "fail",
    `CVaR10 candidate ${m.candidate_cvar10 ?? "—"}¢ vs control ${m.control_cvar10 ?? "—"}¢`);
  const blocked = gates.filter((x) => x.state !== "pass").map((x) => x.id);
  return { status: blocked.length ? "BLOCKED" : "PROMOTION_READY", gates, blocked_by: blocked };
}

// ---------------------------------------------------------------------------
// Causal day state per arm.
// ---------------------------------------------------------------------------

export type ArmDayState = { day: string; settled_net: number; wins: number; losses: number; pending_full_loss_exposure: number; tightened: boolean; profit_protected: boolean };

/**
 * Each arm's own Chicago-day P&L and pending exposure from its own receipts
 * only: a changed policy cannot borrow the control's later profit-lock state.
 */
export function armDayState(receipts: readonly ShadowReceipt[], arm: string, day: string, tightenAt = -100, protectWins = 5, protectNet = 100): ArmDayState {
  const mine = receipts.filter((r) => r.arm === arm && r.kind === "fill" && chicagoDayOf(r.close_ms) === day).sort((a, b) => a.close_ms - b.close_ms);
  let net = 0, peak = 0, low = 0, wins = 0, losses = 0, pending = 0;
  for (const r of mine) {
    if (r.net_cents == null) { pending += (r.ask_cents ?? 0) + (r.fee_cents ?? 0); continue; }
    net += r.net_cents; peak = Math.max(peak, net); low = Math.min(low, net);
    if (r.net_cents > 0) wins += 1; else if (r.net_cents < 0) losses += 1;
  }
  return { day, settled_net: Math.round(net * 10) / 10, wins, losses, pending_full_loss_exposure: Math.round(pending * 10) / 10, tightened: low <= tightenAt, profit_protected: net > 0 && (wins >= protectWins || peak >= protectNet) };
}

export const SHADOW_FEE_FINGERPRINT = feeFingerprint(DEFAULT_FEE_ENGINE);
