/**
 * Cached public projection for DISAGREEMENT_EDGE_V1.
 *
 * Reads the desk's already-frozen call-quality checkpoints instead of loading
 * full replay arrays. No writer or decision path imports this module.
 */
import { getSql } from "@/lib/db";
import {
  buildDisagreementEdgeReport,
  type DisagreementCheckpointRow,
  type DisagreementEdgeReport,
} from "./disagreement-edge";

const WINDOW_CAP = 700;
const CACHE_MS = 5 * 60_000;
const STUDY = "entry-time-v1";

export type PublicDisagreementEdgeSnapshot = DisagreementEdgeReport & {
  at: string;
  window_cap: number;
  evidence: "valid-call-quality-checkpoints";
  authority: "none";
};

let cache: { expiresAt: number; value: PublicDisagreementEdgeSnapshot } | null = null;
let pending: Promise<PublicDisagreementEdgeSnapshot> | null = null;

async function buildSnapshot(): Promise<PublicDisagreementEdgeSnapshot> {
  const sql = await getSql();
  const rows = await sql<DisagreementCheckpointRow>`
    with recent as materialized (
      select q.ticker, q.close_time
      from desk_call_quality q
      join desk_ledger_research l
        on l.ticker = q.ticker
       and l.close_time = q.close_time
      where q.study = ${STUDY}
        and q.capture_valid = true
        and l.source = 'kalshi-result'
        and l.research_quality = 'valid'
        and l.winner in ('UP', 'DOWN')
      group by q.ticker, q.close_time
      order by q.close_time desc
      limit ${WINDOW_CAP}
    )
    select
      q.ticker,
      q.close_time,
      q.horizon,
      (q.receipt->>'market_p')::double precision as market_p,
      q.receipt->'quotes' as quotes,
      q.receipt->'seats' as seats,
      l.winner
    from recent r
    join desk_call_quality q
      on q.ticker = r.ticker
     and q.close_time = r.close_time
    join desk_ledger_research l
      on l.ticker = q.ticker
     and l.close_time = q.close_time
    where q.study = ${STUDY}
      and q.capture_valid = true
      and q.horizon in (450, 300, 180)
      and l.source = 'kalshi-result'
      and l.research_quality = 'valid'
      and l.winner in ('UP', 'DOWN')
      and q.receipt->>'market_p' is not null
    order by q.close_time desc, q.horizon desc
  `;

  const value: PublicDisagreementEdgeSnapshot = {
    ...buildDisagreementEdgeReport(rows),
    at: new Date().toISOString(),
    window_cap: WINDOW_CAP,
    evidence: "valid-call-quality-checkpoints",
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
