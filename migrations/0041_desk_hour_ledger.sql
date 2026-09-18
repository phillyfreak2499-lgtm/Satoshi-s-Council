-- The hourly Bitcoin paper book (Kalshi series KXBTCD, CF Benchmarks close at
-- the top of the hour). A SEPARATE ledger from the 15-minute desk_ledger: no
-- foreign key, no view over it, no shared totals. Authority: none. Nothing in
-- this table feeds the Chair, the learner, the 15-minute paper book, or any
-- promotion gate. This migration creates structure only and writes no rows.
create table if not exists desk_hour_ledger (
  id             bigserial primary key,
  ticker         text not null,
  event_ticker   text not null default '',
  close_time     timestamptz not null,
  -- The contract is a strike ladder ("$X or above"), not the 15-minute UP/DOWN.
  strike         double precision,
  question       text not null default '',
  -- The hourly posture at the decision point. WAIT until an hourly rule exists.
  chair_lean     text not null default 'WAIT',
  -- A paper fill, if any: the side bought at the ask, the fee, and the grade.
  entry_side     text,
  entry_cents    double precision,
  entry_fee_cents double precision,
  settle_cents   double precision,
  ev_cents       double precision,
  -- Settlement: which side paid, and the official CF Benchmarks value.
  result         text,
  official_value double precision,
  source         text not null default '',
  graded_at      timestamptz,
  recorded_at    timestamptz not null default now(),
  build_sha      text not null default '',
  constraint desk_hour_ledger_lean check (chair_lean in ('WAIT', 'YES', 'NO')),
  constraint desk_hour_ledger_side check (entry_side is null or entry_side in ('YES', 'NO')),
  constraint desk_hour_ledger_result check (result is null or result in ('YES', 'NO'))
);
create unique index if not exists desk_hour_ledger_win_idx on desk_hour_ledger (ticker, close_time);
create index if not exists desk_hour_ledger_close_idx on desk_hour_ledger (close_time desc);
