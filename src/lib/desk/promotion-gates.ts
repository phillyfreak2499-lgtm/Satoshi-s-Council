/**
 * What a challenger must prove before it may replace the Champion.
 *
 * THESE NUMBERS ARE NOT NEGOTIABLE BY THE THING BEING MEASURED. They are frozen
 * constants with a freeze test, because the single most seductive failure available
 * to an automated research desk is to notice a candidate just missing a bar and
 * move the bar. A threshold changes only as a reviewed code change, never because
 * something is performing well.
 *
 * FAIL CLOSED. Every gate returns one of pass / fail / insufficient, and
 * insufficient is not a pass. A candidate with too few tail events to judge its
 * tail risk has not demonstrated that its tail risk is acceptable — it has
 * demonstrated nothing about it, and stays SHADOW.
 *
 * PAIRED, ALWAYS. A candidate is compared to the Champion only on windows where
 * both produced a countable observation. Comparing a candidate's good week to the
 * Champion's bad month is the easiest way to manufacture an edge that is not there.
 *
 * DAYS, NOT TICKS. The bootstrap resamples whole calendar days, because windows
 * within a day share a regime, a feed, and often one underlying move. Treating 96
 * windows from one day as 96 independent observations inflates confidence by
 * roughly the square root of however wrong that assumption is.
 *
 * THIS MODULE DECIDES NOTHING. It reports. Nothing here promotes, demotes, writes,
 * or touches the active policy; the actuator is deliberately a separate, later
 * change, so these gates can be read and argued with before they can act.
 *
 * Pure module: no clock, no state, no database, no randomness that is not seeded.
 */

// ---------------------------------------------------------------------------
// THE FROZEN THRESHOLDS.
// ---------------------------------------------------------------------------

/** Minimums for an exit or risk component to replace its slot. */
export const COMPONENT_MIN = Object.freeze({
  /** Prospective eligible paper fills. Historical or backfilled rows do not count. */
  fills: 250,
  /** Paired windows where the CONTROL lost — a loss-reducer must be tested on losses. */
  paired_control_losses: 25,
  /** Calendar days of prospective evidence. */
  days: 30,
});

/** Minimums for a full Floor candidate to replace the whole active policy. */
export const FULL_FLOOR_MIN = Object.freeze({
  /** Prospective graded windows. */
  windows: 500,
  /** Actual directional calls — a policy cannot qualify by saying WAIT nearly always. */
  directional_calls: 100,
  days: 30,
});

/** Economic bars, applied to paired observations after modelled fees. */
export const ECONOMIC = Object.freeze({
  /** Candidate average net per call must clear this. */
  min_avg_net_cents: 0,
  /** Paired improvement over the Champion, per comparable call. */
  min_paired_delta_cents: 1.0,
  /** Two-sided confidence level for the paired interval. */
  confidence: 0.95,
  /** Resamples per evaluation. Enough that the interval is stable run to run. */
  bootstrap_iters: 2000,
  /** Fixed seed: an evaluation must be reproducible from stored data alone. */
  bootstrap_seed: 20260911,
});

/** Risk bars. The stated objective is smaller losses, so these are the teeth. */
export const RISK = Object.freeze({
  /** Candidate max drawdown must be no worse than this fraction of the Champion's. */
  max_drawdown_ratio: 0.75,
  /** CVaR10 must improve by at least this fraction. */
  cvar_improvement: 0.2,
  /** The tail percentile CVaR is taken at. */
  cvar_pct: 10,
  /** Rate of losses worse than the catastrophic threshold, as a fraction of the Champion's. */
  catastrophic_rate_ratio: 0.6,
  /** What counts as catastrophic, in net cents. */
  catastrophic_cents: -30,
  /** Candidate worst single loss may not be worse than the Champion's by more than this. */
  worst_loss_slack_cents: 5,
  /** Below this many tail events, tail gates return insufficient rather than pass. */
  min_tail_events: 10,
});

/** Per-regime safety. A candidate may not be much worse anywhere it is tested. */
export const REGIME = Object.freeze({
  /** Paired observations needed before a regime is judged at all. */
  min_paired: 30,
  /** How far a candidate may trail the Champion within a judged regime. */
  max_trail_cents: 2.0,
});

/** Passing once is luck. */
export const STABILITY = Object.freeze({ consecutive_daily_evaluations: 3 });

/** After a promotion, before another ordinary one. */
export const COOLDOWN = Object.freeze({ eligible_fills: 100 });

/** A newly promoted Champion is watched against its predecessor. */
export const PROBATION = Object.freeze({ active_fills: 100 });

/** When to hand the Champion back. */
export const ROLLBACK = Object.freeze({
  /** Paired active calls before a trailing verdict is allowed at all. */
  min_paired_calls: 50,
  /** Trailing the previous Champion by more than this per call. */
  trails_by_cents: -1.5,
  /** Or a drawdown this much worse than the predecessor's over comparable observations. */
  drawdown_worse_ratio: 1.5,
  /** Or a catastrophic-loss rate exceeding the predecessor's by this factor. */
  catastrophic_rate_worse_ratio: 1.5,
});

// ---------------------------------------------------------------------------
// Statistics.
// ---------------------------------------------------------------------------

/** One paired observation: the same window, both policies, with the day it fell on. */
export type Pair = {
  /** Calendar day key, e.g. "2026-09-11". The bootstrap's resampling unit. */
  day: string;
  candidate_net: number;
  champion_net: number;
  /** Optional regime tag for the per-regime gate. */
  regime?: string;
};

export const delta = (p: Pair): number => p.candidate_net - p.champion_net;

export function mean(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Worst peak-to-trough run of a cumulative series, as a negative number.
 *
 * Computed on the order given, which must be chronological: a drawdown is a path
 * property, and sorting the observations would destroy it.
 */
export function maxDrawdown(nets: readonly number[]): number {
  let cum = 0;
  let peak = 0;
  let worst = 0;
  for (const x of nets) {
    cum += x;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < worst) worst = dd;
  }
  return Math.round(worst * 10) / 10;
}

/**
 * Conditional value at risk: the average of the worst `pct`% of outcomes.
 *
 * Returns null when there are too few observations for the tail to mean anything,
 * rather than averaging one bad window and calling it a tail.
 */
export function cvar(nets: readonly number[], pct: number): number | null {
  if (!nets.length) return null;
  const k = Math.max(1, Math.floor((nets.length * pct) / 100));
  if (nets.length < RISK.min_tail_events) return null;
  const sorted = [...nets].sort((a, b) => a - b);
  const tail = sorted.slice(0, k);
  const m = mean(tail);
  return m == null ? null : Math.round(m * 100) / 100;
}

/** Deterministic PRNG, so an evaluation is reproducible from stored data alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

export type Interval = { lo: number; hi: number; point: number; days: number; n: number };

/**
 * Day-block bootstrap on the paired difference.
 *
 * Resamples whole days with replacement and recomputes the mean paired delta, so
 * the interval reflects how many independent DAYS were observed rather than how
 * many windows. `alpha` is the two-sided total, already corrected for however many
 * candidates are competing.
 */
export function dayBlockCI(pairs: readonly Pair[], alpha: number, iters: number, seed: number): Interval | null {
  if (!pairs.length) return null;
  const byDay = new Map<string, number[]>();
  for (const p of pairs) {
    const arr = byDay.get(p.day) ?? [];
    arr.push(delta(p));
    byDay.set(p.day, arr);
  }
  const days = [...byDay.values()];
  if (days.length < 2) return null; // one day cannot describe day-to-day variation
  const point = mean(pairs.map(delta))!;
  const rand = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    let n = 0;
    for (let d = 0; d < days.length; d++) {
      const block = days[Math.floor(rand() * days.length)]!;
      for (const x of block) {
        sum += x;
        n += 1;
      }
    }
    if (n > 0) means.push(sum / n);
  }
  if (!means.length) return null;
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))]!;
  return {
    lo: Math.round(at(alpha / 2) * 1000) / 1000,
    hi: Math.round(at(1 - alpha / 2) * 1000) / 1000,
    point: Math.round(point * 1000) / 1000,
    days: days.length,
    n: pairs.length,
  };
}

/**
 * Bonferroni: split the error budget across simultaneous candidates.
 *
 * Four candidates each tested at 5% gives roughly a one-in-five chance that one of
 * them clears by luck alone. Correcting is the difference between a research desk
 * and a desk that promotes its luckiest experiment.
 */
export function correctedAlpha(confidence: number, competitors: number): number {
  const alpha = 1 - confidence;
  return alpha / Math.max(1, competitors);
}

// ---------------------------------------------------------------------------
// The gates.
// ---------------------------------------------------------------------------

export type GateState = "pass" | "fail" | "insufficient";

export type Gate = {
  id: string;
  label: string;
  state: GateState;
  /** What was measured, and against what, in plain terms. */
  detail: string;
  /** True when this gate must pass for promotion. All of them are, today. */
  required: boolean;
};

export type ComponentEvidence = {
  candidate_id: string;
  /** Paired observations, chronological. */
  pairs: readonly Pair[];
  /** Candidate net cents, chronological, for drawdown. */
  candidate_nets: readonly number[];
  /** Champion net cents over the same windows, chronological. */
  champion_nets: readonly number[];
  /** Distinct calendar days of prospective evidence. */
  days: number;
  /** Paired windows where the Champion/control lost. */
  paired_control_losses: number;
  /** How many candidates are being tested at once, for the correction. */
  competitors: number;
};

const g = (id: string, label: string, state: GateState, detail: string): Gate => ({
  id,
  label,
  state,
  detail,
  required: true,
});

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Evaluate every component-promotion gate and report.
 *
 * Returns the gates and a verdict. The verdict is never "promote": it is whether
 * every required gate passed, which is a precondition someone else acts on.
 */
export function evaluateComponentGates(ev: ComponentEvidence): {
  candidate_id: string;
  gates: Gate[];
  passed: number;
  total: number;
  all_required_passed: boolean;
  blocked_by: string[];
} {
  const gates: Gate[] = [];
  const n = ev.pairs.length;

  // --- sample minimums -----------------------------------------------------
  gates.push(
    g(
      "min_fills",
      "Prospective fills",
      n >= COMPONENT_MIN.fills ? "pass" : "insufficient",
      `${n} / ${COMPONENT_MIN.fills}`,
    ),
  );
  gates.push(
    g(
      "min_control_losses",
      "Paired control losses",
      ev.paired_control_losses >= COMPONENT_MIN.paired_control_losses ? "pass" : "insufficient",
      `${ev.paired_control_losses} / ${COMPONENT_MIN.paired_control_losses}`,
    ),
  );
  gates.push(
    g("min_days", "Minimum age", ev.days >= COMPONENT_MIN.days ? "pass" : "insufficient", `${ev.days} / ${COMPONENT_MIN.days} days`),
  );

  // --- economics -----------------------------------------------------------
  const avg = mean(ev.candidate_nets);
  gates.push(
    g(
      "positive_economics",
      "Positive economics",
      avg == null ? "insufficient" : avg > ECONOMIC.min_avg_net_cents ? "pass" : "fail",
      avg == null ? "no observations" : `${avg.toFixed(2)}¢ / call after fees`,
    ),
  );

  const d = mean(ev.pairs.map(delta));
  gates.push(
    g(
      "beats_incumbent",
      `+${ECONOMIC.min_paired_delta_cents}¢ vs Champion`,
      d == null ? "insufficient" : d >= ECONOMIC.min_paired_delta_cents ? "pass" : "fail",
      d == null ? "no paired observations" : `${d >= 0 ? "+" : ""}${d.toFixed(2)}¢ paired`,
    ),
  );

  const alpha = correctedAlpha(ECONOMIC.confidence, ev.competitors);
  const ci = dayBlockCI(ev.pairs, alpha, ECONOMIC.bootstrap_iters, ECONOMIC.bootstrap_seed);
  gates.push(
    g(
      "paired_ci",
      `${pct(ECONOMIC.confidence)} paired CI`,
      ci == null ? "insufficient" : ci.lo > 0 ? "pass" : "fail",
      ci == null
        ? "needs at least two distinct days"
        : `lower bound ${ci.lo > 0 ? "+" : ""}${ci.lo}¢ over ${ci.days} days (α corrected for ${ev.competitors})`,
    ),
  );

  // --- risk ----------------------------------------------------------------
  const ddC = maxDrawdown(ev.candidate_nets);
  const ddK = maxDrawdown(ev.champion_nets);
  // Drawdowns are negative; "no worse than 75% of" means nearer zero than that.
  const ddAllowed = ddK * RISK.max_drawdown_ratio;
  gates.push(
    g(
      "drawdown",
      "Drawdown",
      !ev.candidate_nets.length || !ev.champion_nets.length
        ? "insufficient"
        : ddC >= ddAllowed
          ? "pass"
          : "fail",
      `${ddC}¢ vs allowed ${Math.round(ddAllowed * 10) / 10}¢ (${pct(RISK.max_drawdown_ratio)} of Champion's ${ddK}¢)`,
    ),
  );

  const cvC = cvar(ev.candidate_nets, RISK.cvar_pct);
  const cvK = cvar(ev.champion_nets, RISK.cvar_pct);
  const cvarState: GateState =
    cvC == null || cvK == null ? "insufficient" : cvC >= cvK * (1 - RISK.cvar_improvement) ? "pass" : "fail";
  gates.push(
    g(
      "cvar",
      `CVaR${RISK.cvar_pct} improvement`,
      cvarState,
      cvC == null || cvK == null
        ? `needs ${RISK.min_tail_events} observations per side`
        : `${cvC}¢ vs Champion ${cvK}¢, needs ${pct(RISK.cvar_improvement)} better`,
    ),
  );

  const catC = ev.candidate_nets.filter((x) => x < RISK.catastrophic_cents).length;
  const catK = ev.champion_nets.filter((x) => x < RISK.catastrophic_cents).length;
  const rateC = ev.candidate_nets.length ? catC / ev.candidate_nets.length : null;
  const rateK = ev.champion_nets.length ? catK / ev.champion_nets.length : null;
  const catState: GateState =
    rateC == null || rateK == null || catK < RISK.min_tail_events
      ? "insufficient"
      : rateC <= rateK * RISK.catastrophic_rate_ratio
        ? "pass"
        : "fail";
  gates.push(
    g(
      "catastrophic",
      `Losses worse than ${RISK.catastrophic_cents}¢`,
      catState,
      catK < RISK.min_tail_events
        ? `Champion has ${catK} such losses; ${RISK.min_tail_events} needed to judge`
        : `${catC}/${ev.candidate_nets.length} vs Champion ${catK}/${ev.champion_nets.length}`,
    ),
  );

  const worstC = ev.candidate_nets.length ? Math.min(...ev.candidate_nets) : null;
  const worstK = ev.champion_nets.length ? Math.min(...ev.champion_nets) : null;
  gates.push(
    g(
      "worst_loss",
      "Worst loss",
      worstC == null || worstK == null
        ? "insufficient"
        : worstC >= worstK - RISK.worst_loss_slack_cents
          ? "pass"
          : "fail",
      worstC == null || worstK == null
        ? "no observations"
        : `${worstC}¢ vs Champion ${worstK}¢ (slack ${RISK.worst_loss_slack_cents}¢)`,
    ),
  );

  // --- regime safety -------------------------------------------------------
  gates.push(regimeGate(ev.pairs));

  const passed = gates.filter((x) => x.state === "pass").length;
  const blocked = gates.filter((x) => x.required && x.state !== "pass").map((x) => x.label);
  return {
    candidate_id: ev.candidate_id,
    gates,
    passed,
    total: gates.length,
    all_required_passed: blocked.length === 0,
    blocked_by: blocked,
  };
}

/**
 * A candidate may not be materially worse in any regime it has been tested in.
 *
 * Regimes with too few paired observations are not judged — and not counted as a
 * pass either. Inventing a verdict for a regime the candidate has barely seen is
 * how a policy that only works in one market gets promoted.
 */
export function regimeGate(pairs: readonly Pair[]): Gate {
  const by = new Map<string, number[]>();
  for (const p of pairs) {
    if (!p.regime) continue;
    const arr = by.get(p.regime) ?? [];
    arr.push(delta(p));
    by.set(p.regime, arr);
  }
  const judged: string[] = [];
  const failing: string[] = [];
  for (const [k, ds] of by) {
    if (ds.length < REGIME.min_paired) continue;
    judged.push(`${k} n=${ds.length}`);
    const m = mean(ds)!;
    if (m < -REGIME.max_trail_cents) failing.push(`${k} ${m.toFixed(2)}¢`);
  }
  if (!judged.length) {
    return g("regime", "Regime safety", "insufficient", `no regime has ${REGIME.min_paired} paired observations yet`);
  }
  return g(
    "regime",
    "Regime safety",
    failing.length ? "fail" : "pass",
    failing.length ? `trails in ${failing.join("; ")}` : `within ${REGIME.max_trail_cents}¢ across ${judged.join(", ")}`,
  );
}

/**
 * The human-readable reason, generated from the measurements rather than written.
 *
 * A hand-written promotion reason is a claim; this is a description of the numbers
 * that actually cleared the gates.
 */
export function gateSummary(r: ReturnType<typeof evaluateComponentGates>): string {
  const head = `${r.candidate_id}: ${r.passed}/${r.total} gates`;
  if (r.all_required_passed) return `${head} — every required gate passed`;
  return `${head} — blocked by ${r.blocked_by.join(", ")}`;
}
