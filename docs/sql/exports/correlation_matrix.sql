-- 4. correlation_matrix: co-speak counts and same-side rates per cohort, with the market's side at the same instant.
-- Cohort 'grade_frame' is T-0 (inflated by the book); cohorts 'T-450/300/180' are MID checkpoints. Never pooled.
with grade as (
  select 'grade_frame' as cohort, l.ticker || '|' || l.close_time as w, e.key as seat, e.value ->> 'lean' as side, l.winner as market_side
  from desk_ledger_research l, jsonb_each(l.seats) e
  where e.value ->> 'lean' in ('UP', 'DOWN') and l.close_time >= :from and l.close_time < :to),
mid as (
  select 'T-' || q.horizon as cohort, q.ticker || '|' || q.close_time as w, s ->> 'seat' as seat, s ->> 'lean' as side,
    case when (q.receipt ->> 'market_p')::double precision >= 0.5 then 'UP' else 'DOWN' end as market_side
  from desk_call_quality q, jsonb_array_elements(q.receipt -> 'seats') s
  where q.capture_valid and s ->> 'lean' in ('UP', 'DOWN') and q.taken_at >= :from and q.taken_at < :to),
all_rows as (select * from grade union all select * from mid)
select a.cohort, a.seat as seat_a, b.seat as seat_b, count(*) as n_both, count(*) filter (where a.side = b.side) as agree,
  round(100.0 * count(*) filter (where a.side = b.side) / count(*), 1) as same_side_pct,
  count(*) filter (where a.side = a.market_side and b.side = b.market_side) as both_with_market,
  count(*) filter (where not (a.side = a.market_side and b.side = b.market_side)) as either_against_market,
  count(*) filter (where a.side = b.side and not (a.side = a.market_side and b.side = b.market_side)) as agree_given_either_against
from all_rows a join all_rows b on a.cohort = b.cohort and a.w = b.w and a.seat < b.seat
group by 1, 2, 3 having count(*) >= 15 order by 1, 4 desc;
