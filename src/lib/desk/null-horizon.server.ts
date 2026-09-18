/**
 * Read-only loader for NULL_HORIZON_V1.
 *
 * Same join and cap as horizon-calibration.server.ts. No path to the Chair,
 * learner, promotion gates, policy book, or any writer.
 */
import { getSql } from "../db.ts";
import {
  WINDOW_CAP,
  buildNullHorizonReport,
  type NullHorizonReplayRow,
  type NullHorizonReport,
} from "./null-horizon.ts";

export type PublicNullHorizonSnapshot = NullHorizonReport & {
  at: string;
  window_cap: number;
  evidence: "valid-complete-replays";
};

export async function loadNullHorizonRows(): Promise<NullHorizonReplayRow[]> {
  const sql = await getSql();
  return sql<NullHorizonReplayRow>`
    select
      r.ticker,
      r.close_time,
      r.strike,
      l.winner,
      r.cols
    from desk_replay r
    join desk_ledger_research l
      on l.ticker = r.ticker
     and l.close_time = r.close_time
    where r.partial = false
      and l.winner in ('UP', 'DOWN')
    order by r.close_time desc
    limit ${WINDOW_CAP}
  `;
}

export async function nullHorizonSnapshot(): Promise<PublicNullHorizonSnapshot> {
  const rows = await loadNullHorizonRows();
  return {
    ...buildNullHorizonReport(rows),
    at: new Date().toISOString(),
    window_cap: WINDOW_CAP,
    evidence: "valid-complete-replays",
  };
}
