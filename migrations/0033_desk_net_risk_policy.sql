-- Owner-requested operating rules. No specimen is promoted and no grade is rewritten.
do $$
begin
  if not exists (select 1 from desk_floor_policy where policy_id = 'FLOOR_SELECTIVE_V2') then
    update desk_floor_policy set status = 'RETIRED', left_champion_at = now()
      where status = 'CHAMPION';
    insert into desk_floor_policy
      (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status,
       created_at, prospective_start_at, became_champion_at)
    values ('FLOOR_SELECTIVE_V2', 3, 'CHAIR_V1', 'ENTRY_SELECTIVE_V2', 'HOLD_V1', 'RISK_NONE_V1',
      'CHAMPION', now(), to_timestamp(ceil(extract(epoch from now()) / 900) * 900), now());
  end if;
end $$;
