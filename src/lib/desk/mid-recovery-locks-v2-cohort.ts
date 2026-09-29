/**
 * Immutable provenance boundary for the candidate-only V2 evaluator.
 *
 * Pure leaf: reporting and the factory can share this classification without
 * importing an evaluator or running research. A revision is a semantic code
 * boundary; build SHAs are provenance, not a new strategy on every deploy.
 * This establishes matched cohort membership, never an integrity CLEAN stamp.
 */
import type { MidRecoveryRow } from "./shadow-lab-mid-recovery";

export const V2_EXPERIMENT_ID = "MID_RECOVERY_LOCKS_V2_INACTIVE";
export const V2_EVALUATOR_REVISION = "V2_CANDIDATE_PROVENANCE_V1";
export const V2_LEGACY_REVISION = "LEGACY_UNSTAMPED";
export const V2_COHORT_ARMS = Object.freeze(["CONTROL", "BAR_NO_SITMASS", "SUPPORT_UNCAL_E1", "COMBINED_DIAG", "NULL_FAV_80"] as const);

export type LocksV2Row = MidRecoveryRow & { experiment?: string; build_sha?: string };
export type V2CohortClass = "legacy_unstamped" | "current" | "unknown_revision";
export type V2BoundaryReason =
  | "LEGACY_UNSTAMPED" | "UNKNOWN_REVISION" | "MIXED_REVISIONS" | "MIXED_BUILDS" | "MISSING_BUILD"
  | "INCOMPLETE_ARMS" | "INCOMPLETE_TERMINAL_ARMS" | "MISSING_SESSION_BOUNDARY" | "WINDOW_CROSSES_SESSION_BOUNDARY"
  | "CONFLICTING_RECEIPT_IDENTITY";
export type V2ExcludedWindow = {
  ticker: string; close_ms: number; revisions: string[]; build_shas: string[];
  reasons: V2BoundaryReason[]; row_count: number;
};
export type V2CohortPartition = {
  windows: number;
  foreign_rows: number;
  cohorts: Array<{
    revision: string; classification: V2CohortClass; rows: LocksV2Row[]; matched_rows: LocksV2Row[]; build_shas: string[];
  }>;
  excluded_windows: V2ExcludedWindow[];
};

/** Missing old stamps remain historical; an unrecognized stamp is never upgraded. */
export function locksV2Revision(row: Pick<LocksV2Row, "payload">): string {
  const revision = row.payload?.evaluator_revision;
  return revision == null ? V2_LEGACY_REVISION
    : typeof revision === "string" && revision.trim() ? revision : "INVALID_REVISION";
}
const classificationOf = (revision: string): V2CohortClass => revision === V2_EVALUATOR_REVISION ? "current"
  : revision === V2_LEGACY_REVISION ? "legacy_unstamped" : "unknown_revision";
const keyOf = (r: Pick<LocksV2Row, "ticker" | "close_ms">) => `${r.ticker}|${r.close_ms}`;
const buildsOf = (rows: readonly LocksV2Row[]) => [...new Set(rows.map((r) => r.build_sha?.trim() ?? ""))].sort();

/**
 * Keep every V2 receipt visible in its revision's observed population. Only
 * complete, terminal five-arm windows under the current revision, one known
 * build, and valid session boundaries enter matched_rows. Legacy and unknown
 * revisions remain diagnostic. Neither membership nor completeness certifies
 * settlement, execution quality, candidate integrity, or promotion readiness.
 */
export function partitionLocksV2Rows(rows: readonly LocksV2Row[]): V2CohortPartition {
  const arms = new Set<string>(V2_COHORT_ARMS);
  const own = rows.filter((r) => arms.has(r.arm) && (r.experiment == null || r.experiment === V2_EXPERIMENT_ID)
    && (r.payload?.experiment == null || r.payload.experiment === V2_EXPERIMENT_ID));
  // A truly foreign experiment is outside this cohort. A database row that
  // claims V2 but contradicts that identity inside its receipt cannot be
  // silently dropped to make the remaining five arms appear complete.
  const conflicting = new Set(rows.filter((r) => r.experiment === V2_EXPERIMENT_ID && (!arms.has(r.arm)
    || (r.payload?.experiment != null && r.payload.experiment !== V2_EXPERIMENT_ID))).map(keyOf));
  const cohorts = new Map<string, V2CohortPartition["cohorts"][number]>();
  const windows = new Map<string, LocksV2Row[]>();
  for (const row of own) {
    const revision = locksV2Revision(row);
    const cohort = cohorts.get(revision) ?? { revision, classification: classificationOf(revision), rows: [], matched_rows: [], build_shas: [] };
    cohort.rows.push(row);
    cohorts.set(revision, cohort);
    const key = keyOf(row), window = windows.get(key) ?? [];
    window.push(row);
    windows.set(key, window);
  }
  const excluded: V2ExcludedWindow[] = [];
  for (const window of windows.values()) {
    const first = window[0]!;
    const revisions = [...new Set(window.map(locksV2Revision))].sort();
    const builds = buildsOf(window);
    const reasons: V2BoundaryReason[] = [];
    if (conflicting.has(keyOf(first))) reasons.push("CONFLICTING_RECEIPT_IDENTITY");
    if (revisions.includes(V2_LEGACY_REVISION)) reasons.push("LEGACY_UNSTAMPED");
    if (revisions.some((r) => classificationOf(r) === "unknown_revision")) reasons.push("UNKNOWN_REVISION");
    if (revisions.length !== 1) reasons.push("MIXED_REVISIONS");
    if (builds.length !== 1) reasons.push("MIXED_BUILDS");
    if (builds.some((b) => !b || /^(unknown|dev|development)$/i.test(b))) reasons.push("MISSING_BUILD");
    if (new Set(window.map((r) => r.arm)).size !== arms.size) reasons.push("INCOMPLETE_ARMS");
    const terminal = new Set(window.filter((r) => r.kind === "fill" || r.kind === "no_fill" || r.kind === "veto").map((r) => r.arm));
    if (terminal.size !== arms.size) reasons.push("INCOMPLETE_TERMINAL_ARMS");
    const current = window.filter((r) => locksV2Revision(r) === V2_EVALUATOR_REVISION);
    const hasSession = (r: LocksV2Row) => typeof r.payload?.observer_session_start_ms === "number"
      && Number.isFinite(r.payload.observer_session_start_ms) && r.payload.observer_session_start_ms > 0;
    if (current.some((r) => !hasSession(r))) reasons.push("MISSING_SESSION_BOUNDARY");
    if (current.some((r) => hasSession(r) && (r.payload!.observer_session_start_ms as number) > r.close_ms - 900_000)) reasons.push("WINDOW_CROSSES_SESSION_BOUNDARY");
    if (reasons.length) excluded.push({ ticker: first.ticker, close_ms: first.close_ms, revisions, build_shas: builds, reasons, row_count: window.length });
    else cohorts.get(revisions[0]!)!.matched_rows.push(...window);
  }
  return {
    windows: windows.size, foreign_rows: rows.length - own.length,
    cohorts: [...cohorts.values()].map((c) => ({ ...c, build_shas: buildsOf(c.rows) })),
    excluded_windows: excluded,
  };
}
