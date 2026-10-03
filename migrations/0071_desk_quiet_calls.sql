-- QUIET_CALL_LEDGER_V1 (research only, authority NONE).
-- Strictly additive and idempotent: only new tables/indexes; no legacy schema or rows changed.
-- One row per (window, seat): the seat's mandatory directional quiet call, captured at the
-- first usable tick with < 12 min left and graded at settlement with capture-tick asks.
-- Nothing here is read by any vote, weight, gate, threshold, floor, status or Chair path.
create table if not exists desk_quiet_calls (
  ticker         text not null,
  close_time     timestamptz not null,
  seat           text not null,
  captured_at    timestamptz not null,
  mins_left      double precision not null,
  regime_key     text not null,
  side           text not null check (side in ('UP','DOWN')),
  conf_raw       double precision not null,
  p_used         double precision not null check (p_used >= 0.5 and p_used <= 0.99),
  source         text not null check (source in ('RAW','PAPER','TILT','NONE','CONTROL')),
  paper_card_id  text,
  closed_card    boolean not null default false,
  admitted_lean  text not null,
  admitted_state text not null,
  skill_used     text not null,
  yes_ask        double precision,
  no_ask         double precision,
  yes_mid        double precision,
  build_sha      text not null,
  grade_status   text not null default 'PENDING'
                 check (grade_status in ('PENDING','GRADED','SKIPPED_CHALK','SKIPPED_UNCOUNTABLE','SKIPPED_IDENTITY')),
  finish         text check (finish in ('UP','DOWN')),
  hit            smallint check (hit in (0,1)),
  cents          double precision,
  coin_cents     double precision,
  graded_at      timestamptz,
  primary key (ticker, close_time, seat)
);
create index if not exists desk_quiet_calls_close_idx on desk_quiet_calls(close_time desc);
create index if not exists desk_quiet_calls_seat_idx on desk_quiet_calls(seat, close_time desc);

-- Window-level capture status, so a window with no usable tick in the entry window is
-- recorded as MISSED rather than silently absent (coverage feeds kill check K0).
create table if not exists desk_quiet_windows (
  ticker     text not null,
  close_time timestamptz not null,
  status     text not null check (status in ('CAPTURED','MISSED')),
  noted_at   timestamptz not null default now(),
  primary key (ticker, close_time)
);
