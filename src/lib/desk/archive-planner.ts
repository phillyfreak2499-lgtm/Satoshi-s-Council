/**
 * Phase 1 off-site archive planner. Inspect only.
 *
 * Classifies rows from the five research/replay tables the audit named as
 * archive candidates. It never writes, never deletes, never imports Chair /
 * seat / grade / engine code, and never treats desk_ledger as a candidate.
 *
 * Pure module: every "now" is passed in. Date.now is not consulted inside a
 * classifier, so tests are deterministic and the live web process is not a
 * caller.
 *
 * PAPER ONLY. No order, no venue, no size.
 */
import { qualityOf, type Quality } from "./research-quality.ts";
import { seriesKey } from "./replay-window.ts";

export const ARCHIVE_SCHEMA_VERSION = "1";

export const ARCHIVE_TABLES = [
  "desk_path_parity",
  "desk_lag_events",
  "desk_absorption",
  "desk_basis_minutes",
  "desk_replay",
] as const;

export type ArchiveTable = (typeof ARCHIVE_TABLES)[number];

/** Days that stay hot in Postgres. Older rows are archive-eligible. */
export const KEEP_HOT_DAYS: Record<ArchiveTable, number> = {
  desk_path_parity: 14,
  desk_lag_events: 30,
  desk_absorption: 30,
  desk_basis_minutes: 30,
  desk_replay: 14,
};

/**
 * Replay-only upper bound. pruneReplays() deletes close_time < now-30d.
 * Phase 1 dumps the 14..29 day band so a copy exists before that prune.
 * Rows older than 29 days are reported, not proposed for delete.
 */
export const REPLAY_ARCHIVE_MAX_DAYS = 29;

export const DAY_MS = 86_400_000;

export const DEFAULT_BYTES: Record<ArchiveTable, number> = {
  desk_path_parity: 1_200,
  desk_lag_events: 500,
  desk_absorption: 700,
  desk_basis_minutes: 160,
  desk_replay: 12_000,
};

export type RowDisposition = "archive" | "retain" | "identity_gap" | "outside_window";

export type PlannerRow = {
  table: ArchiveTable;
  ticker?: string | null;
  /** Window close. Required (with ticker) for path_parity, absorption, replay. */
  close_time?: string | number | Date | null;
  /** Event / sample / minute clock when the table is not window-keyed. */
  t?: string | number | Date | null;
  estimated_bytes?: number | null;
  research_quality?: Quality | string | null;
};

export type IdentityGap = {
  table: ArchiveTable;
  reason: string;
  ticker: string | null;
  timestamp: string | null;
  research_quality: string | null;
};

export type ProposedPartition = {
  archive_id: string;
  object_key: string;
  table_name: ArchiveTable;
  partition: string;
  partition_start: string;
  partition_end: string;
  schema_version: string;
  row_count: number;
  estimated_bytes: number;
  source_identity: string;
  status: "planned";
};

export type TablePlan = {
  table: ArchiveTable;
  inspected_row_count: number;
  eligible_row_count: number;
  retained_row_count: number;
  archived_row_count: number;
  identity_gap_row_count: number;
  outside_window_row_count: number;
  min_timestamp: string | null;
  max_timestamp: string | null;
  estimated_bytes: number;
  proposed_partitions: ProposedPartition[];
  identity_gaps: IdentityGap[];
  quality_trace: Record<string, number>;
};

export type ArchivePlan = {
  generated_at: string;
  now: string;
  schema_version: string;
  source_identity: string;
  dry_run: true;
  writes: false;
  deletes: false;
  ledger_rows_deleted: 0;
  tables: TablePlan[];
  totals: {
    inspected: number;
    archive: number;
    retain: number;
    identity_gap: number;
    outside_window: number;
    estimated_bytes: number;
    proposed_partitions: number;
  };
};

const WINDOW_TABLES = new Set<ArchiveTable>(["desk_path_parity", "desk_absorption", "desk_replay"]);

export function parseTime(value: string | number | Date | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Seconds-since-epoch are not used on this desk; reject implausibly small ms.
    if (value > 0 && value < 1_000_000_000_000) return null;
    return value;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

export function utcDayStamp(ms: number): string {
  return isoUtc(utcDayStart(ms)).slice(0, 10);
}

export function rowTimestamp(row: PlannerRow): number | null {
  if (row.table === "desk_lag_events" || row.table === "desk_basis_minutes") {
    return parseTime(row.t ?? row.close_time);
  }
  return parseTime(row.close_time ?? row.t);
}

/**
 * Stable identity for one row. Window tables use ticker|close_ms — the same
 * spelling as replay-window.seriesKey — so a reused ticker with two closes is
 * two identities. A ticker alone is never an identity.
 */
export function rowIdentity(row: PlannerRow): { ok: true; key: string; ts: number } | { ok: false; reason: string } {
  const ts = rowTimestamp(row);
  if (ts == null) {
    return { ok: false, reason: "missing-or-unparseable-timestamp" };
  }
  if (row.table === "desk_basis_minutes") {
    return { ok: true, key: `minute:${ts}`, ts };
  }
  const ticker = typeof row.ticker === "string" ? row.ticker.trim() : "";
  if (!ticker) {
    return { ok: false, reason: "missing-ticker" };
  }
  if (WINDOW_TABLES.has(row.table)) {
    const close = parseTime(row.close_time);
    if (close == null) return { ok: false, reason: "missing-or-unparseable-close_time" };
    return { ok: true, key: seriesKey(ticker, close), ts: close };
  }
  // desk_lag_events: ticker + event time. Still not ticker-alone.
  return { ok: true, key: `lag:${ticker}|${ts}`, ts };
}

export function archiveId(
  table: ArchiveTable,
  partitionStartIso: string,
  partitionEndIso: string,
  schemaVersion: string,
  sourceIdentity: string,
): string {
  return `${schemaVersion}:${table}:${partitionStartIso}:${partitionEndIso}:${sourceIdentity}`;
}

export function objectKey(
  table: ArchiveTable,
  day: string,
  schemaVersion: string,
  sourceIdentity: string,
): string {
  const compact = day.replace(/-/g, "");
  return `archive/${schemaVersion}/${sourceIdentity}/${table}/dt=${day}/${table}_${compact}.json.gz`;
}

export function classifyAge(table: ArchiveTable, ts: number, nowMs: number): Exclude<RowDisposition, "identity_gap"> {
  const hotMs = KEEP_HOT_DAYS[table] * DAY_MS;
  if (table === "desk_replay") {
    const oldest = nowMs - REPLAY_ARCHIVE_MAX_DAYS * DAY_MS;
    const newestHot = nowMs - hotMs;
    // [now-29d, now-14d): dump before pruneReplays at 30d.
    if (ts >= newestHot) return "retain";
    if (ts >= oldest) return "archive";
    return "outside_window";
  }
  if (ts >= nowMs - hotMs) return "retain";
  return "archive";
}

function qualityLabel(row: PlannerRow, ts: number | null): string {
  if (typeof row.research_quality === "string" && row.research_quality.trim()) {
    return row.research_quality.trim();
  }
  if (WINDOW_TABLES.has(row.table) && ts != null) {
    return qualityOf(ts).quality;
  }
  return "unknown";
}

export type PlanOptions = {
  nowMs: number;
  sourceIdentity: string;
  schemaVersion?: string;
};

export function planArchive(rows: readonly PlannerRow[], opts: PlanOptions): ArchivePlan {
  const nowMs = opts.nowMs;
  const sourceIdentity = opts.sourceIdentity;
  const schemaVersion = opts.schemaVersion ?? ARCHIVE_SCHEMA_VERSION;
  const byTable = new Map<ArchiveTable, PlannerRow[]>();
  for (const table of ARCHIVE_TABLES) byTable.set(table, []);
  for (const row of rows) {
    const list = byTable.get(row.table);
    if (list) list.push(row);
  }

  const tables: TablePlan[] = ARCHIVE_TABLES.map((table) => planTable(table, byTable.get(table) ?? [], nowMs, sourceIdentity, schemaVersion));

  const totals = {
    inspected: 0,
    archive: 0,
    retain: 0,
    identity_gap: 0,
    outside_window: 0,
    estimated_bytes: 0,
    proposed_partitions: 0,
  };
  for (const t of tables) {
    totals.inspected += t.inspected_row_count;
    totals.archive += t.archived_row_count;
    totals.retain += t.retained_row_count;
    totals.identity_gap += t.identity_gap_row_count;
    totals.outside_window += t.outside_window_row_count;
    totals.estimated_bytes += t.estimated_bytes;
    totals.proposed_partitions += t.proposed_partitions.length;
  }

  return {
    generated_at: isoUtc(nowMs),
    now: isoUtc(nowMs),
    schema_version: schemaVersion,
    source_identity: sourceIdentity,
    dry_run: true,
    writes: false,
    deletes: false,
    ledger_rows_deleted: 0,
    tables,
    totals,
  };
}

function planTable(
  table: ArchiveTable,
  rows: readonly PlannerRow[],
  nowMs: number,
  sourceIdentity: string,
  schemaVersion: string,
): TablePlan {
  const seen = new Map<string, number>();
  const gaps: IdentityGap[] = [];
  const quality_trace: Record<string, number> = {};
  const partitions = new Map<number, ProposedPartition>();
  let archived = 0;
  let retained = 0;
  let gapCount = 0;
  let outside = 0;
  let estimated_bytes = 0;
  let minTs: number | null = null;
  let maxTs: number | null = null;

  for (const row of rows) {
    const ident = rowIdentity(row);
    const ts = ident.ok ? ident.ts : rowTimestamp(row);
    const quality = qualityLabel(row, ts);
    quality_trace[quality] = (quality_trace[quality] ?? 0) + 1;
    if (ts != null) {
      minTs = minTs == null ? ts : Math.min(minTs, ts);
      maxTs = maxTs == null ? ts : Math.max(maxTs, ts);
    }

    if (!ident.ok) {
      gapCount += 1;
      gaps.push({
        table,
        reason: ident.reason,
        ticker: typeof row.ticker === "string" && row.ticker.trim() ? row.ticker.trim() : null,
        timestamp: ts != null ? isoUtc(ts) : null,
        research_quality: quality === "unknown" ? null : quality,
      });
      continue;
    }

    const n = (seen.get(ident.key) ?? 0) + 1;
    seen.set(ident.key, n);
    if (n > 1) {
      gapCount += 1;
      gaps.push({
        table,
        reason: "duplicate-identity",
        ticker: typeof row.ticker === "string" && row.ticker.trim() ? row.ticker.trim() : null,
        timestamp: isoUtc(ident.ts),
        research_quality: quality === "unknown" ? null : quality,
      });
      continue;
    }

    const disposition = classifyAge(table, ident.ts, nowMs);
    const bytes = row.estimated_bytes != null && Number.isFinite(row.estimated_bytes) && row.estimated_bytes >= 0
      ? Math.floor(row.estimated_bytes)
      : DEFAULT_BYTES[table];

    if (disposition === "retain") {
      retained += 1;
      continue;
    }
    if (disposition === "outside_window") {
      outside += 1;
      continue;
    }

    archived += 1;
    estimated_bytes += bytes;
    const dayStart = utcDayStart(ident.ts);
    const existing = partitions.get(dayStart);
    if (existing) {
      existing.row_count += 1;
      existing.estimated_bytes += bytes;
      continue;
    }
    const startIso = isoUtc(dayStart);
    const endIso = isoUtc(dayStart + DAY_MS);
    const day = utcDayStamp(dayStart);
    partitions.set(dayStart, {
      archive_id: archiveId(table, startIso, endIso, schemaVersion, sourceIdentity),
      object_key: objectKey(table, day, schemaVersion, sourceIdentity),
      table_name: table,
      partition: day,
      partition_start: startIso,
      partition_end: endIso,
      schema_version: schemaVersion,
      row_count: 1,
      estimated_bytes: bytes,
      source_identity: sourceIdentity,
      status: "planned",
    });
  }

  const proposed_partitions = [...partitions.values()].sort((a, b) => a.partition_start.localeCompare(b.partition_start));

  return {
    table,
    inspected_row_count: rows.length,
    eligible_row_count: archived,
    retained_row_count: retained,
    archived_row_count: archived,
    identity_gap_row_count: gapCount,
    outside_window_row_count: outside,
    min_timestamp: minTs == null ? null : isoUtc(minTs),
    max_timestamp: maxTs == null ? null : isoUtc(maxTs),
    estimated_bytes,
    proposed_partitions,
    identity_gaps: gaps,
    quality_trace,
  };
}

/** Fixture rows for `scripts/archive-plan.ts --demo`. Deterministic against DEMO_NOW_MS. */
export const DEMO_NOW_MS = Date.parse("2026-09-15T10:00:00.000Z");
export const DEMO_SOURCE = "pg:satoshi_council";

export function demoRows(): PlannerRow[] {
  const reuse = "KXBTC15M-26SEP100300-00";
  return [
    { table: "desk_replay", ticker: "KXBTC15M-26SEP140800-00", close_time: "2026-09-14T12:00:00.000Z" },
    { table: "desk_replay", ticker: "KXBTC15M-26AUG250800-00", close_time: "2026-08-25T12:00:00.000Z" },
    { table: "desk_replay", ticker: "KXBTC15M-26AUG100800-00", close_time: "2026-08-10T12:00:00.000Z" },
    { table: "desk_replay", ticker: reuse, close_time: "2026-08-20T07:00:00.000Z", research_quality: "valid" },
    { table: "desk_replay", ticker: reuse, close_time: "2026-08-20T07:15:00.000Z", research_quality: "excluded" },
    { table: "desk_replay", ticker: "BROKEN", close_time: "not-a-time" },
    { table: "desk_path_parity", ticker: "KXBTC15M-26AUG200800-00", close_time: "2026-08-20T12:00:00.000Z" },
    { table: "desk_path_parity", ticker: "KXBTC15M-26SEP140800-00", close_time: "2026-09-14T12:00:00.000Z" },
    { table: "desk_lag_events", ticker: "KXBTC15M-26AUG010800-00", t: "2026-08-01T12:00:00.000Z" },
    { table: "desk_lag_events", ticker: "KXBTC15M-26SEP010800-00", t: "2026-09-01T12:00:00.000Z" },
    { table: "desk_absorption", ticker: "KXBTC15M-26AUG010800-00", close_time: "2026-08-01T12:00:00.000Z", t: "2026-08-01T11:50:00.000Z" },
    { table: "desk_absorption", ticker: "KXBTC15M-26SEP010800-00", close_time: "2026-09-01T12:00:00.000Z" },
    { table: "desk_basis_minutes", t: "2026-08-01T00:00:00.000Z" },
    { table: "desk_basis_minutes", t: "2026-09-01T00:00:00.000Z" },
    { table: "desk_path_parity", ticker: null, close_time: "2026-08-01T12:00:00.000Z" },
  ];
}
