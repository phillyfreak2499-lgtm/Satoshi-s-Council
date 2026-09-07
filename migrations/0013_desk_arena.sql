-- The Arena: visitors' own paper calls, no logins. A device token names a
-- player; one call per window, booked at the ask plus Kalshi's fee exactly
-- like the chair, held to settlement, graded by the same result.
create table if not exists desk_players (
  token      text primary key,
  name       text not null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create table if not exists desk_human_calls (
  id           bigserial primary key,
  token        text not null references desk_players(token),
  ticker       text not null,
  close_time   timestamptz not null,
  lean         text not null,
  conf         integer,
  entry_cents  double precision not null,
  fee          double precision not null,
  mins_left    double precision not null,
  t            timestamptz not null default now(),
  winner       text,
  cents        double precision,
  unique (token, ticker)
);
create index if not exists desk_human_calls_close_idx on desk_human_calls (close_time desc);
create index if not exists desk_human_calls_t_idx on desk_human_calls (t desc);
