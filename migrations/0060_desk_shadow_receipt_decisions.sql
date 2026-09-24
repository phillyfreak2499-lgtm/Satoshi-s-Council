-- Research-only cross-kind arbitration. Apply in the migrator's transaction.
-- No receipt, manifest, learner, ledger or paper-state row is rewritten.
-- A terminal T-3 sit and an observed decision cannot coexist for one key.
-- Nonterminal no_fill observations (basis blocks / NULL_FAV checkpoints) may
-- precede a later eligible fill; this migration must not freeze those arms.
--
-- Lock before seeding so old-version INSERTs cannot slip between the seed and
-- trigger installation. Ordinary reads remain available. All old and new
-- writers subsequently pass through the trigger, not a process-local lock.
-- A single DO statement also makes standalone test/maintenance application atomic.
do $migration$
begin
perform set_config('lock_timeout', '5s', true);
lock table desk_shadow_receipts in share row exclusive mode;

create table if not exists desk_shadow_receipt_decisions (
  experiment text not null,
  arm text not null,
  ticker text not null,
  close_time timestamptz not null,
  decision_class text not null check (decision_class in ('active', 'no_fill', 'conflicted')),
  primary key (experiment, arm, ticker, close_time)
);

-- Classify existing writer payloads, not the overloaded kind alone. Both the
-- original exact-T-3 writer and the grace writer stamp checkpoint=180. The
-- grace writer also stamps receipt_only=true. Other no_fill rows are in-band
-- observations, not a promise that no later research fill can occur.
create or replace function shadow_receipt_decision_class(receipt_kind text, receipt_payload jsonb)
returns text
language sql
immutable
as $class$
  select case
    when receipt_kind = 'no_fill' and (
      coalesce(receipt_payload, '{}'::jsonb) @> '{"checkpoint":180}'::jsonb
      or coalesce(receipt_payload, '{}'::jsonb) @> '{"receipt_only":true}'::jsonb
    ) then 'no_fill'
    when receipt_kind in ('intention', 'fill', 'veto', 'no_fill') then 'active'
    else null end
$class$;

-- Preserve historical contradictions verbatim and fence their keys. This is
-- derived coordination state, not a reconstructed or backdated receipt.
insert into desk_shadow_receipt_decisions (experiment, arm, ticker, close_time, decision_class)
select experiment, arm, ticker, close_time,
  case when bool_or(shadow_receipt_decision_class(kind, payload) = 'no_fill')
             and bool_or(shadow_receipt_decision_class(kind, payload) = 'active') then 'conflicted'
       when bool_or(shadow_receipt_decision_class(kind, payload) = 'no_fill') then 'no_fill'
       else 'active' end
from desk_shadow_receipts
where kind in ('intention', 'fill', 'veto', 'no_fill')
group by experiment, arm, ticker, close_time
on conflict (experiment, arm, ticker, close_time) do nothing;

create or replace function guard_shadow_receipt_decision()
returns trigger
language plpgsql
set search_path from current
as $guard$
declare
  wanted text;
  accepted text;
begin
  -- Settlement can still update outcome/net metadata, never receipt identity.
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

  -- The unique-index conflict is the serialization point. Unlike NOT EXISTS,
  -- ON CONFLICT waits for an uncommitted competing claim. The class comparison
  -- is made against that row, not a stale predicate-read snapshot. The claim
  -- and receipt share the INSERT's transaction and roll back together.
  insert into desk_shadow_receipt_decisions as d
    (experiment, arm, ticker, close_time, decision_class)
  values (NEW.experiment, NEW.arm, NEW.ticker, NEW.close_time, wanted)
  on conflict (experiment, arm, ticker, close_time)
  do update set decision_class = d.decision_class
  where d.decision_class = excluded.decision_class
  returning d.decision_class into accepted;

  if accepted is null then
    -- A rejected write is an error, never a false "duplicate" acknowledgement.
    -- In particular, the observer must not cache a receipt that was not saved.
    raise exception using errcode = '23514', message = 'shadow receipt cross-kind decision conflict';
  end if;
  return NEW;
end
$guard$;

drop trigger if exists desk_shadow_receipt_decision_guard on desk_shadow_receipts;
create trigger desk_shadow_receipt_decision_guard
before insert or update of experiment, arm, ticker, close_time, kind, payload
on desk_shadow_receipts
for each row execute function guard_shadow_receipt_decision();

end
$migration$;

-- Rollback is an explicit follow-up migration, not part of a code rollback:
-- remove the trigger, functions and coordination table together only after
-- stopping receipt writers. Never delete or rewrite desk_shadow_receipts.
