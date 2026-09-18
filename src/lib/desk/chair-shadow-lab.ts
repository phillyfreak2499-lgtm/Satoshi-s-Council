/**
 * Chair v2 / Chair v3 — frozen, read-only Lab scoreboards.
 *
 * This module turns numbers the desk ALREADY keeps (Chair v2's shadow
 * scoreboard in server-engine, Chair v3's strict walk-forward report) into
 * two public cards. It is pure: no clock, no database, no engine import.
 *
 * It has no authority. It cannot refit, sample, vote, book, or promote. The
 * gates it prints are the ones written in chair-v2.ts and chair-v3.ts; it
 * invents none of its own, and meeting a count here is not promotion.
 *
 * Disambiguation, because the Lab already uses "V2" and "V3" for something
 * else: these cards are chair-v2.ts and chair-v3.ts, the shadow probability
 * chairs. They are NOT FLOOR_SELECTIVE_V2 / ENTRY_SELECTIVE_V3, which are
 * entry policies scored by the entry-time call-quality study.
 */
import {
  V2_GATE_CALLS,
  V2_GATE_SAMPLES,
  V2_MARGIN_CENTS,
  V2_MIN_ENTRY_CENTS,
  V2_POPULATION,
  V2_SAMPLE_MINS,
  v2Gates,
  type V2Stats,
} from "./chair-v2.ts";
import { V3_MAX_ADJUSTMENT, V3_MIN_TRAIN, type V3Report } from "./chair-v3.ts";

export const CHAIR_SHADOW_LAB_ID = "CHAIR_SHADOW_LAB_V1";
export const CHAIR_V2_SOURCE = "src/lib/desk/chair-v2.ts" as const;
export const CHAIR_V3_SOURCE = "src/lib/desk/chair-v3.ts" as const;
/** The entry policies this page must never be confused with. */
export const NOT_THESE = ["FLOOR_SELECTIVE_V2", "ENTRY_SELECTIVE_V3"] as const;

/**
 * unavailable — the source produced nothing this request (engine frame or
 *   report unreachable). Rendered as unavailable, never as zeros.
 * collecting  — evidence exists but at least one frozen gate is unmet, or
 *   nothing has been graded yet.
 * gates-met   — every frozen gate holds on the current sample. Still not
 *   promotion; a separate documented review is required.
 */
export type ShadowStanding = "unavailable" | "collecting" | "gates-met";

export type ChairV2Gates = ReturnType<typeof v2Gates>;

export type ChairV2Card = {
  id: "CHAIR_V2";
  source: typeof CHAIR_V2_SOURCE;
  standing: ShadowStanding;
  /** Raw sample bookkeeping — real counts even before anything is graded. */
  n_samples: number | null;
  n_graded: number | null;
  /** The record. Null until at least one sample is graded, so an empty ledger
   *  is not printed as "0 calls, +0.0¢, Brier —" dressed up as a result. */
  calls_v2: number | null;
  calls_v1: number | null;
  ev_v2: number | null;
  ev_v1: number | null;
  brier_v2: number | null;
  brier_market: number | null;
  /** v2Gates() from chair-v2.ts, verbatim. Null when there are no stats. */
  gates: ChairV2Gates | null;
  /** The frozen thresholds, cited from chair-v2.ts. */
  gate_rules: {
    samples: number;
    calls: number;
    ev_positive: true;
    brier: "v2 < market";
  };
  model: { weights_n: number; fitted_at: string | null };
  /** The live shadow rule in one line. */
  rule: string;
  rule_parts: {
    margin_cents: number;
    min_entry_cents: number;
    sample_mins: number;
    population: string;
  };
};

export type ChairV3Card = {
  id: "CHAIR_V3";
  source: typeof CHAIR_V3_SOURCE;
  evidence: "historical-strict-walk-forward";
  standing: ShadowStanding;
  n_rows: number | null;
  /** Walk-forward points scored — by construction only rows after the
   *  min_train warm-up, each predicted from strictly earlier closes. */
  n_scored: number | null;
  market_brier: number | null;
  v3_brier: number | null;
  brier_delta: number | null;
  market_log_loss: number | null;
  v3_log_loss: number | null;
  avg_abs_adjustment_pp: number | null;
  max_abs_adjustment_pp: number | null;
  /** Rows in the current fitted model, or 0 while under min_train. */
  model_n: number | null;
  min_train: number;
  max_adjustment_pp: number;
  /** The one frozen gate: v3 Brier below market Brier on the scored points. */
  gate: { brierOk: boolean; scored: number } | null;
  report_at: string | null;
};

export type ChairV2CardInput = {
  stats: V2Stats | null;
  weights_n: number;
  fitted_at: number;
};

export type ChairV3CardInput = {
  report: Pick<
    V3Report,
    | "n_rows"
    | "n_scored"
    | "market_brier"
    | "v3_brier"
    | "brier_delta"
    | "market_log_loss"
    | "v3_log_loss"
    | "avg_abs_adjustment_pp"
    | "max_abs_adjustment_pp"
  > | null;
  model_n: number | null;
  at: string | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => (finite(v) ? v : null);

/** The live shadow rule, as chair-v2.ts applies it, in one line. */
export function v2RuleLine(): string {
  return `fill only where P beats the ask by fee + ${V2_MARGIN_CENTS}¢ · no entry under ${V2_MIN_ENTRY_CENTS}¢ · one sample per window at ${V2_SAMPLE_MINS} min left · population ${V2_POPULATION}`;
}

export function buildChairV2Card(input: ChairV2CardInput): ChairV2Card {
  const st = input.stats;
  const base = {
    id: "CHAIR_V2" as const,
    source: CHAIR_V2_SOURCE,
    gate_rules: {
      samples: V2_GATE_SAMPLES,
      calls: V2_GATE_CALLS,
      ev_positive: true as const,
      brier: "v2 < market" as const,
    },
    model: {
      weights_n: Math.max(0, Math.floor(num(input.weights_n) ?? 0)),
      fitted_at: finite(input.fitted_at) && input.fitted_at > 0 ? new Date(input.fitted_at).toISOString() : null,
    },
    rule: v2RuleLine(),
    rule_parts: {
      margin_cents: V2_MARGIN_CENTS,
      min_entry_cents: V2_MIN_ENTRY_CENTS,
      sample_mins: V2_SAMPLE_MINS,
      population: V2_POPULATION,
    },
  };
  if (!st) {
    return {
      ...base,
      standing: "unavailable",
      n_samples: null,
      n_graded: null,
      calls_v2: null,
      calls_v1: null,
      ev_v2: null,
      ev_v1: null,
      brier_v2: null,
      brier_market: null,
      gates: null,
    };
  }
  const nSamples = Math.max(0, Math.floor(num(st.n_samples) ?? 0));
  const nGraded = Math.max(0, Math.floor(num(st.n_graded) ?? 0));
  const gates = v2Gates(st);
  const graded = nGraded > 0;
  return {
    ...base,
    standing: graded && gates.met === 3 ? "gates-met" : "collecting",
    n_samples: nSamples,
    n_graded: nGraded,
    calls_v2: graded ? Math.max(0, Math.floor(num(st.calls_v2) ?? 0)) : null,
    calls_v1: graded ? Math.max(0, Math.floor(num(st.calls_v1) ?? 0)) : null,
    ev_v2: graded ? (num(st.ev_v2) ?? 0) : null,
    ev_v1: graded ? (num(st.ev_v1) ?? 0) : null,
    brier_v2: graded ? num(st.brier_v2) : null,
    brier_market: graded ? num(st.brier_market) : null,
    gates,
  };
}

export function buildChairV3Card(input: ChairV3CardInput): ChairV3Card {
  const r = input.report;
  const base = {
    id: "CHAIR_V3" as const,
    source: CHAIR_V3_SOURCE,
    evidence: "historical-strict-walk-forward" as const,
    min_train: V3_MIN_TRAIN,
    max_adjustment_pp: Math.round(V3_MAX_ADJUSTMENT * 100),
    report_at: input.at,
  };
  if (!r) {
    return {
      ...base,
      standing: "unavailable",
      n_rows: null,
      n_scored: null,
      market_brier: null,
      v3_brier: null,
      brier_delta: null,
      market_log_loss: null,
      v3_log_loss: null,
      avg_abs_adjustment_pp: null,
      max_abs_adjustment_pp: null,
      model_n: null,
      gate: null,
    };
  }
  const scored = Math.max(0, Math.floor(num(r.n_scored) ?? 0));
  const marketBrier = num(r.market_brier);
  const v3Brier = num(r.v3_brier);
  const brierOk = scored > 0 && marketBrier != null && v3Brier != null && v3Brier < marketBrier;
  return {
    ...base,
    standing: brierOk ? "gates-met" : "collecting",
    n_rows: Math.max(0, Math.floor(num(r.n_rows) ?? 0)),
    n_scored: scored,
    market_brier: scored > 0 ? marketBrier : null,
    v3_brier: scored > 0 ? v3Brier : null,
    brier_delta: scored > 0 ? num(r.brier_delta) : null,
    market_log_loss: scored > 0 ? num(r.market_log_loss) : null,
    v3_log_loss: scored > 0 ? num(r.v3_log_loss) : null,
    avg_abs_adjustment_pp: scored > 0 ? num(r.avg_abs_adjustment_pp) : null,
    max_abs_adjustment_pp: scored > 0 ? num(r.max_abs_adjustment_pp) : null,
    model_n: Math.max(0, Math.floor(num(input.model_n) ?? 0)),
    gate: { brierOk, scored },
  };
}

// ---------------------------------------------------------------------------
// Display formatters. Shared by the server render and the browser so the
// first paint matches. They never turn a null into a zero.
// ---------------------------------------------------------------------------

export function fmtCount(v: number | null): string {
  return v == null ? "—" : String(v);
}

export function fmtCents(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}¢`;
}

export function fmtBrier(v: number | null): string {
  return v == null ? "—" : v.toFixed(4);
}

export function fmtPp(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(2)}pp`;
}

export function standingLabel(s: ShadowStanding): string {
  if (s === "unavailable") return "Unavailable · not a zero result";
  if (s === "gates-met") return "Frozen gates met · review required · not promotion";
  return "Collecting";
}

export function gateLabel(ok: boolean | null): string {
  if (ok == null) return "no evidence yet";
  return ok ? "met" : "not met";
}
