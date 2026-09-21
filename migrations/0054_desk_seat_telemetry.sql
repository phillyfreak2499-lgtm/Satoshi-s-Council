-- MEASUREMENT-ONLY seat + Chair telemetry. Authority: NONE.
--
-- Append-only research tables recording the full seat -> aggregation ->
-- Chair-gating pipeline per sampled production tick, so the SPEAK_CONF=52 cliff
-- and the sit_mass self-silencing hypotheses can be tested on real settled
-- windows. Nothing here is ever read by a seat, the Chair, thresholds, learned
-- weights, paper booking, or risk. Written non-blocking and fail-open by
-- telemetry.server.ts; a write failure never alters a Chair decision. Sampled
-- (not every 2s tick) and pruned on a fixed retention to bound growth.

create table if not exists desk_seat_reads (
  ticker                     text not null,
  close_time                 timestamptz not null,
  as_of                      timestamptz not null,
  seat                       text not null,
  phase                      text not null default '',
  mins_left                  double precision,
  secs_left                  double precision,
  eligible_voter             boolean not null default false,
  active_skill               text not null default '',
  skill_status               text not null default '',
  -- raw read BEFORE the speak filter: direction and confidence are retained
  -- verbatim even when the read was suppressed downstream.
  raw_lean                   text not null default 'WAIT',
  raw_conf                   double precision,
  speak_offset               double precision,
  effective_speak_threshold  double precision,
  passed_speak               boolean not null default false,
  final_lean                 text not null default 'WAIT',
  final_conf                 double precision,
  forced_sit                 boolean not null default false,
  -- structured binding cause; never a collapsed generic "forced_sit".
  suppression_reason         text not null default 'other',
  seat_weight                double precision,
  seat_status                text,
  contribution               double precision,
  health                     text not null default '',
  feed_age_s                 double precision,
  shadow_lean                text,
  build_sha                  text,
  primary key (ticker, close_time, as_of, seat)
);

create index if not exists desk_seat_reads_window_idx on desk_seat_reads (ticker, close_time);
create index if not exists desk_seat_reads_asof_idx   on desk_seat_reads (as_of desc);
create index if not exists desk_seat_reads_seat_idx   on desk_seat_reads (seat);
create index if not exists desk_seat_reads_reason_idx on desk_seat_reads (suppression_reason);

create table if not exists desk_chair_evals (
  ticker                 text not null,
  close_time             timestamptz not null,
  as_of                  timestamptz not null,
  phase                  text not null default '',
  mins_left              double precision,
  secs_left              double precision,

  -- aggregation
  raw_score              double precision,
  abs_score              double precision,
  dir_mass               double precision,
  sit_total_mass         double precision,
  sit_mass               double precision,
  eligible_voter_count   integer,
  speaker_count          integer,
  up_speakers            integer,
  down_speakers          integer,
  silent_count           integer,

  -- bar built as separate numeric fields (no value hidden in a string)
  bar_base               double precision,
  bar_quiet              double precision,
  bar_weekend            double precision,
  bar_phase              double precision,
  bar_law_miss1          double precision,
  bar_calib_tax          double precision,
  bar_sit_mass           double precision,
  bar_knn                double precision,
  bar_pre_clamp          double precision,
  bar_final              double precision,

  aggressiveness         double precision,
  time_factor            double precision,
  vs_bar                 double precision,
  diversity              double precision,
  categories_agree       integer,
  conflict               boolean not null default false,
  conflict_frac          double precision,
  hard_fail              boolean not null default false,

  raw_chair_lean         text not null default 'WAIT',
  final_lean             text not null default 'WAIT',
  final_differs_from_raw boolean not null default false,
  confidence             double precision,
  size                   integer,
  wait_reason            text not null default '',
  gates                  jsonb,
  build_sha              text,
  primary key (ticker, close_time, as_of)
);

create index if not exists desk_chair_evals_window_idx   on desk_chair_evals (ticker, close_time);
create index if not exists desk_chair_evals_asof_idx     on desk_chair_evals (as_of desc);
create index if not exists desk_chair_evals_decision_idx on desk_chair_evals (final_lean);
