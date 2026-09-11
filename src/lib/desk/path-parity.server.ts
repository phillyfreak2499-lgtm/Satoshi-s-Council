/**
 * The shadow write for the YES-path horizon measurement (server only).
 *
 * MEASUREMENT ONLY, AND STRUCTURALLY SO. This module has exactly one public write,
 * it returns nothing a caller can branch on, and no seat, DSL rule, threshold,
 * Chair input, learned weight or skill status imports it. It cannot influence a
 * decision because there is nothing for a decision to read: the data goes one way,
 * into a table, and the only consumer is a research query.
 *
 * WHY IT IS SAMPLED PER MINUTE. One row per horizon per window-minute - about 45
 * rows per fifteen-minute window - is enough to see the divergence develop through
 * a window without turning the brain loop into a write loop - it polls every 4s, or
 * 2.5s in beast mode, so that would otherwise be 15 to 24 redundant sample-sets a
 * minute. The sample key is
 * deterministic, so a restart inside a minute replays the same key and `on conflict
 * do nothing` keeps the first observation. The desk's own reading is never revised
 * after the fact.
 *
 * WHAT IT REFUSES. Demo snapshots, because demo timestamps are synthetic and would
 * pollute a real distribution with invented spacing. Windows with no usable key.
 * And it swallows its own errors: a failed shadow write must never be able to
 * disturb a brain tick, because the measurement is worth strictly less than the
 * desk it is measuring.
 */
import { getSql } from "@/lib/db";
import { parity, type Parity } from "./path-time";
import type { CandleTsTally } from "./candle-time";
import type { Snapshot } from "./types";

/**
 * Stamped on every row. Bumped by hand only when the measurement itself changes in
 * a way that makes earlier rows incomparable - not on every deploy, or a build that
 * changed nothing about the measurement would look like a different study.
 */
export const PATH_RESEARCH_VERSION = "path-1";

/** One sample per horizon per window-minute. */
export const SAMPLE_BUCKET_MS = 60_000;

/** Deterministic, so a replay after a restart recomputes the same key. */
export function sampleKey(
  ticker: string,
  closeMs: number,
  atMs: number,
  horizon: string,
): string {
  return `${ticker}|${closeMs}|${Math.floor(atMs / SAMPLE_BUCKET_MS)}|${horizon}`;
}

/** Everything the write needs, so the caller hands over facts rather than a live object. */
export type ParitySample = {
  ticker: string;
  closeMs: number;
  atMs: number;
  /** The bare array production reads today. */
  path: readonly number[];
  /** The timestamped twin. */
  points: Snapshot["yes_mid_path_pts"];
  candle_ts: CandleTsTally;
  phase: string;
  secs_left: number;
  /** What the Chair was saying, for context only. Read, never written back. */
  chair_decision: string;
};

/**
 * Record one sample-set: three horizons, each with BOTH readings and the reason each
 * is what it is.
 *
 * Returns void deliberately. There is no success value a caller could act on, which
 * is the cheapest possible guarantee that the shadow cannot steer anything.
 */
export async function recordPathParity(s: ParitySample): Promise<void> {
  if (!s.ticker || !Number.isFinite(s.closeMs) || s.closeMs <= 0) return;
  // `atMs` feeds both the sample key and a toISOString, which THROWS on a non-finite
  // value. The throw would land in the silent catch below and lose every row without
  // a trace, so it is refused up front instead.
  if (!Number.isFinite(s.atMs) || s.atMs <= 0) return;
  // Demo paths carry invented spacing; they must never enter a research table.
  if (s.ticker.includes("DEMO")) return;

  // The tick's own clock is passed so the newest sample's staleness is recorded.
  const rows: Parity[] = parity(s.path, s.points, s.atMs);
  if (!rows.length) return;

  try {
    const db = await getSql();
    const closeIso = new Date(s.closeMs).toISOString();
    const atIso = new Date(s.atMs).toISOString();
    const minute = Math.floor(s.atMs / SAMPLE_BUCKET_MS);
    const fields = s.candle_ts.fields.join("+");
    // Present-but-broken and absent are stored apart: "absent" sends someone hunting
    // for a field name, "bad" says the field is there and its value is wrong.
    const bad = s.candle_ts.unparseable + s.candle_ts.implausible;

    for (const r of rows) {
      await db`
        insert into desk_path_parity (
          sample_key, ticker, close_time, sampled_at, sample_minute,
          horizon, want_ms, legacy_back,
          legacy_delta, legacy_state,
          true_delta, true_state,
          signed_divergence, abs_divergence, divergence_state,
          span_ms, overshoot_ms, legacy_span_ms, legacy_overshoot_ms, legacy_span_aligned,
          available_ms, coverage_ok, newest_t, newest_age_ms,
          anchor_t, anchor_age_ms, decision_overshoot_ms, decision_fidelity,
          source_mix, points_used,
          points_dropped_non_finite, points_dropped_non_positive, points_collapsed_duplicate,
          candle_rows_priced, candle_rows_timed, candle_ts_fields,
          candle_ts_absent, candle_ts_bad, candle_ts_start_adjusted,
          window_phase, secs_left, chair_decision,
          research_version
        ) values (
          ${sampleKey(s.ticker, s.closeMs, s.atMs, r.horizon)},
          ${s.ticker}, ${closeIso}, ${atIso}, ${minute},
          ${r.horizon}, ${r.want_ms}, ${r.legacy_back},
          ${r.legacy_delta}, ${r.legacy_state},
          ${r.true_delta}, ${r.true_state},
          ${r.signed_divergence}, ${r.abs_divergence}, ${r.divergence_state},
          ${r.span_ms}, ${r.overshoot_ms}, ${r.legacy_span_ms}, ${r.legacy_overshoot_ms},
          ${r.legacy_span_aligned},
          ${r.available_ms}, ${r.coverage_ok},
          ${r.newest_t == null ? null : new Date(r.newest_t).toISOString()}, ${r.newest_age_ms},
          ${r.anchor_t == null ? null : new Date(r.anchor_t).toISOString()},
          ${r.anchor_age_ms}, ${r.decision_overshoot_ms}, ${r.decision_fidelity},
          ${r.source_mix}, ${r.points_used},
          ${r.points_dropped_non_finite}, ${r.points_dropped_non_positive},
          ${r.points_collapsed_duplicate},
          ${s.candle_ts.rows_priced}, ${s.candle_ts.rows_timed}, ${fields},
          ${s.candle_ts.absent}, ${bad}, ${s.candle_ts.start_adjusted},
          ${s.phase}, ${int(s.secs_left)}, ${s.chair_decision},
          ${PATH_RESEARCH_VERSION}
        )
        on conflict (sample_key) do nothing
      `;
    }
  } catch {
    // Deliberately silent. A shadow measurement that can break a brain tick is worse
    // than no measurement at all.
  }
}

/** What the horizon study looks like so far. Read-only, admin-gated at the route. */
export type ParityStanding = {
  horizon: string;
  samples: number;
  /** THE COUNTER: how often the DSL-facing value is non-finite. */
  legacy_non_finite: number;
  legacy_short_path: number;
  legacy_numeric: number;
  true_numeric: number;
  true_no_coverage: number;
  true_empty: number;
  measured: number;
  median_abs_divergence: number | null;
  p90_abs_divergence: number | null;
  mean_signed_divergence: number | null;
  /** The finding in one number: what the offset actually spans, typically. */
  median_legacy_span_ms: number | null;
  median_true_span_ms: number | null;
  /**
   * median(span_ms) - want_ms. The figure a consumer flip turns on: a horizon whose
   * true span typically overshoots by most of itself is not honestly supportable
   * from this source, whatever the label says.
   */
  median_overshoot_ms: number | null;
  p90_overshoot_ms: number | null;
  median_legacy_overshoot_ms: number | null;
  /** How stale the newest sample typically was at the decision tick. */
  median_newest_age_ms: number | null;
  p90_newest_age_ms: number | null;
  /**
   * (3) DECISION-HORIZON FIDELITY, counted by structural class rather than against a
   * freshness cutoff. `end_shifted` is the one that matters: those rows may have a
   * perfect `span_ms` while describing an interval that ended in the past.
   */
  decision_aligned: number;
  end_shifted: number;
  /** Newest stamp ahead of the tick: feed clock skew, not staleness. */
  end_ahead: number;
  /**
   * No decision clock, so the fidelity question is unanswered. Kept apart from the
   * others because "unknown" is not "fresh" - folding a missing age into zero would be
   * the same collapse of null into a number that this whole study exists to stop.
   */
  fidelity_unknown: number;
  /**
   * How far the covered interval's START typically sat from where the label claims it
   * is: median(newest_age_ms + overshoot_ms). This, not median_overshoot_ms, is the
   * number that says whether a horizon is decision-faithful.
   */
  median_decision_overshoot_ms: number | null;
  p90_decision_overshoot_ms: number | null;
  /** Samples where no honest legacy span existed because the arrays were unaligned. */
  legacy_span_unaligned: number;
  candle_ts_unreadable: number;
};

/**
 * A finite integer or null, never NaN.
 *
 * Postgres rejects NaN for an `integer` column, and this module's catch is
 * deliberately silent - so an unguarded `Math.round(NaN)` would lose every row of a
 * sample set with no error anywhere. A measurement that can disappear quietly is
 * worse than one that is absent loudly, so a bad number becomes an explicit null.
 */
function int(v: number): number | null {
  return Number.isFinite(v) ? Math.round(v) : null;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const v = lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
  return Math.round(v * 100) / 100;
}

/**
 * The study so far, per horizon, from valid windows only.
 *
 * Deliberately reads the research VIEW, so quarantined windows are excluded on the
 * same rule as every other research read.
 *
 * THE VIEW LAGS BY ONE WINDOW, BY DESIGN. It inner-joins desk_ledger, and a ledger
 * row only exists once a window has GRADED. Samples are written during the window,
 * so the window in flight contributes nothing here until it settles. That is correct
 * for a research read - an ungraded window is not evidence - but it means a
 * just-deployed desk reports zero samples for up to fifteen minutes. Verifying that
 * writes are landing is a question for the base table, not for this function.
 */
export async function parityStanding(days = 30): Promise<ParityStanding[]> {
  const db = await getSql();
  const rows = await db<{
    horizon: string;
    legacy_state: string;
    true_state: string;
    divergence_state: string;
    abs_divergence: number | null;
    signed_divergence: number | null;
    legacy_span_ms: number | null;
    span_ms: number | null;
    overshoot_ms: number | null;
    legacy_overshoot_ms: number | null;
    newest_age_ms: number | null;
    anchor_age_ms: number | null;
    decision_overshoot_ms: number | null;
    decision_fidelity: string;
    legacy_span_aligned: boolean;
    candle_rows_priced: number;
    candle_rows_timed: number;
  }>`
    select horizon, legacy_state, true_state, divergence_state,
           abs_divergence, signed_divergence, legacy_span_ms, span_ms,
           overshoot_ms, legacy_overshoot_ms, newest_age_ms,
           anchor_age_ms, decision_overshoot_ms, decision_fidelity, legacy_span_aligned,
           candle_rows_priced, candle_rows_timed
      from desk_path_parity_research
     where sampled_at > now() - (${days}::text || ' days')::interval
  `;

  const byH = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byH.get(r.horizon) ?? [];
    list.push(r);
    byH.set(r.horizon, list);
  }

  return [...byH.entries()]
    .map(([horizon, list]) => {
      const abs = list
        .map((r) => r.abs_divergence)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      const signed = list.map((r) => r.signed_divergence).filter((v): v is number => v != null);
      const legSpan = list
        .map((r) => r.legacy_span_ms)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      const trueSpan = list
        .map((r) => r.span_ms)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      const sortedNums = (pick: (r: (typeof list)[number]) => number | null) =>
        list
          .map(pick)
          .filter((v): v is number => v != null)
          .sort((a, b) => a - b);
      const over = sortedNums((r) => r.overshoot_ms);
      const decOver = sortedNums((r) => r.decision_overshoot_ms);
      const legOver = sortedNums((r) => r.legacy_overshoot_ms);
      // Negative ages are feed clock skew, not staleness; they are counted separately
      // rather than dragging the staleness median toward zero.
      const age = sortedNums((r) => (r.newest_age_ms != null && r.newest_age_ms >= 0 ? r.newest_age_ms : null));
      const count = (f: (r: (typeof list)[number]) => boolean) => list.filter(f).length;
      return {
        horizon,
        samples: list.length,
        legacy_non_finite: count((r) => r.legacy_state === "non-finite"),
        legacy_short_path: count((r) => r.legacy_state === "short-path"),
        legacy_numeric: count((r) => r.legacy_state === "numeric"),
        true_numeric: count((r) => r.true_state === "numeric"),
        true_no_coverage: count((r) => r.true_state === "no-coverage"),
        true_empty: count((r) => r.true_state === "empty"),
        measured: count((r) => r.divergence_state === "measured"),
        median_abs_divergence: quantile(abs, 0.5),
        p90_abs_divergence: quantile(abs, 0.9),
        mean_signed_divergence: signed.length
          ? Math.round((signed.reduce((a, b) => a + b, 0) / signed.length) * 100) / 100
          : null,
        median_legacy_span_ms: quantile(legSpan, 0.5),
        median_true_span_ms: quantile(trueSpan, 0.5),
        median_overshoot_ms: quantile(over, 0.5),
        p90_overshoot_ms: quantile(over, 0.9),
        median_legacy_overshoot_ms: quantile(legOver, 0.5),
        median_newest_age_ms: quantile(age, 0.5),
        p90_newest_age_ms: quantile(age, 0.9),
        decision_aligned: count((r) => r.decision_fidelity === "decision-aligned"),
        end_shifted: count((r) => r.decision_fidelity === "end-shifted"),
        end_ahead: count((r) => r.decision_fidelity === "end-ahead"),
        fidelity_unknown: count((r) => r.decision_fidelity === "unknown"),
        median_decision_overshoot_ms: quantile(decOver, 0.5),
        p90_decision_overshoot_ms: quantile(decOver, 0.9),
        legacy_span_unaligned: count((r) => r.legacy_span_aligned === false),
        candle_ts_unreadable: count((r) => r.candle_rows_priced > r.candle_rows_timed),
      };
    })
    .sort((a, b) => a.horizon.localeCompare(b.horizon));
}
