-- UTC window closes identify exclusions even when no ticker was captured.
-- Separate from quote captures so later writes cannot erase the skip reason.
create table if not exists desk_execution_lab_exclusions (
  experiment text not null,
  close_ms bigint not null,
  reason text not null,
  primary key (experiment,close_ms)
);
-- A row-local latch also guards a grade racing with an exclusion write.
alter table desk_execution_lab_windows
  add column if not exists exclusion_reason text;
