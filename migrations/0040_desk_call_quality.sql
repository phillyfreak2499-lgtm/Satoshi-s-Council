-- New, prospective timing experiment. No backfill, guessed outcomes or policy writes.
create table if not exists desk_call_quality (
  study text not null,
  ticker text not null,
  close_time timestamptz not null,
  horizon integer not null check (horizon in (450, 300, 180)),
  taken_at timestamptz not null,
  entry_policy text not null,
  capture_valid boolean not null,
  receipt jsonb not null,
  build_sha text not null default '',
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (study, ticker, close_time, horizon),
  check (taken_at < close_time),
  check (recorded_at < close_time),
  check (extract(epoch from close_time - taken_at) >= horizon),
  check (extract(epoch from close_time - taken_at) < horizon + 12)
);
create index if not exists desk_call_quality_time on desk_call_quality (study, close_time desc);

-- Keep the earlier v3 experiment distinguishable from the corrected population.
alter table desk_v3_samples add column if not exists measurement_version text not null default 'legacy-unfiltered';
