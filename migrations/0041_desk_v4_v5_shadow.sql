-- V4 forced-direction + V5 profit-hunter prospective shadow research.
--
-- Both systems are PAPER-ONLY and have no execution authority. V4 must choose
-- UP or DOWN once per observed window. V5 may enter, exit and flip a one-contract
-- paper position any number of times when its expected-value comparison says the
-- action is better after executable spread + fees.
--
-- Predictions/trades are immutable. Outcomes are joined later from the official
-- research ledger; no winner is stored at decision time.

create table if not exists desk_v4_frames (
  ticker              text not null,
  close_time          timestamptz not null,
  frame_bucket        bigint not null,
  taken_at            timestamptz not null,
  secs_left           double precision not null,
  side                text not null check (side in ('UP','DOWN')),
  p_up                double precision not null check (p_up >= 0 and p_up <= 1),
  market_p            double precision not null check (market_p >= 0 and market_p <= 1),
  model_n             integer not null default 0,
  features            jsonb not null,
  measurement_version text not null,
  build_sha           text not null default '',
  created_at          timestamptz not null default clock_timestamp(),
  primary key (ticker, close_time, frame_bucket),
  check (taken_at < close_time)
);
create index if not exists desk_v4_frames_close_idx on desk_v4_frames (close_time desc);
create index if not exists desk_v4_frames_taken_idx on desk_v4_frames (taken_at desc);

create table if not exists desk_v4_calls (
  ticker              text not null,
  close_time          timestamptz not null,
  locked_at           timestamptz not null,
  secs_left           double precision not null,
  side                text not null check (side in ('UP','DOWN')),
  p_up                double precision not null check (p_up >= 0 and p_up <= 1),
  market_p            double precision not null check (market_p >= 0 and market_p <= 1),
  model_n             integer not null default 0,
  lock_reason         text not null check (lock_reason in ('STABLE_PEAK','DEADLINE')),
  features            jsonb not null,
  measurement_version text not null,
  build_sha           text not null default '',
  created_at          timestamptz not null default clock_timestamp(),
  primary key (ticker, close_time),
  check (locked_at < close_time)
);
create index if not exists desk_v4_calls_close_idx on desk_v4_calls (close_time desc);

create table if not exists desk_v5_windows (
  ticker              text not null,
  close_time          timestamptz not null,
  first_seen_at       timestamptz not null,
  measurement_version text not null,
  build_sha           text not null default '',
  created_at          timestamptz not null default clock_timestamp(),
  primary key (ticker, close_time),
  check (first_seen_at < close_time)
);
create index if not exists desk_v5_windows_close_idx on desk_v5_windows (close_time desc);

create table if not exists desk_v5_trades (
  ticker              text not null,
  close_time          timestamptz not null,
  seq                 integer not null check (seq > 0),
  traded_at           timestamptz not null,
  action              text not null check (action in ('ENTER','EXIT','FLIP')),
  from_side           text check (from_side is null or from_side in ('UP','DOWN')),
  to_side             text check (to_side is null or to_side in ('UP','DOWN')),
  sell_cents          double precision,
  buy_cents           double precision,
  fees_cents          double precision not null check (fees_cents >= 0),
  cashflow_cents      double precision not null,
  p_up                double precision not null check (p_up >= 0 and p_up <= 1),
  market_p            double precision not null check (market_p >= 0 and market_p <= 1),
  expected_gain_cents double precision not null,
  reason              text not null,
  measurement_version text not null,
  build_sha           text not null default '',
  created_at          timestamptz not null default clock_timestamp(),
  primary key (ticker, close_time, seq),
  foreign key (ticker, close_time) references desk_v5_windows (ticker, close_time),
  check (traded_at < close_time),
  check (
    (action = 'ENTER' and from_side is null and to_side is not null and buy_cents is not null and sell_cents is null)
    or
    (action = 'EXIT' and from_side is not null and to_side is null and sell_cents is not null and buy_cents is null)
    or
    (action = 'FLIP' and from_side is not null and to_side is not null and from_side <> to_side and sell_cents is not null and buy_cents is not null)
  )
);
create index if not exists desk_v5_trades_close_idx on desk_v5_trades (close_time desc);
create index if not exists desk_v5_trades_time_idx on desk_v5_trades (traded_at desc);
