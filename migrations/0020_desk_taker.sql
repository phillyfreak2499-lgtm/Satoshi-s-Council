-- TAKER shadow seat: the Kalshi taker-flow experiment. One row per sampled
-- window at the mid-window decision point, graded at settle. Non-voting and
-- recorded only — it never touches the chair, the learner, COACH, thresholds,
-- or any existing seat. Frozen rules (see src/lib/desk/taker.ts); graded
-- prospectively so the ledger judges it out-of-sample.
create table if not exists desk_taker (
  id          serial primary key,
  ticker      text not null,
  close_time  timestamptz not null,
  sampled_at  timestamptz not null default now(),
  mins_left   double precision not null default 0,
  taker_yes   double precision not null default 0.5,
  trade_n     integer not null default 0,
  eligible    boolean not null default false,
  lean        text not null default 'WAIT',
  conf        integer not null default 0,
  imbalance   double precision not null default 0,
  chair_lean  text not null default 'WAIT',
  regime      text not null default '',
  entry_cents double precision,
  winner      text,
  ev_cents    double precision,
  graded_at   timestamptz
);
create unique index if not exists desk_taker_win_idx on desk_taker (ticker, close_time);
create index if not exists desk_taker_close_idx on desk_taker (close_time desc);
