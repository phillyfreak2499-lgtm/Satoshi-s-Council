-- Prospective diagnostic evidence only. Old grades remain unchanged and NULL.
alter table desk_ledger add column if not exists skill_score_audit jsonb;
comment on column desk_ledger.skill_score_audit is
  'Read-only SKILL_SCORE_AUDIT_V1 receipt for actual grading inputs and counter deltas. Signal strength is not a calibrated probability. No historical backfill.';

-- Keep the select-* research view's columns in sync. Its quality filter stays
-- intact; neither this refresh nor the additive column changes a stored grade.
drop view if exists desk_ledger_research;
create view desk_ledger_research as
  select * from desk_ledger where research_quality = 'valid';
