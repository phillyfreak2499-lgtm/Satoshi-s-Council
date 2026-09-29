-- Corrected V2 receipt lifecycle: intention is nonterminal and may advance to
-- exactly one terminal fill, veto or T-3 no_fill. Legacy experiment semantics
-- remain unchanged. Raw append-only receipts are never updated or deleted;
-- only the derived cross-writer coordination row is reclassified.
do $migration$
begin
perform set_config('lock_timeout', '5s', true);
lock table desk_shadow_receipts in share row exclusive mode;
lock table desk_shadow_receipt_decisions in share row exclusive mode;

alter table desk_shadow_receipt_decisions
  drop constraint if exists desk_shadow_receipt_decisions_decision_class_check;
alter table desk_shadow_receipt_decisions
  add constraint desk_shadow_receipt_decisions_decision_class_check
  check (decision_class in ('active', 'intention', 'fill', 'veto', 'no_fill', 'conflicted'));

create or replace function shadow_receipt_decision_class(receipt_kind text, receipt_payload jsonb)
returns text
language sql
immutable
as $class$
  select case
    when coalesce(receipt_payload, '{}'::jsonb)->>'evaluator_revision' = 'V2_CANDIDATE_PROVENANCE_V1'
      and receipt_kind in ('intention', 'fill', 'veto', 'no_fill') then receipt_kind
    when receipt_kind = 'no_fill' and (
      coalesce(receipt_payload, '{}'::jsonb) @> '{"checkpoint":180}'::jsonb
      or coalesce(receipt_payload, '{}'::jsonb) @> '{"receipt_only":true}'::jsonb
    ) then 'no_fill'
    when receipt_kind in ('intention', 'fill', 'veto', 'no_fill') then 'active'
    else null end
$class$;

-- Migration 0060 correctly serialized these keys but could not yet distinguish
-- a corrected-V2 intention from a terminal decision. Rebuild only those
-- derived claims from their preserved source receipts.
with v2 as (
  select experiment, arm, ticker, close_time,
    case
      when count(*) filter (where kind in ('fill', 'veto', 'no_fill')) > 1 then 'conflicted'
      when bool_or(kind = 'fill') then 'fill'
      when bool_or(kind = 'veto') then 'veto'
      when bool_or(kind = 'no_fill') then 'no_fill'
      else 'intention'
    end as decision_class
  from desk_shadow_receipts
  where experiment = 'MID_RECOVERY_LOCKS_V2_INACTIVE'
    and payload->>'evaluator_revision' = 'V2_CANDIDATE_PROVENANCE_V1'
    and kind in ('intention', 'fill', 'veto', 'no_fill')
  group by experiment, arm, ticker, close_time
)
update desk_shadow_receipt_decisions d
set decision_class = v2.decision_class
from v2
where d.experiment = v2.experiment and d.arm = v2.arm
  and d.ticker = v2.ticker and d.close_time = v2.close_time
  and d.decision_class is distinct from v2.decision_class;

create or replace function guard_shadow_receipt_decision()
returns trigger
language plpgsql
set search_path from current
as $guard$
declare
  wanted text;
  accepted text;
begin
  if TG_OP = 'UPDATE' then
    if row(NEW.experiment, NEW.arm, NEW.ticker, NEW.close_time, NEW.kind)
       is distinct from row(OLD.experiment, OLD.arm, OLD.ticker, OLD.close_time, OLD.kind) then
      raise exception using errcode = '23514', message = 'shadow receipt identity is immutable';
    end if;
    if shadow_receipt_decision_class(NEW.kind, NEW.payload)
       is distinct from shadow_receipt_decision_class(OLD.kind, OLD.payload) then
      raise exception using errcode = '23514', message = 'shadow receipt decision class is immutable';
    end if;
    return NEW;
  end if;
  if NEW.kind not in ('intention', 'fill', 'veto', 'no_fill') then
    return NEW;
  end if;
  wanted := shadow_receipt_decision_class(NEW.kind, NEW.payload);

  -- The primary-key conflict remains the cross-process serialization point.
  -- Corrected V2 may advance intention once to a terminal class. A terminal
  -- class can then only accept its own idempotent duplicate.
  insert into desk_shadow_receipt_decisions as d
    (experiment, arm, ticker, close_time, decision_class)
  values (NEW.experiment, NEW.arm, NEW.ticker, NEW.close_time, wanted)
  on conflict (experiment, arm, ticker, close_time)
  do update set decision_class = excluded.decision_class
  where d.decision_class = excluded.decision_class
     or (d.decision_class = 'intention' and excluded.decision_class in ('fill', 'veto', 'no_fill'))
  returning d.decision_class into accepted;

  if accepted is null then
    raise exception using errcode = '23514', message = 'shadow receipt cross-kind decision conflict';
  end if;
  return NEW;
end
$guard$;

end
$migration$;
