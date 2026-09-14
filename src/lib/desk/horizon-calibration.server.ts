/**
 * Cached, public aggregate for the Lab's fixed-horizon seat study.
 *
 * This is a read-only projection over valid, complete replay evidence. It has
 * no path to the Chair, learner, promotion gates, policy book, or any writer.
 */
import { getSql } from "@/lib/db";
import {
  buildSeatHorizonReport,
  type HorizonReplayRow,
  type SeatHorizonReport,
} from "./horizon-calibration";

const WINDOW_CAP = 700;
const CACHE_MS = 5 * 60_000;

export type PublicSeatHorizonSnapshot = SeatHorizonReport & {
  at: string;
  window_cap: number;
  evidence: "valid-complete-replays";
  authority: "none";
};

let cache: { expiresAt: number; value: PublicSeatHorizonSnapshot } | null = null;
let pending: Promise<PublicSeatHorizonSnapshot> | null = null;

async function buildSnapshot(): Promise<PublicSeatHorizonSnapshot> {
  const sql = await getSql();
  const rows = await sql<HorizonReplayRow>`
    select
      r.close_time,
      l.winner,
      jsonb_build_object(
        't0', r.cols->'t0',
        't', r.cols->'t',
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
  const value: PublicSeatHorizonSnapshot = {
    ...buildSeatHorizonReport(rows),
    at: new Date().toISOString(),
    window_cap: WINDOW_CAP,
    evidence: "valid-complete-replays",
    authority: "none",
  };
  cache = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

/** Return a five-minute cached report and coalesce concurrent cold requests. */
export async function seatHorizonSnapshot(): Promise<PublicSeatHorizonSnapshot> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  pending ??= buildSnapshot().finally(() => {
    pending = null;
  });
  return pending;
}
