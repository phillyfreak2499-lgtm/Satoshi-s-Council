-- Research only. Separate from every production book and learner table.
create table if not exists desk_execution_lab_meta (
  experiment text primary key,
  start_ms bigint not null,
  end_ms bigint not null,
  protocol jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists desk_execution_lab_windows (
  experiment text not null,
  ticker text not null,
  close_ms bigint not null,
  build_sha text not null,
  capture jsonb not null,
  results jsonb,
  recorded_at timestamptz not null default now(),
  primary key (experiment,ticker,close_ms)
);
create index if not exists desk_execution_lab_pending on desk_execution_lab_windows (experiment,close_ms) where results is null;
