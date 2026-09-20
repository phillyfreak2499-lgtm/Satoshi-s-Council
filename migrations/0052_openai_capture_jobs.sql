-- Durable prospective handoff for the T-7:30 OpenAI observers.
--
-- A job is frozen BEFORE the API request. It contains exactly the packet and
-- same-time comparator fields the observer already had on that tick. There is
-- no historical backfill and no reconstruction from Replay, settlement, a later
-- quote, or another table.
--
-- A pending job may be retried only before close. If OpenAI answered before
-- close, the structured result is stored as result_ready so a replacement
-- process can finish the immutable research-ledger write after close without
-- making a post-close model request.
create table if not exists desk_openai_capture_jobs (
  study          text not null,
  version        integer not null,
  ticker         text not null,
  close_time     timestamptz not null,

  frozen_at      timestamptz not null,
  secs_left      double precision not null,
  prompt_version text not null,
  model          text not null,
  input_hash     text not null,
  input_packet   jsonb not null,

  -- Same-time comparators are stored beside, never injected into a blind packet.
  market_p       double precision,
  fair_p         double precision,
  chair_lean     text not null,
  yes_ask        double precision,
  no_ask         double precision,

  status          text not null default 'pending',
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  lease_until     timestamptz,
  last_error      text,

  -- Persist the pre-close answer before touching the final research ledger.
  result          jsonb,
  response_id     text not null default '',
  result_at       timestamptz,
  input_tokens    integer,
  output_tokens   integer,
  total_tokens    integer,
  latency_ms      integer,

  build_sha       text not null default '',
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,

  primary key (study, version, ticker, close_time),

  check (study in ('OPENAI_SHADOW_V1', 'OPENAI_BLIND_V1', 'OPENAI_LUNA_V1')),
  check (version > 0),
  check (frozen_at < close_time),
  check (secs_left <= 450 and secs_left > 438),
  check (chair_lean in ('UP', 'DOWN', 'WAIT')),
  check (status in ('pending', 'result_ready', 'completed', 'expired')),
  check (attempts >= 0),
  check (jsonb_typeof(input_packet) = 'object'),
  check (result is null or jsonb_typeof(result) = 'object'),
  check (market_p is null or (market_p >= 0 and market_p <= 1)),
  check (fair_p is null or (fair_p >= 0 and fair_p <= 1)),
  check (yes_ask is null or (yes_ask > 0 and yes_ask < 100)),
  check (no_ask is null or (no_ask > 0 and no_ask < 100)),
  check (input_tokens is null or input_tokens >= 0),
  check (output_tokens is null or output_tokens >= 0),
  check (total_tokens is null or total_tokens >= 0),
  check (latency_ms is null or latency_ms >= 0),
  check (study <> 'OPENAI_BLIND_V1' or (
    not (input_packet ? 'market')
    and not (input_packet ? 'council')
    and not (input_packet ? 'chair')
  )),
  check (
    (status = 'pending' and result is null and result_at is null)
    or
    (status in ('result_ready', 'completed') and result is not null and result_at is not null and result_at < close_time)
    or
    (status = 'expired' and result is null and result_at is null)
  )
);

create index if not exists desk_openai_capture_jobs_recovery_idx
  on desk_openai_capture_jobs (study, version, status, close_time);

create index if not exists desk_openai_capture_jobs_lease_idx
  on desk_openai_capture_jobs (lease_until)
  where status = 'pending';
