-- Hour Research v1 — SHADOW storage. Authority: none.
--
-- Two append-only research tables for the hourly KXBTCD strike ladder. They are
-- SEPARATE from desk_hour_ledger (the canonical hourly record) and from
-- desk_ledger (the 15-minute book): no foreign key, no view, no shared totals.
-- Nothing in these tables feeds the 15-minute Chair, the Council seats, the
-- learner, the 15-minute paper book, the seat telemetry experiment, or any
-- promotion gate. This migration creates structure only and writes no rows.
--
-- The contract is a strike ladder ("$X or above" on the official settlement
-- value at the top of the hour, Eastern). Sides are YES / NO / WAIT, never the
-- 15-minute UP/DOWN.
--
-- Rows store the decision-time snapshot FROZEN: everything needed to reproduce
-- the read without any future state. Grading later APPENDS outcome columns and
-- never rewrites a frozen input.

-- Every priced rung at every research checkpoint: the calibration surface.
create table if not exists desk_hour_predictions (
  event_ticker      text not null,
  close_time        timestamptz not null,
  -- Minutes remaining that this checkpoint represents (45/30/20/15/10/5).
  checkpoint        integer not null,
  ticker            text not null,
  strike            double precision not null,

  -- FROZEN decision-time clock
  as_of             timestamptz not null,
  secs_left         double precision not null,

  -- FROZEN model output for this rung
  p_model           double precision,
  uncertainty       double precision,
  z                 double precision,
  dollars_to_strike double precision,
  -- Baselines the model must beat prospectively
  p_market          double precision,
  p_baseline_dist   double precision,

  -- FROZEN observed market (a missing ask stays null; a mid is never substituted)
  yes_ask           double precision,
  no_ask            double precision,
  spread_yes        double precision,
  spread_no         double precision,
  edge_yes          double precision,
  edge_no           double precision,
  best_side         text,
  best_edge         double precision,
  -- True on the one rung the model would have chosen at this checkpoint.
  is_selected       boolean not null default false,

  model_version     text not null default '',
  build_sha         text not null default '',
  recorded_at       timestamptz not null default now(),

  -- APPENDED after the hour settles; never rewrites the frozen inputs above.
  result            text,
  official_value    double precision,
  outcome_yes       integer,
  brier_model       double precision,
  brier_market      double precision,
  brier_baseline    double precision,
  graded_at         timestamptz,

  primary key (close_time, checkpoint, ticker),
  constraint desk_hour_predictions_side check (best_side is null or best_side in ('YES', 'NO')),
  constraint desk_hour_predictions_result check (result is null or result in ('YES', 'NO')),
  constraint desk_hour_predictions_outcome check (outcome_yes is null or outcome_yes in (0, 1))
);

create index if not exists desk_hour_predictions_close_idx on desk_hour_predictions (close_time desc);
create index if not exists desk_hour_predictions_cp_idx on desk_hour_predictions (checkpoint);
create index if not exists desk_hour_predictions_sel_idx on desk_hour_predictions (is_selected) where is_selected;
create index if not exists desk_hour_predictions_grade_idx on desk_hour_predictions (graded_at);

-- The shadow book: at most ONE row per hour, so one hour can never count as a
-- dozen correlated fills. The first checkpoint that yields a qualifying
-- candidate locks the hour; if no checkpoint ever qualifies, the hour is stored
-- as a WAIT with its structured reason. The unique primary key on close_time is
-- the structural guarantee of "one candidate per hour".
create table if not exists desk_hour_shadow (
  close_time        timestamptz primary key,
  event_ticker      text not null,
  -- The checkpoint that produced this row.
  checkpoint        integer not null,
  decision          text not null,
  wait_reason       text,

  -- FROZEN candidate (null on a WAIT row)
  ticker            text,
  strike            double precision,
  side              text,
  ask               double precision,
  fee               double precision,
  p_model           double precision,
  p_market          double precision,
  edge_cents        double precision,
  uncertainty       double precision,

  -- FROZEN decision-time snapshot, enough to reproduce the read
  as_of             timestamptz not null,
  secs_left         double precision not null,
  expected_settlement double precision,
  expected_source   text not null default '',
  sigma_horizon     double precision,
  index_value       double precision,
  spot              double precision,
  basis             double precision,
  sigma_hour        double precision,
  ladder_rungs      integer,
  ladder_complete   boolean,
  ladder_inversions integer,
  -- The full frozen feature snapshot, for reproduction and audit.
  features          jsonb,
  explanation       text not null default '',

  model_version     text not null default '',
  authority         text not null default 'none',
  build_sha         text not null default '',
  recorded_at       timestamptz not null default now(),

  -- APPENDED after settlement; never rewrites a frozen input above.
  result            text,
  official_value    double precision,
  settle_cents      double precision,
  ev_cents          double precision,
  graded_at         timestamptz,

  constraint desk_hour_shadow_decision check (decision in ('YES', 'NO', 'WAIT')),
  constraint desk_hour_shadow_side check (side is null or side in ('YES', 'NO')),
  constraint desk_hour_shadow_result check (result is null or result in ('YES', 'NO')),
  -- A WAIT row carries a reason and no fill; a call carries a side and a price.
  constraint desk_hour_shadow_shape check (
    (decision = 'WAIT' and side is null and ask is null and wait_reason is not null)
    or (decision in ('YES', 'NO') and side is not null and ask is not null)
  )
);

create index if not exists desk_hour_shadow_close_idx on desk_hour_shadow (close_time desc);
create index if not exists desk_hour_shadow_decision_idx on desk_hour_shadow (decision);
create index if not exists desk_hour_shadow_grade_idx on desk_hour_shadow (graded_at);
