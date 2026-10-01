-- RECOVERY REACHABILITY: bounded, read-only evidence export.
-- Run Q1..Q6 separately through Render's Postgres query connector. Every
-- statement is SELECT-only; no settings, receipts, flags or schema are changed.
-- Inspected source tree: 4e08b21cd18141a78a9754c36eee66d20cf94945,
-- verified equal to published PR #352 head 3f11a07ff783b92b72dd12bd4cef2382a97df2fd.
-- Verify the deployed SHA separately before interpreting policy constants.
-- SQL cannot establish the currently RUNNING Render SHA: latest_tape_build is
-- only the build that wrote that stored frame. Attach a separately timestamped
-- Render deploy/runtime identity to the results; neither proves DB freshness.
-- Schema: migrations/0004_desk_state.sql, 0061_desk_research_factory.sql.
-- JSON: server-engine.ts persistState; research-factory-tape.ts classifyTape.
--
-- INTERPRETATION
-- desk_state is the latest SAVE, not a historical snapshot and not necessarily
-- the current engine tick. Keep updated_at and staleness in every conclusion.
-- Q2's numeric authority test is NECESSARY, never sufficient for a vote/fill.
-- Rule firing, confidence, current regime, feed health, holds, selection, family
-- folding, opposition, weights, executable quotes and confirmation still matter.
-- Missing numeric inputs remain NULL. Optional flags/thresholds are returned raw.
-- Do not infer that a missing key is zero, a passed gate, or an empty history.
-- Q4/Q5 cover at most the newest 5,000 stored tape frames in the last 48 hours,
-- including a live window closing up to 15 minutes after report_as_of. The 5,001st
-- row detects truncation. This is an event/checkpoint sample, NOT every 2s tick,
-- elapsed-time exposure, every market window, or proof of historical opportunity.
-- Q5 excludes partial windows and observes 180..600 seconds left. Empty data is
-- a coverage gap. A zero counted event is meaningful only inside stated coverage.
-- Tape NO_RESEARCH_READ is based on admitted Chair rows: it does not establish
-- that no raw/pre-authority research card fired. UNKNOWN and missing values stay
-- visible. No query estimates counterfactual fills or establishes positive EV.

-- Q1: state presence, freshness and saved settings. Always returns one row.
-- Expected: live_row_count=1 and object types; missing/old saves require caveats.
SELECT now() AS report_as_of,
       count(*) AS live_row_count,
       max(updated_at) AS saved_at,
       extract(epoch FROM now() - max(updated_at)) AS saved_age_seconds,
       jsonb_agg(jsonb_build_object(
         'top_level_keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(s.state) k),
         'learner_type', jsonb_typeof(s.state->'learner'),
         'skills_type', jsonb_typeof(s.state#>'{learner,skills}'),
         'settings', s.state->'settings',
         'selective_policy', s.state->'selective_policy',
         'selective_start_ms', s.state->'selective_start',
         'risk_history_valid', s.state->'risk_history_valid',
         'risk_calls_type', jsonb_typeof(s.state->'risk_calls'),
         'risk_calls_count', CASE WHEN jsonb_typeof(s.state->'risk_calls')='array'
                                 THEN jsonb_array_length(s.state->'risk_calls') END,
         'call_log_type', jsonb_typeof(s.state->'call_log'),
         'call_log_count', CASE WHEN jsonb_typeof(s.state->'call_log')='array'
                               THEN jsonb_array_length(s.state->'call_log') END,
         'learn_phase', s.state#>'{learner,learn_phase}',
         'graded_windows', s.state#>'{learner,graded_windows}',
         'last_regime', s.state#>'{learner,last_regime}',
         'authority_review_version', s.state#>'{learner,authority_review_version}',
         'lockdown', s.state#>'{learner,lockdown}',
         'lockdown_until_ms', s.state#>'{learner,lockdown_until}',
         'lockdown_windows_left', s.state#>'{learner,lockdown_windows_left}'
       )) AS saved_context
FROM desk_state s WHERE id='live';

-- Q2: each saved card's authority/calibration components. At most 251 rows;
-- total_cards_before_limit > 250 means ask for a narrower seat-specific export.
-- The numeric test mirrors council-authority.ts: n>=50, ev_n>=50,
-- Wilson>=0.60, EV>1c. It is NOT a probability calibration or eligibility label.
-- WARM_N=20 uses seat_n minus calibration debt, not card.brier_n.
-- Effective calibration is deliberately NULL if saved debt is absent: runtime
-- has a zero default, but this export retains the missing input explicitly.
-- Family, nonvoter and retirement mappings come from seats.ts. STREAK=history
-- is the production mapping; do not substitute V2's E1 support-family mapping.
WITH saved AS (
  SELECT updated_at, state->'learner' AS lr, state->'settings' AS settings
  FROM desk_state WHERE id='live'
), cards AS (
  SELECT s.*, c.key AS card_id, c.value AS card, c.value->>'owner' AS seat,
         count(*) OVER () AS total_cards_before_limit
  FROM saved s CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(s.lr->'skills')='object' THEN s.lr->'skills' ELSE '{}'::jsonb END
  ) c
), typed AS (
  SELECT *,
    CASE WHEN jsonb_typeof(card->'n')='number' THEN (card->>'n')::numeric END AS n,
    CASE WHEN jsonb_typeof(card->'ev_n')='number' THEN (card->>'ev_n')::numeric END AS ev_n,
    CASE WHEN jsonb_typeof(card->'ev')='number' THEN (card->>'ev')::numeric END AS ev_cents,
    CASE WHEN jsonb_typeof(card->'wilson')='number' THEN (card->>'wilson')::numeric END AS wilson,
    CASE WHEN jsonb_typeof(lr->'seat_n'->seat)='number' THEN (lr->'seat_n'->>seat)::numeric END AS seat_n,
    CASE WHEN jsonb_typeof(lr->'seat_calib_debt'->seat)='number' THEN (lr->'seat_calib_debt'->>seat)::numeric END AS calibration_debt
  FROM cards
)
SELECT now() AS report_as_of, updated_at AS saved_at, total_cards_before_limit,
       card_id, seat, card->>'status' AS card_status,
       CASE
         WHEN seat IN ('WICK','DRIFT','EXHAUST','PULSE','WHALE','VOLT') THEN 'candle'
         WHEN seat IN ('TAPE','VEL','ODDS','STRIKE','CHEAP','FADE','INDEX') THEN 'book'
         WHEN seat IN ('CARRY','CHAIN','CASCADE') THEN 'derivs'
         WHEN seat='STREAK' THEN 'history'
         WHEN seat IN ('ORBIT','CLOCK','WIRE','WARDEN') THEN 'context'
       END AS production_family,
       seat IN ('WARDEN','ORBIT','WIRE') AS non_voting_seat,
       seat IN ('ODDS','CHEAP','FADE') AS retired_seat,
       card_id IN ('VEL.spot_lead','ODDS.cheap_yes','CHEAP.value','FADE.60s_rip') AS closed_directional_card,
       n, ev_n, ev_cents, wilson,
       n>=50 AND ev_n>=50 AND wilson>=0.60 AND ev_cents>1.0 AS necessary_numeric_authority_pass,
       seat_n, calibration_debt,
       CASE WHEN seat_n IS NOT NULL AND calibration_debt IS NOT NULL
            THEN greatest(0,seat_n-greatest(0,calibration_debt)) END AS effective_calibration_n_if_present,
       card->'brier_n' AS card_brier_n, card->'manual_hold' AS manual_hold_raw,
       card->'held_why' AS held_why, card->'min_walkforward_n' AS min_walkforward_n_raw,
       card->'min_regime_n' AS min_regime_n_raw,
       card->'pocket'->(lr->>'last_regime') AS saved_last_regime_pocket,
       lr->'knobs'->seat AS saved_seat_knobs,
       lr->'seat_w'->seat AS saved_seat_weight,
       lr->'fade_strength'->seat AS saved_fade_strength,
       lr->'seat_calls'->seat AS saved_seat_calls,
       lr->'seat_review_at'->seat AS saved_next_review,
       settings->'mutes' AS saved_mutes,
       jsonb_build_object('n',jsonb_typeof(card->'n'), 'ev_n',jsonb_typeof(card->'ev_n'),
                          'ev',jsonb_typeof(card->'ev'), 'wilson',jsonb_typeof(card->'wilson')) AS numeric_input_types
FROM typed ORDER BY seat, card_id LIMIT 251;

-- Q3: bounded saved risk inputs and latest observed production admission mode.
-- Actual mode comes from the tape, not an invented SQL copy of dailyAdmission.
-- Risk JSON can be passed to the REAL restoreRiskCalls/dailyAdmission functions
-- at saved_at if needed; save/current-date context differs across Chicago midnight.
-- risk_calls and call_log may overlap: restoreRiskCalls deduplicates by window.
-- NULL array payload means missing/non-array, never an established empty history.
-- The most recent tape row can be stale/partial; inspect its times and flag.
SELECT now() AS report_as_of, s.updated_at AS saved_at,
       now() AT TIME ZONE 'America/Chicago' AS report_chicago_time,
       s.updated_at AT TIME ZONE 'America/Chicago' AS saved_chicago_time,
       s.state->'risk_history_valid' AS saved_risk_history_valid,
       s.state->'selective_start' AS saved_selective_start_ms,
       s.state->'selective_policy' AS saved_selective_policy,
       CASE WHEN jsonb_typeof(s.state->'risk_calls')='array'
            THEN jsonb_array_length(s.state->'risk_calls') END AS risk_calls_total,
       CASE WHEN jsonb_typeof(s.state->'risk_calls')='array' THEN
         (SELECT coalesce(jsonb_agg(x.value ORDER BY x.ord),'[]'::jsonb)
          FROM jsonb_array_elements(s.state->'risk_calls') WITH ORDINALITY x(value,ord)
          WHERE x.ord<=160) END AS risk_calls_first_160,
       CASE WHEN jsonb_typeof(s.state->'call_log')='array' THEN
         (SELECT coalesce(jsonb_agg(x.value ORDER BY x.ord),'[]'::jsonb)
          FROM jsonb_array_elements(s.state->'call_log') WITH ORDINALITY x(value,ord)
          WHERE x.ord<=80) END AS call_log_first_80,
       t.as_of AS latest_tape_as_of, t.close_time AS latest_tape_close,
       t.build_sha AS latest_tape_build, t.partial_window AS latest_tape_partial_window,
       t.record#>>'{raw,mode}' AS observed_production_mode,
       t.record->'values' AS latest_observed_values,
       t.record->'raw' AS latest_raw_checks
FROM desk_state s LEFT JOIN LATERAL (
  SELECT * FROM desk_research_decision_tape ORDER BY close_time DESC, as_of DESC LIMIT 1
) t ON true WHERE s.id='live';

-- Q4: tape coverage and stage observations, grouped by exact build SHA.
-- windows_with_* means observed at least once, not terminal results; categories
-- overlap. partial rows are reported and excluded from entry-band state counts.
-- An empty tape yields a metadata row with zero sample rows, never 'no blockers'.
WITH bounds AS (SELECT now() AS report_as_of, now()-interval '48 hours' AS from_close),
probe AS MATERIALIZED (
  SELECT t.* FROM desk_research_decision_tape t CROSS JOIN bounds b
  WHERE t.close_time>=b.from_close AND t.close_time<=b.report_as_of+interval '15 minutes'
  ORDER BY t.close_time DESC,t.as_of DESC LIMIT 5001
), sampled AS MATERIALIZED (
  SELECT * FROM probe ORDER BY close_time DESC,as_of DESC LIMIT 5000
), coverage AS (
  SELECT count(*) AS sampled_frames, count(DISTINCT (ticker,close_time)) AS sampled_window_ids,
         min(as_of) AS earliest_as_of,max(as_of) AS latest_as_of,
         count(*) FILTER(WHERE partial_window) AS partial_frames,
         count(*) FILTER(WHERE NOT partial_window AND secs_left BETWEEN 180 AND 600) AS entry_band_frames,
         count(*) FILTER(WHERE record#>'{raw,mode}' IS NULL OR record#>'{raw,mode}'='null'::jsonb) AS missing_mode_frames
  FROM sampled
), by_build AS (
  SELECT build_sha,count(*) AS frames,count(DISTINCT (ticker,close_time)) AS window_ids,
    count(DISTINCT (ticker,close_time)) FILTER(WHERE NOT partial_window AND secs_left BETWEEN 180 AND 600) AS entry_band_window_ids,
    count(DISTINCT (ticker,close_time)) FILTER(WHERE NOT partial_window AND secs_left BETWEEN 180 AND 600 AND state='DIRECTIONAL') AS windows_with_directional,
    count(DISTINCT (ticker,close_time)) FILTER(WHERE NOT partial_window AND secs_left BETWEEN 180 AND 600 AND state='QUALIFIED') AS windows_with_qualified,
    count(DISTINCT (ticker,close_time)) FILTER(WHERE NOT partial_window AND secs_left BETWEEN 180 AND 600 AND state='BOOKED') AS windows_with_booked
  FROM sampled GROUP BY build_sha
)
SELECT b.*, (SELECT count(*)>5000 FROM probe) AS row_cap_reached, c.*,
       (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.build_sha) FROM by_build x) AS per_build
FROM bounds b CROSS JOIN coverage c;

-- Q5: simultaneous blockers on eligible-time, nonpartial captured frames.
-- Rows are grouped by exact build + observed mode + sorted complete blocker set.
-- This answers 'which failures coexist?', not 'what would pass after a change?'.
-- sole_blocker=true means one taxonomy reason in this stored record; it may
-- represent several raw failures, and absent/unknown checks can still exist.
-- Raw full records for representative frames are in Q6.
-- Output is capped to 100 combinations; total/cap metadata shows omissions.
WITH bounds AS (SELECT now() AS report_as_of, now()-interval '48 hours' AS from_close),
probe AS MATERIALIZED (
  SELECT t.* FROM desk_research_decision_tape t CROSS JOIN bounds b
  WHERE t.close_time>=b.from_close AND t.close_time<=b.report_as_of+interval '15 minutes'
  ORDER BY t.close_time DESC,t.as_of DESC LIMIT 5001
), sampled AS MATERIALIZED (
  SELECT * FROM probe ORDER BY close_time DESC,as_of DESC LIMIT 5000
), entry AS (
  SELECT s.*, ARRAY(SELECT DISTINCT u FROM unnest(s.blockers) u ORDER BY u) AS sorted_blockers,
         record#>>'{raw,mode}' AS observed_mode
  FROM sampled s WHERE NOT partial_window AND secs_left BETWEEN 180 AND 600
), combinations AS (
  SELECT build_sha,observed_mode,state,sorted_blockers,
         cardinality(sorted_blockers)=1 AS sole_blocker,
         count(*) AS captured_frames,count(DISTINCT (ticker,close_time)) AS window_ids,
         min(as_of) AS first_seen,max(as_of) AS last_seen,
         count(*) FILTER(WHERE record#>'{values,eligible}' IS NULL OR record#>'{values,eligible}'='null'::jsonb) AS missing_eligible,
         count(*) FILTER(WHERE record#>'{values,confirmation_pass}' IS NULL OR record#>'{values,confirmation_pass}'='null'::jsonb) AS missing_confirmation,
         count(*) FILTER(WHERE record#>'{values,model_edge_cents}' IS NULL OR record#>'{values,model_edge_cents}'='null'::jsonb) AS missing_model_edge,
         count(*) FILTER(WHERE record#>'{values,index_margin_cents}' IS NULL OR record#>'{values,index_margin_cents}'='null'::jsonb) AS missing_index_margin
  FROM entry GROUP BY build_sha,observed_mode,state,sorted_blockers
)
SELECT b.*, (SELECT count(*)>5000 FROM probe) AS row_cap_reached,
       (SELECT count(*) FROM sampled) AS sampled_frames,
       (SELECT count(*) FROM entry) AS nonpartial_entry_band_frames,
       (SELECT count(DISTINCT (ticker,close_time)) FROM entry) AS nonpartial_entry_band_window_ids,
       (SELECT count(*) FROM combinations) AS total_combination_groups,
       (SELECT count(*)>100 FROM combinations) AS combination_output_capped,
       (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.captured_frames DESC,c.build_sha,c.observed_mode,c.state,c.sorted_blockers)
        FROM (SELECT * FROM combinations
              ORDER BY captured_frames DESC,build_sha,observed_mode,state,sorted_blockers LIMIT 100) c) AS simultaneous_blocker_sets
FROM bounds b;

-- Q6: 20 newest actual in-band records for source-level diagnosis. Every row
-- carries provenance, raw admission/Chair failures, observed values, evidence,
-- market and optional checkpoint seat reads. seats=NULL can mean a state-change
-- record rather than a checkpoint. Full confirmation latch is not persisted in
-- tape: a missing confirmation_pass must not be replaced with false or true.
SELECT now() AS report_as_of,ticker,close_time,as_of,recorded_at,build_sha,
       secs_left,checkpoint_secs,partial_window,state,stage,primary_blocker,blockers,
       record->'raw' AS raw,record->'values' AS values,
       record->'evidence' AS evidence,record->'conditions' AS conditions,
       record->'market' AS market,record->'seats' AS checkpoint_seats
FROM desk_research_decision_tape
WHERE close_time>=now()-interval '48 hours'
  AND close_time<=now()+interval '15 minutes'
  AND secs_left BETWEEN 180 AND 600
ORDER BY close_time DESC,as_of DESC LIMIT 20;
