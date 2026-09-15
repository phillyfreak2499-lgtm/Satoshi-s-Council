-- Prospective diagnostic evidence only. Old grades remain unchanged and NULL.
alter table desk_ledger add column if not exists skill_score_audit jsonb;
comment on column desk_ledger.skill_score_audit is
  'Read-only SKILL_SCORE_AUDIT_V1 receipt for actual grading inputs and counter deltas. Signal strength is not a calibrated probability. No historical backfill.';
