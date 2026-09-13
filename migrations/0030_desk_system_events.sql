-- Phase 1A: structured, insert-once system events.
--
-- Characters may later speak FROM these rows. Free-text board.who is not
-- identity. This file creates structure only — no backfill, no Board rewrite,
-- no historical DESK update copy.
--
-- Immutability is an application contract: there is no update/delete helper.
-- The unique event_key makes a restart replay a no-op.

create table if not exists desk_system_events (
  id          bigserial primary key,
  event_key   text not null,
  event_type  text not null,
  character   text not null,
  occurred_at timestamptz not null,
  source_type text not null default '',
  source_id   text not null default '',
  payload     jsonb not null default '{}'::jsonb,
  public      boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint desk_system_events_key unique (event_key),

  constraint desk_system_events_type check (event_type in (
    'CHAIR_DIRECTIONAL',
    'CHAIR_WAIT_MILESTONE',
    'EXPERIMENT_STARTED',
    'EXPERIMENT_EVIDENCE_MILESTONE',
    'EXPERIMENT_REVIEW_READY',
    'EXPERIMENT_REJECTED',
    'EXPERIMENT_INCONCLUSIVE',
    'SYSTEM_HEALTH_ALERT',
    'SYSTEM_HEALTH_RECOVERED',
    'DESK_UPDATE'
  )),

  constraint desk_system_events_character check (character in (
    'SATOSHI',
    'ALCHEMIST',
    'WARDEN',
    'WRENCH',
    'SWEEP',
    'COACH',
    'DESK'
  ))
);

create index if not exists desk_system_events_public_idx
  on desk_system_events (occurred_at desc, id desc)
  where public;

create index if not exists desk_system_events_source_idx
  on desk_system_events (source_type, source_id);

alter table desk_system_events add column if not exists event_key text;
alter table desk_system_events add column if not exists event_type text;
alter table desk_system_events add column if not exists character text;
alter table desk_system_events add column if not exists occurred_at timestamptz;
alter table desk_system_events add column if not exists source_type text not null default '';
alter table desk_system_events add column if not exists source_id text not null default '';
alter table desk_system_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table desk_system_events add column if not exists public boolean not null default false;
alter table desk_system_events add column if not exists created_at timestamptz not null default now();
