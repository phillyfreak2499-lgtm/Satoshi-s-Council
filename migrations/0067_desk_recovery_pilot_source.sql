-- Label non-Chair paper positions prospectively. NULL continues to mean the
-- canonical Chair book. Existing rows remain NULL; nothing is backfilled.
alter table desk_ledger add column if not exists entry_source text;
comment on column desk_ledger.entry_source is
  'Non-Chair paper-position source. NULL is the canonical Chair book; RECOVERY_FAV85_V1 is the bounded owner-authorized recovery pilot.';

alter table desk_ledger drop constraint if exists desk_ledger_entry_source_check;
alter table desk_ledger add constraint desk_ledger_entry_source_check
  check (entry_source is null or entry_source = 'RECOVERY_FAV85_V1');

-- Refresh the select-* research view so the additive column is visible.
drop view if exists desk_booked_chair_mirror;
drop view if exists desk_ledger_research;
create view desk_ledger_research as
  select * from desk_ledger where research_quality = 'valid';

-- A recovery-pilot fill is deliberately not a booked Chair decision.
create view desk_booked_chair_mirror as
  select
    ticker,
    close_time,
    entry_build_sha,
    entry_lean as lean,
    entry_conf as confidence,
    entry_score as score,
    entry_bar as bar,
    entry_cents,
    settle_cents,
    winner,
    (entry_lean = winner) as hit,
    case
      when entry_conf between 0 and 100 then
        power(entry_conf / 100.0 - case when entry_lean = winner then 1.0 else 0.0 end, 2)
      else null
    end as brier,
    ev_cents
  from desk_ledger
  where research_quality = 'valid'
    and entry_source is null
    and entry_lean in ('UP', 'DOWN')
    and entry_cents is not null
    and settle_cents is not null
    and winner in ('UP', 'DOWN');
