-- 9. card_fire_receipts: card/version, fire time, pocket, side/ask/fee, health, grade, observation-vs-fill.
-- Coverage today: SKILL_SCORE_AUDIT_V1 receipts for DRIFT.pullback_in_trend and PULSE.vol_lag_5m (since 2026-09-15 16:15Z),
-- plus ENTRY_SKILL_QUALITY_V1 on booked entries (1 row). Widening capture to every card is an approval-required change.
select l.ticker, l.close_time, to_timestamp((l.skill_score_audit ->> 'input_at')::bigint / 1000.0) as fire_time,
  (l.skill_score_audit ->> 'seconds_to_close')::double precision as secs_left,
  case when (l.skill_score_audit ->> 'seconds_to_close')::double precision > 600 then 'ENTRY' when (l.skill_score_audit ->> 'seconds_to_close')::double precision >= 180 then 'MID' else 'FINAL' end as pocket,
  sk ->> 'id' as card_id, l.skill_score_audit ->> 'version' as receipt_version, sk ->> 'status_at_input' as status_at_input,
  o ->> 'side' as side, (o ->> 'ask_cents')::double precision as ask_cents, (o ->> 'fee_cents')::double precision as fee_cents,
  (o ->> 'confidence')::double precision as strength_not_probability, o ->> 'confidence_kind' as strength_label,
  (o ->> 'market_side_midpoint')::double precision as market_side_midpoint_benchmark,
  (o ->> 'legacy_quote_fallback')::boolean as quote_is_fallback, l.skill_score_audit ->> 'outcome' as official_outcome, (o ->> 'hit')::int as hit,
  (o ->> 'hypothetical_net_cents')::double precision as hypothetical_net_cents, o ->> 'path' as observation_kind, sk ->> 'check' as counter_check
from desk_ledger l, jsonb_array_elements(l.skill_score_audit -> 'skills') sk, jsonb_array_elements(sk -> 'observations') o
where l.skill_score_audit is not null and l.close_time >= :from and l.close_time < :to
union all
select l.ticker, l.close_time, to_timestamp((l.entry_skill_quality ->> 'entry_at_ms')::bigint / 1000.0), l.entry_secs_left,
  case when l.entry_secs_left > 600 then 'ENTRY' when l.entry_secs_left >= 180 then 'MID' else 'FINAL' end,
  o ->> 'skill', l.entry_skill_quality ->> 'version', o ->> 'status', o ->> 'lean', (o ->> 'ask_cents')::double precision, (o ->> 'fee_cents')::double precision,
  (o ->> 'signal_strength')::double precision, 'signal_strength_not_calibrated_probability', null, false, l.entry_skill_quality ->> 'winner', (o ->> 'hit')::boolean::int,
  (o ->> 'hypothetical_net_cents')::double precision, 'main_paper_fill:' || (o ->> 'role'), 'n/a'
from desk_ledger l, jsonb_array_elements(l.entry_skill_quality -> 'observations') o
where l.entry_skill_quality is not null and l.close_time >= :from and l.close_time < :to
order by 3;
