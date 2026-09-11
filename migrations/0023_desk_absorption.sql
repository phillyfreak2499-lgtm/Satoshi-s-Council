-- WHALE 2.0's prospective absorption study.
--
-- One row per real execution (or same-side burst counted as one decision), with
-- everything measured around it stored CONTINUOUSLY. No threshold is applied at
-- write time: what counts as "large" or "no response" is decided at read time
-- from frozen candidate bands, so the recorder cannot be tuned by hindsight and
-- a later change of band does not require re-collecting the data.
--
-- `era` is written, not derived on read. The quantity fix of 2026-09-11
-- 03:47:17Z divides this table into two sets that must never be pooled: before
-- it, sizes and depth were floating-point residue. Storing the era on the row
-- means no query can accidentally blend them by forgetting a date filter.
create table if not exists desk_absorption (
  id            bigserial primary key,
  ticker        text not null,
  close_time    timestamptz not null,
  t             timestamptz not null,
  era           text not null,

  -- the print
  side          text not null,          -- aggressor: UP lifted the offer, DOWN hit the bid
  cluster_n     integer not null default 1,
  size          double precision,
  size_pctile   double precision,
  size_vs_touch double precision,
  size_vs_depth double precision,

  -- what it did
  impact_2s     double precision,
  impact_per_100 double precision,
  move_5s       double precision,
  move_15s      double precision,
  move_30s      double precision,
  move_60s      double precision,

  -- what the underlying did over the same intervals, so "nothing happened" can
  -- be told apart from "nothing happened HERE"
  btc_5s        double precision,
  btc_15s       double precision,
  btc_30s       double precision,
  btc_60s       double precision,

  -- book state at the print
  ofi_norm      double precision,
  replenished   boolean,
  spread        double precision,
  depth         double precision,

  -- window state
  dist          double precision,
  sigma         double precision,
  secs_left     double precision,
  market_prob_up double precision,
  regime        text,

  -- the other signals, for the conditioning tests
  fair_yes      double precision,
  vel_resid     double precision,
  drift_ev      double precision,
  cascade_ev    double precision,
  -- how stale the seat reads were when this print landed; a value from four
  -- minutes ago is not a reading of this moment
  seat_age_ms   integer,

  winner        text,
  graded_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists desk_absorption_close_idx on desk_absorption (close_time desc);
create index if not exists desk_absorption_era_idx on desk_absorption (era, close_time desc);
create index if not exists desk_absorption_ticker_idx on desk_absorption (ticker);
