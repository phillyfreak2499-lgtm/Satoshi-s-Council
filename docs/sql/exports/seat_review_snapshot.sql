-- 16. seat_review_snapshot: the current learner's review counters and the verdict reviewSeats WOULD print now.
-- desk_state keeps no history: known_at = updated_at, and the read is the state at query time, not at as-of.
with l as (select updated_at, state -> 'learner' as lr from desk_state where id = 'live')
select l.updated_at as known_at, s.key as seat, (l.lr -> 'seat_calls' ->> s.key)::int as calls,
  greatest(700, coalesce((l.lr -> 'seat_review_at' ->> s.key)::int, 700)) as next_review_at_calls,
  greatest(700, coalesce((l.lr -> 'seat_review_at' ->> s.key)::int, 700)) - (l.lr -> 'seat_calls' ->> s.key)::int as calls_until_review,
  (l.lr -> 'seat_n' ->> s.key)::int as seat_n, coalesce((l.lr -> 'seat_calib_debt' ->> s.key)::int, 0) as calib_debt,
  jsonb_array_length(coalesce(s.value -> 'legs', '[]'::jsonb)) as scalp_legs,
  (select round(avg(x::numeric), 2) from jsonb_array_elements_text(coalesce(s.value -> 'legs', '[]'::jsonb)) x) as scalp_avg_cents,
  case when jsonb_array_length(coalesce(s.value -> 'legs', '[]'::jsonb)) < 8 then 'hold (thin book)'
       when (select avg(x::numeric) from jsonb_array_elements_text(s.value -> 'legs') x) >= 15 then 'hold (edge >= 15c)'
       else 'DEMOTE (debt := seat_n; bench lowest-EV LIVE card; spawn rethink)' end as verdict_if_review_ran_now,
  (select string_agg(c.key, ',') from jsonb_each(l.lr -> 'skills') c where c.value ->> 'owner' = s.key and c.value ->> 'status' = 'LIVE') as live_cards
from l, jsonb_each(l.lr -> 'seat_scalp') s where s.key <> 'WARDEN' order by calls_until_review;
