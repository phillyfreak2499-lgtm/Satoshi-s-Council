/**
 * Cached public projection for DISAGREEMENT_EDGE_V1.
 *
 * Reads retained, officially graded replay rows only. No writer or decision
 * path imports this module.
 */
import { getSql } from "@/lib/db";
import {
  buildDisagreementEdgeReport,
  type DisagreementEdgeReport,
  type DisagreementReplayRow,
} from "./disagreement-edge";

const WINDOW_CAP = 1000;
const CACHE_MS = 5 * 60_000;

export type PublicDisagreementEdgeSnapshot = DisagreementEdgeReport & {
  at: string;
  window_cap: number;
  evidence: "valid-complete-replays";
  authority: "none";
};

let cache: { expiresAt: number; value: PublicDisagreementEdgeSnapshot } | null = null;
let pending: Promise<PublicDisagreementEdgeSnapshot> | null = null;

async function buildSnapshot(): Promise<PublicDisagreementEdgeSnapshot> {
  const sql = await getSql();
  const rows = await sql<DisagreementReplayRow>`
    select
      r.close_time,
      l.winner,
      jsonb_build_object(
        't0', r.cols->'t0',
        't', r.cols->'t',
        'yes_bid', r.cols->'yes_bid',
        'yes_ask', r.cols->'yes_ask',
        'seats', r.cols->'seats'
      ) as cols
    from desk_replay r
    join desk_ledger_research l
      on l.ticker = r.ticker
     and l.close_time = r.close_time
    where r.partial = false
      and l.winner in ('UP', 'DOWN')
    order by r.close_time desc
    limit ${WINDOW_CAP}
  `;

  const value: PublicDisagreementEdgeSnapshot = {
    ...buildDisagreementEdgeReport(rows),
    at: new Date().toISOString(),
    window_cap: WINDOW_CAP,
    evidence: "valid-complete-replays",
    authority: "none",
  };
  cache = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

export async function disagreementEdgeSnapshot(): Promise<PublicDisagreementEdgeSnapshot> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  pending ??= buildSnapshot().finally(() => {
    pending = null;
  });
  return pending;
}
