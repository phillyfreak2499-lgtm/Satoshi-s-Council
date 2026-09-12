#!/usr/bin/env node
/**
 * S2-7 — manual, read-only Kalshi reconciliation command.
 *
 *   npm run reconcile:kalshi            # default 90-day window
 *   npm run reconcile:kalshi -- 30      # explicit day count
 *   npm run reconcile:kalshi -- --days 30
 *
 * Runs the INDEPENDENT historical reconciliation (see kalshi-reconcile.ts):
 * a read-only SELECT of desk_ledger windows + a public Kalshi market GET per
 * window, comparing each recorded identity/outcome against the official external
 * record. It prints a machine-readable JSON report (first line) followed by
 * human-readable evidence for every non-MATCH outcome.
 *
 * STRICTLY READ-ONLY AND MANUAL:
 *   - SELECT + public GET only. No INSERT/UPDATE/DELETE/backfill.
 *   - No order/auth/trading code. The Kalshi fetch is the public, unauthenticated
 *     market-data endpoint.
 *   - Invoked by hand only. It is NOT wired into tick, the engine, a cron, an
 *     interval, or boot, and exposes nothing publicly.
 *   - Exit status is nonzero ONLY for an actual execution failure (no DB access,
 *     transport/parse error). A winner/value MISMATCH is a research finding, not
 *     an error, and exits 0.
 */
import { renderReconReport } from "../src/lib/desk/kalshi-reconcile.ts";

/** Day count from argv: `--days N`, `--days=N`, or a bare positive integer; default 90. */
function parseDays(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--days") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    const eq = /^--days=(\d+)$/.exec(a);
    if (eq) return Number(eq[1]);
    if (/^\d+$/.test(a) && Number(a) > 0) return Number(a);
  }
  return 90;
}

async function main(): Promise<number> {
  const days = parseDays(process.argv.slice(2));

  // This audit reads the production ledger and reaches the public Kalshi API. It
  // refuses to run against the local PGLite fallback: without DATABASE_URL there
  // is no historical ledger to reconcile. The guard precedes the db-touching
  // import below, so the module load takes the Neon path only.
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error:
          "DATABASE_URL is not set — the read-only Kalshi reconciliation requires " +
          "production/read-only DB access and public Kalshi egress. Run it from the deploy environment.",
      }) + "\n",
    );
    return 1;
  }

  // Imported AFTER the DATABASE_URL guard so db.ts initializes the Neon client and
  // never the PGLite bootstrap (which needs Vite's import.meta.glob).
  const { runReconciliation } = await import("../src/lib/desk/kalshi-reconcile.server.ts");
  const report = await runReconciliation({ days });
  process.stdout.write(renderReconReport(report) + "\n");
  // Mismatches are findings, not failures.
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
    // Nonzero only for a genuine execution failure — never merely because the
    // audit found mismatches.
    process.exit(1);
  });
