-- ASK_LEAD_SWAP_V1 measurement ledger.
-- How often the higher Kalshi ask changes sides inside a 15-minute window.
-- Paper research only. No Chair, book, learner or promotion authority.
create table if not exists desk_ask_lead_windows (
  ticker               text not null,
  close_time           timestamptz not null,
  study                text not null,
  version              integer not null,
  measurement_version  text not null,
  samples              integer not null default 0,
  ties                 integer not null default 0,
  invalid              integer not null default 0,
  swaps                integer not null default 0,
  first_lead           text,
  first_lead_secs      double precision,
  last_lead            text,
  last_lead_secs       double precision,
  first_swap_secs      double precision,
  last_swap_secs       double precision,
  b_15_10              integer not null default 0,
  b_10_5               integer not null default 0,
  b_5_2                integer not null default 0,
  b_last_2             integer not null default 0,
  session_pocket       text,
  finalized            boolean not null default false,
  updated_at           timestamptz not null default now(),
  build_sha            text,
  primary key (ticker, close_time)
);

create index if not exists desk_ask_lead_windows_close_idx
  on desk_ask_lead_windows (close_time desc);

create table if not exists desk_ask_lead_swaps (
  ticker      text not null,
  close_time  timestamptz not null,
  swap_n      integer not null,
  from_side   text not null,
  to_side     text not null,
  secs_left   double precision not null,
  bucket      text,
  yes_ask     double precision not null,
  no_ask      double precision not null,
  taken_at    timestamptz not null default now(),
  primary key (ticker, close_time, swap_n)
);

create index if not exists desk_ask_lead_swaps_close_idx
  on desk_ask_lead_swaps (close_time desc);
