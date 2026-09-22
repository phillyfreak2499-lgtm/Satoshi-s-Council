-- 3. seat_votes: raw/heard seat and skill, status, strength (never a probability), fire-time asks where recorded.
select 'seat_reads' as source, ticker, close_time, as_of as source_time, seat, active_skill as skill, skill_status, seat_status,
  raw_lean, raw_conf as strength_raw, final_lean as heard_lean, final_conf as strength_heard, passed_speak, forced_sit, suppression_reason,
  health, feed_age_s, secs_left, null::double precision as yes_ask, null::double precision as no_ask, 'no quote on seat reads' as price_usability, build_sha
from desk_seat_reads where as_of >= :from and as_of < :to
union all
select 'call_quality', q.ticker, q.close_time, q.taken_at, s ->> 'seat', null, null, null,
  s ->> 'lean', (s ->> 'strength')::double precision, case when (s ->> 'heard')::boolean then s ->> 'lean' else 'WAIT' end, null, (s ->> 'heard')::boolean, null, null,
  s ->> 'health', null, q.horizon, (q.receipt -> 'quotes' ->> 'yes_ask')::double precision, (q.receipt -> 'quotes' ->> 'no_ask')::double precision,
  case when (q.receipt -> 'quotes' ->> 'yes_ask') is null then 'no quote' else 'both-side ask at checkpoint' end, q.build_sha
from desk_call_quality q, jsonb_array_elements(q.receipt -> 'seats') s
where q.capture_valid and q.taken_at >= :from and q.taken_at < :to
order by 4;
