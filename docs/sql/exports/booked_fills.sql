-- 1. booked_fills: every booked paper position with economic identity.
-- fee_fingerprint: KALSHI_TAKER_7PCT_CEIL_CENT_V1 (ASSUMED). era per docs/METRIC_CONTRACT.md.
select l.ticker || '|' || (extract(epoch from l.close_time) * 1000)::bigint as economic_id,
  l.ticker, l.close_time as close_utc, (l.close_time at time zone 'America/Chicago')::date as chicago_day,
  l.entry_lean as side_recorded, l.entry_cents as ask_cents,
  ceil(0.07 * l.entry_cents * (100 - l.entry_cents) / 100.0) as fee_cents, 'KALSHI_TAKER_7PCT_CEIL_CENT_V1' as fee_fingerprint,
  l.entry_spread_cents as spread_cents, l.entry_touch_size as touch_size, l.entry_leftover_cents as leftover_cents,
  l.winner as official_winner, l.official_value, l.settle_cents, l.ev_cents as net_cents,
  case when l.settle_cents in (0, 100) then 'booked_settled' when l.settle_cents is null then 'booked_pending' when l.ev_cents = 0 then 'scratch' else 'booked_legacy_exit' end as event_kind,
  coalesce(f.entry_policy, 'unassigned') as entry_policy, coalesce(f.signal_policy, 'unassigned') as signal_policy, coalesce(f.risk_policy, 'unassigned') as risk_policy,
  case when l.close_time < '2026-09-08T20:47:00Z' then 'A0_pre_floor' when l.close_time < '2026-09-10T23:00:00Z' then 'A1_floor70'
       when l.close_time < '2026-09-15T14:05:13Z' then 'B_floor80_trial' when l.close_time < '2026-09-17T12:09:31Z' then 'C1_selective_v1v2' else 'C2_selective_v3' end as era,
  'main_paper' as ledger, l.research_quality,
  null::text as pre_entry_day_state, -- UNKNOWN: day state at entry is not persisted; derivable from prior rows via dailyAdmission()
  l.entry_skill_roster -> 'chair_rows' as supporters_at_entry, -- present on 1 row (ENTRY_SKILL_ROSTER_V2); UNKNOWN before
  l.entry_secs_left as secs_left_at_entry, l.entry_regime, l.entry_conf as chair_strength_not_probability, l.entry_build_sha
from desk_ledger l
left join desk_policy_fills f on f.ticker = l.ticker and f.close_time = l.close_time
where l.entry_cents is not null and l.close_time >= :from and l.close_time < :to
order by l.close_time, l.id;
