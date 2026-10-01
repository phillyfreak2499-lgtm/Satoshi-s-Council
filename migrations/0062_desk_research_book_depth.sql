-- KXBTC15M order-book depth snapshots: instrument first, no decision use.
--
-- One insert-once row per (window, fixed clock): T-600, T-300, T-180, T-60.
-- Read from the Lab's rebuilt book (copied) and the engine's same-instant
-- quote. `quality` carries every data-quality flag (missing book, no snapshot
-- loaded, sequence-gap stale, old book, crossed, quote mismatch, ...), and
-- `clean` is true only when there are none. Displayed depth is resting
-- interest, not executable truth. Nothing reads this table into a decision.
--
-- Rollback: drop table desk_research_book_depth.
create table if not exists desk_research_book_depth (
  ticker      text not null,
  close_time  timestamptz not null,
  clock_secs  integer not null,
  as_of       timestamptz not null,
  secs_left   double precision not null,
  clean       boolean not null,
  quality     jsonb not null,
  features    jsonb,
  levels      jsonb,
  market      jsonb not null,
  build_sha   text not null default '',
  recorded_at timestamptz not null default now(),
  primary key (ticker, close_time, clock_secs),
  check (clock_secs in (600, 300, 180, 60)),
  check (as_of < close_time),
  check (jsonb_typeof(quality) = 'object'),
  check (jsonb_typeof(market) = 'object')
);
create index if not exists desk_research_book_depth_close_idx
  on desk_research_book_depth (close_time desc);
