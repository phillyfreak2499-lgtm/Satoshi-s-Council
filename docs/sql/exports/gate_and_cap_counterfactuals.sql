-- 19. gate_and_cap_counterfactuals: settled one-contract fills with the 92c cap and the gate variants applied on the
-- settlement-index edge PROXY (entry_fair_yes). The production model edge at entry is NOT stored: the flat-3c model gate
-- itself cannot be reproduced from the ledger (UNKNOWN). ORACLE_CEILING is evaluation only.
with f as (
  select l.id, l.close_time, l.entry_cents as ask, coalesce(l.entry_fee_cents, ceil(7 * l.entry_cents * (100 - l.entry_cents) / 10000.0)) as fee, l.ev_cents as net,
    case when l.ev_cents > 0 then l.winner else (case when l.winner = 'UP' then 'DOWN' else 'UP' end) end as side, l.winner, l.entry_fair_yes as fair
  from desk_ledger_research l where l.close_time >= :from and l.close_time < :to and l.entry_cents is not null and l.winner in ('UP', 'DOWN') and l.source = 'kalshi-result'),
g as (select *, (case when side = 'UP' then fair else 100 - fair end) - ask - fee as idx_edge from f)
select variant, count(*) as fills, count(*) filter (where side = winner) as wins, sum(net) as net, round(avg(ask)::numeric, 2) as avg_ask, sum(net) filter (where side <> winner) as loss_sum
from (
  select 'ALL_FILLS' as variant, * from g
  union all select 'CAP_92_KEPT', * from g where ask < 92
  union all select 'CAP_92_BLOCKED', * from g where ask >= 92
  union all select 'FLAT_3C_INDEX_PROXY', * from g where fair is not null and idx_edge >= 3
  union all select 'QUARTER_OF_WIN_INDEX_PROXY', * from g where fair is not null and idx_edge >= 0.25 * (100 - ask)
  union all select 'FEE_PLUS_2_INDEX_PROXY', * from g where fair is not null and idx_edge >= fee + 2
  union all select 'ORACLE_CEILING_EVALUATION_ONLY', * from g where side = winner
) v group by 1 order by 1;
