#!/usr/bin/env node
/**
 * NULL_HORIZON_V1 — manual, read-only Lab replay study.
 *
 *   DATABASE_URL=... npm run lab:null-horizon
 *   DATABASE_URL=... npm run lab:null-horizon -- --json   # machine-readable line only
 *
 * Replays the same 700 valid, complete windows the Lab's seat-timing study uses
 * and asks whether a horizon-weighted council beats a driftless null after fee.
 * See docs/NULL_HORIZON_V1.md for the arms, the booking rule and the gate.
 *
 * STRICTLY READ-ONLY AND MANUAL:
 *   - One SELECT over desk_replay joined to desk_ledger_research. No writes.
 *   - No path to the Chair, learner, promotion gates, skill status or the paper book.
 *   - Invoked by hand only. Not wired into tick, the engine, a cron or boot.
 *   - Exit status is nonzero ONLY for an execution failure (no DB access, query
 *     error). A gate that is not cleared is a finding, not an error, and exits 0.
 */
import { renderNullHorizonTable } from "../src/lib/desk/null-horizon.ts";

async function main(): Promise<number> {
  // The study reads the recorded replay ledger. It refuses the local PGLite
  // fallback: without DATABASE_URL there is no ledger to measure. The guard
  // precedes the db-touching import so db.ts takes the Neon path only.
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error:
          "DATABASE_URL is not set — NULL_HORIZON_V1 reads the recorded replay ledger " +
          "and does not run against the local PGLite fallback. Run it from the deploy environment.",
      }) + "\n",
    );
    return 1;
  }

  const { nullHorizonSnapshot } = await import("../src/lib/desk/null-horizon.server.ts");
  const report = await nullHorizonSnapshot();
  process.stdout.write(JSON.stringify(report) + "\n");
  if (!process.argv.slice(2).includes("--json")) {
    process.stdout.write(renderNullHorizonTable(report) + "\n");
  }
  // Cleared or not, the gate result is a finding. Only failures are failures.
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
    process.exit(1);
  });
