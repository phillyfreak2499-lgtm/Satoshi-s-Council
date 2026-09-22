-- 18. chalk_adjusted_wait: Chair WAIT rate at each checkpoint, raw and excluding windows already >= 99c (chalk) on a side. Both kept.
select horizon, count(*) as n, count(*) filter (where coalesce(receipt ->> 'chair_lean', 'WAIT') not in ('UP', 'DOWN')) as waits,
  round(100.0 * count(*) filter (where coalesce(receipt ->> 'chair_lean', 'WAIT') not in ('UP', 'DOWN')) / count(*), 1) as wait_raw_pct,
  count(*) filter (where greatest((receipt -> 'quotes' ->> 'yes_ask')::float, (receipt -> 'quotes' ->> 'no_ask')::float) >= 99) as chalk_n,
  round(100.0 * count(*) filter (where coalesce(receipt ->> 'chair_lean', 'WAIT') not in ('UP', 'DOWN') and greatest((receipt -> 'quotes' ->> 'yes_ask')::float, (receipt -> 'quotes' ->> 'no_ask')::float) < 99)
    / nullif(count(*) filter (where greatest((receipt -> 'quotes' ->> 'yes_ask')::float, (receipt -> 'quotes' ->> 'no_ask')::float) < 99), 0), 1) as wait_ex_chalk_pct
from desk_call_quality where capture_valid and taken_at >= :from and taken_at < :to group by 1 order by 1;
