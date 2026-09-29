/**
 * RESEARCH FACTORY — insight reports (pure).
 *
 * Built on the production decision tape (research-factory-tape.ts) and the
 * experiment window facts. It answers where legitimate volume is suppressed,
 * without recommending a gate change because it blocks often:
 *
 *   abstention          structured WAIT analysis (frequency, regime, time,
 *                       ask, activity, drift over days, structural vs
 *                       episodic, what precedes conversion)
 *   transitions         how windows MOVE through the funnel (matrix, dwell,
 *                       advance and regression rates, first / terminal /
 *                       deepest), rolling
 *   brief_accuracy      does the system know what would change its decision?
 *   survival            the smallest SINGLE rule change that moves a stuck
 *                       window one stage further, and whether it then
 *                       qualifies or just meets the next blocker
 *   stage_unlocks       how much further each isolated arm moves than CONTROL
 *   signal_value        raw vs incremental information per seat and family,
 *                       inside narrow market-price bands, walk-forward
 *   research_summary    the six questions, answered deterministically
 *
 * Every result carries its population and hypothesis kind (PRESPECIFIED or
 * EXPLORATORY) and the number of variants tested. Nothing here changes
 * production, and nothing EXPLORATORY can earn production authority directly.
 */
import { takerFeeCents } from "./clock.ts";
import { EVIDENCE_OF } from "./seats.ts";
import type { SeatId } from "./types";
import { FUNNEL, currentEvidenceScope, isDiagnosticOnly, type WindowFact } from "./research-factory-analysis.ts";
import { brier, logLoss, mean, round, wilson } from "./research-factory.ts";
import { TAPE_STAGES, type TapeEvent, type WindowTimeline } from "./research-factory-tape.ts";

export const ROLLING = [25, 50, 100, 250, 500] as const;
const pct = (k: number, n: number) => (n > 0 ? Math.round((k / n) * 1000) / 10 : null);
const median = (xs: readonly number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const tally = (xs: readonly string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
const bucket = (v: number | null | undefined, w: number) => (v == null || !Number.isFinite(v) ? "unknown" : `${Math.floor(v / w) * w}`);
const chicagoDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/** One settled window's tape, as the factory stores it. */
export type TapeWindow = { ticker: string; close_ms: number; events: TapeEvent[]; timeline: WindowTimeline };

export type HonestyLabel = { hypothesis_kind: "PRESPECIFIED" | "EXPLORATORY"; variants_tested: number; population: string; note?: string };

// ---------------------------------------------------------------------------
// A. Abstention (structured WAIT) analysis.
// ---------------------------------------------------------------------------

export function abstentionReport(windows: readonly TapeWindow[]) {
  const checkpoints = windows.flatMap((w) => w.events.filter((e) => e.checkpoint != null && e.state !== "BOOKED" && e.state !== "QUALIFIED"));
  const by = (key: (e: TapeEvent) => string) => {
    const groups = new Map<string, TapeEvent[]>();
    for (const e of checkpoints) { const k = key(e); groups.set(k, [...(groups.get(k) ?? []), e]); }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, es]) => ({
      value, frames: es.length, primary: tally(es.map((e) => e.primary_blocker ?? "NONE")).slice(0, 5).map(([blocker, n]) => ({ blocker, n, pct: pct(n, es.length) })),
    }));
  };
  // Structural vs episodic: in windows where a blocker appears at any checkpoint, what share of that window's checkpoints does it hold?
  const persistence = new Map<string, number[]>();
  for (const w of windows) {
    const cps = w.events.filter((e) => e.checkpoint != null);
    if (!cps.length) continue;
    const seen = new Set(cps.flatMap((e) => e.blockers));
    for (const b of seen) persistence.set(b, [...(persistence.get(b) ?? []), cps.filter((e) => e.blockers.includes(b as never)).length / cps.length]);
  }
  const character = [...persistence.entries()].map(([blocker, shares]) => {
    const m = mean(shares) ?? 0;
    return { blocker, windows: shares.length, mean_share_of_checkpoints: round(m, 3), character: m >= 0.8 ? "STRUCTURAL" : m <= 0.35 ? "EPISODIC" : "MIXED" };
  }).sort((a, b) => b.windows - a.windows);
  // What precedes conversion: blockers present before the first directional frame, in windows that did vs did not become directional.
  const converted = windows.filter((w) => w.timeline.became_directional && !w.timeline.partial_window);
  const never = windows.filter((w) => !w.timeline.became_directional && !w.timeline.partial_window);
  const blockers = [...new Set(windows.flatMap((w) => w.timeline.blockers_before_directional))].sort();
  const precede = blockers.map((b) => {
    const inConv = converted.filter((w) => w.timeline.blockers_before_directional.includes(b)).length;
    const inNever = never.filter((w) => w.timeline.blockers_before_directional.includes(b)).length;
    return { blocker: b, windows_that_converted: inConv, windows_never_directional: inNever, conversion_rate_when_present_pct: pct(inConv, inConv + inNever) };
  });
  return {
    population: "production decision tape: designated checkpoints of settled windows while WAIT or DIRECTIONAL-not-qualified",
    frames: checkpoints.length, windows: windows.length,
    frequency: {
      primary: tally(checkpoints.map((e) => e.primary_blocker ?? "NONE")).map(([blocker, n]) => ({ blocker, n, pct: pct(n, checkpoints.length) })),
      any: tally(checkpoints.flatMap((e) => e.blockers)).map(([blocker, n]) => ({ blocker, n, pct: pct(n, checkpoints.length) })),
      unknown_frames: checkpoints.filter((e) => e.primary_blocker === "UNKNOWN").length,
    },
    by_regime: by((e) => e.market.regime ?? "unknown"),
    by_time_remaining: by((e) => String(e.checkpoint)),
    by_ask_bucket: by((e) => bucket(e.market.favorite_ask, 5)),
    by_seat_activity: by((e) => `${Math.min(e.evidence.directional_seats.length, 4)}${e.evidence.directional_seats.length >= 4 ? "+" : ""} directional seats`),
    by_family_activity: by((e) => `${new Set(e.evidence.directional_seats.map((s) => EVIDENCE_OF[s as SeatId])).size} families speaking`),
    over_time: by((e) => chicagoDay(e.close_ms)),
    character,
    precedes_conversion: precede,
    note: "UNKNOWN is recorded when production's own fields do not decide the reason; nothing is inferred.",
  };
}

// ---------------------------------------------------------------------------
// 1. Choke-transition engine (production tape).
// ---------------------------------------------------------------------------

export function transitionReport(windows: readonly TapeWindow[]) {
  const full = windows.filter((w) => !w.timeline.partial_window).sort((a, b) => b.close_ms - a.close_ms);
  const view = (ws: readonly TapeWindow[]) => {
    const t = ws.flatMap((w) => w.timeline.transitions);
    const from = new Map<string, number>();
    for (const x of t) from.set(x.from, (from.get(x.from) ?? 0) + 1);
    const matrix = tally(t.map((x) => `${x.from} -> ${x.to}`)).map(([k, n]) => { const [f, to] = k.split(" -> ") as [string, string]; return { from: f, to, count: n, rate_pct: pct(n, from.get(f) ?? 0) }; });
    const dwell = new Map<string, number[]>();
    for (const w of ws) for (const l of w.timeline.labels) dwell.set(l.label, [...(dwell.get(l.label) ?? []), l.dwell_s]);
    const labels = [...dwell.keys()].sort();
    return {
      windows: ws.length, transitions: t.length,
      matrix,
      by_label: labels.map((label) => {
        const out = t.filter((x) => x.from === label);
        return {
          label, visits: dwell.get(label)!.length, median_dwell_s: round(median(dwell.get(label)!), 1),
          advance_pct: pct(out.filter((x) => !x.regression).length, out.length), regression_pct: pct(out.filter((x) => x.regression).length, out.length),
        };
      }),
      first_blocker: tally(ws.map((w) => w.timeline.first_blocker ?? "none")).map(([label, n]) => ({ label, n })),
      terminal: tally(ws.map((w) => w.timeline.terminal_label ?? "none")).map(([label, n]) => ({ label, n })),
      deepest_stage: TAPE_STAGES.map((s) => ({ stage: s, windows: ws.filter((w) => w.timeline.deepest_stage === s).length })).filter((x) => x.windows > 0),
      became_directional: ws.filter((w) => w.timeline.became_directional).length,
      qualified: ws.filter((w) => w.timeline.qualified).length,
      booked: ws.filter((w) => w.timeline.booked).length,
    };
  };
  const rolling = [...ROLLING.filter((n) => n < full.length).map((n) => ({ view: `last ${n}`, ...view(full.slice(0, n)) })), { view: `all (${full.length})`, ...view(full) }];
  const breakdown = (key: (w: TapeWindow) => string) => {
    const g = new Map<string, TapeWindow[]>();
    for (const w of full) { const k = key(w); g.set(k, [...(g.get(k) ?? []), w]); }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, ws]) => {
      const v = view(ws);
      return { value, windows: ws.length, became_directional: v.became_directional, qualified: v.qualified, booked: v.booked, top_terminal: v.terminal[0]?.label ?? null };
    });
  };
  const first = (w: TapeWindow) => w.events[0];
  return {
    population: "production decision tape: settled windows observed from their start (partial windows excluded)",
    partial_windows_excluded: windows.length - full.length,
    rolling,
    breakdowns: {
      direction: breakdown((w) => w.timeline.first_directional_side ?? "never directional"),
      regime: breakdown((w) => first(w)?.market.regime ?? "unknown"),
      favorite_strength: breakdown((w) => bucket(first(w)?.market.favorite_ask, 5)),
      build: breakdown((w) => first(w)?.build_sha || "unknown"),
      day: breakdown((w) => chicagoDay(w.close_ms)),
    },
    note: "A later failure does not make an earlier unlock useless: read the matrix as stage-by-stage movement.",
  };
}

// ---------------------------------------------------------------------------
// B. Frame-brief accuracy.
// ---------------------------------------------------------------------------

export function briefAccuracy(windows: readonly TapeWindow[]) {
  const briefs = windows.flatMap((w) => w.timeline.briefs);
  const gradable = briefs.filter((b) => b.gradable);
  const met = gradable.filter((b) => b.condition_met);
  const cleared = gradable.filter((b) => b.blocker_cleared);
  const byBlocker = tally(gradable.map((b) => b.primary_blocker)).map(([blocker]) => {
    const bs = gradable.filter((b) => b.primary_blocker === blocker);
    const m = bs.filter((b) => b.condition_met);
    return {
      blocker, briefs: bs.length,
      brief_condition_hit_rate: pct(m.length, bs.length),
      brief_correct_transition_rate: pct(m.filter((b) => b.correct_transition).length, m.length),
      brief_false_hope_rate: pct(m.filter((b) => b.false_hope).length, m.length),
      unexplained_clear_rate: pct(bs.filter((b) => b.unexplained_clear).length, bs.filter((b) => b.blocker_cleared).length),
      next_blocker: tally(bs.map((b) => b.next_blocker ?? "none")).slice(0, 3).map(([next, n]) => ({ next, n })),
    };
  });
  return {
    population: "designated checkpoint briefs of settled windows whose primary blocker has a condition production's own logic defines",
    briefs: briefs.length, gradable: gradable.length,
    brief_condition_hit_rate: pct(met.length, gradable.length),
    brief_correct_transition_rate: pct(met.filter((b) => b.correct_transition).length, met.length),
    brief_false_hope_rate: pct(met.filter((b) => b.false_hope).length, met.length),
    unexplained_clear_rate: pct(cleared.filter((b) => b.unexplained_clear).length, cleared.length),
    definitions: {
      brief_condition_hit_rate: "the stated condition occurred later in the same window",
      brief_correct_transition_rate: "given the condition occurred, the blocker then cleared",
      brief_false_hope_rate: "given the condition occurred, the window never advanced past the brief's stage",
      unexplained_clear_rate: "the blocker cleared without the stated condition occurring (the brief was incomplete)",
    },
    by_blocker: byBlocker,
  };
}

// ---------------------------------------------------------------------------
// 3. Counterfactual survival: the smallest single change, and what it buys.
// ---------------------------------------------------------------------------

/** One single-variable change and how big it must be for this frame to pass its primary blocker. */
export type Lever = { lever: string; magnitude: number | null; unit: string };

/** The smallest single rule change that clears the primary blocker of this frame, when production's values define it. */
export function smallestChange(e: TapeEvent): Lever | null {
  const v = e.values;
  const num = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  const req = (m: string) => e.conditions.find((c) => c.metric === m)?.required;
  switch (e.primary_blocker) {
    case "DIRECTION_BELOW_BAR": { const g = num("vs_bar_minus_bar"); return g == null ? null : { lever: "chair_bar", magnitude: round(-g, 3), unit: "bar points lower" }; }
    case "SUPPORTER_FAIL": { const c = num("supporters"), r = req("supporters"); return c == null || typeof r !== "number" ? null : { lever: "min_supporters", magnitude: r - c, unit: "fewer supporters required" }; }
    case "FAMILY_DIVERSITY_FAIL": { const c = num("families"), r = req("families"); return c == null || typeof r !== "number" ? null : { lever: "min_families", magnitude: r - c, unit: "fewer families required" }; }
    case "OPPOSITION_FAIL": { const c = num("opposing"), r = req("opposing"); return c == null || typeof r !== "number" ? null : { lever: "max_opposing", magnitude: c - r, unit: "more opposing votes allowed" }; }
    case "ENTRY_PRICE_FAIL": { const c = num("ask_cents"), r = req("ask_cents"); return c == null || typeof r !== "number" ? null : { lever: "floor_cents", magnitude: round(r - c, 1), unit: "cents lower floor" }; }
    case "MODEL_EDGE_FAIL": { const c = num("model_edge_cents"), r = req("model_edge_cents"); return c == null || typeof r !== "number" ? null : { lever: "min_model_edge", magnitude: round(r - c, 1), unit: "cents lower requirement" }; }
    case "INDEX_EDGE_FAIL": { const c = num("index_margin_cents"), r = req("index_margin_cents"); return c == null || typeof r !== "number" ? null : { lever: "min_index_edge", magnitude: round(r - c + 0.1, 1), unit: "cents lower requirement" }; }
    case "CONFIRMATION_INCOMPLETE": return { lever: "confirmation", magnitude: null, unit: "frames/seconds (latch count not published; not replayable)" };
    default: return null;
  }
}

const MAGNITUDE_BUCKET: Record<string, number> = { chair_bar: 0.02, min_supporters: 1, min_families: 1, max_opposing: 1, floor_cents: 1, min_model_edge: 1, min_index_edge: 1 };

export function survivalReport(windows: readonly TapeWindow[]): HonestyLabel & { levers: unknown[]; false_unlocks: string[]; highest_leverage: unknown } {
  type Row = { lever: string; step: string; w: TapeWindow; later_fail: string[]; side: "UP" | "DOWN" | null; ask: number | null };
  const rows: Row[] = [];
  for (const w of windows) {
    if (w.timeline.qualified || w.timeline.booked) continue;
    // The window's deepest frame (its best chance), not an arbitrary one.
    const best = [...w.events].filter((e) => e.primary_blocker).sort((a, b) => b.stage_index - a.stage_index || b.as_of - a.as_of)[0];
    if (!best) continue;
    const lv = smallestChange(best);
    if (!lv || lv.magnitude == null || lv.magnitude <= 0) continue;
    const width = MAGNITUDE_BUCKET[lv.lever] ?? 1;
    const step = `<= ${round(Math.ceil(lv.magnitude / width) * width, 3)} ${lv.unit}`;
    // Every other failing blocker production measured on the same frame still stands.
    rows.push({ lever: lv.lever, step, w, later_fail: best.blockers.filter((b) => b !== best.primary_blocker), side: best.evidence.side ?? best.evidence.raw_side, ask: best.values.ask_cents as number | null });
  }
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(`${r.lever}|${r.step}`, [...(groups.get(`${r.lever}|${r.step}`) ?? []), r]);
  const levers = [...groups.entries()].map(([k, rs]) => {
    const [lever, step] = k.split("|") as [string, string];
    const qualifiedIfConfirmed = rs.filter((r) => r.later_fail.every((b) => b === "CONFIRMATION_INCOMPLETE") && r.side && r.ask != null);
    const settled = qualifiedIfConfirmed.filter((r) => r.w.timeline.winner);
    const wins = settled.filter((r) => r.side === r.w.timeline.winner).length;
    const nets = settled.map((r) => (r.side === r.w.timeline.winner ? 100 - r.ask! : -r.ask!) - takerFeeCents(r.ask!));
    return {
      lever, step, windows_unlocked_one_stage: rs.length,
      still_blocked_later: rs.length - qualifiedIfConfirmed.length,
      next_blockers: tally(rs.flatMap((r) => r.later_fail.slice(0, 1))).slice(0, 3).map(([b, n]) => ({ blocker: b, n })),
      qualified_fills_created_per_rule_change: qualifiedIfConfirmed.length,
      settled: settled.length, wins, losses: settled.length - wins, win_rate_ci95: wilson(wins, settled.length),
      net_cents_at_recorded_ask: nets.length ? round(nets.reduce((a, b) => a + b, 0)) : null,
      replay_quality: lever === "confirmation" ? "UNAVAILABLE" : "PARTIAL",
      quality_note: "Admission at the deepest recorded frame is exact; confirmation afterwards is assumed; the fill is priced at that frame's ask with the taker fee.",
    };
  }).sort((a, b) => b.qualified_fills_created_per_rule_change - a.qualified_fills_created_per_rule_change || b.windows_unlocked_one_stage - a.windows_unlocked_one_stage);
  const falseUnlocks = levers.filter((l) => l.windows_unlocked_one_stage > 0 && l.qualified_fills_created_per_rule_change === 0).map((l) => `${l.lever} ${l.step}`);
  const best = levers.find((l) => l.qualified_fills_created_per_rule_change > 0 && (l.net_cents_at_recorded_ask ?? -1) >= 0) ?? null;
  return {
    hypothesis_kind: "EXPLORATORY", variants_tested: levers.length,
    population: "settled production windows that never qualified; each at its deepest recorded frame; one single-variable change at a time",
    levers, false_unlocks: falseUnlocks,
    highest_leverage: best ? { lever: best.lever, step: best.step, qualified_fills_created: best.qualified_fills_created_per_rule_change, net_cents: best.net_cents_at_recorded_ask } : null,
    note: "Ranked by qualified fills created, not windows unblocked. A change that only moves a window from one blocker to the next is a false unlock.",
  };
}

// ---------------------------------------------------------------------------
// 1b. Incremental stage unlocks per isolated arm (experiment window facts).
// ---------------------------------------------------------------------------

const factStage = (f: Pick<WindowFact, "funnel_stage">) => (f.funnel_stage ? FUNNEL.indexOf(f.funnel_stage) : -1);

export function stageUnlocks(facts: readonly WindowFact[], experiment: string, control = "CONTROL") {
  const own = currentEvidenceScope(facts).filter((f) => f.experiment === experiment && f.observed && f.funnel_stage != null);
  const ctl = new Map(own.filter((f) => f.arm === control).map((f) => [`${f.ticker}|${f.close_ms}`, f]));
  const arms = [...new Set(own.map((f) => f.arm))].filter((a) => a !== control).sort();
  return {
    experiment, control,
    population: "windows where both the arm and CONTROL recorded an evaluation (matched)",
    arms: arms.map((arm) => {
      const pairs = own.filter((f) => f.arm === arm && ctl.has(`${f.ticker}|${f.close_ms}`)).map((f) => ({ a: f, c: ctl.get(`${f.ticker}|${f.close_ms}`)! }));
      const perStage = FUNNEL.slice(1).map((stage) => {
        const i = FUNNEL.indexOf(stage);
        const armReached = pairs.filter((p) => factStage(p.a) >= i).length;
        const ctlReached = pairs.filter((p) => factStage(p.c) >= i).length;
        return { stage, arm_reached: armReached, control_reached: ctlReached, incremental: armReached - ctlReached };
      });
      return {
        arm, diagnostic_only: isDiagnosticOnly(experiment, arm), matched_windows: pairs.length,
        advanced_further_than_control: pairs.filter((p) => factStage(p.a) > factStage(p.c)).length,
        fell_short_of_control: pairs.filter((p) => factStage(p.a) < factStage(p.c)).length,
        incremental_stage_unlocks: perStage,
        next_blocker_after_unlock: tally(pairs.filter((p) => factStage(p.a) > factStage(p.c) && p.a.first_blocker).map((p) => p.a.first_blocker!)).slice(0, 3).map(([b, n]) => ({ blocker: b, n })),
      };
    }),
    note: "Recorders store an arm's deepest evaluation per window, not a per-tick tape, so arm-level dwell times are not available; production's tape carries those.",
  };
}

// ---------------------------------------------------------------------------
// 2. Marginal-information (value-add) scorer.
// ---------------------------------------------------------------------------

/** One observation of a signal at a fixed clock, from the favourite's point of view. */
export type SignalObs = { window: string; close_ms: number; fav_prob: number; stance: "AGREE" | "OPPOSE" | "SILENT"; fav_won: 0 | 1 };

export const PRICE_BANDS = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 0.95], [0.95, 1.0001]] as const;
const bandOf = (p: number) => PRICE_BANDS.findIndex(([lo, hi]) => p >= lo && p < hi);

/**
 * Incremental information of one signal over the market price.
 *  - within each narrow favourite-price band, favourite win rate when the
 *    signal agrees vs opposes (price-band control);
 *  - walk-forward: each window is scored by a model fitted only on earlier
 *    windows (band x stance offsets, shrunk to the market with k pseudo-counts),
 *    against the market-only baseline: incremental Brier and log loss
 *    (positive = the signal adds information).
 */
export function marginalValue(obs: readonly SignalObs[], opts: { minTrain?: number; k?: number } = {}) {
  const minTrain = opts.minTrain ?? 30, k = opts.k ?? 10;
  const sorted = [...obs].filter((o) => o.fav_prob >= 0.5 && o.fav_prob <= 1 && bandOf(o.fav_prob) >= 0).sort((a, b) => a.close_ms - b.close_ms);
  const bands = PRICE_BANDS.map(([lo, hi], i) => {
    const inBand = sorted.filter((o) => bandOf(o.fav_prob) === i);
    const cell = (s: SignalObs["stance"]) => { const c = inBand.filter((o) => o.stance === s); const w = c.filter((o) => o.fav_won).length; return { n: c.length, fav_won: w, rate_pct: pct(w, c.length), ci95: wilson(w, c.length) }; };
    return { band: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}c`, n: inBand.length, agree: cell("AGREE"), oppose: cell("OPPOSE"), silent: cell("SILENT") };
  });
  const base: number[] = [], model: number[] = [], ys: (0 | 1)[] = [];
  const stats = new Map<string, { n: number; resid: number }>();
  for (const o of sorted) {
    const key = `${bandOf(o.fav_prob)}|${o.stance}`;
    const seen = [...stats.values()].reduce((a, s) => a + s.n, 0);
    if (seen >= minTrain) {
      const s = stats.get(key) ?? { n: 0, resid: 0 };
      const offset = s.n > 0 ? s.resid / (s.n + k) : 0;
      base.push(o.fav_prob); model.push(Math.min(0.999, Math.max(0.001, o.fav_prob + offset))); ys.push(o.fav_won);
    }
    const s = stats.get(key) ?? { n: 0, resid: 0 };
    stats.set(key, { n: s.n + 1, resid: s.resid + (o.fav_won - o.fav_prob) });
  }
  const bB = brier(base, ys), bM = brier(model, ys), lB = logLoss(base, ys), lM = logLoss(model, ys);
  const directional = sorted.filter((o) => o.stance !== "SILENT");
  const correct = directional.filter((o) => (o.stance === "AGREE") === (o.fav_won === 1)).length;
  return {
    n: sorted.length, directional: directional.length,
    raw_value: { directional_accuracy_pct: pct(correct, directional.length), ci95: wilson(correct, directional.length), market_brier: brier(sorted.map((o) => o.fav_prob), sorted.map((o) => o.fav_won)) },
    incremental_value: {
      walk_forward_scored: ys.length, min_train: minTrain,
      incremental_brier: bB != null && bM != null ? round(bB - bM, 5) : null,
      incremental_log_loss: lB != null && lM != null ? round(lB - lM, 5) : null,
    },
    price_bands: bands,
  };
}

/** Pairwise redundancy: how often two signals agree when both speak, and who is right when they do not. */
export function redundancy(stances: ReadonlyMap<string, ReadonlyMap<string, { side: "UP" | "DOWN" }>>, winners: ReadonlyMap<string, "UP" | "DOWN">) {
  const names = [...stances.keys()].sort();
  const out: Array<{ a: string; b: string; both_speaking: number; agreement_pct: number | null; disagreements: number; a_right_when_disagree: number; b_right_when_disagree: number }> = [];
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
    const A = stances.get(names[i]!)!, B = stances.get(names[j]!)!;
    const both = [...A.keys()].filter((w) => B.has(w));
    const agree = both.filter((w) => A.get(w)!.side === B.get(w)!.side).length;
    const dis = both.filter((w) => A.get(w)!.side !== B.get(w)!.side && winners.has(w));
    out.push({ a: names[i]!, b: names[j]!, both_speaking: both.length, agreement_pct: pct(agree, both.length), disagreements: dis.length, a_right_when_disagree: dis.filter((w) => A.get(w)!.side === winners.get(w)).length, b_right_when_disagree: dis.filter((w) => B.get(w)!.side === winners.get(w)).length });
  }
  return out.filter((r) => r.both_speaking > 0).sort((x, y) => (y.agreement_pct ?? 0) - (x.agreement_pct ?? 0) || y.both_speaking - x.both_speaking);
}

/** Seat and family signal value from the production tape, at one fixed checkpoint per window (default T-5:00). */
export function signalValueReport(windows: readonly TapeWindow[], checkpoint = 300): HonestyLabel & { signals: unknown[]; redundancy: unknown[]; best_incremental: string | null; most_redundant: string | null } {
  const obsBy = new Map<string, SignalObs[]>();
  const stances = new Map<string, Map<string, { side: "UP" | "DOWN" }>>();
  const winners = new Map<string, "UP" | "DOWN">();
  for (const w of windows) {
    const e = w.events.find((x) => x.checkpoint === checkpoint && x.seats && x.market.yes_mid != null);
    if (!e || !w.timeline.winner) continue;
    const key = `${w.ticker}|${w.close_ms}`;
    winners.set(key, w.timeline.winner);
    const yes = e.market.yes_mid! / 100;
    const fav: "UP" | "DOWN" = yes >= 0.5 ? "UP" : "DOWN";
    const favProb = Math.max(yes, 1 - yes);
    const favWon: 0 | 1 = w.timeline.winner === fav ? 1 : 0;
    const add = (name: string, side: "UP" | "DOWN" | null) => {
      obsBy.set(name, [...(obsBy.get(name) ?? []), { window: key, close_ms: w.close_ms, fav_prob: favProb, stance: side == null ? "SILENT" : side === fav ? "AGREE" : "OPPOSE", fav_won: favWon }]);
      if (side) { const m = stances.get(name) ?? new Map(); m.set(key, { side }); stances.set(name, m); }
    };
    const famVotes = new Map<string, number>();
    for (const s of e.seats ?? []) {
      const side = (s.lean === "UP" || s.lean === "DOWN") && (s.weight ?? 0) > 0 ? (s.lean as "UP" | "DOWN") : null;
      add(`seat:${s.seat}`, side);
      if (side) { const f = `family:${EVIDENCE_OF[s.seat as SeatId] ?? "unknown"}`; famVotes.set(f, (famVotes.get(f) ?? 0) + (side === "UP" ? 1 : -1)); }
    }
    for (const f of new Set((e.seats ?? []).map((s) => `family:${EVIDENCE_OF[s.seat as SeatId] ?? "unknown"}`))) {
      const v = famVotes.get(f) ?? 0;
      add(f, v > 0 ? "UP" : v < 0 ? "DOWN" : null);
    }
  }
  const signals = [...obsBy.entries()].map(([name, obs]) => ({ signal: name, ...marginalValue(obs) })).sort((a, b) => (b.incremental_value.incremental_log_loss ?? -1) - (a.incremental_value.incremental_log_loss ?? -1));
  const red = redundancy(stances, winners);
  const eligible = signals.filter((s) => s.incremental_value.walk_forward_scored >= 50);
  const best = eligible[0] && (eligible[0].incremental_value.incremental_log_loss ?? 0) > 0 ? eligible[0].signal : null;
  const redundant = eligible.filter((s) => (s.raw_value.directional_accuracy_pct ?? 0) >= 60 && (s.incremental_value.incremental_log_loss ?? 0) <= 0).map((s) => s.signal)[0] ?? null;
  return {
    hypothesis_kind: "EXPLORATORY", variants_tested: signals.length,
    population: `production seat reads at the T-${checkpoint / 60}:00 checkpoint of settled windows; favourite-perspective; price-band controlled`,
    signals, redundancy: red.slice(0, 40), best_incremental: best, most_redundant: redundant,
    note: "Raw value and incremental value are separate scores. Nothing here mutes, promotes or re-weights a seat.",
  };
}

// ---------------------------------------------------------------------------
// 5. The research summary.
// ---------------------------------------------------------------------------

export function researchSummary(input: {
  transitions: ReturnType<typeof transitionReport>;
  abstention: ReturnType<typeof abstentionReport>;
  survival: ReturnType<typeof survivalReport>;
  signals: ReturnType<typeof signalValueReport>;
  pockets_promising: Array<{ experiment: string; arm: string; dimension: string; value: string }>;
  lifecycle_flags: Array<{ experiment: string; arm: string }>;
}) {
  const r = input.transitions.rolling.find((x) => x.view === "last 100") ?? input.transitions.rolling[input.transitions.rolling.length - 1];
  // "Otherwise legitimate": a research read exists and no precondition (time, feeds, daily risk) is the primary blocker.
  const legit = input.abstention.frequency.primary.filter((b) => !["NO_RESEARCH_READ", "TIME_WINDOW_FAIL", "FEED_OR_DATA_HEALTH_FAIL", "DAILY_RISK_FAIL", "UNKNOWN", "NONE"].includes(b.blocker));
  return {
    current_bottleneck: legit[0] ? { blocker: legit[0].blocker, frames: legit[0].n, share_pct: legit[0].pct, population: input.abstention.population, windows_in_view: r ? `${r.view}: ${r.windows} windows` : null } : { none: "no legitimate-candidate frames yet" },
    highest_leverage_isolated_change: input.survival.highest_leverage ?? { none: "no single change has yet created a qualified fill with non-negative net at the recorded ask" },
    best_incremental_signal: input.signals.best_incremental ?? { none: "no signal has >= 50 walk-forward scored windows with positive incremental log loss" },
    most_redundant_signal: input.signals.most_redundant ?? { none: "insufficient sample" },
    false_unlocks: input.survival.false_unlocks,
    next_prospective_experiment: input.lifecycle_flags[0] ?? input.pockets_promising[0] ?? (input.survival.highest_leverage ? { candidate: input.survival.highest_leverage, requires: "freeze as a pre-registered shadow arm before any claim" } : { none: "no finding yet meets the evidence bar for a frozen shadow test" }),
    honesty: {
      survival: { hypothesis_kind: input.survival.hypothesis_kind, variants_tested: input.survival.variants_tested },
      signals: { hypothesis_kind: input.signals.hypothesis_kind, variants_tested: input.signals.variants_tested },
      rule: "EXPLORATORY findings can earn a frozen prospective test; they cannot earn production authority directly. No promotion from COMBINED_DIAG or P2-contaminated evidence.",
    },
    authority: { production_authority: "NONE", automatic_changes: false },
  };
}

export const TAPE_REPORT_KINDS = ["abstention", "transitions", "brief_accuracy", "survival", "stage_unlocks", "signal_value", "research_summary"] as const;
