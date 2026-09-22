-- Shared shadow lab: append-only receipts for exactly three frozen hypotheses
-- (UNMUTE_DEDUP_SHELF_V1, WARDEN_JUMP_VETO_V1, SETTLE_BASIS_MEASURED_V1) and
-- their manifests. Research only. No row here can vote, book, grade, tune,
-- promote, veto or alter production state. Additive; applying twice is a no-op.
-- Rollback: drop table desk_shadow_receipts; drop table desk_shadow_manifests.
create table if not exists desk_shadow_manifests (
  experiment           text not null,
  experiment_version   integer not null,
  fingerprint          text not null,
  manifest             jsonb not null,
  frozen_at            timestamptz not null,
  -- Set once by an owner-approved activation at the actual instant; never backdated.
  prospective_start_at timestamptz,
  status               text not null default 'CANDIDATE',
  recorded_at          timestamptz not null default now(),
  primary key (experiment, experiment_version),
  check (status in ('CANDIDATE', 'SHADOW', 'PAUSED', 'BLOCKED', 'KILLED')),
  check (jsonb_typeof(manifest) = 'object')
);

create table if not exists desk_shadow_receipts (
  experiment      text not null,
  arm             text not null,
  ticker          text not null,
  close_time      timestamptz not null,
  kind            text not null,
  decided_at      timestamptz not null,
  side            text,
  ask_cents       double precision,
  fee_engine      text not null,
  fee_cents       double precision,
  size_at_ask     double precision,
  spread_cents    double precision,
  feeds_ok        boolean,
  hittable_150ms  boolean,
  hittable_500ms  boolean,
  official_winner text,
  net_cents       double precision,
  note            text,
  payload         jsonb not null default '{}'::jsonb,
  build_sha       text not null default '',
  recorded_at     timestamptz not null default now(),
  -- One booking per arm per economic window per kind: polls, restarts and
  -- concurrent workers cannot manufacture a second fill.
  primary key (experiment, arm, ticker, close_time, kind),
  check (kind in ('intention', 'fill', 'no_fill', 'veto', 'wait', 'settle')),
  check (side is null or side in ('UP', 'DOWN')),
  check (official_winner is null or official_winner in ('UP', 'DOWN')),
  check (ask_cents is null or (ask_cents > 0 and ask_cents < 100)),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists desk_shadow_receipts_close_idx
  on desk_shadow_receipts (experiment, arm, close_time desc);
