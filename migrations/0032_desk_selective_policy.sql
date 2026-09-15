-- Owner-selected operating policy, not a data-driven promotion. Never rewrite observations.
-- A re-run cannot re-promote it or overwrite its original activation time.
do $$
begin
  if not exists (select 1 from desk_floor_policy where policy_id = 'FLOOR_SELECTIVE_V1') then
    update desk_floor_policy set status = 'RETIRED', left_champion_at = now()
      where status = 'CHAMPION';
    insert into desk_floor_policy
      (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status,
       created_at, prospective_start_at, became_champion_at)
    values ('FLOOR_SELECTIVE_V1', 2, 'CHAIR_V1', 'ENTRY_SELECTIVE_V1', 'HOLD_V1', 'RISK_NONE_V1',
      'CHAMPION', now(), to_timestamp(ceil(extract(epoch from now()) / 900) * 900), now());
  end if;
end $$;
