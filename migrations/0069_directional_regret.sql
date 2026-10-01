-- Strictly additive: only new tables/indexes. No legacy schema or rows changed.
-- Every captured unbooked directional frame. Missing asks are retained, not invented.
create table if not exists desk_directional_regret (
  ticker text not null,
  close_time timestamptz not null,
  observed_at timestamptz not null,
  side text not null check (side in ('UP','DOWN')),
  ask_cents double precision check (ask_cents > 0 and ask_cents < 100),
  fee_cents double precision,
  reasons jsonb not null,
  build_sha text not null,
  chair_stage text not null,
  evidence jsonb not null default '{}'::jsonb,
  primary key (ticker,close_time,observed_at,side)
);
create index if not exists desk_directional_regret_window_idx on desk_directional_regret(ticker,close_time);
create table if not exists desk_directional_read_events (
  ticker text not null, close_time timestamptz not null, side text not null,
  attempted_at timestamptz not null default now(),
  primary key(ticker,close_time,side)
);

-- Missing preference rows mean READ ONLY is off; legacy subscriptions are not opted in.
create table if not exists desk_push_read_prefs (
  subscription_id bigint primary key references desk_push_subs(id) on delete cascade,
  on_read boolean not null default false
);
-- READ receipts never require widening the legacy event_kind constraint.
create table if not exists desk_directional_read_receipts (
  id bigserial primary key,
  event_kind text not null check (event_kind = 'read'),
  event_key text not null check (length(event_key) between 1 and 300),
  subscription_id bigint not null,
  outcome text not null check (outcome in ('accepted','gone','failed')),
  provider_status integer,
  error_code text check (error_code is null or length(error_code) <= 120),
  build_sha text not null,
  attempted_at timestamptz not null
);
create index if not exists desk_directional_read_receipts_recent_idx on desk_directional_read_receipts(attempted_at desc);
-- Verification sends are owner-only fixtures, never call-readiness evidence.
create table if not exists desk_alert_verification_attempts (
  id text primary key,
  build_sha text not null,
  subscription_id bigint not null,
  key_fingerprint text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists desk_alert_verification_receipts (
  verification_id text not null references desk_alert_verification_attempts(id),
  tier text not null check (tier in ('paper-fill','directional-read')),
  outcome text not null check (outcome in ('accepted','gone','failed')),
  provider_status integer,
  error_code text,
  attempted_at timestamptz not null,
  primary key(verification_id,tier)
);
-- No seed row: every new deployed build starts HELD. Explicit owner confirmation only.
create table if not exists desk_alert_rollout (
  build_sha text primary key,
  verification_id text not null references desk_alert_verification_attempts(id),
  device_display_confirmed boolean not null check (device_display_confirmed),
  released_at timestamptz not null default now()
);
