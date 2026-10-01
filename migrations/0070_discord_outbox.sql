-- REQ-DISCORD-001: additive-only, isolated delivery state. No existing data/schema touched.
create table if not exists desk_discord_outbox (
  event_key text primary key,
  kind text not null check (kind in ('paper','read','settle')),
  ticker text not null,
  close_time timestamptz not null,
  seat text not null,
  side text not null check (side in ('UP','DOWN')),
  source text,
  observed_at timestamptz not null,
  build_sha text not null,
  target_hash text not null,
  payload jsonb not null,
  state text not null check (state in ('pending','sent','failed','held','expired')),
  attempts integer not null default 0,
  next_attempt timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_until timestamptz,
  message_id text,
  last_status integer,
  error_code text,
  delivered_at timestamptz,
  parent_key text references desk_discord_outbox(event_key)
);
create index if not exists desk_discord_outbox_due_idx on desk_discord_outbox(next_attempt) where state='pending';
create table if not exists desk_discord_destinations (
  target_hash text primary key,
  blocked_until timestamptz not null default now(),
  disabled boolean not null default false
);

-- Retained publication cursor prevents duplicate leans across process restarts.
create table if not exists desk_discord_read_state (
  ticker text not null,
  close_time timestamptz not null,
  seat text not null,
  target_hash text not null,
  signature text not null,
  observed_at timestamptz not null,
  primary key(ticker,close_time,seat,target_hash)
);
