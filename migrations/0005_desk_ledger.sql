-- Permanent research record: one row per graded window. The rolling call log
-- keeps 80 rows for the floor; this keeps everything for review.
create table if not exists desk_ledger (
  id           serial primary key,
  ticker       text not null,
  close_time   timestamptz not null,
  graded_at    timestamptz not null default now(),
  source       text not null default '',
  winner       text not null,
  chair_lean   text not null,
  chair_conf   integer not null default 0,
  score        double precision not null default 0,
  bar          double precision not null default 0,
  sit_mass     double precision not null default 0,
  entry_cents  double precision,
  settle_cents double precision,
  ev_cents     double precision,
  calls        integer not null default 0,
  seats        jsonb not null default '{}'::jsonb
);
create index if not exists desk_ledger_close_idx on desk_ledger (close_time desc);
create unique index if not exists desk_ledger_win_idx on desk_ledger (ticker, close_time);
