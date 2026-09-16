-- Chair v3 prospective shadow ledger.
-- Predictions are frozen before settlement and are never read by the live Chair
-- or paper book. Winner is joined later from the existing research ledger.
create table if not exists desk_v3_samples (
  ticker                text not null,
  close_time            timestamptz not null,
  taken_at              timestamptz not null,
  secs_left             double precision not null,
  version               integer not null,
  market_p              double precision not null,
  v3_p                  double precision not null,
  raw_v3_p              double precision not null,
  adjustment_pp         double precision not null,
  correction_logit      double precision not null,
  model_n               integer not null,
  model_fitted_at       timestamptz,
  features              jsonb not null,
  build_sha             text not null default '',
  created_at            timestamptz not null default now(),
  primary key (ticker, close_time),
  check (market_p >= 0 and market_p <= 1),
  check (v3_p >= 0 and v3_p <= 1),
  check (raw_v3_p >= 0 and raw_v3_p <= 1),
  check (abs(adjustment_pp) <= 10.001)
);

create index if not exists desk_v3_samples_taken_idx on desk_v3_samples (taken_at desc);
create index if not exists desk_v3_samples_close_idx on desk_v3_samples (close_time desc);
