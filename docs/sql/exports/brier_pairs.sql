-- 7. brier_pairs: authentic prospective model probabilities against the named market benchmark. No strength substitutions.
select 'v3' as model, s.measurement_version as model_version, s.ticker, s.close_time, s.taken_at, s.secs_left as horizon_secs, s.v3_p as p_up_model, s.market_p as p_up_market_benchmark, 'yes_mid/100 at capture' as benchmark_definition, s.model_n, s.model_fitted_at as training_version, l.winner as official_winner
from desk_v3_samples s join desk_ledger_research l using (ticker, close_time) where s.taken_at >= :from and s.taken_at < :to
union all
select 'v4_forced', f.measurement_version, f.ticker, f.close_time, f.taken_at, f.secs_left, f.p_up, f.market_p, 'yes_mid/100 at capture', f.model_n, f.model_fitted_at, l.winner
from desk_v4_forced f join desk_ledger_research l using (ticker, close_time) where f.taken_at >= :from and f.taken_at < :to
union all
select 'openai_shadow', o.prompt_version || '/' || o.model, o.ticker, o.close_time, o.taken_at, o.secs_left, o.p_up, o.market_p, 'yes_mid/100 at capture', null, null, l.winner
from desk_openai_shadow o join desk_ledger_research l using (ticker, close_time) where o.taken_at >= :from and o.taken_at < :to
union all
select 'v2', 'desk_samples', s.ticker, s.close_time, s.taken_at, s.mins_left * 60, s.v2_p, (s.market ->> 'yes_mid')::double precision / 100, 'yes_mid/100 at capture', null, null, s.winner
from desk_samples s where s.v2_p is not null and s.winner in ('UP', 'DOWN') and s.taken_at >= :from and s.taken_at < :to
order by 5;
