-- Research factory: a durable, resource-governed background job queue and the
-- derived research it produces. Research only; production authority NONE.
--
-- NOTHING HERE WRITES TO AN EXISTING TABLE. desk_shadow_receipts, desk_ledger,
-- desk_replay and desk_decision_snapshots are read, never updated: an integrity
-- finding is an annotation row beside the receipt, never an edit of it.
--
-- Rollback: drop table desk_research_reports, desk_research_integrity,
-- desk_research_window_facts, desk_research_jobs.

-- One row per (kind, key): the primary key IS the idempotency guarantee. A
-- scheduler that enqueues the same settled window twice, or a restarted process
-- that enqueues it again, hits the key and inserts nothing. A completed job is
-- never re-run; a running job whose lease lapsed (the process died) may be
-- reclaimed and resumes from its checkpoint.
create table if not exists desk_research_jobs (
  job_kind       text not null,
  job_key        text not null,
  status         text not null default 'queued',
  priority       integer not null default 100,
  params         jsonb not null default '{}'::jsonb,
  checkpoint     jsonb not null default '{}'::jsonb,
  attempts       integer not null default 0,
  lease_owner    text,
  lease_until    timestamptz,
  not_before     timestamptz not null default now(),
  -- Telemetry of the most recent attempt (Phase 10).
  started_at     timestamptz,
  finished_at    timestamptz,
  wall_ms        double precision,
  cpu_ms         double precision,
  peak_rss_mb    double precision,
  db_queries     integer,
  db_ms          double precision,
  rows_scanned   integer,
  rows_written   integer,
  guard_reason   text,
  error          text,
  build_sha      text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (job_kind, job_key),
  check (status in ('queued', 'running', 'complete', 'failed', 'skipped_resource_guard')),
  check (attempts >= 0),
  check (jsonb_typeof(params) = 'object'),
  check (jsonb_typeof(checkpoint) = 'object')
);
create index if not exists desk_research_jobs_ready_idx
  on desk_research_jobs (status, priority, not_before);

-- Phase 2: one row per settled window x experiment x arm, re-graded from the
-- records that were stored at decision time. replay_quality says how much of
-- the decision could be re-derived from stored inputs; nothing is substituted
-- for a missing input. Versioned: a new grader version writes new rows beside
-- the old ones and never rewrites them.
create table if not exists desk_research_window_facts (
  ticker            text not null,
  close_time        timestamptz not null,
  experiment        text not null,
  arm               text not null,
  fact_version      integer not null,
  replay_quality    text not null,
  quality_reasons   text[] not null default '{}',
  experiment_version integer,
  source_build_sha  text,
  decided_at        timestamptz,
  observed          boolean not null default false,
  terminal_kind     text,
  side              text,
  ask_cents         double precision,
  fee_cents         double precision,
  official_winner   text,
  net_cents         double precision,
  production_lean   text,
  production_booked boolean,
  funnel_stage      text,
  first_blocker     text,
  blockers          text[] not null default '{}',
  facts             jsonb not null default '{}'::jsonb,
  build_sha         text not null default '',
  created_at        timestamptz not null default now(),
  primary key (ticker, close_time, experiment, arm, fact_version),
  check (replay_quality in ('EXACT', 'PARTIAL', 'UNAVAILABLE')),
  check (side is null or side in ('UP', 'DOWN')),
  check (official_winner is null or official_winner in ('UP', 'DOWN')),
  check (jsonb_typeof(facts) = 'object')
);
create index if not exists desk_research_window_facts_exp_idx
  on desk_research_window_facts (experiment, fact_version, close_time desc);

-- Phase 3: integrity annotations. One row per audited receipt per auditor
-- version. The receipt itself is never touched: suspect history is annotated,
-- never deleted or rewritten.
create table if not exists desk_research_integrity (
  experiment       text not null,
  arm              text not null,
  ticker           text not null,
  close_time       timestamptz not null,
  kind             text not null,
  auditor_version  integer not null,
  integrity_status text not null,
  reason_codes     text[] not null default '{}',
  details          jsonb not null default '{}'::jsonb,
  build_sha        text not null default '',
  created_at       timestamptz not null default now(),
  primary key (experiment, arm, ticker, close_time, kind, auditor_version),
  check (integrity_status in ('CLEAN', 'SUSPECT', 'INVALID', 'UNVERIFIABLE')),
  check (jsonb_typeof(details) = 'object')
);
create index if not exists desk_research_integrity_status_idx
  on desk_research_integrity (auditor_version, integrity_status);

-- Phases 4-10: derived reports. Recomputable from the rows above; the latest
-- per (kind, key) is what the admin route serves, earlier versions are kept.
create table if not exists desk_research_reports (
  report_kind    text not null,
  report_key     text not null,
  report_version integer not null,
  payload        jsonb not null,
  build_sha      text not null default '',
  created_at     timestamptz not null default now(),
  primary key (report_kind, report_key, report_version),
  check (jsonb_typeof(payload) = 'object')
);
