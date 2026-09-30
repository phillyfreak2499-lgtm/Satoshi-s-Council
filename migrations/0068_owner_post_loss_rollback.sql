-- Owner-requested prospective rollback of the post-four-loss admission
-- narrowing. Historical policy rows remain frozen and attributable.
do $$
begin
  if not exists (select 1 from desk_floor_policy where policy_id = 'FLOOR_OWNER_ROLLBACK_V1') then
    update desk_floor_policy set status = 'RETIRED', left_champion_at = now()
      where status = 'CHAMPION';
    insert into desk_floor_policy
      (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status,
       created_at, prospective_start_at, became_champion_at)
    values ('FLOOR_OWNER_ROLLBACK_V1', 5, 'CHAIR_V1', 'ENTRY_OWNER_ROLLBACK_V1', 'HOLD_V1', 'RISK_NONE_V1',
      'CHAMPION', now(), greatest(
        to_timestamp(ceil(extract(epoch from now()) / 900) * 900),
        '2026-09-30 21:00:00+00'::timestamptz
      ), now());
  end if;
end $$;
