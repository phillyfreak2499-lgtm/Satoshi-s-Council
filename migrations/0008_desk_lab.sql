-- The lab: receipts for the settlement rule and the stale-quote study.

-- One row per fair-value shock: what a taker could have hit, and what the
-- level did afterwards (survival by latency, markouts, who took it).
create table if not exists desk_lag_events (
  id            bigserial primary key,
  ticker        text not null,
  t             timestamptz not null,
  session       text not null,
  secs_left     double precision not null,
  final_minute  boolean not null default false,
  side          text not null,
  fair_before   double precision,
  fair_after    double precision,
  ask_before    integer,
  ask_size      double precision,
  misprice      double precision,
  fee           integer,
  net_edge      double precision,
  gone_ms       integer,
  gone_how      text,
  markout_100   double precision,
  markout_250   double precision,
  markout_500   double precision,
  markout_1000  double precision,
  fill_50       boolean,
  fill_100      boolean,
  fill_150      boolean,
  fill_200      boolean,
  fill_300      boolean,
  fill_500      boolean,
  winner        text,
  realized      double precision
);
create index if not exists desk_lag_events_t_idx on desk_lag_events (t desc);
create index if not exists desk_lag_events_ticker_idx on desk_lag_events (ticker);

-- Per-minute basis between our spot feeds and the settlement index, in bps.
create table if not exists desk_basis_minutes (
  minute            timestamptz primary key,
  session           text not null,
  n                 integer not null,
  binance_bps       double precision,
  binance_abs_bps   double precision,
  coinbase_bps      double precision,
  coinbase_abs_bps  double precision,
  brti_sigma1       double precision
);

-- Settlement receipts on the ledger: the index's final-minute average and
-- last print, how many of the 60 prints we saw, the average's gap to the
-- strike, our P(UP) entering the final minute, and whether each candidate
-- rule agreed with Kalshi's official result.
alter table desk_ledger add column if not exists settle_avg   double precision;
alter table desk_ledger add column if not exists settle_last  double precision;
alter table desk_ledger add column if not exists brti_prints  integer;
alter table desk_ledger add column if not exists settle_gap   double precision;
alter table desk_ledger add column if not exists fair_pre     double precision;
alter table desk_ledger add column if not exists rule_avg_ok  boolean;
alter table desk_ledger add column if not exists rule_last_ok boolean;
