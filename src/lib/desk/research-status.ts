/**
 * How much evidence does each new measurement actually have — and how much of it
 * is prospective?
 *
 * THE DISTINCTION THIS BOARD EXISTS FOR. Every Phase 2 study produced a first
 * reading on windows that had already happened. Those readings are known, so the
 * definitions were frozen on 2026-09-11 and cannot move. But a number computed
 * on the same windows that suggested it is not evidence for it, however large n
 * gets. What counts is the sample gathered AFTER the definition was fixed.
 *
 * So every row carries two counts. `n` is everything. `prospective_n` is the
 * part recorded after this measurement's clock started — and for most rows that
 * is the freeze date, but not all: a measurement whose definition was corrected
 * for a proven bug starts again at the correction, because the records before it
 * were produced by different arithmetic and pooling them would smuggle the old
 * ones back in.
 *
 * WHAT THE STATUS MEANS, AND WHAT IT NEVER MEANS. The ladder tops out at
 * "measurable". There is no rung for "promote", "adopt" or "trust", because no
 * amount of sample on this board earns authority — that is decided elsewhere, by
 * a human, against the gates each seat already carries. A row that reads
 * measurable with a strong result is a row worth arguing about, nothing more.
 *
 * Pure module.
 */

/** Where a measurement is in its life, and nowhere further. */
export type ResearchStatus =
  /** Nothing recorded. The measurement exists in code and has never fired. */
  | "no sample"
  /** Recording, but not enough prospective evidence to read. */
  | "gathering"
  /** Enough prospective evidence to state a result — which may be "no effect". */
  | "measurable"
  /** Recording is broken or the definition was corrected; the clock restarted. */
  | "restarted";

export type ResearchRow = {
  id: string;
  family: string;
  /** Every observation, including the ones that suggested the definition. */
  n: number;
  /** Observations recorded after this measurement's clock started. The real count. */
  prospective_n: number;
  /** When that clock started, and why it is that date rather than the freeze date. */
  since: string;
  since_why: string;
  /** Observations per regime, so a result cannot hide that it lives in one session. */
  regime_n: Record<string, number>;
  /** The best-populated regime's count — the gate INDEX is held to, for scale. */
  best_regime_n: number;
  /**
   * Times the measurement actually pointed somewhere. A feature that is zero on
   * 90% of windows has far less evidence than its row count suggests, and this
   * is the number that says so.
   */
  directional: number;
  /** The result in one line, or null when there is not enough to say anything. */
  result: string | null;
  status: ResearchStatus;
  /** What this row is for, in a sentence, so the board reads without a key. */
  note: string;
};

/** Prospective observations below this and no result is stated, whatever it looks like. */
export const MIN_PROSPECTIVE = 30;

/**
 * The date Phase 2 definitions were frozen. Everything recorded from here counts
 * as prospective unless a row names a later restart.
 */
export const FROZEN_AT = "2026-09-11";

export function statusOf(opts: {
  n: number;
  prospective_n: number;
  restarted?: boolean;
  min?: number;
}): ResearchStatus {
  const min = opts.min ?? MIN_PROSPECTIVE;
  if (opts.restarted) return "restarted";
  if (opts.n <= 0) return "no sample";
  if (opts.prospective_n < min) return "gathering";
  return "measurable";
}

/**
 * Build a row. `result` is accepted from the caller but DROPPED unless the row
 * is measurable — a result printed beside a thin sample is read as a finding no
 * matter what the status column says, so the honest thing is not to print it.
 */
export function researchRow(r: Omit<ResearchRow, "status" | "best_regime_n"> & { restarted?: boolean; min?: number }): ResearchRow {
  const status = statusOf({ n: r.n, prospective_n: r.prospective_n, restarted: r.restarted, min: r.min });
  const counts = Object.values(r.regime_n);
  return {
    id: r.id,
    family: r.family,
    n: r.n,
    prospective_n: r.prospective_n,
    since: r.since,
    since_why: r.since_why,
    regime_n: r.regime_n,
    best_regime_n: counts.length ? Math.max(...counts) : 0,
    directional: r.directional,
    result: status === "measurable" ? r.result : null,
    status,
    note: r.note,
  };
}

export type ResearchBoard = {
  frozen_at: string;
  min_prospective: number;
  rows: ResearchRow[];
  /** Counts by status, so the shape of the board is readable at a glance. */
  tally: Record<ResearchStatus, number>;
  /** What this board is and is not. Restated in the payload, not just in a doc. */
  note: string;
};

export function researchBoard(rows: readonly ResearchRow[]): ResearchBoard {
  const tally: Record<ResearchStatus, number> = {
    "no sample": 0,
    gathering: 0,
    measurable: 0,
    restarted: 0,
  };
  for (const r of rows) tally[r.status] += 1;
  return {
    frozen_at: FROZEN_AT,
    min_prospective: MIN_PROSPECTIVE,
    rows: [...rows].sort((a, b) => b.prospective_n - a.prospective_n),
    tally,
    note:
      `Definitions were frozen on ${FROZEN_AT} and may change only for a proven correctness bug. ` +
      `prospective_n is the count recorded since a row's clock started; n includes the windows that ` +
      `suggested the definition and is not evidence for it. The ladder stops at "measurable": nothing on ` +
      `this board promotes anything, and a measurable row with a strong result is worth arguing about and ` +
      `no more. A result is withheld entirely below ${MIN_PROSPECTIVE} prospective observations, because a ` +
      `number printed beside a thin sample gets read as a finding whatever the status column says.`,
  };
}
