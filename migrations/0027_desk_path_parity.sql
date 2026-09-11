-- Shadow measurement of the YES-path horizons. Measurement only: nothing reads this
-- table to make a decision, and no consumer changed in the change that added it.
--
-- WHY. Four modules read `yes_mid_path` at fixed ARRAY OFFSETS and label the results
-- d30/d60/d120, as if the array were evenly sampled at 10s, 12s and 13.3s. It is not.
-- The path is normally built from Kalshi candlesticks at period_interval=1, which is
-- ONE MINUTE per slot. The anchor index is `length - back` and the newest is
-- `length - 1`, so `back` slots back crosses `back - 1` gaps: the offsets actually
-- span 3, 5 and 9 MINUTES -- 6x, 5x and 4.5x their labels. The names are not
-- approximations; they denote materially different horizons. On the rarer per-tick
-- feed the same offsets span 12, 20 and 36 seconds, so one named quantity ranges
-- exactly 15x. This table measures that divergence prospectively so the decision to
-- migrate the consumers rests on distribution, not on one example.
--
-- WHY NOT JUST FIX IT. Every calibration record, seat threshold and learned weight in
-- production was fitted against the old numbers. Changing what d60 means retroactively
-- invalidates that history. So the old reading and the true reading are recorded side
-- by side first, and the migration is a separate, explicit decision with its own
-- research-era boundary.
--
-- NO COLLAPSED NULLS. "0", "null" and "NaN" mean three different things operationally
-- and each gets its own representation:
--
--   legacy_state = 'numeric'     two real slots subtracted.
--   legacy_state = 'short-path'  production's `: 0` branch. legacy_delta IS 0, because
--                                that 0 is what consumers receive and act on - it is
--                                real input, not a missing value.
--   legacy_state = 'non-finite'  NaN propagated. legacy_delta is NULL because NaN is
--                                not a number to store. THIS IS THE DEFECT WORTH
--                                WATCHING: downstream, `Math.abs(NaN) >= k` is FALSE,
--                                so a seat reads "quiet tape" when the truth is
--                                "unknown". Count it; do not fix it here.
--
--   true_state = 'numeric'       a real anchor at or beyond the requested age existed.
--   true_state = 'no-coverage'   points existed, none old enough. Never approximated.
--   true_state = 'empty'         no usable timestamped points at all.
--
--   divergence_state             why the divergence is or is not a number, so a NULL
--                                divergence never has to be guessed at.
--
-- PAPER ONLY. No order, no venue, no size. This is a research table.

create table if not exists desk_path_parity (
  -- Deterministic: ticker | close_time_ms | sample_minute | horizon. A replayed or
  -- restarted tick recomputes the same key, so `on conflict do nothing` makes the
  -- write idempotent and bounds the table at one row per horizon per window-minute.
  sample_key        text primary key,

  ticker            text not null,
  close_time        timestamptz not null,
  sampled_at        timestamptz not null,
  /** Minute bucket the sample was deduplicated into. */
  sample_minute     bigint not null,

  horizon           text not null,
  want_ms           integer not null,
  legacy_back       integer not null,

  -- What production reads today, verbatim - including its zero.
  legacy_delta      double precision,
  legacy_state      text not null,

  -- What the clock says.
  true_delta        double precision,
  true_state        text not null,

  signed_divergence double precision,
  abs_divergence    double precision,
  divergence_state  text not null,

  -- Coverage facts, so "how often was this measurable" is answerable.
  --
  -- span_ms is the ACTUAL elapsed span measured, and must never be ASSUMED equal to
  -- want_ms: the anchor is a real sample, so the span is whatever the grid allows. It
  -- lands on the request when the grid divides it -- 60s and 120s do on 1-minute
  -- candles -- and overshoots otherwise, as a requested 30s lands on ~60s: 30s is NOT
  -- EXACTLY REPRESENTABLE on a pure 1-minute grid, though a coarse historical
  -- approximation exists. Any read reporting "a 30-second move" off a want_ms of 30000
  -- is wrong; span_ms is the number that describes what actually happened -- and even
  -- an exact span says nothing about WHERE the interval sits: see decision_fidelity.
  span_ms           integer,
  -- span_ms - want_ms, stored rather than derived so horizon overshoot is queryable
  -- directly. >= 0 whenever coverage_ok: the helper overshoots, never undershoots.
  -- ~+30000 for d30 on candles (100% overshoot, so 30s is not exactly representable
  -- there); ~0 for d60 and d120, which the grid divides. NOT on its own sufficient to
  -- judge whether a consumer flip can honestly carry a 30s/60s/120s label -- that also
  -- needs decision_overshoot_ms, because an exactly-60s span on a 45s-stale endpoint
  -- is still not a measurement of the last 60 seconds.
  overshoot_ms      integer,
  legacy_span_ms    integer,
  -- The headline finding as one number per horizon: how far the index offset's real
  -- span sits from the horizon it is named for. ~+240000 for "d60" on candles.
  legacy_overshoot_ms integer,
  -- NULL in the two span columns above is not "unknown for no reason": it means the
  -- bare array the legacy read subtracted and the timestamped path were not the same
  -- length, so slot i of one is not slot i of the other and no honest span exists.
  -- False here is itself a finding: prices the desk used, timestamps it could not read.
  legacy_span_aligned boolean not null default true,
  available_ms      integer not null,
  coverage_ok       boolean not null,

  -- (2) ENDPOINT FRESHNESS. The reading ends at the newest SAMPLE, not at the decision
  -- tick. With 1-minute candles that sample can itself be most of a minute old.
  newest_t          timestamptz,
  newest_age_ms     integer,

  -- (3) DECISION-HORIZON FIDELITY. span_ms and overshoot_ms describe the interval's
  -- LENGTH; these describe WHERE it sits. `span_ms = 60000, overshoot_ms = 0` is
  -- satisfied identically by "the last 60 seconds" and by "a 60-second interval that
  -- ended a minute ago", so without these a zero span overshoot would later be read
  -- as proof of exact horizon coverage.
  --
  -- The row covers [as_of - anchor_age_ms, as_of - newest_age_ms]; the label claims
  -- [as_of - want_ms, as_of]. decision_overshoot_ms is the gap at the start.
  --   anchor_age_ms         = newest_age_ms + span_ms
  --   decision_overshoot_ms = newest_age_ms + overshoot_ms
  anchor_t              timestamptz,
  anchor_age_ms         integer,
  decision_overshoot_ms integer,
  -- STRUCTURAL, never tuned -- no freshness cutoff is chosen here, because that would
  -- be a policy decision and this table makes none. 'decision-aligned' (the interval
  -- ends exactly at as_of, in practice the per-tick feed), 'end-shifted' (it ends in
  -- the past, in practice the candle feed), 'end-ahead' (feed clock skew), 'unknown'
  -- (no decision clock -- which is not the same as answered favourably). The MAGNITUDE
  -- of any shift is in the columns above, so a reader decides what is tolerable.
  decision_fidelity     text not null default 'unknown',

  -- Where the points came from, and what reading them cost.
  source_mix        text not null,
  points_used       integer not null,
  points_dropped_non_finite   integer not null default 0,
  points_dropped_non_positive integer not null default 0,
  points_collapsed_duplicate  integer not null default 0,

  -- Candle timestamp extraction, so an empty timestamped path is explainable and a
  -- wrong field-name guess shows up in the data rather than as silent absence.
  candle_rows_priced integer not null default 0,
  candle_rows_timed  integer not null default 0,
  candle_ts_fields   text not null default '',
  candle_ts_absent   integer not null default 0,
  candle_ts_bad      integer not null default 0,
  -- Rows dated from a period START and moved forward one interval. Recorded because
  -- the adjustment shifts a timestamp by a full period: if this is ever non-zero, the
  -- affected rows' times are derived rather than read, and a reader must know that.
  candle_ts_start_adjusted integer not null default 0,

  -- Context for the research read.
  window_phase      text not null default '',
  secs_left         integer,
  /** What the Chair was saying at this sample. Read-only: the shadow never feeds it. */
  chair_decision    text not null default '',

  research_version  text not null,
  code_version      text not null default '',

  created_at        timestamptz not null default now()
);

-- SELF-HEALING. `create table if not exists` is a no-op on a database that already
-- has the table, so any column added to this file after it was first applied would
-- never arrive -- and the writer, whose errors are deliberately silent, would lose
-- every row without a trace. Each column is therefore also added idempotently.
alter table desk_path_parity add column if not exists overshoot_ms integer;
alter table desk_path_parity add column if not exists legacy_overshoot_ms integer;
alter table desk_path_parity add column if not exists legacy_span_aligned boolean not null default true;
alter table desk_path_parity add column if not exists newest_t timestamptz;
alter table desk_path_parity add column if not exists newest_age_ms integer;
alter table desk_path_parity add column if not exists candle_ts_start_adjusted integer not null default 0;
alter table desk_path_parity add column if not exists anchor_t timestamptz;
alter table desk_path_parity add column if not exists anchor_age_ms integer;
alter table desk_path_parity add column if not exists decision_overshoot_ms integer;
alter table desk_path_parity add column if not exists decision_fidelity text not null default 'unknown';

create index if not exists desk_path_parity_window
  on desk_path_parity (ticker, close_time);

create index if not exists desk_path_parity_horizon
  on desk_path_parity (horizon, sampled_at desc);

-- The counter the operator actually wants: how often is the DSL-facing value
-- non-finite? A non-zero row count here is a separate defect worth knowing about.
create index if not exists desk_path_parity_legacy_state
  on desk_path_parity (legacy_state, sampled_at desc);

-- Horizon overshoot is the question a consumer flip turns on, so it is indexed with
-- the horizon it belongs to rather than scanned.
create index if not exists desk_path_parity_overshoot
  on desk_path_parity (horizon, overshoot_ms);

-- Decision fidelity is the other half of that question, so it is indexed alongside.
create index if not exists desk_path_parity_fidelity
  on desk_path_parity (horizon, decision_fidelity);

-- Research view: quarantined windows excluded, on the same rule as every other
-- research read. Spelled out rather than layered on desk_ledger_research so that
-- hand-running migration 0024 alone cannot silently drop this view.
--
-- THE JOIN IS INNER, AND THAT IS DELIBERATE. A desk_ledger row exists only once a
-- window has GRADED, while parity samples are written DURING the window. So the
-- window in flight is absent from this view until it settles -- correct for research,
-- because an ungraded window is not evidence, but it means this view is the wrong
-- place to check whether writes are landing at all. Use the base table for that.
drop view if exists desk_path_parity_research;
create view desk_path_parity_research as
  select p.*
    from desk_path_parity p
    join desk_ledger l
      on l.ticker = p.ticker and l.close_time = p.close_time
   where l.research_quality = 'valid';
