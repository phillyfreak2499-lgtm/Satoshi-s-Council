-- Owner-requested correction after V2's three-speaker quorum blocked all
-- observed directional reads. V2 remains frozen for historical attribution.
-- Normal mode now accepts two healthy supporters only when they come from two
-- distinct evidence families and nobody opposes. All price, freshness, edge,
-- timing and defensive-mode requirements remain unchanged.
do $$
begin
  if not exists (select 1 from desk_floor_policy where policy_id = 'FLOOR_SELECTIVE_V3') then
    update desk_floor_policy set status = 'RETIRED', left_champion_at = now()
      where status = 'CHAMPION';
    insert into desk_floor_policy
      (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status,
       created_at, prospective_start_at, became_champion_at)
    values ('FLOOR_SELECTIVE_V3', 4, 'CHAIR_V1', 'ENTRY_SELECTIVE_V3', 'HOLD_V1', 'RISK_NONE_V1',
      'CHAMPION', now(), to_timestamp(ceil(extract(epoch from now()) / 900) * 900), now());
  end if;
end $$;
