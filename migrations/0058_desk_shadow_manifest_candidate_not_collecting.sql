-- Shadow lab: a fourth manifest status. CANDIDATE_NOT_COLLECTING is a frozen,
-- registered hypothesis that holds NO collection slot under the three-active
-- cap (MIRROR_35_V1, docs/SHADOW_EXPERIMENTS_2026-09-22.md). Research only:
-- no row here can vote, book, grade, tune, promote, veto or alter production
-- state. Additive; applying twice is a no-op (drop if exists, then add).
-- Rollback: re-add the 0057 check list without CANDIDATE_NOT_COLLECTING.
alter table desk_shadow_manifests drop constraint if exists desk_shadow_manifests_status_check;
alter table desk_shadow_manifests add constraint desk_shadow_manifests_status_check
  check (status in ('CANDIDATE', 'CANDIDATE_NOT_COLLECTING', 'SHADOW', 'PAUSED', 'BLOCKED', 'KILLED'));
