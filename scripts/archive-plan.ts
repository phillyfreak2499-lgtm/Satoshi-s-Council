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
 *   honor --apply / --upload / --delete / --purge (those exit nonzero)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_NOW_MS,
  DEMO_SOURCE,
  demoRows,
  planArchive,
  type ArchivePlan,
  type ArchiveTable,
  type PlannerRow,
} from "../src/lib/desk/archive-planner.ts";

export const FORBIDDEN_WRITE_FLAGS = ["--apply", "--upload", "--delete", "--purge"] as const;

/** First forbidden write flag on argv, or null. `--apply=1` counts as `--apply`. */
export function rejectedWriteFlag(argv: readonly string[]): string | null {
  const forbidden = new Set<string>(FORBIDDEN_WRITE_FLAGS);
  for (const raw of argv) {
    const flag = (raw.split("=")[0] ?? raw).trim();
    if (forbidden.has(flag)) return flag;
  }
  return null;
}

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
  const Pool = pg.Pool ?? pg.default?.Pool;
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const rows: PlannerRow[] = [];
  try {
    const queries: Array<{ table: ArchiveTable; sql: string }> = [
      {
        table: "desk_path_parity",
        sql: `select p.ticker, p.close_time,
                     pg_column_size(p.*) as estimated_bytes,
                     l.research_quality
                from desk_path_parity p
                left join desk_ledger l
                  on l.ticker = p.ticker
                 and l.close_time = p.close_time`,
      },
      {
        table: "desk_lag_events",
        sql: `select e.ticker, e.t, pg_column_size(e.*) as estimated_bytes
                from desk_lag_events e`,
      },
      {
        table: "desk_absorption",
        sql: `select a.ticker, a.close_time, a.t,
                     pg_column_size(a.*) as estimated_bytes,
                     l.research_quality
                from desk_absorption a
                left join desk_ledger l
                  on l.ticker = a.ticker
                 and l.close_time = a.close_time`,
      },
      {
        table: "desk_basis_minutes",
        sql: `select b.minute as t, pg_column_size(b.*) as estimated_bytes
                from desk_basis_minutes b`,
      },
      {
        table: "desk_replay",
        sql: `select r.ticker, r.close_time,
                     coalesce(pg_column_size(r.cols), 0) as estimated_bytes,
                     l.research_quality
                from desk_replay r
                left join desk_ledger l
                  on l.ticker = r.ticker
                 and l.close_time = r.close_time`,
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

function refuseWrite(flag: string): number {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: `${flag} is refused. Phase 1 is inspect-only: no upload, no delete, no purge, no apply, no manifest write.`,
    }) + "\n",
  );
  return 1;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const forbidden = rejectedWriteFlag(argv);
  if (forbidden) return refuseWrite(forbidden);

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
  return 0;
}

const invokedAsScript =
  Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedAsScript) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
      process.exit(1);
    });
}
