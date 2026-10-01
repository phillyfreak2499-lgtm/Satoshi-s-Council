-- Durable owner-set Discord release, independent of the per-commit web-push rollout
-- (desk_alert_rollout, untouched). Additive only: one new single-row table.
-- No seed row: absent row => Discord HELD. Only the owner/admin-key route writes it,
-- and it survives deploys because it is not keyed by build.
create table if not exists desk_discord_release (
  id integer primary key check (id = 1),
  released boolean not null default false,
  released_at timestamptz,
  updated_at timestamptz not null default now()
);
