/**
 * The two statements Hour Research writes with. Pure text, no imports.
 *
 * WHY THEY LIVE HERE. Their correctness is a property of the SQL itself — which
 * columns move together, which conflict clause admits a write — and that cannot
 * be checked by reading the TypeScript around them. Keeping the statements in
 * one importable place lets a test run the REAL text against a real database
 * instead of asserting against a copy that can drift from what ships.
 *
 * Nothing here executes anything, connects to anything, or decides anything.
 */

/** Columns of one `desk_hour_predictions` row, in the order the values are bound. */
export const HOUR_PREDICTION_COLUMNS = [
  "event_ticker", "close_time", "checkpoint", "ticker", "strike", "as_of", "secs_left",
  "p_model", "uncertainty", "z", "dollars_to_strike", "p_market", "p_baseline_dist",
  "yes_ask", "no_ask", "spread_yes", "spread_no", "edge_yes", "edge_no", "best_side", "best_edge",
  "is_selected", "model_version", "build_sha",
] as const;

/**
 * One multi-row insert for a whole checkpoint's ladder.
 *
 * `do nothing` on conflict is what makes a repeated tick inside the same capture
 * window — or a restart that re-reaches the same checkpoint — write nothing at
 * all, so a rung can never be counted twice and a frozen row can never be
 * rewritten by a later observation.
 */
export function hourPredictionsInsert(rowCount: number): string {
  const cols = HOUR_PREDICTION_COLUMNS.length;
  const tuples: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const base = i * cols;
    const slots = Array.from({ length: cols }, (_, k) => `$${base + k + 1}`);
    // Only the two timestamps need an explicit cast; the rest are inferred.
    slots[1] = `${slots[1]}::timestamptz`;
    slots[5] = `${slots[5]}::timestamptz`;
    tuples.push(`(${slots.join(", ")})`);
  }
  return `insert into desk_hour_predictions (${HOUR_PREDICTION_COLUMNS.join(", ")})
values ${tuples.join(", ")}
on conflict (close_time, checkpoint, ticker) do nothing`;
}

/** Columns of the one-row-per-hour shadow book, in bind order. */
export const HOUR_SHADOW_COLUMNS = [
  "close_time", "event_ticker", "checkpoint", "decision", "wait_reason",
  "ticker", "strike", "side", "ask", "fee", "p_model", "p_market", "edge_cents", "uncertainty",
  "as_of", "secs_left", "expected_settlement", "expected_source", "sigma_horizon",
  "brti_value", "spot", "brti_spot_basis", "sigma_hour",
  "ladder_rungs", "ladder_complete", "ladder_inversions", "stored_rungs",
  "features", "explanation", "model_version", "authority", "build_sha",
] as const;

/** Every column a later checkpoint replaces. `graded_at` and the outcome columns are NOT here. */
const SHADOW_REPLACED = HOUR_SHADOW_COLUMNS.filter(
  (c) => c !== "close_time" && c !== "event_ticker" && c !== "model_version" && c !== "authority",
);

/**
 * The shadow book upsert: one row per hour, replaced WHOLE or not at all.
 *
 * THE OLD VERSION MOVED THE CLOCK WITHOUT THE SNAPSHOT. It updated `checkpoint`,
 * `as_of`, `secs_left` and `explanation` while leaving `expected_settlement`,
 * the index and spot values, sigma, the ladder counts and the features JSON from
 * the PREVIOUS checkpoint — so a row could claim the 10-minute clock over the
 * 30-minute inputs, and no reader could tell. Every frozen field now moves in
 * the same statement.
 *
 * THREE GUARDS, EACH DOING ONE JOB:
 *   `decision = 'WAIT'`  — once the hour has a directional candidate it is
 *                          locked, exactly as designed. One candidate per hour.
 *   `graded_at is null`  — a settled hour is history and is never rewritten.
 *   `excluded.checkpoint < checkpoint`
 *                        — checkpoints count DOWN (45 → 5), so this admits only
 *                          a strictly LATER instant. A duplicate tick at the same
 *                          checkpoint, and an out-of-order earlier one, are both
 *                          no-ops rather than silent rewrites.
 */
export const HOUR_SHADOW_UPSERT = `insert into desk_hour_shadow (${HOUR_SHADOW_COLUMNS.join(", ")})
values (
  $1::timestamptz, $2, $3, $4, $5,
  $6, $7, $8, $9, $10, $11, $12, $13, $14,
  $15::timestamptz, $16, $17, $18, $19,
  $20, $21, $22, $23,
  $24, $25, $26, $27,
  $28::jsonb, $29, $30, $31, $32
)
on conflict (close_time) do update set
${SHADOW_REPLACED.map((c) => `  ${c} = excluded.${c}`).join(",\n")}
where desk_hour_shadow.decision = 'WAIT'
  and desk_hour_shadow.graded_at is null
  and excluded.checkpoint < desk_hour_shadow.checkpoint`;
