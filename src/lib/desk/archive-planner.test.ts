import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ARCHIVE_SCHEMA_VERSION,
  ARCHIVE_TABLES,
  DEMO_NOW_MS,
  DEMO_SOURCE,
  KEEP_HOT_DAYS,
  REPLAY_ARCHIVE_MAX_DAYS,
  archiveId,
  classifyAge,
  demoRows,
  objectKey,
  parseTime,
  planArchive,
  rowIdentity,
  utcDayStart,
  utcDayStamp,
  type PlannerRow,
} from "./archive-planner.ts";
import { FORBIDDEN_WRITE_FLAGS, rejectedWriteFlag } from "../../../scripts/archive-plan.ts";
import { qualityOf } from "./research-quality.ts";
import { seriesKey } from "./replay-window.ts";

const NOW = Date.parse("2026-09-15T10:00:00.000Z");
const DAY = 86_400_000;
const SRC = "pg:test";
const REUSE = "KXBTC15M-26SEP100300-00";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI = join(ROOT, "scripts", "archive-plan.ts");

function plan(rows: PlannerRow[]) {
  return planArchive(rows, { nowMs: NOW, sourceIdentity: SRC });
}

function tablePlan(rows: PlannerRow[], table: PlannerRow["table"]) {
  return plan(rows).tables.find((t) => t.table === table)!;
}

test("window identity is ticker plus close_time, never ticker alone", () => {
  const a = rowIdentity({
    table: "desk_replay",
    ticker: REUSE,
    close_time: "2026-09-10T07:00:00.000Z",
  });
  const b = rowIdentity({
    table: "desk_replay",
    ticker: REUSE,
    close_time: "2026-09-10T07:15:00.000Z",
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.notEqual(a.key, b.key);
    assert.equal(a.key, seriesKey(REUSE, Date.parse("2026-09-10T07:00:00.000Z")));
    assert.equal(b.key, seriesKey(REUSE, Date.parse("2026-09-10T07:15:00.000Z")));
    assert.match(a.key, /\|/);
    assert.notEqual(a.key, REUSE);
  }
});

test("ticker reuse produces two archive identities and two object keys", () => {
  const rows: PlannerRow[] = [
    { table: "desk_replay", ticker: REUSE, close_time: "2026-08-20T07:00:00.000Z" },
    { table: "desk_replay", ticker: REUSE, close_time: "2026-08-20T07:15:00.000Z" },
  ];
  const replay = tablePlan(rows, "desk_replay");
  assert.equal(replay.archived_row_count, 2);
  assert.equal(replay.proposed_partitions.length, 1, "same UTC day shares one partition");
  assert.equal(replay.proposed_partitions[0]?.row_count, 2);
  const k1 = rowIdentity(rows[0]!);
  const k2 = rowIdentity(rows[1]!);
  assert.ok(k1.ok && k2.ok && k1.key !== k2.key);
});

test("a midnight UTC row belongs to that day, not the previous", () => {
  const ms = Date.parse("2026-08-20T00:00:00.000Z");
  assert.equal(utcDayStamp(ms), "2026-08-20");
  assert.equal(utcDayStart(ms), ms);
  const justBefore = ms - 1;
  assert.equal(utcDayStamp(justBefore), "2026-08-19");
  const endOfDay = Date.parse("2026-08-20T23:59:59.999Z");
  assert.equal(utcDayStamp(endOfDay), "2026-08-20");

  const replay = tablePlan(
    [
      { table: "desk_replay", ticker: "A", close_time: "2026-08-20T00:00:00.000Z" },
      { table: "desk_replay", ticker: "B", close_time: "2026-08-19T23:59:59.000Z" },
    ],
    "desk_replay",
  );
  const days = replay.proposed_partitions.map((p) => p.partition);
  assert.deepEqual(days, ["2026-08-19", "2026-08-20"]);
  assert.equal(replay.proposed_partitions[1]?.partition_start, "2026-08-20T00:00:00.000Z");
  assert.equal(replay.proposed_partitions[1]?.partition_end, "2026-08-21T00:00:00.000Z");
});

test("replay selection is the 14-to-29 day band", () => {
  const hotEdge = NOW - KEEP_HOT_DAYS.desk_replay * DAY;
  const oldest = NOW - REPLAY_ARCHIVE_MAX_DAYS * DAY;
  assert.equal(classifyAge("desk_replay", hotEdge, NOW), "retain");
  assert.equal(classifyAge("desk_replay", hotEdge - 1, NOW), "archive");
  assert.equal(classifyAge("desk_replay", oldest, NOW), "archive");
  assert.equal(classifyAge("desk_replay", oldest - 1, NOW), "outside_window");
  assert.equal(classifyAge("desk_replay", NOW - 5 * DAY, NOW), "retain");
  assert.equal(classifyAge("desk_replay", NOW - 21 * DAY, NOW), "archive");
  assert.equal(classifyAge("desk_replay", NOW - 36 * DAY, NOW), "outside_window");
});

test("replay plan splits retain / archive / outside_window without deleting", () => {
  const rows: PlannerRow[] = [
    { table: "desk_replay", ticker: "HOT", close_time: NOW - 3 * DAY },
    { table: "desk_replay", ticker: "MID", close_time: NOW - 21 * DAY },
    { table: "desk_replay", ticker: "OLD", close_time: NOW - 40 * DAY },
  ];
  const replay = tablePlan(rows, "desk_replay");
  assert.equal(replay.retained_row_count, 1);
  assert.equal(replay.archived_row_count, 1);
  assert.equal(replay.outside_window_row_count, 1);
  assert.equal(replay.eligible_row_count, 1);
  assert.equal(plan(rows).deletes, false);
  assert.equal(plan(rows).ledger_rows_deleted, 0);
});

test("research tables keep their own hot windows", () => {
  assert.equal(classifyAge("desk_path_parity", NOW - 13 * DAY, NOW), "retain");
  assert.equal(classifyAge("desk_path_parity", NOW - 15 * DAY, NOW), "archive");
  assert.equal(classifyAge("desk_lag_events", NOW - 29 * DAY, NOW), "retain");
  assert.equal(classifyAge("desk_lag_events", NOW - 31 * DAY, NOW), "archive");
  assert.equal(classifyAge("desk_absorption", NOW - 31 * DAY, NOW), "archive");
  assert.equal(classifyAge("desk_basis_minutes", NOW - 31 * DAY, NOW), "archive");
});

test("no planner path deletes ledger rows", () => {
  const files = [
    "src/lib/desk/archive-planner.ts",
    "src/lib/desk/archive-planner.test.ts",
    "scripts/archive-plan.ts",
    "migrations/0032_desk_archive_manifest.sql",
  ];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.doesNotMatch(src, /delete\s+from\s+desk_ledger/i, rel);
    assert.doesNotMatch(src, /truncate\s+desk_ledger/i, rel);
  }
  assert.ok(!ARCHIVE_TABLES.includes("desk_ledger" as (typeof ARCHIVE_TABLES)[number]));
  const planned = plan([{ table: "desk_replay", ticker: "X", close_time: NOW - 20 * DAY }]);
  assert.equal(planned.ledger_rows_deleted, 0);
  assert.equal(planned.writes, false);
  assert.equal(planned.deletes, false);
});

test("archive keys are idempotent for the same partition inputs", () => {
  const start = "2026-08-20T00:00:00.000Z";
  const end = "2026-08-21T00:00:00.000Z";
  assert.equal(
    archiveId("desk_replay", start, end, ARCHIVE_SCHEMA_VERSION, SRC),
    archiveId("desk_replay", start, end, ARCHIVE_SCHEMA_VERSION, SRC),
  );
  assert.equal(objectKey("desk_replay", "2026-08-20", "1", SRC), objectKey("desk_replay", "2026-08-20", "1", SRC));
  const once = plan([{ table: "desk_replay", ticker: "X", close_time: "2026-08-20T12:00:00.000Z" }]);
  const twice = plan([{ table: "desk_replay", ticker: "X", close_time: "2026-08-20T12:00:00.000Z" }]);
  assert.deepEqual(once.tables[4]?.proposed_partitions, twice.tables[4]?.proposed_partitions);
  assert.equal(once.tables[4]?.proposed_partitions[0]?.archive_id, twice.tables[4]?.proposed_partitions[0]?.archive_id);
  assert.equal(once.tables[4]?.proposed_partitions[0]?.object_key, twice.tables[4]?.proposed_partitions[0]?.object_key);
});

test("different tables or days never share an object key", () => {
  const a = objectKey("desk_replay", "2026-08-20", "1", SRC);
  const b = objectKey("desk_path_parity", "2026-08-20", "1", SRC);
  const c = objectKey("desk_replay", "2026-08-21", "1", SRC);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("missing or unparseable timestamps are identity gaps, not archive candidates", () => {
  const rows: PlannerRow[] = [
    { table: "desk_replay", ticker: "X", close_time: null },
    { table: "desk_replay", ticker: "Y", close_time: "not-a-time" },
    { table: "desk_replay", ticker: "Z", close_time: Number.NaN },
    { table: "desk_lag_events", ticker: "L", t: "" },
    { table: "desk_basis_minutes", t: undefined },
    { table: "desk_path_parity", ticker: "P", close_time: "2026-08-01T12:00:00.000Z" },
  ];
  const p = plan(rows);
  assert.equal(p.totals.identity_gap, 5);
  assert.equal(p.totals.archive, 1);
  const reasons = p.tables.flatMap((t) => t.identity_gaps.map((g) => g.reason));
  assert.ok(reasons.includes("missing-or-unparseable-timestamp") || reasons.includes("missing-or-unparseable-close_time"));
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("bogus"), null);
  assert.equal(parseTime(1_700_000_000), null, "seconds-since-epoch are rejected");
});

test("a missing ticker on a window table is an identity gap", () => {
  const gap = rowIdentity({ table: "desk_absorption", ticker: "  ", close_time: "2026-08-01T12:00:00.000Z" });
  assert.equal(gap.ok, false);
  if (!gap.ok) assert.equal(gap.reason, "missing-ticker");
});

test("duplicate ticker+close_time is ambiguous and is not archived", () => {
  const rows: PlannerRow[] = [
    { table: "desk_replay", ticker: "DUP", close_time: "2026-08-20T12:00:00.000Z" },
    { table: "desk_replay", ticker: "DUP", close_time: "2026-08-20T12:00:00.000Z" },
  ];
  const replay = tablePlan(rows, "desk_replay");
  assert.equal(replay.archived_row_count, 1, "the first occurrence may archive");
  assert.equal(replay.identity_gap_row_count, 1, "the duplicate is fail-closed");
  assert.equal(replay.identity_gaps[0]?.reason, "duplicate-identity");
});

test("partial and suspect rows stay traceable and are still archive-eligible", () => {
  const close = "2026-08-20T12:00:00.000Z";
  const rows: PlannerRow[] = [
    { table: "desk_replay", ticker: "P1", close_time: close, research_quality: "partial" },
    { table: "desk_replay", ticker: "S1", close_time: close, research_quality: "suspect" },
    { table: "desk_replay", ticker: REUSE, close_time: "2026-09-10T08:45:00.000Z", research_quality: "excluded" },
  ];
  const replay = tablePlan(rows, "desk_replay");
  // 08:45 on 2026-09-10 is only ~5 days before NOW, so retain; quality still traced.
  assert.equal(replay.quality_trace.partial, 1);
  assert.equal(replay.quality_trace.suspect, 1);
  assert.equal(replay.quality_trace.excluded, 1);
  assert.equal(replay.archived_row_count, 2, "partial and suspect in the 14-29d band still archive");
  assert.equal(replay.retained_row_count, 1, "excluded reuse-block row is recent, so retained");
  const excluded = qualityOf("2026-09-10T08:45:00.000Z");
  assert.equal(excluded.quality, "excluded");
  assert.equal(excluded.rule, "2026-09-10-ticker-reuse");
  assert.ok(rowIdentity(rows[0]!).ok, "partial remains addressable by ticker+close_time");
  assert.ok(rowIdentity(rows[1]!).ok, "suspect remains addressable by ticker+close_time");
});

test("excluded reuse-block windows that fall in the archive band stay labeled", () => {
  const rows: PlannerRow[] = [
    {
      table: "desk_path_parity",
      ticker: REUSE,
      close_time: "2026-09-10T08:00:00.000Z",
      research_quality: "excluded",
    },
  ];
  // Force the close into the archive band by planning against a later now.
  const later = planArchive(rows, { nowMs: Date.parse("2026-10-01T00:00:00.000Z"), sourceIdentity: SRC });
  const parity = later.tables.find((t) => t.table === "desk_path_parity")!;
  assert.equal(parity.archived_row_count, 1);
  assert.equal(parity.quality_trace.excluded, 1);
  assert.equal(parity.identity_gap_row_count, 0);
});

test("demo fixtures produce a readable dry-run without writes", () => {
  const report = planArchive(demoRows(), { nowMs: DEMO_NOW_MS, sourceIdentity: DEMO_SOURCE });
  assert.equal(report.dry_run, true);
  assert.equal(report.writes, false);
  assert.equal(report.deletes, false);
  assert.ok(report.totals.archive > 0);
  assert.ok(report.totals.retain > 0);
  assert.ok(report.totals.identity_gap > 0);
  const replay = report.tables.find((t) => t.table === "desk_replay")!;
  assert.equal(replay.outside_window_row_count, 1);
  assert.ok(replay.proposed_partitions.every((p) => p.object_key.includes("desk_replay")));
});

test("CLI live inspect sizes rows with alias.* and replay cols, never a bare table name", () => {
  const src = readFileSync(CLI, "utf8");
  assert.match(src, /pg_column_size\(p\.\*\)/);
  assert.match(src, /pg_column_size\(e\.\*\)/);
  assert.match(src, /pg_column_size\(a\.\*\)/);
  assert.match(src, /pg_column_size\(b\.\*\)/);
  assert.match(src, /pg_column_size\(r\.cols\)/);
  assert.doesNotMatch(src, /pg_column_size\(desk_path_parity\)/);
  assert.doesNotMatch(src, /pg_column_size\(desk_lag_events\)/);
  assert.doesNotMatch(src, /pg_column_size\(desk_absorption\)/);
  assert.doesNotMatch(src, /pg_column_size\(desk_basis_minutes\)/);
  assert.doesNotMatch(src, /pg_column_size\(desk_replay\)/);
});

test("write flags are rejected even when paired with --demo", () => {
  assert.deepEqual([...FORBIDDEN_WRITE_FLAGS], ["--apply", "--upload", "--delete", "--purge"]);
  assert.equal(rejectedWriteFlag(["--demo"]), null);
  assert.equal(rejectedWriteFlag([]), null);
  for (const flag of FORBIDDEN_WRITE_FLAGS) {
    assert.equal(rejectedWriteFlag([flag]), flag);
    assert.equal(rejectedWriteFlag(["--demo", flag]), flag);
    assert.equal(rejectedWriteFlag([`${flag}=1`]), flag);
  }
});

test("CLI process exits nonzero for --apply --upload --delete --purge", () => {
  for (const flag of FORBIDDEN_WRITE_FLAGS) {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", CLI, flag], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });
    assert.notEqual(r.status, 0, flag);
    assert.match(r.stderr, new RegExp(flag.slice(2)), flag);
    assert.match(r.stderr, /inspect-only|refused/i, flag);
    assert.doesNotMatch(r.stdout, /"writes":\s*true/);
  }
  const demoApply = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--demo", "--apply"], {
    encoding: "utf8",
  });
  assert.notEqual(demoApply.status, 0);
  assert.match(demoApply.stderr, /--apply/);
});
