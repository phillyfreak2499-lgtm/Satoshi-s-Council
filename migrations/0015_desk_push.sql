-- Push alerts: the desk's own VAPID key pair (generated once at boot and kept
-- here so a restart never orphans subscriptions) and one row per browser that
-- opted in, with what it wants to hear about.
create table if not exists desk_push_keys (
  id          text primary key,
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
create table if not exists desk_push_subs (
  id          bigserial primary key,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  token       text,
  on_call     boolean not null default true,
  on_settle   boolean not null default false,
  ua          text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  last_sent   timestamptz,
  fails       integer not null default 0
);
create index if not exists desk_push_subs_token_idx on desk_push_subs (token);
