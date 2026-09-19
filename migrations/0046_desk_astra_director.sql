-- ASTRA_RESEARCH_DIRECTOR_V1.
-- Periodic report-only governance review. Astra can nominate investigations and
-- promotion/demotion REVIEW, but this table and its writer have no actuator.
create table if not exists desk_astra_director (
  id                    bigserial primary key,
  study                 text not null,
  version               integer not null,
  prompt_version        text not null,
  model                 text not null,
  window_batch          integer not null,
  through_close_time    timestamptz not null,
  graded_total          integer not null,
  packet_hash           text not null,
  packet                jsonb not null,
  report                jsonb not null,
  response_id           text not null default '',
  input_tokens          integer,
  output_tokens         integer,
  total_tokens          integer,
  latency_ms            integer not null,
  build_sha              text not null default '',
  created_at             timestamptz not null default now(),
  check (study = 'ASTRA_RESEARCH_DIRECTOR_V1'),
  check (version = 1),
  check (window_batch between 300 and 500),
  check (graded_total >= 0),
  check (jsonb_typeof(packet) = 'object'),
  check (jsonb_typeof(report) = 'object')
);

create unique index if not exists desk_astra_director_through_idx
  on desk_astra_director (study, version, through_close_time);
create index if not exists desk_astra_director_created_idx
  on desk_astra_director (created_at desc);
