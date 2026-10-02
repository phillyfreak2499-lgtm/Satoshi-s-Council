-- Read-only diagnostics. Fixed Chicago report-day cohort; do not insert grades.
-- Terminal reads: these are NOT entry-time predictions.
select (seats->'DRIFT'->>'lean'='WAIT') as raw_held,
 count(*) as n,count(*) filter(where seats->'DRIFT'->>'raw_lean'=winner) as hits
from desk_ledger_research
where close_time>=timestamptz '2026-09-25 05:00:00+00'
 and close_time<timestamptz '2026-10-02 05:00:00+00'
 and source='kalshi-result' and winner in ('UP','DOWN')
 and seats->'DRIFT'->>'raw_lean' in ('UP','DOWN') group by 1;

-- All first captured gagged reads at least two minutes before close.
-- Crucially does NOT select windows using their terminal bot state.
with firsts as (
 select distinct on (r.ticker,r.close_time) r.ticker,r.close_time,r.as_of,r.raw_lean,l.winner
 from desk_seat_reads r join desk_ledger_research l
 on l.ticker=r.ticker and l.close_time=r.close_time
 where r.seat='DRIFT'
 and r.close_time>=timestamptz '2026-09-25 05:00:00+00'
 and r.close_time<timestamptz '2026-10-02 05:00:00+00'
 and r.raw_lean in ('UP','DOWN') and r.suppression_reason='below_speak_conf'
 and r.as_of>=r.close_time-interval '15 minutes'
 and r.as_of<=r.close_time-interval '2 minutes'
 and l.source='kalshi-result' and l.winner in ('UP','DOWN')
 order by r.ticker,r.close_time,r.as_of)
select count(*) as n,count(*) filter(where raw_lean=winner) as hits,
 min(close_time) as first_close,max(close_time) as last_close from firsts;

-- Separate generated shadow candidates from selected production directions.
select seat,count(*) as ticks,
 count(*) filter(where raw_lean in ('UP','DOWN')) as raw_directional,
 count(*) filter(where final_lean in ('UP','DOWN')) as final_directional,
 count(*) filter(where shadow_lean in ('UP','DOWN')) as shadow_directional,
 count(distinct (ticker,close_time)) as windows,
 array_agg(distinct suppression_reason) as suppression_reasons,
 array_agg(distinct skill_status) as selected_statuses
from desk_seat_reads
where as_of>=timestamptz '2026-10-01 00:00:00+00'
 and as_of<timestamptz '2026-10-02 11:00:00+00'
 and seat in ('WICK','TAPE','PULSE','VEL','VOLT','WHALE','CARRY','CASCADE','EXHAUST','STREAK')
group by seat order by seat;
