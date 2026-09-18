-- FORCED_DIRECTION_V4 prospective shadow ledger.
-- One immutable UP/DOWN decision per 15-minute window at T-7:30.
-- Direction is chosen before settlement and without price/fee/confidence/Chair gates.
-- Quotes are measurement-only. Authority: none.
create table if not exists desk_v4_forced (
  ticker              text not null,
  close_time          timestamptz not null,
  taken_at            timestamptz not null,
  secs_left           double precision not null,
  study               text not null,
  version             integer not null,
  measurement_version text not null,
  market_p            double precision not null,
  fair_p              double precision,
  p_up                 double precision not null,
  side                 text not null,
  model_n              integer not null,
  model_fitted_at      timestamptz,
  correction_logit     double precision not null,
  features             jsonb not null,
  chair_lean           text not null,
  yes_ask              double precision,
  no_ask               double precision,
  entry_cents          double precision,
  feed_health          jsonb not null default '{}'::jsonb,
  build_sha            text not null default '',
  created_at           timestamptz not null default now(),
  primary key (ticker, close_time),
  check (study = 'FORCED_DIRECTION_V4'),
  check (side in ('UP', 'DOWN')),
  check (chair_lean in ('UP', 'DOWN', 'WAIT')),
  check (market_p >= 0 and market_p <= 1),
  check (fair_p is null or (fair_p >= 0 and fair_p <= 1)),
  check (p_up >= 0 and p_up <= 1),
  check (secs_left <= 450 and secs_left > 438),
  check (entry_cents is null or (entry_cents > 0 and entry_cents < 100))
);

create index if not exists desk_v4_forced_taken_idx
  on desk_v4_forced (taken_at desc);
create index if not exists desk_v4_forced_close_idx
  on desk_v4_forced (close_time desc);
