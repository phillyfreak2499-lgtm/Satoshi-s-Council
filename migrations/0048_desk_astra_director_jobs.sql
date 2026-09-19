-- Persisted OpenAI background job state for ASTRA_RESEARCH_DIRECTOR_V1.
-- This table gives long-running deep reviews restart-safe polling without adding
-- any promotion, Chair, seat, paper-book, or execution authority.
create table if not exists desk_astra_director_jobs (
  id                    bigserial primary key,
  study                 text not null,
  version               integer not null,
  through_close_time    timestamptz not null,
  graded_total          integer not null,
  packet_hash           text not null,
  packet                jsonb not null,
  response_id           text not null,
  status                text not null,
  attempt               integer not null default 1,
  started_at            timestamptz not null default now(),
  last_polled_at        timestamptz,
  completed_at          timestamptz,
  last_error            text,
  build_sha             text not null default '',
  check (study = 'ASTRA_RESEARCH_DIRECTOR_V1'),
  check (version = 1),
  check (graded_total >= 0),
  check (jsonb_typeof(packet) = 'object'),
  check (status in ('queued','in_progress','completed','failed','expired','cancelled'))
);

create unique index if not exists desk_astra_director_jobs_response_idx
  on desk_astra_director_jobs (response_id);
create index if not exists desk_astra_director_jobs_pending_idx
  on desk_astra_director_jobs (status, started_at desc);
create index if not exists desk_astra_director_jobs_window_idx
  on desk_astra_director_jobs (through_close_time desc, attempt desc);
