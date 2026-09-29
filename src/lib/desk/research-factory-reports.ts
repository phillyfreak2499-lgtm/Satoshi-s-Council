/**
 * RESEARCH FACTORY — cross-window reports (pure).
 *
 * Every report is computed from window facts (Phase 2) joined with integrity
 * annotations (Phase 3). Every metric carries its population label, and every
 * comparison says whether its cohorts share the same window IDs. Nothing here
 * recommends loosening a gate because it blocks often, and nothing promotes:
 * the lifecycle may FLAG a result for human review, never change production.
 */
import { feeCents } from "./fee-engine.ts";
import { DEPLOYED_POLICY } from "./gate-vector.ts";
import { e1FamilyOf } from "./shadow-arms.ts";
import type { SeatId } from "./types";
import {
  FUNNEL, currentEvidenceCohort, currentEvidenceScope, evidenceEligible, isDiagnosticOnly,
  type FunnelStage, type IntegrityStatus, type WindowFact,
} from "./research-factory-analysis.ts";
import {
  KNOWN_EXPERIMENTS, benjaminiHochberg, binomialUpperP, computeUtilization, fillStats, round, sum,
  type Fill, type FillStats,
} from "./research-factory.ts";
import { V2_EVALUATOR_REVISION, V2_LEGACY_REVISION } from "./mid-recovery-locks-v2-cohort.ts";

const MID_RECOVERY_EXPERIMENT = KNOWN_EXPERIMENTS.mid_recovery_v1;
const MID_RECOVERY_LOCKS_EXPERIMENT = KNOWN_EXPERIMENTS.mid_recovery_locks_v1;
const MID_RECOVERY_LOCKS_V2_EXPERIMENT = KNOWN_EXPERIMENTS.mid_recovery_locks_v2;

/** A window fact with the integrity statuses of every receipt its arm wrote in that window. */
export type GradedFact = WindowFact & { integrity: IntegrityStatus[] };

type Obj = Record<string, unknown>;
const winKey = (f: Pick<WindowFact, "ticker" | "close_ms">) => `${f.ticker}|${f.close_ms}`;
const armKey = (f: Pick<WindowFact, "experiment" | "arm">) => `${f.experiment}|${f.arm}`;
const facts = (f: GradedFact): Obj => (f.facts ?? {}) as Obj;
const isProduction = (f: Pick<WindowFact, "experiment">) => f.experiment === "PRODUCTION";
/** Production's own rows (the ledger fact and the decision-tape timeline): never an experiment, never pooled with one. */
export const isProductionAny = (f: Pick<WindowFact, "experiment">) => f.experiment === "PRODUCTION" || f.experiment === "PRODUCTION_TAPE";
/** The official ledger is not a receipt the auditor annotates; its EXACT replay is its evidence bar. */
export const clean = (f: GradedFact): boolean => (isProduction(f) ? f.replay_quality === "EXACT" : evidenceEligible(f, f.integrity));
const fillOf = (f: GradedFact): Fill | null =>
  f.side && f.ask_cents != null ? { side: f.side, ask_cents: f.ask_cents, fee_cents: f.fee_cents ?? 0, winner: f.official_winner, close_ms: f.close_ms } : null;
const stageIndex = (s: FunnelStage | null) => (s ? FUNNEL.indexOf(s) : -1);

export function cohortCoverage(all: readonly GradedFact[]) {
  const own = all.filter((f) => f.experiment === MID_RECOVERY_LOCKS_V2_EXPERIMENT.id && f.observed);
  const windows = new Map<string, GradedFact[]>();
  const comparable = new Set(currentEvidenceScope(own).map(winKey));
  for (const f of own) { const k = winKey(f); windows.set(k, [...(windows.get(k) ?? []), f]); }
  const details = [...windows.entries()].map(([window, fs]) => {
    const c = facts(fs[0]!).v2_cohort as Obj | undefined;
    return {
      window, ticker: fs[0]!.ticker, close_ms: fs[0]!.close_ms,
      revisions: c?.revisions ?? [V2_LEGACY_REVISION], build_shas: c?.build_shas ?? [],
      arms: fs.map((f) => f.arm).sort(), comparable: comparable.has(window),
      reasons: [...(Array.isArray(c?.reasons) ? c.reasons : ["MISSING_DERIVED_COHORT_METADATA"]), ...(fs.every(currentEvidenceCohort) && !comparable.has(window) ? ["INCOMPLETE_DERIVED_ARMS"] : [])],
    };
  }).sort((a, b) => a.close_ms - b.close_ms || a.ticker.localeCompare(b.ticker));
  return {
    experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, current_revision: V2_EVALUATOR_REVISION,
    observed_windows: details.length, current_comparable_windows: details.filter((w) => w.comparable).length,
    excluded_windows: details.filter((w) => !w.comparable),
    rule: "Factory V2 economics use only complete current-revision windows with one known build and a complete observer session. Legacy, unknown, mixed, and incomplete windows remain visible here. Cohort membership does not certify CLEAN integrity, settlement, execution, or promotion. Original receipts remain unchanged.",
  };
}

export const CONTROL_ARMS: ReadonlySet<string> = new Set(["NULL_FAV_80", "CONTROL", "BASELINE", "FLOOR"]);
export const MIN_SETTLED_FOR_CLAIM = 30;

// ---------------------------------------------------------------------------
// Phase 4: matched-window grader.
// ---------------------------------------------------------------------------

export type ArmGrade = {
  experiment: string;
  arm: string;
  role: "CONTROL" | "ISOLATED" | "DIAGNOSTIC_ONLY";
  population: string;
  observed_windows: number;
  candidate_windows: number | null;
  wait_to_directional: number | null;
  eligible_windows: number | null;
  qualified_windows: number | null;
  stats: FillStats;
};

export type ExperimentGrade = {
  experiment: string;
  arms: string[];
  matched_windows: number;
  matched_clean_windows: number;
  matched: ArmGrade[];
  matched_clean: ArmGrade[];
  /** Each arm over its own observed windows: NOT a like-for-like comparison. */
  unmatched: ArmGrade[];
  note: string;
  cohort_coverage?: ReturnType<typeof cohortCoverage>;
};

function roleOf(experiment: string, arm: string): ArmGrade["role"] {
  if (isDiagnosticOnly(experiment, arm)) return "DIAGNOSTIC_ONLY";
  return CONTROL_ARMS.has(arm) ? "CONTROL" : "ISOLATED";
}

function gradeArm(experiment: string, arm: string, rows: readonly GradedFact[], population: string): ArmGrade {
  const recovered = rows.some((f) => facts(f).candidate_count != null);
  const idx = (s: FunnelStage) => FUNNEL.indexOf(s);
  return {
    experiment, arm, role: roleOf(experiment, arm), population,
    observed_windows: rows.length,
    candidate_windows: recovered ? rows.filter((f) => Number(facts(f).candidate_count ?? 0) > 0).length : null,
    wait_to_directional: recovered ? rows.filter((f) => facts(f).wait_to_directional === true).length : null,
    eligible_windows: recovered ? rows.filter((f) => stageIndex(f.funnel_stage) >= idx("INDEX_EDGE") && facts(f).families_ok === true).length : null,
    qualified_windows: recovered ? rows.filter((f) => stageIndex(f.funnel_stage) >= idx("QUALIFIED")).length : null,
    stats: fillStats(rows.map(fillOf).filter((x): x is Fill => x != null)),
  };
}

/** The window sets a matched comparison is built on: computed once, then graded one arm at a time. */
export type MatchedSets = { experiment: string; keys: string[]; byArm: Map<string, Map<string, GradedFact>>; matched: string[]; matchedClean: string[]; cohort_coverage?: ReturnType<typeof cohortCoverage> };

export function matchedSets(all: readonly GradedFact[], experiment: string): MatchedSets {
  const coverage = experiment === MID_RECOVERY_LOCKS_V2_EXPERIMENT.id ? cohortCoverage(all) : undefined;
  all = currentEvidenceScope(all);
  const own = all.filter((f) => f.experiment === experiment && f.observed);
  const windows = new Set(own.map(winKey));
  const prod = all.filter((f) => isProduction(f) && windows.has(winKey(f)));
  const byArm = new Map<string, Map<string, GradedFact>>();
  for (const f of [...own, ...prod]) {
    const k = isProduction(f) ? "PRODUCTION|FLOOR" : armKey(f);
    const m = byArm.get(k) ?? new Map<string, GradedFact>();
    m.set(winKey(f), f);
    byArm.set(k, m);
  }
  const keys = [...byArm.keys()].sort();
  const matched = [...windows].filter((w) => keys.every((k) => byArm.get(k)!.has(w))).sort();
  const matchedClean = matched.filter((w) => keys.every((k) => { const f = byArm.get(k)!.get(w)!; return isDiagnosticOnly(f.experiment, f.arm) || clean(f); }));
  return { experiment, keys, byArm, matched, matchedClean, ...(coverage ? { cohort_coverage: coverage } : {}) };
}

export const MATCHED_LABEL = "MATCHED: identical window IDs, all integrity statuses";
export const MATCHED_CLEAN_LABEL = "MATCHED_CLEAN: identical window IDs, every non-diagnostic arm EXACT and CLEAN";
export const UNMATCHED_LABEL = "UNMATCHED: this arm's own observed windows; not comparable across arms";

/** One arm's three populations on precomputed sets. */
export function gradeArmOn(sets: MatchedSets, key: string): { matched: ArmGrade; matched_clean: ArmGrade; unmatched: ArmGrade } {
  const [e, a] = key.split("|") as [string, string];
  const m = sets.byArm.get(key)!;
  return {
    matched: gradeArm(e, a, sets.matched.map((w) => m.get(w)!), MATCHED_LABEL),
    matched_clean: gradeArm(e, a, sets.matchedClean.map((w) => m.get(w)!), MATCHED_CLEAN_LABEL),
    unmatched: gradeArm(e, a, [...m.values()], UNMATCHED_LABEL),
  };
}

export const MATCHED_NOTE = "Only MATCHED rows are like-for-like. COMBINED_DIAG is DIAGNOSTIC_ONLY and never evidence for promotion. Probabilities are market-implied (ask/100); Chair confidence is not a probability.";

export function assembleGrade(sets: MatchedSets, parts: ReadonlyArray<ReturnType<typeof gradeArmOn>>): ExperimentGrade {
  return {
    experiment: sets.experiment, arms: sets.keys, matched_windows: sets.matched.length, matched_clean_windows: sets.matchedClean.length,
    matched: parts.map((p) => p.matched), matched_clean: parts.map((p) => p.matched_clean), unmatched: parts.map((p) => p.unmatched), note: MATCHED_NOTE,
    ...(sets.cohort_coverage ? { cohort_coverage: sets.cohort_coverage } : {}),
  };
}

/**
 * Compare an experiment's arms (plus production) on IDENTICAL window IDs. The
 * matched set is the intersection of the windows every arm observed; the clean
 * set further requires every non-diagnostic arm's record to be evidence-grade.
 */
export function matchedGrade(all: readonly GradedFact[], experiment: string): ExperimentGrade {
  const sets = matchedSets(all, experiment);
  return assembleGrade(sets, sets.keys.map((k) => gradeArmOn(sets, k)));
}

// ---------------------------------------------------------------------------
// Phase 5: choke attribution.
// ---------------------------------------------------------------------------

export const ROLLING = [25, 50, 100, 250, 500] as const;

export type ChokeReport = {
  experiment: string;
  arm: string;
  rolling: Array<{ windows: string; n: number; first_blocker: Array<{ stage: string; n: number; pct: number | null }>; candidate_windows: number; candidate_first_blocker: Array<{ stage: string; n: number; pct: number | null }> }>;
  all_blockers: Array<{ check: string; n: number }>;
  breakdowns: Record<string, Array<{ value: string; windows: number; booked: number; top_first_blocker: string | null; top_share_pct: number | null }>>;
  answer: string;
  caution: string;
};

const tally = (xs: readonly string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const pct = (k: number, n: number) => (n > 0 ? Math.round((k / n) * 1000) / 10 : null);

/** One window's breakdown keys, all read from decision-time fields. */
export function breakdownKeys(f: GradedFact): Record<string, string[]> {
  const x = facts(f);
  const ctx = (x.context ?? {}) as Obj;
  const seats = (Array.isArray(x.candidate_seats) ? x.candidate_seats : []) as string[];
  const bucket = (v: unknown, w: number) => (typeof v === "number" && Number.isFinite(v) ? `${Math.floor(v / w) * w}` : "unknown");
  return {
    seat: seats.length ? seats : ["none"],
    family: seats.length ? [...new Set(seats.map((s) => e1FamilyOf(s as SeatId)))] : ["none"],
    direction: [String(x.recorded_side ?? "none")],
    ask_bucket: [bucket(x.decision_ask_cents, 5)],
    secs_left_bucket: [bucket(x.secs_left, 60)],
    regime: [String(ctx.regime ?? "unknown")],
    favorite_strength: [String(ctx.favorite_cents_bucket ?? "unknown")],
    hour_block_chicago: [String(ctx.hour_block_chicago ?? "unknown")],
    weekday_chicago: [String(ctx.weekday_chicago ?? "unknown")],
    hypothesis: (Array.isArray(x.candidate_hypotheses) && x.candidate_hypotheses.length ? x.candidate_hypotheses : ["none"]) as string[],
    build: [String(f.source_build_sha ?? "unknown")],
  };
}

export function chokeAttribution(all: readonly GradedFact[], experiment: string, arm: string): ChokeReport {
  all = currentEvidenceScope(all);
  const rows = all.filter((f) => f.experiment === experiment && f.arm === arm && f.observed && f.funnel_stage != null).sort((a, b) => b.close_ms - a.close_ms);
  const blockerOf = (f: GradedFact) => (f.funnel_stage === "SIMULATED_BOOKED" ? "BOOKED" : f.first_blocker ?? "UNKNOWN");
  const dist = (xs: readonly GradedFact[]) => tally(xs.map(blockerOf)).map(([stage, n]) => ({ stage, n, pct: pct(n, xs.length) }));
  const sizes: Array<[string, number]> = [...ROLLING.filter((n) => n < rows.length).map((n) => [`last ${n}`, n] as [string, number]), [`all (${rows.length})`, rows.length]];
  const rolling = sizes.map(([label, n]) => {
    const slice = rows.slice(0, n);
    const cand = slice.filter((f) => Number(facts(f).candidate_count ?? 0) > 0);
    return { windows: label, n: slice.length, first_blocker: dist(slice), candidate_windows: cand.length, candidate_first_blocker: dist(cand) };
  });
  const breakdowns: ChokeReport["breakdowns"] = {};
  const groups = new Map<string, Map<string, GradedFact[]>>();
  for (const f of rows) for (const [dim, values] of Object.entries(breakdownKeys(f))) for (const v of values) {
    const g = groups.get(dim) ?? new Map<string, GradedFact[]>();
    g.set(v, [...(g.get(v) ?? []), f]);
    groups.set(dim, g);
  }
  for (const [dim, g] of groups) {
    breakdowns[dim] = [...g.entries()].map(([value, fs]) => {
      const d = dist(fs.filter((f) => f.funnel_stage !== "SIMULATED_BOOKED"));
      return { value, windows: fs.length, booked: fs.filter((f) => f.funnel_stage === "SIMULATED_BOOKED").length, top_first_blocker: d[0]?.stage ?? null, top_share_pct: d[0]?.pct ?? null };
    }).sort((a, b) => b.windows - a.windows || a.value.localeCompare(b.value));
  }
  const recent = rolling.find((r) => r.windows === "last 100") ?? rolling[rolling.length - 1]!;
  const topCand = recent.candidate_first_blocker[0];
  const top = recent.first_blocker[0];
  const answer = !rows.length ? `No recorded evaluations yet for ${experiment}/${arm}.`
    : `Over the ${recent.windows} windows of ${experiment}/${arm}: first blocker ${top?.stage ?? "none"} (${top?.n ?? 0}/${recent.n}); among the ${recent.candidate_windows} windows that had a recovery candidate: ${topCand ? `${topCand.stage} (${topCand.n}/${recent.candidate_windows})` : "none"}.`;
  return {
    experiment, arm, rolling,
    all_blockers: tally(rows.flatMap((f) => f.blockers)).map(([check, n]) => ({ check, n })),
    breakdowns, answer,
    caution: "Frequency is not a recommendation: a gate that blocks often may be blocking losers. Test any change one gate at a time on EXACT windows (counterfactual report) before proposing it.",
  };
}

// ---------------------------------------------------------------------------
// Phase 6: calibration and pocket discovery.
// ---------------------------------------------------------------------------

/**
 * The pre-registered pocket dimensions. Single dimensions only, fixed in code,
 * so the number of tests is known in advance and reported with every result.
 */
export const POCKET_DIMENSIONS: ReadonlyArray<{ id: string; of: (f: GradedFact) => string | null }> = Object.freeze([
  { id: "ask_bucket_5c", of: (f) => (f.ask_cents == null ? null : `${Math.floor(f.ask_cents / 5) * 5}`) },
  { id: "side", of: (f) => f.side },
  { id: "secs_left_60s", of: (f) => { const v = facts(f).secs_left; return typeof v === "number" ? `${Math.floor(v / 60) * 60}` : null; } },
  { id: "regime", of: (f) => ((facts(f).context as Obj | undefined)?.regime as string | null) ?? null },
  { id: "favorite_strength_5c", of: (f) => ((facts(f).context as Obj | undefined)?.favorite_cents_bucket as string | null) ?? null },
  { id: "strike_distance_atr", of: (f) => ((facts(f).context as Obj | undefined)?.strike_distance_atr_bucket as string | null) ?? null },
  { id: "hour_block_chicago", of: (f) => ((facts(f).context as Obj | undefined)?.hour_block_chicago as string | null) ?? null },
  { id: "confidence_10", of: (f) => { const v = facts(f).recorded_confidence; return typeof v === "number" ? `${Math.floor(v / 10) * 10}` : null; } },
  { id: "model_edge_2c", of: (f) => { const v = facts(f).model_edge_cents; return typeof v === "number" ? `${Math.floor(v / 2) * 2}` : null; } },
  { id: "index_margin_2c", of: (f) => { const v = facts(f).index_margin_cents; return typeof v === "number" ? `${Math.floor(v / 2) * 2}` : null; } },
  { id: "spread_1c", of: (f) => { const v = facts(f).decision_spread_cents; return typeof v === "number" ? `${Math.floor(v)}` : null; } },
  { id: "families", of: (f) => { const v = facts(f).families; return Array.isArray(v) && v.length ? [...v].map(String).sort().join("+") : null; } },
]);

export type Pocket = {
  dimension: string;
  value: string;
  population: string;
  windows: number;
  stats: FillStats;
  matched_null_fav: FillStats;
  p_value_vs_breakeven: number | null;
  bh_pass: boolean;
  label: "PROMISING" | "EXPLORATORY" | "INSUFFICIENT_SAMPLE";
};

export type PocketReport = { experiment: string; arm: string; tests: number; fdr_q: number; pockets: Pocket[]; caution: string; hypothesis_kind: "EXPLORATORY"; variants_tested: number };

export function pocketScan(all: readonly GradedFact[], experiment: string, arm: string, q = 0.1): PocketReport {
  all = currentEvidenceScope(all);
  const mine = all.filter((f) => f.experiment === experiment && f.arm === arm && f.observed);
  const nullByWin = new Map(all.filter((f) => f.experiment === experiment && f.arm === "NULL_FAV_80").map((f) => [winKey(f), f]));
  const pockets: Pocket[] = [];
  for (const d of POCKET_DIMENSIONS) {
    const groups = new Map<string, GradedFact[]>();
    for (const f of mine) { if (!fillOf(f)) continue; const v = d.of(f); if (v == null) continue; groups.set(v, [...(groups.get(v) ?? []), f]); }
    for (const [value, fs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const cleanFs = fs.filter(clean);
      const stats = fillStats(cleanFs.map(fillOf).filter((x): x is Fill => x != null));
      const nulls = cleanFs.map((f) => nullByWin.get(winKey(f))).filter((f): f is GradedFact => !!f).map(fillOf).filter((x): x is Fill => x != null);
      const p = stats.settled > 0 && stats.breakeven_win_rate_pct != null ? binomialUpperP(stats.wins, stats.settled, stats.breakeven_win_rate_pct / 100) : null;
      pockets.push({ dimension: d.id, value, population: "CLEAN simulated fills of this arm (EXACT replay, integrity CLEAN)", windows: fs.length, stats, matched_null_fav: fillStats(nulls), p_value_vs_breakeven: p == null ? null : round(p, 4), bh_pass: false, label: "INSUFFICIENT_SAMPLE" });
    }
  }
  const pass = benjaminiHochberg(pockets.map((x) => x.p_value_vs_breakeven), q);
  pockets.forEach((x, i) => {
    x.bh_pass = pass[i]!;
    const lo = x.stats.win_rate_ci95?.lo ?? null;
    x.label = x.stats.settled < MIN_SETTLED_FOR_CLAIM ? "INSUFFICIENT_SAMPLE"
      : x.bh_pass && lo != null && x.stats.breakeven_win_rate_pct != null && lo > x.stats.breakeven_win_rate_pct && (x.stats.net_cents ?? 0) > 0 ? "PROMISING" : "EXPLORATORY";
  });
  return {
    experiment, arm, tests: pockets.length, fdr_q: q, pockets, hypothesis_kind: "EXPLORATORY", variants_tested: pockets.length,
    caution: `${pockets.length} pockets tested across ${POCKET_DIMENSIONS.length} pre-registered single dimensions. PROMISING requires >= ${MIN_SETTLED_FOR_CLAIM} clean settled fills, a Wilson 95% lower bound above break-even, positive net, and surviving Benjamini-Hochberg at q=${q}. Everything else is exploratory.`,
  };
}

// ---------------------------------------------------------------------------
// Phase 8: counterfactual gate tester (one gate at a time).
// ---------------------------------------------------------------------------

export type Counterfactual = {
  id: string;
  gate: string;
  change: string;
  direction: "TIGHTEN" | "LOOSEN";
  replay_quality: "EXACT" | "PARTIAL" | "UNAVAILABLE";
  quality_note: string;
  population: string;
  windows_considered: number;
  extra_directionals: number | null;
  extra_eligible: number;
  added_fills: number;
  removed_fills: number;
  added: FillStats;
  removed: FillStats;
  baseline: FillStats;
  after: FillStats;
  net_delta_cents: number | null;
  drawdown_delta_cents: number | null;
  brier_delta: number | null;
  vs_null_fav_same_windows: FillStats;
  windows_added: string[];
  windows_removed: string[];
};

const checksOf = (f: GradedFact) => new Map(((facts(f).checks ?? []) as Array<{ id: string; pass: boolean | null }>).map((c) => [c.id, c.pass]));
/** Every recorded admission check passes except (possibly) `except`; confirmation is judged separately. */
function onlyFailing(f: GradedFact, except: string): boolean {
  const c = checksOf(f);
  if (!c.size || !facts(f).recorded_side) return false;
  for (const [id, pass] of c) { if (id === "confirmation" || id === "families" || id === except) continue; if (pass !== true) return false; }
  if (except !== "families" && facts(f).families_ok !== true) return false;
  return c.get(except) === false || (except === "families" && facts(f).families_ok !== true);
}

function required(f: GradedFact) {
  const p = DEPLOYED_POLICY.params;
  const tight = facts(f).mode === "tight";
  return {
    supporters: tight ? p.tight_min_speaking : p.min_speaking,
    families: tight ? p.tight_min_families : p.min_families,
    index: tight ? p.tight_min_index_edge_cents : p.min_index_edge_cents,
    model: tight ? p.tight_min_edge_cents : p.min_edge_cents,
  };
}

export function counterfactualGates(all: readonly GradedFact[], experiment: string, arm: string): Counterfactual[] {
  all = currentEvidenceScope(all);
  const rows = all.filter((f) => f.experiment === experiment && f.arm === arm && f.observed && f.replay_quality !== "UNAVAILABLE" && facts(f).checks != null);
  const population = `${experiment}/${arm}: windows with a stored evaluation record and an official settlement (${rows.length})`;
  const nullByWin = new Map(all.filter((f) => f.experiment === experiment && f.arm === "NULL_FAV_80").map((f) => [winKey(f), f]));
  const baseFills = rows.filter((f) => fillOf(f));
  const toFills = (fs: readonly GradedFact[]) => fs.map(fillOf).filter((x): x is Fill => x != null);
  /** A loosened window is filled at its own recorded decision ask; confirmation was not stored, so it is assumed. */
  const asFill = (f: GradedFact): GradedFact => ({ ...f, side: (facts(f).recorded_side as "UP" | "DOWN"), ask_cents: facts(f).decision_ask_cents as number, fee_cents: f.fee_cents ?? feeOf(facts(f).decision_ask_cents as number) });
  const make = (id: string, gate: string, change: string, direction: Counterfactual["direction"], quality: Counterfactual["replay_quality"], note: string, added: GradedFact[], removed: GradedFact[], extraDirectionals: number | null = null): Counterfactual => {
    const removedKeys = new Set(removed.map(winKey));
    const after = [...baseFills.filter((f) => !removedKeys.has(winKey(f))), ...added];
    const b = fillStats(toFills(baseFills)), a = fillStats(toFills(after));
    const changed = [...added, ...removed].map(winKey);
    return {
      id, gate, change, direction, replay_quality: quality, quality_note: note, population, windows_considered: rows.length,
      extra_directionals: extraDirectionals, extra_eligible: added.length, added_fills: added.length, removed_fills: removed.length,
      added: fillStats(toFills(added)), removed: fillStats(toFills(removed)), baseline: b, after: a,
      net_delta_cents: a.net_cents != null || b.net_cents != null ? round((a.net_cents ?? 0) - (b.net_cents ?? 0)) : null,
      drawdown_delta_cents: a.max_drawdown_cents != null && b.max_drawdown_cents != null ? round(a.max_drawdown_cents - b.max_drawdown_cents) : null,
      brier_delta: a.brier_market != null && b.brier_market != null ? round(a.brier_market - b.brier_market, 4) : null,
      vs_null_fav_same_windows: fillStats(toFills(changed.map((k) => nullByWin.get(k)).filter((f): f is GradedFact => !!f))),
      windows_added: added.map(winKey).slice(0, 50), windows_removed: removed.map(winKey).slice(0, 50),
    };
  };
  const tightenNote = "Tightening only removes recorded fills; no unstored input is needed.";
  const loosenNote = "Admission at the stored decision tick is exact; the confirmation that follows it (frames over seconds) is not stored, so the added fill assumes confirmation at the recorded ask.";
  const num = (f: GradedFact, k: string) => (typeof facts(f)[k] === "number" ? (facts(f)[k] as number) : null);
  const qp = (f: GradedFact) => (facts(f).quote_parts ?? {}) as Obj;
  const out: Counterfactual[] = [
    make("FLOOR_82", "quote", "minimum entry 80c -> 82c", "TIGHTEN", "EXACT", tightenNote, [], baseFills.filter((f) => (f.ask_cents ?? 0) < 82)),
    make("FLOOR_78", "quote", "minimum entry 80c -> 78c", "LOOSEN", "PARTIAL", loosenNote,
      rows.filter((f) => !fillOf(f) && onlyFailing(f, "quote") && qp(f).floor_ok === false && qp(f).ceiling_ok === true && qp(f).spread_ok === true && qp(f).size_ok === true && (num(f, "decision_ask_cents") ?? 0) >= 78).map(asFill), []),
    make("INDEX_EDGE_PLUS_2", "index_edge", "settlement-index margin must exceed the requirement by 2c more", "TIGHTEN", "EXACT", tightenNote, [],
      baseFills.filter((f) => { const m = num(f, "index_margin_cents"); return m != null && m <= required(f).index + 2; })),
    make("INDEX_EDGE_MINUS_1", "index_edge", "settlement-index margin requirement lowered by 1c", "LOOSEN", "PARTIAL", loosenNote,
      rows.filter((f) => { const m = num(f, "index_margin_cents"); return !fillOf(f) && onlyFailing(f, "index_edge") && m != null && m > required(f).index - 1; }).map(asFill), []),
    make("MODEL_EDGE_PLUS_2", "model_edge", "main-model edge must be 2c higher", "TIGHTEN", "EXACT", tightenNote, [],
      baseFills.filter((f) => { const m = num(f, "model_edge_cents"); return m != null && m < required(f).model + 2; })),
    make("SUPPORTERS_MINUS_1", "supporters", "one fewer healthy supporter required", "LOOSEN", "PARTIAL", loosenNote,
      rows.filter((f) => !fillOf(f) && onlyFailing(f, "supporters") && (Array.isArray(facts(f).supporters) ? (facts(f).supporters as unknown[]).length : 0) === required(f).supporters - 1).map(asFill), []),
    make("FAMILIES_MINUS_1", "families", "one fewer evidence family required", "LOOSEN", "PARTIAL", loosenNote,
      rows.filter((f) => !fillOf(f) && onlyFailing(f, "families") && (Array.isArray(facts(f).families) ? (facts(f).families as unknown[]).length : 0) === required(f).families - 1).map(asFill), []),
  ];
  // Bar without the sit-mass term: direction only. What the downstream gates would have said for a side they never evaluated is not stored.
  const barOpen = rows.filter((f) => {
    const t = facts(f).chair_trace as Obj | null;
    if (!t || facts(f).recorded_side || t.hard_fail === true) return false;
    const vs = t.vs_bar as number | null, bar = t.bar as number | null, sit = t.sit_term as number | null;
    return vs != null && bar != null && sit != null && vs >= Math.max(0.24, bar - sit);
  }).length;
  out.push(make("BAR_NO_SITMASS", "chair_bar", "Chair bar without the 0.2 x sit-mass term", "LOOSEN", "PARTIAL",
    "Only the direction change is replayable from the stored Chair tape; the downstream gates were never evaluated for the new side. MID_RECOVERY_LOCKS_V1 measures this prospectively (BAR_NO_SITMASS arm).", [], [], barOpen));
  out.push(make("CONFIRMATION_FRAMES", "confirmation", "confirmation frames 3 -> 2", "LOOSEN", "UNAVAILABLE",
    "The per-tick sequence between the first eligible tick and the fill is not stored; this change cannot be replayed.", [], []));
  return out;
}

/** The fee a loosened fill would pay at its decision ask, from the one fee engine. */
const feeOf = (ask: number) => feeCents(ask);

// ---------------------------------------------------------------------------
// Phase 7: experiment lifecycle.
// ---------------------------------------------------------------------------

export type LifecycleStatus = "COLLECTING" | "INSUFFICIENT_SAMPLE" | "PROMISING" | "NEEDS_REVIEW" | "FAILED" | "RETIRED" | "INVALID_EVIDENCE" | "DIAGNOSTIC_ONLY";

export type LifecycleSpec = {
  experiment: string;
  arm: string;
  version: number;
  hypothesis: string;
  authority: "NONE";
  controls: string[];
  target_metric: string;
  promotion_criteria: string;
  retirement_criteria: string;
  lab_registry_id: string;
  retired: boolean;
  /** Research honesty rail. */
  hypothesis_kind: "PRESPECIFIED" | "EXPLORATORY";
  variants_tested: number;
  sample_windows: { training: string; validation: string; holdout: string };
};

const PROSPECTIVE = Object.freeze({ training: "none: frozen before collection", validation: "none", holdout: "every prospective window from the start boundary" });

const PROMOTION = `>= 50 CLEAN settled fills on MATCHED windows; Wilson 95% lower bound above break-even; positive after-fee net; beats NULL_FAV_80 on the same windows; zero INVALID and zero unresolved-P2 fills. Promotion then needs a separate, human-approved production trial.`;
const RETIREMENT = `>= 50 CLEAN settled fills with the Wilson 95% upper bound below break-even, or >= 500 observed windows with fewer than 5 fills.`;
const TARGET = "after-fee net cents per CLEAN settled fill, against NULL_FAV_80 on identical windows";

export const LIFECYCLE_REGISTRY: readonly LifecycleSpec[] = Object.freeze([
  { experiment: MID_RECOVERY_EXPERIMENT.id, arm: "RECOVERED_MID", version: MID_RECOVERY_EXPERIMENT.version, hypothesis: "Hearing the frozen E1 roster through the inactive recovery path turns production WAITs into profitable directional entries under every production rule.", authority: "NONE", controls: ["BASELINE", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: PROMOTION, retirement_criteria: RETIREMENT, lab_registry_id: "mid-recovery-v1", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arm: "CONTROL", version: MID_RECOVERY_LOCKS_EXPERIMENT.version, hypothesis: "Reference: the V1 recovered path unchanged, on the LOCKS cohort.", authority: "NONE", controls: ["NULL_FAV_80"], target_metric: TARGET, promotion_criteria: "Reference arm: never promoted.", retirement_criteria: "Retires with the experiment.", lab_registry_id: "recovery-locks", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arm: "BAR_NO_SITMASS", version: MID_RECOVERY_LOCKS_EXPERIMENT.version, hypothesis: "The Chair bar's sit-mass term alone suppresses profitable recovered directional reads.", authority: "NONE", controls: ["CONTROL", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: PROMOTION, retirement_criteria: RETIREMENT, lab_registry_id: "recovery-locks", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arm: "SUPPORT_UNCAL_E1", version: MID_RECOVERY_LOCKS_EXPERIMENT.version, hypothesis: "Refusing UNCALIBRATED recovered E1 rows as support alone suppresses profitable entries.", authority: "NONE", controls: ["CONTROL", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: PROMOTION, retirement_criteria: RETIREMENT, lab_registry_id: "recovery-locks", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arm: "COMBINED_DIAG", version: MID_RECOVERY_LOCKS_EXPERIMENT.version, hypothesis: "Diagnostic: both locks removed at once. Not attributable to either lock.", authority: "NONE", controls: ["CONTROL", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: "Never. DIAGNOSTIC_ONLY.", retirement_criteria: "Retires with the experiment.", lab_registry_id: "recovery-locks", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_EXPERIMENT.id, arm: "NULL_FAV_80", version: MID_RECOVERY_LOCKS_EXPERIMENT.version, hypothesis: "Matched-window control: buy the favourite at >= 80c.", authority: "NONE", controls: [], target_metric: TARGET, promotion_criteria: "Control arm: never promoted.", retirement_criteria: "Never retired while any arm it controls is collecting.", lab_registry_id: "recovery-locks", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },  // LOCKS V2: the same five arms with the P1 supporter correction in every recovered arm and only P2-guarded producer frames.
  { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arm: "CONTROL", version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version, hypothesis: "Reference: the V1 recovered path with STREAK beside another E1 book supporter counted once, on P2-guarded frames.", authority: "NONE", controls: ["NULL_FAV_80"], target_metric: TARGET, promotion_criteria: "Reference arm: never promoted.", retirement_criteria: "Retires with the experiment.", lab_registry_id: "recovery-locks-v2", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arm: "BAR_NO_SITMASS", version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version, hypothesis: "The Chair bar's sit-mass term alone suppresses profitable recovered directional reads (P1 and P2 corrected).", authority: "NONE", controls: ["CONTROL", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: PROMOTION, retirement_criteria: RETIREMENT, lab_registry_id: "recovery-locks-v2", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arm: "SUPPORT_UNCAL_E1", version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version, hypothesis: "Refusing UNCALIBRATED recovered E1 rows as support alone suppresses profitable entries (P1 and P2 corrected).", authority: "NONE", controls: ["CONTROL", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: PROMOTION, retirement_criteria: RETIREMENT, lab_registry_id: "recovery-locks-v2", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arm: "COMBINED_DIAG", version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version, hypothesis: "Diagnostic: both locks removed at once. Not attributable to either lock.", authority: "NONE", controls: ["CONTROL", "NULL_FAV_80"], target_metric: TARGET, promotion_criteria: "Never. DIAGNOSTIC_ONLY.", retirement_criteria: "Retires with the experiment.", lab_registry_id: "recovery-locks-v2", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
  { experiment: MID_RECOVERY_LOCKS_V2_EXPERIMENT.id, arm: "NULL_FAV_80", version: MID_RECOVERY_LOCKS_V2_EXPERIMENT.version, hypothesis: "Matched-window control: buy the favourite at >= 80c.", authority: "NONE", controls: [], target_metric: TARGET, promotion_criteria: "Control arm: never promoted.", retirement_criteria: "Never retired while any arm it controls is collecting.", lab_registry_id: "recovery-locks-v2", retired: false, hypothesis_kind: "PRESPECIFIED", variants_tested: 1, sample_windows: PROSPECTIVE },
]);

export type LifecycleRow = LifecycleSpec & {
  evaluator_revision: string | null;
  excluded_cohort_windows: number;
  status: LifecycleStatus;
  promotion_eligible: boolean;
  flag_for_human_review: boolean;
  start_boundary: string | null;
  integrity: Record<IntegrityStatus, number>;
  current_sample: { observed_windows: number; fills: number; clean_settled_fills: number; suspect_fills: number; invalid_fills: number };
  current_result: FillStats;
  matched_null_fav: FillStats;
  reasons: string[];
};

export function lifecycle(all: readonly GradedFact[]): LifecycleRow[] {
  return LIFECYCLE_REGISTRY.map((spec) => lifecycleRow(all, spec));
}

/** One registry row's lifecycle; the rollup builds these one per governed unit. */
export function lifecycleRow(all: readonly GradedFact[], spec: LifecycleSpec): LifecycleRow {
  const scoped = currentEvidenceScope(all);
  const excluded = all.filter((f) => f.experiment === spec.experiment && f.arm === spec.arm && f.observed).length
    - scoped.filter((f) => f.experiment === spec.experiment && f.arm === spec.arm && f.observed).length;
  all = scoped;
  {
    const mine = all.filter((f) => f.experiment === spec.experiment && f.arm === spec.arm && f.observed);
    const counts: Record<IntegrityStatus, number> = { CLEAN: 0, SUSPECT: 0, INVALID: 0, UNVERIFIABLE: 0 };
    for (const f of mine) for (const s of f.integrity) counts[s] += 1;
    const fills = mine.filter((f) => fillOf(f));
    const cleanFills = fills.filter(clean);
    const invalid = fills.filter((f) => f.integrity.includes("INVALID")).length;
    const suspect = fills.filter((f) => f.integrity.includes("SUSPECT")).length;
    const stats = fillStats(cleanFills.map(fillOf).filter((x): x is Fill => x != null));
    const nulls = new Map(all.filter((f) => f.experiment === spec.experiment && f.arm === "NULL_FAV_80").map((f) => [winKey(f), f]));
    const matchedNull = fillStats(cleanFills.map((f) => nulls.get(winKey(f))).filter((f): f is GradedFact => !!f).map(fillOf).filter((x): x is Fill => x != null));
    const reasons: string[] = [];
    const be = stats.breakeven_win_rate_pct;
    const ci = stats.win_rate_ci95;
    let status: LifecycleStatus;
    if (isDiagnosticOnly(spec.experiment, spec.arm)) { status = "DIAGNOSTIC_ONLY"; reasons.push("changes two locks at once; never attributable, never promotion evidence"); }
    else if (spec.retired) status = "RETIRED";
    else if (invalid > 0) { status = "INVALID_EVIDENCE"; reasons.push(`${invalid} fill(s) carry INVALID integrity annotations`); }
    else if (stats.settled < MIN_SETTLED_FOR_CLAIM) { status = mine.length < 100 ? "COLLECTING" : "INSUFFICIENT_SAMPLE"; reasons.push(`${stats.settled} clean settled fills; ${MIN_SETTLED_FOR_CLAIM} needed before any claim`); }
    else if (ci && be != null && ci.hi < be) { status = "FAILED"; reasons.push(`Wilson upper ${ci.hi}% < break-even ${be}%`); }
    else if (ci && be != null && ci.lo > be && (stats.net_cents ?? 0) > 0 && (matchedNull.net_cents == null || (stats.net_cents ?? 0) > matchedNull.net_cents)) {
      status = suspect > 0 ? "NEEDS_REVIEW" : "PROMISING";
      reasons.push(suspect > 0 ? `${suspect} SUSPECT fill(s) (P2 unresolved): resolve or bound before review` : "clears the promotion statistics on clean evidence");
    } else { status = suspect > 0 ? "NEEDS_REVIEW" : "COLLECTING"; reasons.push("inconclusive on clean evidence"); }
    const controlArm = CONTROL_ARMS.has(spec.arm);
    const eligible = !controlArm && !isDiagnosticOnly(spec.experiment, spec.arm);
    const first = mine.length ? Math.min(...mine.map((f) => f.decided_ms ?? f.close_ms)) : null;
    return {
      ...spec, status, promotion_eligible: eligible, flag_for_human_review: eligible && status === "PROMISING",
      evaluator_revision: spec.experiment === MID_RECOVERY_LOCKS_V2_EXPERIMENT.id ? V2_EVALUATOR_REVISION : null,
      excluded_cohort_windows: excluded,
      start_boundary: first == null ? null : new Date(first).toISOString(), integrity: counts,
      current_sample: { observed_windows: mine.length, fills: fills.length, clean_settled_fills: stats.settled, suspect_fills: suspect, invalid_fills: invalid },
      current_result: stats, matched_null_fav: matchedNull, reasons,
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 3 report: which recovery results are safe to use as evidence?
// ---------------------------------------------------------------------------

export function evidenceSafety(all: readonly GradedFact[], reasons: ReadonlyArray<{ experiment: string; arm: string; status: IntegrityStatus; codes: readonly string[] }>) {
  const byArm = new Map<string, { windows: number; fills: number; evidence_fills: number; statuses: Record<IntegrityStatus, number>; reasons: Map<string, number> }>();
  for (const f of all) {
    if (isProductionAny(f) || !f.observed) continue;
    const k = armKey(f);
    const cur = byArm.get(k) ?? { windows: 0, fills: 0, evidence_fills: 0, statuses: { CLEAN: 0, SUSPECT: 0, INVALID: 0, UNVERIFIABLE: 0 }, reasons: new Map() };
    cur.windows += 1;
    if (fillOf(f)) { cur.fills += 1; if (clean(f)) cur.evidence_fills += 1; }
    byArm.set(k, cur);
  }
  for (const r of reasons) {
    const cur = byArm.get(`${r.experiment}|${r.arm}`);
    if (!cur) continue;
    cur.statuses[r.status] += 1;
    for (const c of r.codes) cur.reasons.set(c, (cur.reasons.get(c) ?? 0) + 1);
  }
  const rows = [...byArm.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    const [experiment, arm] = k.split("|") as [string, string];
    return {
      experiment, arm, diagnostic_only: isDiagnosticOnly(experiment, arm), windows: v.windows, fills: v.fills, evidence_grade_fills: v.evidence_fills,
      receipt_statuses: v.statuses, top_reasons: [...v.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, n]) => ({ code, n })),
      safe_to_use: v.fills > 0 && v.evidence_fills === v.fills && !isDiagnosticOnly(experiment, arm) ? "ALL_FILLS" : v.evidence_fills > 0 && !isDiagnosticOnly(experiment, arm) ? "CLEAN_SUBSET_ONLY" : "NONE",
    };
  });
  return {
    question: "Which existing recovery results are safe enough to use as evidence?",
    rule: "Only fills whose every receipt is CLEAN, whose replay is EXACT, and whose arm is not DIAGNOSTIC_ONLY. SUSPECT includes the unresolved P2 path (LIVE card not selected by the producer). Nothing is deleted; everything else stays reported and labelled.",
    rows,
  };
}

// ---------------------------------------------------------------------------
// Phase 9: daily digest. Phase 10: utilization.
// ---------------------------------------------------------------------------

export type JobTelemetry = { job_kind: string; status: string; finished_ms: number | null; wall_ms: number | null; cpu_ms: number | null; peak_rss_mb: number | null; db_queries: number | null; db_ms: number | null; rows_scanned: number | null; rows_written: number | null; guard_reason: string | null };

export function utilization(jobs: readonly JobTelemetry[], sinceMs: number, nowMs: number, cpus: number) {
  const recent = jobs.filter((j) => j.finished_ms != null && j.finished_ms >= sinceMs && j.finished_ms <= nowMs);
  const cpu = sum(recent.map((j) => j.cpu_ms ?? 0));
  const byStatus: Record<string, number> = {};
  for (const j of recent) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  const guards: Record<string, number> = {};
  for (const j of recent) if (j.guard_reason) for (const g of j.guard_reason.split(",")) guards[g] = (guards[g] ?? 0) + 1;
  return {
    period: { from: new Date(sinceMs).toISOString(), to: new Date(nowMs).toISOString() },
    jobs: recent.length, by_status: byStatus, resource_guard_pauses: guards,
    cpu_ms: round(cpu), wall_ms: round(sum(recent.map((j) => j.wall_ms ?? 0))),
    peak_rss_mb: recent.length ? Math.max(...recent.map((j) => j.peak_rss_mb ?? 0)) : null,
    db_queries: sum(recent.map((j) => j.db_queries ?? 0)), db_ms: round(sum(recent.map((j) => j.db_ms ?? 0))),
    rows_scanned: sum(recent.map((j) => j.rows_scanned ?? 0)), rows_written: sum(recent.map((j) => j.rows_written ?? 0)),
    cpus,
    research_compute_utilization: computeUtilization(cpu, nowMs - sinceMs, cpus),
    note: "cpu_ms is process CPU measured around each job (it includes any web work that ran concurrently), so utilization is an upper bound.",
  };
}

const MILESTONES = [25, 50, 100, 250, 500] as const;

export function dailyDigest(all: readonly GradedFact[], dayStartMs: number, dayEndMs: number, integrityToday: ReadonlyArray<{ status: IntegrityStatus; codes: readonly string[] }>, extras: { lifecycle: LifecycleRow[]; choke: ChokeReport[]; utilization: ReturnType<typeof utilization> }) {
  const coverage = cohortCoverage(all);
  all = currentEvidenceScope(all);
  const today = all.filter((f) => f.close_ms >= dayStartMs && f.close_ms < dayEndMs);
  const before = all.filter((f) => f.close_ms < dayStartMs);
  const windows = new Set(today.filter((f) => !isProductionAny(f) || isProduction(f)).map(winKey));
  const experiments = [...new Set(today.filter((f) => !isProductionAny(f)).map((f) => f.experiment))].sort();
  const matched = experiments.map((e) => { const g = matchedGrade(today, e); return { experiment: e, matched_windows: g.matched_windows, matched_clean_windows: g.matched_clean_windows }; });
  const prodFills = today.filter((f) => isProduction(f) && fillOf(f));
  const shadow = today.filter((f) => !isProductionAny(f) && fillOf(f));
  const isolated = extras.lifecycle.filter((l) => l.promotion_eligible && l.current_result.settled >= 10);
  const byCpf = [...isolated].sort((a, b) => (b.current_result.cents_per_fill ?? -Infinity) - (a.current_result.cents_per_fill ?? -Infinity));
  const codeCount = new Map<string, number>();
  for (const r of integrityToday) if (r.status === "INVALID" || r.status === "SUSPECT") for (const c of r.codes) codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
  const milestones = extras.lifecycle.flatMap((l) => {
    const prior = fillStats(before.filter((f) => f.experiment === l.experiment && f.arm === l.arm && fillOf(f) && clean(f)).map(fillOf).filter((x): x is Fill => x != null)).settled;
    return MILESTONES.filter((m) => prior < m && l.current_result.settled >= m).map((m) => ({ experiment: l.experiment, arm: l.arm, milestone_clean_settled_fills: m }));
  });
  return {
    day: { from: new Date(dayStartMs).toISOString(), to: new Date(dayEndMs).toISOString() },
    v2_cohort_coverage: coverage,
    windows_observed: { n: windows.size, population: "distinct settled windows with any fact" },
    clean_matched_windows: { by_experiment: matched, population: "identical window IDs across every arm of the experiment and production" },
    production_calls: { n: prodFills.length, stats: fillStats(prodFills.map(fillOf).filter((x): x is Fill => x != null)), population: "official ledger (research-valid view)" },
    shadow_fills: { by_arm: tally(shadow.map((f) => armKey(f))).map(([arm, n]) => ({ arm, n, diagnostic_only: isDiagnosticOnly(...(arm.split("|") as [string, string])) })), population: "simulated fills, all integrity statuses" },
    strongest_isolated_arm: byCpf[0] ? { experiment: byCpf[0].experiment, arm: byCpf[0].arm, cents_per_fill: byCpf[0].current_result.cents_per_fill, settled: byCpf[0].current_result.settled, population: "CLEAN settled fills, all time; >= 10 required to rank" } : { none: "no isolated arm has >= 10 clean settled fills" },
    weakest_isolated_arm: byCpf.length > 1 ? { experiment: byCpf[byCpf.length - 1]!.experiment, arm: byCpf[byCpf.length - 1]!.arm, cents_per_fill: byCpf[byCpf.length - 1]!.current_result.cents_per_fill, settled: byCpf[byCpf.length - 1]!.current_result.settled, population: "CLEAN settled fills, all time" } : null,
    dominant_choke: extras.choke.map((c) => ({ experiment: c.experiment, arm: c.arm, answer: c.answer })),
    integrity_failures: { by_reason: [...codeCount.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, n })), population: "receipts of windows settled today, SUSPECT or INVALID" },
    newly_settled_research: { fills: shadow.filter((f) => f.official_winner != null).length, population: "simulated fills in windows settled today" },
    sample_milestones: milestones,
    retirement_eligible: extras.lifecycle.filter((l) => l.status === "FAILED").map((l) => ({ experiment: l.experiment, arm: l.arm })),
    production_trial_candidates_for_human_review: extras.lifecycle.filter((l) => l.flag_for_human_review).map((l) => ({ experiment: l.experiment, arm: l.arm, reasons: l.reasons })),
    compute: extras.utilization,
    authority: { production_authority: "NONE", auto_promotion: false },
  };
}
