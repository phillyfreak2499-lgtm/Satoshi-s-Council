-- Append-only Lab enrollment for two Chair-policy challengers.
--
-- NOTHING HERE CHANGES BEHAVIOUR.
-- Does not retire the Champion.
-- Does not rewrite any observation.
-- Does not grant authority.
-- No row here is read by the live decision path (Champion only).
--
-- FLOOR_CENTS_V1  = CHAIR_CENTS_V1  + ENTRY_SELECTIVE_V3 + HOLD_V1 + RISK_NONE_V1
-- FLOOR_CALIBER_V1 = CHAIR_CALIBER_V1 + ENTRY_SELECTIVE_V3 + HOLD_V1 + RISK_NONE_V1
--
-- Existing HOLD / PROVE / TAKE / ENTRY_80 / SELECTIVE / Forced V4 collectors stay.
-- Meeting a sample gate later still requires a separate documented review.

insert into desk_floor_policy
  (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status,
   created_at, prospective_start_at)
values
  ('FLOOR_CENTS_V1', 5, 'CHAIR_CENTS_V1', 'ENTRY_SELECTIVE_V3', 'HOLD_V1', 'RISK_NONE_V1',
   'SHADOW', timestamptz '2026-09-19T10:16:00Z', timestamptz '2026-09-19T10:16:00Z')
on conflict (policy_id) do nothing;

insert into desk_floor_policy
  (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status,
   created_at, prospective_start_at)
values
  ('FLOOR_CALIBER_V1', 6, 'CHAIR_CALIBER_V1', 'ENTRY_SELECTIVE_V3', 'HOLD_V1', 'RISK_NONE_V1',
   'SHADOW', timestamptz '2026-09-19T10:16:00Z', timestamptz '2026-09-19T10:16:00Z')
on conflict (policy_id) do nothing;
