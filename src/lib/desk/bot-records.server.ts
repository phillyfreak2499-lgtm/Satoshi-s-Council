/** Public research summary. No learner, booking path, model or writer. */
import { getSql } from "@/lib/db";
import { SEAT_IDS } from "./types";
import { NON_VOTERS, RETIRED_SEATS } from "./crew";
export async function botRecords(at=Date.now()) {
  const sql=await getSql(),start=new Date(at-7*86_400_000).toISOString(),end=new Date(at).toISOString();
  const rows=await sql<{seat:string;windows:number;raw_n:number;raw_hits:number;final_n:number;final_hits:number;suppressed:number}>`
    select s.key as seat,count(*)::int as windows,
      count(*) filter(where s.value->>'raw_lean' in ('UP','DOWN'))::int as raw_n,
      count(*) filter(where s.value->>'raw_lean'=l.winner)::int as raw_hits,
      count(*) filter(where s.value->>'lean' in ('UP','DOWN'))::int as final_n,
      count(*) filter(where s.value->>'lean'=l.winner)::int as final_hits,
      count(*) filter(where s.value->>'raw_lean' in ('UP','DOWN') and s.value->>'lean'='WAIT')::int as suppressed
    from desk_ledger_research l cross join lateral jsonb_each(l.seats) s
    where l.close_time>=${start}::timestamptz and l.close_time<${end}::timestamptz
      and l.source='kalshi-result' and l.winner in ('UP','DOWN') group by s.key`;
  return {at:end,start,end,cohort:"official research-qualified terminal window reads" as const,
    rows:SEAT_IDS.map(seat=>({...(rows.find(r=>r.seat===seat)??{windows:0,raw_n:0,raw_hits:0,final_n:0,final_hits:0,suppressed:0}),
      seat,role:NON_VOTERS.includes(seat)?"context":RETIRED_SEATS[seat]?"retired":"voter"}))};
}
