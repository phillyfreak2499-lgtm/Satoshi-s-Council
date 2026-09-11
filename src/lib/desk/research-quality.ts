/**
 * Research quality: which recorded windows may be used as evidence.
 *
 * WHY THIS EXISTS. Some windows are recorded faithfully and are still not
 * evidence, because what was recorded was not what happened. On 2026-09-10 the
 * ledger took eight consecutive windows — 07:15 through 09:00 UTC — whose
 * settlement belonged to a market that had already closed. Those rows are real
 * records of a real fault. They are not observations of the desk's skill, and
 * every aggregate that counts them is lying by exactly eight windows.
 *
 * THE RULE. The rows stay. Nothing is deleted, nothing is rewritten, no
 * settlement is recomputed and no winner is guessed at — a record that is wrong
 * is still the record, and repairing it would destroy the only evidence of the
 * fault. What changes is that research asks for its quality before counting it.
 *
 * ONE REGISTRY, NOT SCATTERED FILTERS. Every exclusion lives in EXCLUSIONS
 * below, with the window range and the reason. A hard-coded date comparison
 * inside one report is how the next aggregate quietly disagrees with this one.
 *
 * FORENSICS STAY REACHABLE. Excluded rows are still readable by asking for them
 * — `quality` is a filter, never a deletion — so the block can be inspected,
 * charted and explained. It simply cannot arrive unannounced in a hit rate.
 *
 * WHY A PERSISTED COLUMN TOO. `desk_ledger.research_quality` carries the same
 * verdict so SQL aggregates can exclude in the query rather than pulling rows
 * and hoping each caller remembers. The column is metadata ABOUT the record; it
 * changes no recorded value. Migration 0024 stamps it from the ranges here, and
 * a test asserts the two can never drift apart.
 *
 * Research does not spell that predicate out. It reads the `desk_ledger_research`
 * view, which applies it once — see RESEARCH_VIEW. The bare table stays available
 * to the handful of paths that must see every row: the insert and its read-back,
 * the official-value backfill, the replay viewer, and above all the gap scan and
 * reconciliation, which would otherwise report every quarantined window as a
 * missing ledger row and alert on data that is deliberately held back.
 *
 * Pure module: no clock, no state, no database.
 */

/**
 * How usable a recorded window is as evidence.
 *
 *   valid     recorded as intended; counts everywhere
 *   excluded  known invalid; never counts in an aggregate
 *   partial   recorded, but incomplete — e.g. a replay that started late
 *   suspect   not proven invalid, flagged for review; never counts silently
 */
export type Quality = "valid" | "excluded" | "partial" | "suspect";

/** The quality values research may count. Anything else has to be asked for. */
export const COUNTABLE: readonly Quality[] = ["valid"];

/**
 * The view every research aggregate reads instead of desk_ledger.
 *
 * ONE definition beats a predicate repeated in each report: a new aggregate that
 * reads this is correct by construction, and auditing coverage becomes a single
 * question — does this query touch the bare table? — rather than checking that
 * a couple of dozen WHERE clauses each still carry a filter.
 *
 * Defined by migration 0024; a rail names the few reads that must stay on the
 * bare table and why.
 */
export const RESEARCH_VIEW = "desk_ledger_research";

/**
 * The predicate the view applies. Kept here so the registry, the migration and
 * the tests agree on one spelling; queries do not embed it, they read the view.
 */
export const VALID_ONLY_SQL = "research_quality = 'valid'";

export type Exclusion = {
  /** Stable id, also the value recorded beside the row. */
  id: string;
  /** First excluded window close, inclusive, ISO. */
  from: string;
  /** Last excluded window close, inclusive, ISO. */
  to: string;
  /** How many 15-minute windows the range covers, as a stated expectation. */
  windows: number;
  quality: Exclude<Quality, "valid">;
  /** What went wrong, in the terms a later reader will need. */
  why: string;
};

/**
 * Known-invalid intervals. Append-only: an entry here is a statement about what
 * the data is, and removing one would silently re-admit rows that a previous
 * investigation established were not observations.
 */
export const EXCLUSIONS: readonly Exclusion[] = [
  {
    id: "2026-09-10-ticker-reuse",
    from: "2026-09-10T07:15:00.000Z",
    to: "2026-09-10T09:00:00.000Z",
    windows: 8,
    quality: "excluded",
    why:
      "one Kalshi market (KXBTC15M-26SEP100300-00, closing 07:00Z) was reused across these eight windows: " +
      "the feed stopped advancing the ticker and the settlement matcher accepted it on ticker alone, so every " +
      "row carries that market's result and official_value. The settlements are not these windows' settlements.",
  },
];

const WINDOW_MS = 900_000;

/** Windows covered by a range, inclusive of both ends. */
export function rangeWindows(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.floor((b - a) / WINDOW_MS) + 1;
}

export type QualityVerdict = {
  quality: Quality;
  /** The exclusion that caught it, when one did. */
  rule: string | null;
  why: string | null;
};

const VALID: QualityVerdict = { quality: "valid", rule: null, why: null };

/**
 * The quality of a window by its close time.
 *
 * An unreadable close time is "suspect" rather than "valid": a row whose own
 * identity cannot be read must not be counted just because nothing excluded it.
 */
export function qualityOf(closeTime: string | number | Date | null | undefined): QualityVerdict {
  const t =
    closeTime instanceof Date
      ? closeTime.getTime()
      : typeof closeTime === "number"
        ? closeTime
        : closeTime
          ? Date.parse(closeTime)
          : NaN;
  if (!Number.isFinite(t)) return { quality: "suspect", rule: null, why: "close time unreadable" };
  for (const x of EXCLUSIONS) {
    if (t >= Date.parse(x.from) && t <= Date.parse(x.to)) {
      return { quality: x.quality, rule: x.id, why: x.why };
    }
  }
  return VALID;
}

/** Is this window countable in an aggregate? */
export function isCountable(closeTime: string | number | Date | null | undefined): boolean {
  return COUNTABLE.includes(qualityOf(closeTime).quality);
}

export type QualitySplit<T> = {
  /** Rows research may count. */
  countable: T[];
  /** Rows held back, with the rule that held each one. */
  held: { row: T; quality: Quality; rule: string | null }[];
  /** Plain-language note naming how many were held and why. Never silent. */
  note: string;
};

/**
 * Split rows into what may be counted and what was held back.
 *
 * Returns a note rather than quietly yielding a shorter list: a sample that got
 * smaller without saying so is how an exclusion becomes indistinguishable from
 * a desk that simply traded less.
 */
export function splitQuality<T>(rows: readonly T[], closeOf: (row: T) => string | number | Date | null | undefined): QualitySplit<T> {
  const countable: T[] = [];
  const held: { row: T; quality: Quality; rule: string | null }[] = [];
  const byRule = new Map<string, number>();
  for (const row of rows) {
    const v = qualityOf(closeOf(row));
    if (COUNTABLE.includes(v.quality)) {
      countable.push(row);
      continue;
    }
    held.push({ row, quality: v.quality, rule: v.rule });
    const k = v.rule ?? v.quality;
    byRule.set(k, (byRule.get(k) ?? 0) + 1);
  }
  const note = held.length
    ? `${held.length} of ${rows.length} windows held back as not-evidence (${[...byRule]
        .map(([k, n]) => `${k}: ${n}`)
        .join("; ")}); the rows remain readable for forensics`
    : `all ${rows.length} windows countable`;
  return { countable, held, note };
}

/** The registry as a reportable list, for the research API and the UI. */
export function exclusionReport(): {
  id: string;
  from: string;
  to: string;
  windows: number;
  quality: Quality;
  why: string;
}[] {
  return EXCLUSIONS.map((x) => ({ ...x }));
}
