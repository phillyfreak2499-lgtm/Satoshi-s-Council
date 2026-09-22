-- 15. skill_status_transitions: the prospective transition log (insert-once system events written by the healthz-kicked
-- drainer of the engine's transition buffer). Nothing before this branch's deploy exists; docs/sql/exports/skill_status_history.sql
-- gives the current state only. Key shape: SKILL_STATUS:<card>:<from>_to_<to>:<ms>.
select event_key, occurred_at, source_id as card, payload ->> 'seat' as seat, payload ->> 'from' as from_status, payload ->> 'to' as to_status,
  payload ->> 'writer' as writer, payload ->> 'authority' as authority, recorded_at
from desk_system_events
where event_key like 'SKILL_STATUS:%' and occurred_at >= :from and occurred_at < :to order by occurred_at, event_key;
