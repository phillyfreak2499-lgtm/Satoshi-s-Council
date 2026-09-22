#!/usr/bin/env node
/**
 * PHASE A reconciliation command: one economic book, explicit populations.
 *
 *   DATABASE_URL=... npm run reconcile:book
 *   DATABASE_URL=... npm run reconcile:book -- --as-of 2026-09-22T00:00:00Z --since 2026-09-01T00:00:00Z
 *
 * Read-only SELECT. Rebuilds /books' four periods through the shared read model
 * (economics-book.ts) and compares them with an independent reference query at
 * the SAME as-of, then prints the era books, the rolling-vs-recap anti-join and
 * a manifest with query hashes, the fee fingerprint and the policy fingerprint.
 * Prints JSON (first line) then a table. Exit status is nonzero only on an
 * execution failure; a reconciliation MISMATCH is a finding, not an error.
 *
 * Never wired into the engine, a timer or a route. Manual only.
 */
import { execSync } from "node:child_process";
import { reconcileBook } from "../src/lib/desk/economics-book.server.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : fallback;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("reconcile:book refuses to start without DATABASE_URL (read-only SELECT).");
    process.exit(2);
  }
  const asOfIso = arg("--as-of", new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString());
  const sinceIso = arg("--since", "2026-09-01T00:00:00Z");
  let sourceSha = "UNKNOWN";
  try { sourceSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
  const r = await reconcileBook({ asOfIso, sinceIso, sourceSha });
  console.log(JSON.stringify({
    version: r.version, model_version: r.model_version, as_of: r.as_of, since: r.since, source_sha: r.source_sha,
    fee_fingerprint: r.fee_fingerprint, policy_fingerprint: r.policy_fingerprint, ledger_query_sha256: r.ledger_query_sha256,
    reference_query_sha256: r.reference_query_sha256, rows_read: r.rows_read,
    reconciled: r.scopes.filter((s) => s.reconciled != null).map((s) => ({ scope: s.scope_id, ok: s.reconciled })),
  }));
  console.log("");
  const line = (s: string) => console.log(s);
  line(`scope                    windows  fills(hold/legacy/pend)  offWins  WR%    needed%  net¢     legacy¢  DD¢     ref?`);
  for (const s of r.scopes) {
    const b = s.book;
    line(`${s.scope_id.padEnd(24)} ${String(b.windows).padStart(7)}  ${String(b.settled_hold_fills).padStart(4)}/${String(b.legacy_exit_fills).padStart(3)}/${String(b.pending_fills).padStart(3)}            ${String(b.official_wins).padStart(6)}  ${String(b.official_wr_pct ?? "—").padStart(5)}  ${String(b.needed_wr_pct ?? "—").padStart(6)}  ${String(b.net_cents).padStart(7)}  ${String(b.legacy_net_cents).padStart(7)}  ${String(b.max_drawdown_cents).padStart(6)}  ${s.reconciled == null ? "n/a" : s.reconciled ? "MATCH" : "MISMATCH"}`);
    for (const c of s.cells) if (!c.equal) line(`    ${c.cell}: model ${c.model} vs reference ${c.reference}`);
  }
  line("");
  line("eras:");
  for (const e of r.eras) line(`  ${e.scope.id.padEnd(26)} windows ${e.windows} fills ${e.settled_hold_fills}+${e.legacy_exit_fills}L wins ${e.official_wins} WR ${e.official_wr_pct ?? "—"} needed ${e.needed_wr_pct ?? "—"} net ${e.net_cents} legacy ${e.legacy_net_cents} DD ${e.max_drawdown_cents} cvar5 ${e.cvar5.value}${e.cvar5.descriptive ? " (descriptive)" : ""} ttr ${e.time_to_recover.censored ? "censored" : e.time_to_recover.hours + "h"}`);
  line("");
  const d = r.week_definitions_diff;
  line(`rolling-168h vs recap-week fills: missing_in_recap ${d.missing_in_b.length}, extra_in_recap ${d.extra_in_b.length}, pending_in_one ${d.pending_in_one.length}`);
  for (const n of r.notes) line(`note: ${n}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
