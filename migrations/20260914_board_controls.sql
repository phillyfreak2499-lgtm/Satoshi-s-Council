alter table board add column if not exists hidden boolean not null default false;
alter table board add column if not exists moderation_reason text;

create table if not exists board_rate_limits (
  network_key text primary key,
  window_start timestamptz not null,
  last_post_at timestamptz not null,
  posts integer not null check (posts > 0)
);
create index if not exists board_rate_limits_age_idx on board_rate_limits (last_post_at);

create table if not exists board_moderation_log (
  id bigserial primary key,
  board_id integer not null references board(id),
  hidden boolean not null,
  reason text not null,
  created_at timestamptz not null default now()
);
