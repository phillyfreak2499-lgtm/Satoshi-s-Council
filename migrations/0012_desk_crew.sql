-- The Pit Crew: SWEEP (janitor) writes a nightly per-seat scorecard with
-- flags; COACH (trainer) and WRENCH (mechanic) log every action they take.
create table if not exists desk_crew_reports (
  day            date not null,
  seat           text not null,
  reads          integer not null default 0,
  spoke          integer not null default 0,
  gagged         integer not null default 0,
  max_conf       double precision,
  avg_conf       double precision,
  spoke_hit_pct  double precision,
  mid_n          integer not null default 0,
  mid_hit_pct    double precision,
  mid_cents      double precision,
  grade_n        integer not null default 0,
  flags          text[] not null default '{}',
  note           text,
  primary key (day, seat)
);

create table if not exists desk_crew_log (
  id        bigserial primary key,
  t         timestamptz not null default now(),
  who       text not null,
  seat      text,
  action    text not null,
  detail    text not null,
  before    jsonb,
  after     jsonb,
  evidence  jsonb,
  slug      text
);
create unique index if not exists desk_crew_log_slug_idx on desk_crew_log (slug);
create index if not exists desk_crew_log_t_idx on desk_crew_log (t desc);
