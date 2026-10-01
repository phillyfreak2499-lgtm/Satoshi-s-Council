-- Read-only. $1 is an inclusive UTC snapshot cutoff. One retained candidate/hour, never ladder-rung trials.
with eligible as (
 select *, case when ask is null then 'missing ask' when ask<20 then '00–19¢' when ask<40 then '20–39¢' when ask<60 then '40–59¢'
 when ask<70 then '60–69¢' when ask<80 then '70–79¢' when ask<85 then '80–84¢'
 when ask<90 then '85–89¢' when ask<95 then '90–94¢' else '95–99¢' end as price_band,
 (decision in ('YES','NO') and graded_at<=$1::timestamptz and result in ('YES','NO') and side=decision
 and ask>0 and ask<100 and fee is not null and expected_source='cfbenchmarks-brti'
 and (features->>'brti')::numeric>0 and (features->>'brti_age_s')::numeric between 0 and 15
 and (features->>'brti_source_age_s')::numeric between 0 and 15 and settle_cents in (0,100)
 and (settle_cents=100)=(side=result)) as valid
 from desk_hour_shadow where as_of <= $1::timestamptz
), groups as (
 select model_version, price_band, count(*) as observations,
 count(*) filter(where decision in ('YES','NO')) as directional,
 count(*) filter(where decision='WAIT') as waits,
 count(*) filter(where decision in ('YES','NO') and (graded_at is null or graded_at>$1::timestamptz)) as pending,
 count(*) filter(where valid) as settled,
 count(*) filter(where valid and result=side) as wins,
 count(*) filter(where decision in ('YES','NO') and graded_at<=$1::timestamptz and not coalesce(valid,false)) as excluded,
 sum(case when side=result then 100 else 0 end-ask-fee) filter(where valid) as net_cents,
 avg(ask+fee) filter(where valid) as needed_pct,
 avg(power(p_model-case when result=side then 1 else 0 end,2)) filter(where valid and p_model is not null and p_market is not null) as brier_model,
 avg(power(case when side='YES' then p_market else 1-p_market end-case when result=side then 1 else 0 end,2)) filter(where valid and p_model is not null and p_market is not null) as brier_market,
 min(as_of) filter(where decision in ('YES','NO')) as first_call,
 max(as_of) filter(where decision in ('YES','NO')) as last_call
 from eligible group by grouping sets ((model_version),(model_version,price_band))
)
select *,case when settled>0 then 100.0*wins/settled end as hit_rate_pct from groups order by model_version,price_band nulls first;
