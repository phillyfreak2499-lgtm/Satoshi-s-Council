-- 6. jump_settlement: qualified shocks with ask/fee, timestamps, official result and availability evidence quality.
-- One first-opportunity row per window is the frozen scoring rule (rn = 1); the rest are context.
select id, ticker, t as event_time, secs_left, final_minute, side, ask_before, ask_size, fair_before, fair_after, misprice, fee, net_edge,
  gone_ms, gone_how, jump_ms, book_age_ms, fill_50, fill_100, fill_150, fill_200, fill_300, fill_500,
  case when jump_ms is null then 'UNKNOWN: no jump timestamp' when book_age_ms > 2000 then 'stale book at event' else 'sub-second capture' end as availability_evidence_quality,
  markout_100, markout_250, markout_500, markout_1000, winner as official_winner, realized as realized_net_cents,
  row_number() over (partition by ticker order by t) as rn
from desk_lag_events where t >= :from and t < :to order by t;
