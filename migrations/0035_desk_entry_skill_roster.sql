-- Prospective booked-paper-entry evidence. Existing rows remain NULL.
alter table desk_ledger add column if not exists entry_skill_roster jsonb;
comment on column desk_ledger.entry_skill_roster is
  'Immutable ENTRY_SKILL_ROSTER_V1 receipt captured at the exact booked paper tick; signal strength is not a calibrated probability. No historical backfill.';

drop view if exists desk_ledger_research;
create view desk_ledger_research as
  select * from desk_ledger where research_quality = 'valid';
