#!/usr/bin/env node
/**
 * Phase 1 dry-run archive planner.
 *
 *   npm run archive:plan -- --demo
 *   npm run archive:plan
 *
 * Inspect only. SELECT identity columns when DATABASE_URL is set.
 * `--demo` runs the fixture planner with no database at all.
 *
 * NEVER:
 *   INSERT / UPDATE / DELETE / COPY / TRUNCATE
 *   import server-engine, Chair, seats, grading, or pruneReplays
 *   write into desk_archive_manifest (that is a later phase)
 *   attach a disk or talk to object storage
 */
import {
  ARCHIVE_TABLES,
  DEMO_NOW_MS,
  DEMO_SOURCE,
  demoRows,
  planArchive,
  type ArchivePlan,
  type ArchiveTable,
  type PlannerRow,
} from "../src/lib/desk/archive-planner.ts";

function wantsDemo(argv: readonly string[]): boolean {
  return argv.includes("--demo");
}

function sourceIdentityFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "unknown";
    return `pg:${u.hostname}/${db}`;
  } catch {
    return "pg:unknown";
  }
}

async function inspectDatabase(url: string): Promise<PlannerRow[]> {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const rows: PlannerRow[] = [];
  try {
    const queries: Array<{ table: ArchiveTable; sql: string }> = [
      {
        table: "desk_path_parity",
        sql: `select ticker, close_time,
                     pg_column_size(desk_path_parity) as estimated_bytes,
                     l.research_quality
                from desk_path_parity
                left join desk_ledger l
                  on l.ticker = desk_path_parity.ticker
                 and l.close_time = desk_path_parity.close_time`,
      },
      {
        table: "desk_lag_events",
        sql: `select ticker, t, pg_column_size(desk_lag_events) as estimated_bytes
                from desk_lag_events`,
      },
      {
        table: "desk_absorption",
        sql: `select ticker, close_time, t,
                     pg_column_size(desk_absorption) as estimated_bytes,
                     l.research_quality
                from desk_absorption
                left join desk_ledger l
                  on l.ticker = desk_absorption.ticker
                 and l.close_time = desk_absorption.close_time`,
      },
      {
        table: "desk_basis_minutes",
        sql: `select minute as t, pg_column_size(desk_basis_minutes) as estimated_bytes
                from desk_basis_minutes`,
      },
      {
        table: "desk_replay",
        sql: `select ticker, close_time,
                     coalesce(pg_column_size(cols), 0) as estimated_bytes,
                     l.research_quality
                from desk_replay
                left join desk_ledger l
                  on l.ticker = desk_replay.ticker
                 and l.close_time = desk_replay.close_time`,
      },
    ];
    for (const q of queries) {
      const res = await client.query(q.sql);
      for (const r of res.rows) {
        rows.push({
          table: q.table,
          ticker: r.ticker ?? null,
          close_time: r.close_time ?? null,
          t: r.t ?? null,
          estimated_bytes: r.estimated_bytes == null ? null : Number(r.estimated_bytes),
          research_quality: r.research_quality ?? null,
        });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  return rows;
}

function printPlan(plan: ArchivePlan): void {
  process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (wantsDemo(argv)) {
    printPlan(planArchive(demoRows(), { nowMs: DEMO_NOW_MS, sourceIdentity: DEMO_SOURCE }));
    return 0;
  }

  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error:
          "DATABASE_URL is not set. Re-run with --demo for fixture output, or set DATABASE_URL for a read-only inspect of the five candidate tables.",
      }) + "\n",
    );
    return 1;
  }

  const rows = await inspectDatabase(url);
  const plan = planArchive(rows, {
    nowMs: Date.now(),
    sourceIdentity: sourceIdentityFromUrl(url),
  });
  printPlan(plan);
  void ARCHIVE_TABLES;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
    process.exit(1);
  });
