/**
 * Movement over a real elapsed interval, rather than over a count of array slots.
 *
 * WHY THIS EXISTS. `snap.yes_mid_path` is a bare `number[]` with no time on it, and
 * four consumers read fixed offsets as if they were fixed horizons:
 *
 *   d30  = path[last] - path[last - 4]
 *   d60  = path[last] - path[last - 6]
 *   d120 = path[last] - path[last - 10]
 *
 * MIND THE OFF-BY-ONE GAP. The anchor index is `length - back` and the newest is
 * `length - 1`, so `back` slots back crosses `back - 1` GAPS, not `back`. Every span
 * below follows from that, and getting it wrong overstates the defect by one
 * interval - so the implied sample intervals are ms/(back-1): 30/3 = 10s,
 * 60/5 = 12s, 120/9 = 13.33s. Three different intervals for three readings from one
 * array, which is incoherent before reality is consulted.
 *
 * And the reality is worse: the path is normally built from Kalshi candlesticks
 * requested at `period_interval=1`, which is ONE MINUTE per point. Sixteen minutes
 * of those is ~16 points, so the `length >= 4` branch in live.ts is the usual case,
 * not the fallback. Under normal feed conditions:
 *
 *   "d30"  spans 3 minutes  (3 gaps x 60s)  - 6x its name
 *   "d60"  spans 5 minutes  (5 gaps x 60s)  - 5x its name
 *   "d120" spans 9 minutes  (9 gaps x 60s)  - 4.5x its name
 *
 * On a fifteen-minute market, a quantity called "one minute of movement" is actually
 * a third of the window. The per-tick fallback (~4s) is the rare path, and there the
 * same offsets span 12, 20 and 36 seconds - so a single named quantity ranges over
 * about 15x (the ratio of the slot widths, 60s/4s) depending only on which branch
 * ran - and 24x while the desk is in beast mode, where the loop polls every 2.5s. The labels are therefore not merely approximate; they name materially
 * different horizons.
 *
 * (features.ts has a FOURTH variant, and the d30 row below does NOT describe it. It
 * reads `path[last] - path[Math.max(0, length - 4)]` guarded at `length >= 2`, so
 * where dsl.ts and bots.ts return 0 on a path shorter than 4 slots, features.ts clamps
 * to index 0 and returns a real number measured over the WHOLE path. On a short path
 * the study's d30 row therefore reports `short-path` while features.ts was acting on a
 * live value. It feeds `spot_lead_bps` rather than a d30 threshold, and it is left
 * alone here - noted so the inventory is honest about what the study does and does not
 * cover.)
 *
 * WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO. It answers "how much did
 * this move in the last N milliseconds" from timestamps, and it says so explicitly
 * when the path cannot answer - when nothing is old enough to anchor the interval.
 * It never interpolates, never extrapolates, and never substitutes the oldest
 * available point for the one it wanted. An unavailable measurement is a fact to
 * record, not a gap to paper over: approximating here is how the original bug
 * became invisible.
 *
 * A TRUE READING IS STILL NOT THE NUMBER ON THE LABEL. Three separate questions,
 * each answered by its own field rather than left for a reader to assume away. They
 * are independent: a reading can pass any one and fail the others, so collapsing them
 * is how "span_ms is 60000" becomes the false claim "this is the last 60 seconds".
 *
 *   (1) SPAN COVERAGE     was there an anchor at least the requested interval behind
 *                         the newest point?  -> true_state, coverage_ok, overshoot_ms
 *   (2) ENDPOINT FRESHNESS how stale was the newest point at the decision moment?
 *                         -> newest_age_ms
 *   (3) DECISION-HORIZON  does the reading actually cover `as_of - horizon -> as_of`,
 *       FIDELITY          or an older interval of the right length?
 *                         -> anchor_age_ms, decision_overshoot_ms, decision_fidelity
 *
 * The worked case that forces the distinction: the newest 1-minute candle is 45s old
 * and the anchor is 60s behind it. Then span_ms = 60000 and overshoot_ms = 0 - which
 * looks exact - but the interval measured is roughly t-105s to t-45s, not t-60s to t.
 * Zero span overshoot must never be read as exact horizon coverage.
 *
 * The two reasons span coverage alone is not enough:
 *
 *   1. SPAN OVERSHOOT. The anchor is a real sample, so the span is whatever the
 *      sampling grid allows: it lands on the request only when the grid happens to
 *      divide it, and overshoots otherwise. On 1-minute candles a requested 30s can
 *      only anchor to a point ~60s old, so `span_ms` is ~60_000 against a `want_ms`
 *      of 30_000. That result is honest and usable, but it is not a 30-second
 *      observation and must never be labelled one. `overshoot_ms` makes the gap
 *      explicit: ~+30_000 (100%) for d30 on candles, ~0 for d60.
 *
 *      Stated precisely: 30s is NOT EXACTLY REPRESENTABLE on a pure 1-minute candle
 *      grid. A coarse historical approximation does exist - the 60s span above - so
 *      the claim is not that nothing can be computed; it is that what can be computed
 *      is not a faithful 30-second decision-time measurement. 60s and 120s divide the
 *      grid and so are exactly representable in SPAN, which says nothing yet about
 *      whether they are decision-aligned - see (2) and (3).
 *
 *   2. END-STALENESS, and therefore a SHIFTED INTERVAL. The reading ends at the
 *      newest SAMPLE, not at now. With 1-minute candles that sample can itself be
 *      most of a minute old, so a "last 60 seconds" reading may really describe the
 *      minute before last. `newest_age_ms` measures the end against the decision
 *      tick; `anchor_age_ms` measures the start; and `decision_overshoot_ms`
 *      (anchor_age_ms - want_ms) says how far the covered interval's START sits from
 *      where the label claims it is. The identity worth remembering:
 *
 *        anchor_age_ms        = newest_age_ms + span_ms
 *        decision_overshoot_ms = newest_age_ms + overshoot_ms
 *
 *      So a perfectly-divided span (overshoot 0) on a 45s-stale endpoint still has a
 *      45s decision overshoot, and the fidelity field names that rather than hiding
 *      it behind a zero.
 *
 * None of this is corrected here, and NO freshness cutoff is chosen: `decision_fidelity`
 * is structural (does the interval end AT the decision moment, before it, or after it)
 * rather than tuned, and the magnitudes are stored so a reader can decide what matters
 * later. Correcting or thresholding silently is precisely the move that made the
 * original defect invisible; these are measured and reported instead.
 *
 * EVERY OUTCOME IS NAMED. A shadow row must never leave "0", "null" and "NaN"
 * meaning the same thing, because they mean three different things operationally:
 * a flat tape, an unavailable measurement, and a comparison that silently reads as
 * quiet. Hence `LegacyState` and `TrueState` below: the number and the reason it
 * is that number are stored side by side.
 *
 * NOTHING READS THIS YET. No seat, DSL rule, threshold, Chair input, learned
 * weight or skill status consults it. It exists so the divergence from the
 * index-based readings can be measured prospectively, before anyone decides
 * whether to migrate - because migrating changes the meaning of every calibration
 * record learned against the old numbers, and that is a separate, explicit
 * decision with its own research-era boundary.
 *
 * Pure module: no clock, no state, no database.
 */

/** Where a point came from. Recorded per point so a mixed path is legible. */
export type PathSource =
  /** A Kalshi candlestick close, carrying the candle's own period timestamp. */
  | "candle"
  /** One brain tick's midpoint, timestamped by the snapshot. */
  | "tick";

/** One price with the moment it belongs to. */
export type PathPoint = {
  /** Absolute ms since the epoch, UTC. */
  t: number;
  /** Cents. */
  px: number;
  source: PathSource;
};

/**
 * What the index-based reading actually produced. Three distinct outcomes that
 * production collapses into one `number`, kept apart here:
 *
 *   - "numeric"     two real slots subtracted. The value means what it says.
 *   - "short-path"  production's `: 0` branch. Consumers receive 0 and cannot
 *                   distinguish it from a genuinely flat tape, so the 0 is real
 *                   input to real thresholds - it is not a missing value.
 *   - "non-finite"  NaN or Infinity propagated out of the subtraction. Downstream,
 *                   `Math.abs(NaN) >= k` is FALSE, so every threshold reads
 *                   "quiet tape" when the truth is "unknown". This is the state
 *                   worth counting in production.
 */
export type LegacyState = "numeric" | "short-path" | "non-finite";

/**
 * What an elapsed-time reading produced.
 *
 *   - "numeric"      a real anchor at or beyond the requested age was found.
 *   - "no-coverage"  usable points exist, but none old enough. The shortfall is
 *                    reported as `available_ms` rather than approximated.
 *   - "empty"        no usable points at all, after non-finite and non-positive
 *                    inputs were dropped.
 */
export type TrueState = "numeric" | "no-coverage" | "empty";

/**
 * Why a divergence is or is not a number. Without this, a null divergence could
 * mean the old reading was NaN, or the new one was unavailable, or both - and
 * those have different remedies.
 */
export type DivergenceState =
  | "measured"
  | "legacy-non-finite"
  | "true-unavailable"
  | "both-unavailable";

/**
 * A measurement over an elapsed interval, or the reason there wasn't one.
 *
 * `ok: false` is the honest answer when the path does not reach back far enough.
 * The span it *could* cover is still reported, so "how often was a real 60s
 * measurement available?" is answerable from stored rows rather than guessed at.
 */
export type Move =
  | {
      ok: true;
      /** Cents moved from the anchor to the newest point. */
      delta: number;
      /** Actual ms between the two points used - never the requested window. */
      span_ms: number;
      /** The horizon asked for, for comparison against span_ms. */
      want_ms: number;
      /** Timestamps of the two points used. */
      from_t: number;
      to_t: number;
      /** Which sources the two points came from. */
      from_source: PathSource;
      to_source: PathSource;
    }
  | {
      ok: false;
      want_ms: number;
      /** How far back the path actually reaches, so the shortfall is visible. */
      available_ms: number;
      why: "empty" | "not-enough-history";
    };

/**
 * What cleaning the input cost, so a thin true-time reading can be explained.
 *
 * A non-finite timestamp or price on the way IN is a feed defect, distinct from a
 * path that is merely short. Counted rather than discarded quietly.
 */
export type Sanitised = {
  points: PathPoint[];
  /** Points rejected for a non-finite `t` or `px`. */
  dropped_non_finite: number;
  /** Points rejected for a non-positive price - 0c is not a tradeable mid. */
  dropped_non_positive: number;
  /** Points that collided on an existing timestamp and replaced it. */
  collapsed_duplicate: number;
};

/**
 * Drop what cannot be measured, collapse duplicate instants, sort oldest-first -
 * and report what that cost.
 */
export function sanitise(points: readonly PathPoint[]): Sanitised {
  const byT = new Map<number, PathPoint>();
  let nonFinite = 0;
  let nonPositive = 0;
  let dupes = 0;
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.px)) {
      nonFinite++;
      continue;
    }
    if (!(p.px > 0)) {
      nonPositive++;
      continue;
    }
    // A later point for the same instant replaces the earlier: two readings for one
    // moment is a feed artefact, and averaging them would invent a third price.
    if (byT.has(p.t)) dupes++;
    byT.set(p.t, p);
  }
  return {
    points: [...byT.values()].sort((a, b) => a.t - b.t),
    dropped_non_finite: nonFinite,
    dropped_non_positive: nonPositive,
    collapsed_duplicate: dupes,
  };
}

/** Newest-last, duplicate timestamps collapsed to the last value seen for that instant. */
export function normalise(points: readonly PathPoint[]): PathPoint[] {
  return sanitise(points).points;
}

/**
 * How much the newest point moved relative to the newest point at least `ms` old.
 *
 * The anchor is the LATEST point whose age is >= ms - the tightest honest answer.
 * Taking the oldest available point instead would silently widen the horizon, which
 * is the original bug in a different costume.
 */
export function moveOver(points: readonly PathPoint[], ms: number): Move {
  const pts = normalise(points);
  if (!pts.length) return { ok: false, want_ms: ms, available_ms: 0, why: "empty" };
  const newest = pts[pts.length - 1]!;
  const oldest = pts[0]!;
  const available = newest.t - oldest.t;

  let anchor: PathPoint | null = null;
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    if (newest.t - p.t >= ms) {
      anchor = p;
      break;
    }
  }
  if (!anchor) return { ok: false, want_ms: ms, available_ms: available, why: "not-enough-history" };

  return {
    ok: true,
    delta: Math.round((newest.px - anchor.px) * 10) / 10,
    span_ms: newest.t - anchor.t,
    want_ms: ms,
    from_t: anchor.t,
    to_t: newest.t,
    from_source: anchor.source,
    to_source: newest.source,
  };
}

/**
 * The index-based reading the desk computes today, reproduced EXACTLY.
 *
 * Two production behaviours are preserved deliberately, because a tidied-up
 * comparison would not be a comparison against production:
 *
 *   - the `0` returned when the path is too short, which consumers do see; and
 *   - NaN. `path[last] - path[last - back]` has no finite guard, so a non-finite
 *     value propagates - and a NaN then makes every threshold downstream silently
 *     FALSE, because `Math.abs(NaN) >= 8` is false. The seat reads "no meaningful
 *     move" when the truth is "unknown". An earlier version of this helper returned
 *     0 there and was therefore describing a desk that does not exist.
 *
 * Callers must check `Number.isFinite` on the result, or use `legacyRead`, which
 * classifies it.
 */
export function legacyMove(path: readonly number[], back: number): number {
  if (path.length < back) return 0;
  const a = Number(path[path.length - 1]);
  const b = Number(path[path.length - back]);
  // NOT guarded, because production is not guarded. See the note above: a
  // non-finite value propagates, and callers must check Number.isFinite.
  const d = a - b;
  return Number.isFinite(d) ? Math.round(d * 10) / 10 : d;
}

/** The legacy reading with its outcome named, so a 0 is never mistaken for a gap. */
export function legacyRead(
  path: readonly number[],
  back: number,
): { value: number; state: LegacyState } {
  // Checked before calling, because the short-path branch returns a 0 that is
  // indistinguishable from a flat tape once it leaves the function.
  if (path.length < back) return { value: 0, state: "short-path" };
  const v = legacyMove(path, back);
  return Number.isFinite(v) ? { value: v, state: "numeric" } : { value: v, state: "non-finite" };
}

/**
 * The three horizons as the codebase names them, with the offsets it uses.
 *
 * Frozen together so the comparison is against what production actually does,
 * not against a tidied-up version of it. The offsets are from bots.ts, tape.ts
 * and dsl.ts; `d60` is the only one all three share.
 */
export const HORIZONS = Object.freeze([
  Object.freeze({ name: "d30", ms: 30_000, legacy_back: 4 }),
  Object.freeze({ name: "d60", ms: 60_000, legacy_back: 6 }),
  Object.freeze({ name: "d120", ms: 120_000, legacy_back: 10 }),
]);

/**
 * Where the reading's interval sits relative to the decision moment. STRUCTURAL, not
 * tuned: no freshness cutoff is chosen here, because choosing one would be a policy
 * decision and this change makes none. The magnitude of any shift is carried by
 * `newest_age_ms` and `decision_overshoot_ms`, so a reader decides what is tolerable.
 *
 *   "decision-aligned"  the interval ends exactly at `as_of`. In practice this is the
 *                       per-tick feed, whose newest point IS the tick.
 *   "end-shifted"       the interval ends in the past, so it describes
 *                       `as_of - anchor_age -> as_of - newest_age`, NOT
 *                       `as_of - want -> as_of`. In practice this is the candle feed.
 *   "end-ahead"         the newest stamp is ahead of the tick: feed clock skew.
 *   "unknown"           no decision clock was supplied, so the question is unanswered -
 *                       which is not the same as answered favourably.
 */
export type DecisionFidelity = "decision-aligned" | "end-shifted" | "end-ahead" | "unknown";

export type Parity = {
  horizon: string;
  want_ms: number;
  legacy_back: number;

  /**
   * What production reads today, VERBATIM - including its 0 and its NaN. Null only
   * when the value is non-finite and therefore not storable as a number; `legacy_state`
   * says which of the three outcomes produced it, so no two are ever conflated.
   */
  legacy_delta: number | null;
  legacy_state: LegacyState;
  /**
   * Kept as a plain boolean as well as in `legacy_state`, because "how often is the
   * DSL-facing value non-finite?" is the one production counter worth watching: a
   * non-finite d60 reads downstream as a quiet tape, not as an error.
   */
  legacy_finite: boolean;

  /** What an elapsed-time reading gives, when one is available. Null otherwise. */
  true_delta: number | null;
  true_state: TrueState;

  /** true_delta - legacy_delta, sign kept: which way the old reading was wrong. */
  signed_divergence: number | null;
  abs_divergence: number | null;
  /** Why the divergence is or is not a number. */
  divergence_state: DivergenceState;

  /**
   * Actual ms the true reading spanned. NOT SAFE to assume equal to `want_ms`: the
   * anchor is a real sample, so the span is whatever the sampling grid allows. It
   * lands exactly on the request when the grid happens to divide it - 60s and 120s do
   * on 1-minute candles - and overshoots otherwise, as a requested 30s does onto 60s.
   * A reader must use THIS, never `want_ms`, to say what was measured.
   */
  span_ms: number | null;
  /**
   * span_ms - want_ms. Always >= 0 when coverage_ok, because the anchor is the
   * latest point AT OR BEYOND the requested age - the helper overshoots rather than
   * undershooting, and never interpolates to hit the number exactly.
   *
   * On 1-minute candles a requested 30s overshoots by ~30_000, i.e. 100%, so 30s is
   * not EXACTLY REPRESENTABLE there - a coarse historical approximation exists, it is
   * just not a faithful 30-second measurement. 60s and 120s overshoot by ~0 because the
   * grid divides them.
   *
   * NOT sufficient on its own to judge whether a consumer flip can honestly carry a
   * 30s/60s/120s label: that also needs `decision_overshoot_ms`, because an exactly-60s
   * span measured off a 45s-stale endpoint is still not the last 60 seconds.
   */
  overshoot_ms: number | null;
  /** Whether a real measurement at this horizon was available at all. */
  coverage_ok: boolean;
  /** How far back the path reached, so a shortfall is quantified. */
  available_ms: number;
  /**
   * The elapsed span the index offset actually covered - BUT ONLY when the timestamped
   * path is slot-for-slot aligned with the bare array the legacy read subtracted.
   *
   * WHY THE GUARD. `legacy_delta` comes from `path` (the bare array) while the only
   * timestamps available live on `points`. If the two differ in length - a candle
   * priced but with an unreadable timestamp, or two readings collapsed onto one
   * instant - then slot i of one is not slot i of the other, and a span measured from
   * the timestamps would describe a DIFFERENT pair of slots than the subtraction used.
   * Reporting that as "what the offset spanned" would be a confident wrong number in
   * exactly the failure mode this whole study exists to detect, so it is null instead.
   */
  legacy_span_ms: number | null;
  /** legacy_span_ms - want_ms: the headline finding as a number, per horizon. */
  legacy_overshoot_ms: number | null;
  /**
   * Whether the bare array and the timestamped path had the same length, i.e. whether
   * the legacy span above is even answerable. False is itself a finding: it means the
   * feed delivered prices the desk used and timestamps it could not read.
   */
  legacy_span_aligned: boolean;

  /**
   * (3) DECISION-HORIZON FIDELITY. The reading's START relative to the decision
   * moment, which is the quantity a consumer would actually want and the one
   * `span_ms` cannot express.
   *
   * The reading covers `[as_of - anchor_age_ms, as_of - newest_age_ms]`. The label
   * claims `[as_of - want_ms, as_of]`. `decision_overshoot_ms` is the gap at the
   * start; `newest_age_ms` is the gap at the end. Either being non-zero means the
   * label is not describing the interval.
   *
   * Identities, asserted in the tests so a reader can trust them:
   *   anchor_age_ms         = newest_age_ms + span_ms
   *   decision_overshoot_ms = newest_age_ms + overshoot_ms
   *
   * Null when no decision clock was supplied.
   */
  anchor_t: number | null;
  anchor_age_ms: number | null;
  decision_overshoot_ms: number | null;
  /** Structural, never tuned: see DecisionFidelity. */
  decision_fidelity: DecisionFidelity;

  /**
   * (2) ENDPOINT FRESHNESS. Timestamp of the newest point used, and its age at the
   * decision moment.
   *
   * WHY THIS IS NOT OPTIONAL. `moveOver` measures the path's OWN last N ms, ending
   * at the newest SAMPLE - not ending at now. With 1-minute candles that newest
   * sample can itself be most of a minute old, so a "last 60 seconds" reading can
   * really describe the minute BEFORE last. Without this field a row would look like
   * a measurement about the present when it is a measurement about the recent past,
   * which is the same species of error as the index offsets themselves.
   *
   * Null when no clock was supplied to `parity`.
   */
  newest_t: number | null;
  newest_age_ms: number | null;

  /** e.g. "candle" or "candle+tick". */
  source_mix: string;
  /** Usable timestamped points behind the true reading. */
  points_used: number;
  /** Inputs dropped for a non-finite t or px - a feed defect, not a short path. */
  points_dropped_non_finite: number;
  /** Inputs dropped for a non-positive price. */
  points_dropped_non_positive: number;
  /** Duplicate instants collapsed. */
  points_collapsed_duplicate: number;
};

/**
 * Compare, per horizon, what the desk reads today against what the clock says.
 *
 * Returns both numbers, the reason each is what it is, and the coverage facts, so a
 * later era decision rests on "how different, how often, and how often measurable"
 * rather than on one example.
 */
export function parity(
  path: readonly number[],
  points: readonly PathPoint[],
  /**
   * The decision moment, so the newest sample's staleness is recorded. Optional only
   * so the pure helper stays testable without a clock; the shadow writer always
   * supplies the tick's own `as_of`.
   */
  nowMs?: number,
): Parity[] {
  const clean = sanitise(points);
  const pts = clean.points;
  const mix = [...new Set(pts.map((p) => p.source))].sort().join("+") || "none";
  const available = pts.length >= 2 ? pts[pts.length - 1]!.t - pts[0]!.t : 0;
  const newestT = pts.length ? pts[pts.length - 1]!.t : null;
  const haveClock = nowMs != null && Number.isFinite(nowMs);
  const newestAge = newestT != null && haveClock ? nowMs! - newestT : null;

  return HORIZONS.map((h) => {
    const legacy = legacyRead(path, h.legacy_back);
    const legacyFinite = legacy.state !== "non-finite";
    // Slot-for-slot alignment is a precondition for the legacy span, not a hope.
    const aligned = pts.length === path.length;
    const legSpan = aligned ? legacySpanMs(pts, h.legacy_back) : null;
    const m = moveOver(pts, h.ms);
    const trueDelta = m.ok ? m.delta : null;
    const trueState: TrueState = m.ok ? "numeric" : pts.length ? "no-coverage" : "empty";

    // A divergence needs two numbers. A non-finite legacy reading has no difference
    // from anything, and recording one would imply the old value was a number. The
    // short-path 0 DOES get a divergence: consumers act on that 0.
    const divergence_state: DivergenceState =
      !legacyFinite && trueDelta == null
        ? "both-unavailable"
        : !legacyFinite
          ? "legacy-non-finite"
          : trueDelta == null
            ? "true-unavailable"
            : "measured";
    const comparable = divergence_state === "measured";

    return {
      horizon: h.name,
      want_ms: h.ms,
      legacy_back: h.legacy_back,
      legacy_delta: legacyFinite ? legacy.value : null,
      legacy_state: legacy.state,
      legacy_finite: legacyFinite,
      true_delta: trueDelta,
      true_state: trueState,
      signed_divergence: comparable ? Math.round((trueDelta! - legacy.value) * 10) / 10 : null,
      abs_divergence: comparable ? Math.round(Math.abs(trueDelta! - legacy.value) * 10) / 10 : null,
      divergence_state,
      span_ms: m.ok ? m.span_ms : null,
      overshoot_ms: m.ok ? m.span_ms - h.ms : null,
      anchor_t: m.ok ? m.from_t : null,
      // Measured from the decision clock, not inferred from the span: the whole point
      // is that the span can be exact while the interval is shifted into the past.
      anchor_age_ms: m.ok && haveClock ? nowMs! - m.from_t : null,
      decision_overshoot_ms: m.ok && haveClock ? nowMs! - m.from_t - h.ms : null,
      decision_fidelity: !haveClock
        ? "unknown"
        : newestAge == null
          ? "unknown"
          : newestAge === 0
            ? "decision-aligned"
            : newestAge > 0
              ? "end-shifted"
              : "end-ahead",
      coverage_ok: m.ok,
      available_ms: available,
      legacy_span_ms: legSpan,
      legacy_overshoot_ms: legSpan == null ? null : legSpan - h.ms,
      legacy_span_aligned: aligned,
      newest_t: newestT,
      newest_age_ms: newestAge,
      source_mix: mix,
      points_used: pts.length,
      points_dropped_non_finite: clean.dropped_non_finite,
      points_dropped_non_positive: clean.dropped_non_positive,
      points_collapsed_duplicate: clean.collapsed_duplicate,
    };
  });
}

/**
 * The elapsed span the index offsets actually cover, for the record.
 *
 * This is the number that makes the finding concrete: with 1-minute candles,
 * `legacy_back: 6` - the offset labelled d60 - spans FIVE minutes, because six slots
 * back crosses five gaps. Five minutes against a sixty-second label.
 */
export function legacySpanMs(points: readonly PathPoint[], back: number): number | null {
  const pts = normalise(points);
  if (pts.length < back) return null;
  const newest = pts[pts.length - 1]!;
  const anchor = pts[pts.length - back]!;
  return newest.t - anchor.t;
}
