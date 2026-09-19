-- Prospective Chair-core ablations requested by Astra.
-- Research only: fixed-horizon snapshots compare the current Chair core with
-- isolated seat removals and two authority-release counterfactuals. No row in
-- this table can vote, book, grade, tune, promote, or alter production state.
create table if not exists desk_chair_ablation (
  id                  bigserial primary key,
  study               text not null default 'CHAIR_ABLATION_V1',
  version             integer not null default 1,
  ticker              text not null,
  close_time          timestamptz not null,
  horizon             integer not null,
  taken_at            timestamptz not null,
  entry_policy        text not null,
  actual_chair        jsonb not null,
  variants            jsonb not null,
  seat_state          jsonb not null,
  market              jsonb not null,
  build_sha           text not null default '',
  recorded_at         timestamptz not null default now(),
  check (study = 'CHAIR_ABLATION_V1'),
  check (version = 1),
  check (horizon in (450, 300, 180)),
  check (jsonb_typeof(actual_chair) = 'object'),
  check (jsonb_typeof(variants) = 'object'),
  check (jsonb_typeof(seat_state) = 'object'),
  check (jsonb_typeof(market) = 'object'),
  unique (study, ticker, close_time, horizon)
);

create index if not exists desk_chair_ablation_time_idx
  on desk_chair_ablation (close_time desc, horizon);
