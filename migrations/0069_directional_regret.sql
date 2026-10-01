-- No legacy subscribers are silently opted in to research reads.
alter table desk_push_subs add column if not exists on_read boolean not null default false;
alter table desk_push_delivery_receipts drop constraint if exists desk_push_delivery_receipts_event_kind_check;
alter table desk_push_delivery_receipts add constraint desk_push_delivery_receipts_event_kind_check
  check (event_kind in ('call','read','settle','watchdog','test'));
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
