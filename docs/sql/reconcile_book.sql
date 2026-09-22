-- PHASE A reconciliation, as plain SQL for a read-only console.
-- Replace :as_of with an ISO instant (e.g. '2026-09-22T00:00:00Z').
-- Every number is after the charged fee ceil(7·p·(1−p)) whole cents
-- (fee engine KALSHI_TAKER_7PCT_CEIL_CENT_V1, provenance ASSUMED).

-- 1. Era books on the HOLD identity. official_wins uses settle_cents = 100,
--    never ev > 0. identity_mismatch counts rows the HOLD identity cannot describe.
with f as (
  select *, ceil(0.07 * entry_cents * (100 - entry_cents) / 100.0) as fee,
    case when close_time < '2026-09-08T20:47:00Z' then 'A0_pre_floor'
         when close_time < '2026-09-10T23:00:00Z' then 'A1_floor70'
         when close_time < '2026-09-15T14:05:13Z' then 'B_floor80_trial'
         when close_time < '2026-09-17T12:09:31Z' then 'C1_selective_v1v2'
         else 'C2_selective_v3' end as era,
    case when settle_cents = 100 then 1 else 0 end as won,
    case when settle_cents = 100 then 100 - entry_cents - ceil(0.07 * entry_cents * (100 - entry_cents) / 100.0)
         else -entry_cents - ceil(0.07 * entry_cents * (100 - entry_cents) / 100.0) end as hold_ev
  from desk_ledger
  where close_time <= :as_of and (graded_at is null or graded_at <= :as_of))
select era,
  count(*) as windows,
  count(*) filter (where research_quality <> 'valid') as excluded,
  count(entry_cents) as fills,
  count(*) filter (where entry_cents is not null and settle_cents is null) as pending,
  count(*) filter (where settle_cents not in (0, 100)) as legacy_non_binary,
  count(*) filter (where entry_cents is not null and settle_cents in (0, 100) and abs(ev_cents - hold_ev) > 0.05) as identity_mismatch,
  sum(won) as official_wins,
  count(*) filter (where ev_cents > 0) as ev_positive_rows,
  round(sum(ev_cents) filter (where settle_cents in (0, 100))::numeric, 1) as hold_net,
  round(sum(ev_cents) filter (where settle_cents not in (0, 100))::numeric, 1) as legacy_net,
  round(avg(entry_cents + fee) filter (where settle_cents in (0, 100))::numeric, 2) as needed_wr_pct,
  round((100.0 * sum(won) / nullif(count(*) filter (where settle_cents in (0, 100)), 0))::numeric, 1) as official_wr_pct
from f group by 1 order by 1;

-- 2. The same "last 7 days" read at several as-of hours: the four public
--    surfaces that disagreed were this one definition at different instants.
select a.asof, count(*) filter (where l.entry_cents is not null) as fills, sum(l.ev_cents)::int as net
from generate_series(:as_of::timestamptz - interval '3 days', :as_of::timestamptz, interval '1 hour') a(asof)
join desk_ledger_research l on l.close_time > a.asof - interval '7 days' and l.close_time <= a.asof
group by 1 order by 1;

-- 3. Trial decomposition on identical windows: shared, live-only, shadow-only.
with t as (select *, entry_cents is not null as live, shadow_entry_cents is not null as shadow
           from desk_ledger_research where close_time >= '2026-09-10T23:00:00Z' and close_time < '2026-09-15T14:05:13Z')
select case when live and shadow then 'shared' when live then 'live_only' when shadow then 'shadow_only' else 'neither' end as cell,
  count(*) as n, sum(ev_cents)::int as live_net, sum(shadow_ev_cents)::int as shadow_net,
  round(avg(entry_cents)::numeric, 1) as live_avg_ask, round(avg(shadow_entry_cents)::numeric, 1) as shadow_avg_ask
from t group by 1 order by 1;

-- 4. Missing interior slots and exclusions over 90 days.
select count(*) as rows_present,
  ((extract(epoch from max(close_time) - min(close_time)) / 900)::int + 1) as expected_slots,
  count(*) filter (where research_quality <> 'valid') as excluded
from desk_ledger where close_time > :as_of::timestamptz - interval '90 days' and close_time <= :as_of;
