-- 2. chair_decisions: every evaluation with score/bar, gate vector and statuses at the time.
-- desk_chair_evals exists since 2026-09-21 17:06Z; call-quality checkpoints since 2026-09-15 16:15Z.
select 'chair_evals' as source, ticker, close_time, as_of, phase, secs_left, raw_score, abs_score, bar_final, vs_bar, sit_mass,
  eligible_voter_count, speaker_count, up_speakers, down_speakers, silent_count, conflict, hard_fail, raw_chair_lean, final_lean, wait_reason, gates,
  bar_base, bar_quiet, bar_weekend, bar_phase, bar_law_miss1, bar_calib_tax, bar_sit_mass, bar_knn, build_sha,
  'ENTRY_SELECTIVE_V3|entry|floor_cents=80,min_speaking=2,...' as policy_fingerprint
from desk_chair_evals where as_of >= :from and as_of < :to
union all
select 'call_quality' as source, ticker, close_time, taken_at, null, horizon, null, null, null, null, null, null,
  (select count(*) from jsonb_array_elements(receipt -> 'seats') s where (s ->> 'heard')::boolean), null, null, null, null, null,
  receipt ->> 'chair_lean', receipt ->> 'chair_lean', (select string_agg(c ->> 'id', ',') from jsonb_array_elements(receipt -> 'audit' -> 'checks') c where (c ->> 'pass')::text = 'false'),
  receipt -> 'audit' -> 'checks', null, null, null, null, null, null, null, null, build_sha, entry_policy
from desk_call_quality where taken_at >= :from and taken_at < :to
order by 3;
