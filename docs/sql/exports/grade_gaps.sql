-- 12. grade_gaps: ungraded/excluded windows, booked exposure, reason, official availability, treatment.
with slots as (
  select generate_series(date_trunc('hour', :from::timestamptz), :to::timestamptz, interval '15 minutes') as close_time),
present as (select ticker, close_time, entry_cents, research_quality, research_quality_rule, official_value, winner, settle_cents from desk_ledger)
select s.close_time,
  case when p.close_time is null then 'missing_window' when p.research_quality <> 'valid' then 'excluded' when p.entry_cents is not null and p.settle_cents is null then 'booked_ungraded' else 'ok' end as gap_kind,
  p.ticker, p.entry_cents as booked_exposure_ask, case when p.entry_cents is not null then p.entry_cents + ceil(0.07 * p.entry_cents * (100 - p.entry_cents) / 100.0) end as booked_full_loss_exposure,
  p.research_quality_rule as reason, p.official_value is not null as official_available, p.winner,
  case when p.close_time is null then 'not counted anywhere; visible in Books missing_windows' when p.research_quality <> 'valid' then 'kept in desk_ledger; excluded from desk_ledger_research and every total' when p.entry_cents is not null and p.settle_cents is null then 'pending: full loss reserved, never netted' else 'counted' end as financial_and_research_treatment
from slots s left join present p on p.close_time = s.close_time
where p.close_time is null or p.research_quality <> 'valid' or (p.entry_cents is not null and p.settle_cents is null)
order by s.close_time;
