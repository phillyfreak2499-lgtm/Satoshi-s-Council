-- Window replay: one compact row per graded window with what the desk saw
-- and said every few seconds (spot, strike, the yes book, the lab's fair,
-- the chair's lean and confidence, the seat tally, every seat's lean).
create table if not exists desk_replay (
  ticker      text primary key,
  close_time  timestamptz not null,
  strike      double precision,
  winner      text,
  n           integer not null,
  step_ms     integer not null,
  partial     boolean not null default false,
  cols        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists desk_replay_close_idx on desk_replay (close_time desc);
