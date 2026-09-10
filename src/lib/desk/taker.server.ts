import { getSql } from "@/lib/db";
import { chairDecisionOf } from "./booked-side";
import { takerReport, type TakerReport, type TakerRow } from "./taker";
import type { Lean } from "./types";

let cache: { at: number; report: TakerReport } | null = null;
const TTL_MS = 60_000;

const asLean = (v: unknown): Lean => (v === "UP" || v === "DOWN" ? v : "WAIT");

/**
 * The taker-flow experiment's read-out, joined to the ledger for the Council's
 * FINAL call on each window (so "when the chair waited" and "incremental beyond
 * the Council" use the graded chair stance, not the sample-time one). Read-only;
 * touches nothing the desk decides. Cached 60s.
 */
export async function takerExperiment(): Promise<TakerReport> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.report;
  const db = await getSql();
  const rows = await db<{
    eligible: boolean;
    lean: string;
    conf: number;
    regime: string;
    winner: string | null;
    ev_cents: number | null;
    chair_lean: string | null;
    chair_settle: number | null;
    chair_winner: string | null;
  }>`
    select t.eligible, t.lean, t.conf, t.regime, t.winner, t.ev_cents,
           coalesce(l.chair_lean, t.chair_lean) as chair_lean,
           l.settle_cents as chair_settle,
           l.winner as chair_winner
    from desk_taker t
    left join desk_ledger l on l.ticker = t.ticker and l.close_time = t.close_time
    order by t.close_time
  `;
  const mapped: TakerRow[] = rows.map((r) => ({
    eligible: Boolean(r.eligible),
    lean: asLean(r.lean),
    conf: Number(r.conf) || 0,
    regime: r.regime || "",
    winner: r.winner === "UP" || r.winner === "DOWN" ? r.winner : null,
    ev_cents: r.ev_cents == null ? null : Number(r.ev_cents),
    // What the Council DID on the window, so the "when the chair said WAIT"
    // cut cannot be polluted by held positions whose lean decayed to WAIT.
    chair_lean: chairDecisionOf(r.chair_lean, r.chair_settle, r.chair_winner === "UP" || r.chair_winner === "DOWN" ? r.chair_winner : null),
  }));
  const report = takerReport(mapped);
  cache = { at: Date.now(), report };
  return report;
}
