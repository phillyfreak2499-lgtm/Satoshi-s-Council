-- Formalized WICK "no demand / no supply" and absorption: a frozen effort-vs-result
-- predicate evaluated in SHADOW, next to the unchanged WICK seat. No decision use.
--
-- One insert-once row per (window, fixed clock): T-600, T-300, T-180, T-60.
-- `label`/`stance` are the predicate's output under WICK_EFFORT_RESULT_V1
-- (wick-effort.ts); `features` every measured input; `wick` the live WICK
-- seat's same-instant output, copied from the published Chair; `market` the
-- engine's same-instant quote (the price control). `clean` is true only when
-- no data-quality flag applies. Nothing reads this table into a decision.
--
-- Rollback: drop table desk_research_wick_shadow.
create table if not exists desk_research_wick_shadow (
  ticker      text not null,
  close_time  timestamptz not null,
  clock_secs  integer not null,
  as_of       timestamptz not null,
  def_version integer not null,
  clean       boolean not null,
  quality     jsonb not null,
  label       text not null,
  stance      text,
  features    jsonb,
  wick        jsonb,
  market      jsonb not null,
  build_sha   text not null default '',
  recorded_at timestamptz not null default now(),
  primary key (ticker, close_time, clock_secs),
  check (clock_secs in (600, 300, 180, 60)),
  check (as_of < close_time),
  check (label in ('NONE', 'NO_DEMAND', 'NO_SUPPLY', 'ABSORPTION_TOP', 'ABSORPTION_BOTTOM')),
  check (stance is null or stance in ('UP', 'DOWN')),
  check (jsonb_typeof(quality) = 'object'),
  check (jsonb_typeof(market) = 'object')
);
create index if not exists desk_research_wick_shadow_close_idx
  on desk_research_wick_shadow (close_time desc);
