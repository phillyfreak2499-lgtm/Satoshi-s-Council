-- Prospective private diagnostics from booked-entry reads and official outcomes.
-- Historical rows stay NULL; no probability forecast or automatic tuning is created.
alter table desk_ledger add column if not exists entry_skill_quality jsonb;
comment on column desk_ledger.entry_skill_quality is
  'ENTRY_SKILL_QUALITY_V1, only official-result eligible booked paper entries with same-tick V2 quotes. Hypothetical after-fee cents; signal strength is not a calibrated probability.';

drop view if exists desk_ledger_research;
create view desk_ledger_research as
  select * from desk_ledger where research_quality = 'valid';

