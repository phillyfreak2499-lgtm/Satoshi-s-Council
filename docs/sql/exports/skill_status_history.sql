-- 8. skill_status_history: UNKNOWN as a history. Transitions are not logged; the learner keeps only current status,
-- the review counter (seat_review_at) and calibration debt. This exports the CURRENT state with known-at = updated_at.
-- Request: persist reviewSeats/runHuddle status changes to desk_system_events (see docs/EVIDENCE_REPORT_2026-09-22.md §7).
select s.updated_at as known_at, e.key as card_id, e.value ->> 'owner' as seat, e.value ->> 'status' as status_now,
  (e.value ->> 'n')::int as n, (e.value ->> 'hits')::int as hits, (e.value ->> 'wilson')::double precision as wilson_strength_not_probability,
  (e.value ->> 'ev')::double precision as ev_at_grading_quotes, (e.value ->> 'ev_n')::int as ev_n,
  (s.state -> 'learner' -> 'seat_calls' ->> (e.value ->> 'owner'))::int as seat_calls,
  (s.state -> 'learner' -> 'seat_review_at' ->> (e.value ->> 'owner'))::int as seat_review_at,
  (s.state -> 'learner' -> 'seat_calib_debt' ->> (e.value ->> 'owner'))::int as seat_calib_debt,
  'reviewSeats|runHuddle|applyAuthorityReview' as possible_writers, 'transition log absent' as reason_quality
from desk_state s, jsonb_each(s.state -> 'learner' -> 'skills') e where s.id = 'live' order by 3, 2;
