-- Measurement-only spot-path summary derived once from the completed replay.
--
-- This column has no trigger, default, backfill or decision-path consumer.
-- Existing windows remain NULL rather than being silently reconstructed under a
-- definition that did not exist when they were recorded. New rows are stamped
-- with a version inside the JSON payload.
alter table desk_replay
  add column if not exists path_stats jsonb;
