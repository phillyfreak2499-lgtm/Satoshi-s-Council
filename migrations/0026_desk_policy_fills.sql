-- The one source fill every candidate is measured from, stored once.
--
-- WHY. 0025 recorded the entry on each candidate's own row: five observations
-- carrying five matching COPIES of the same side, price, timestamp and fee. That
-- made same-entry parity something to verify rather than something guaranteed, and
-- it meant a paired analysis had to join candidates on a tuple of copied values and
-- trust that they agreed. If they ever disagreed, the join would quietly produce a
-- comparison between two different entries.
--
-- Now the fill is a row of its own and every observation references it by key. Two
-- candidates cannot describe different entries for the same window, because there
-- is only one entry to describe. Paired comparisons join on fill_key.
--
-- Written to work whether or not observations already exist. At the time of writing
-- the table is empty, but the deployed code records observations WITHOUT a fill_key,
-- so a Chair fill landing between that deploy and this one would leave rows behind —
-- and `add column ... not null` on a non-empty table fails. Racing the market is not
-- a migration strategy, so the column arrives nullable, any existing rows are
-- normalised from the entry values they already carry, and the constraint is applied
-- afterwards.
--
-- That normalisation invents nothing: it derives the key and the fill row from the
-- side, price and timestamp already stored on the observation. No observation is
-- added, so no candidate's prospective count changes.
--
-- PAPER ONLY. A "fill" here is the desk's paper book taking a position. There is no
-- order, no venue and no size.

create table if not exists desk_policy_fills (
  -- Deterministic: ticker | close_time_ms | entry_t_ms. A replayed write produces
  -- the same key, so idempotence survives a restart mid-settle.
  fill_key        text primary key,

  ticker          text not null,
  close_time      timestamptz not null,

  -- The position the Chair actually took. Immutable once written.
  entry_side      text not null,
  entry_t         timestamptz not null,
  entry_cents     double precision not null,
  entry_fee_cents double precision not null,

  -- The composition that produced it. The exit slot is deliberately absent: that is
  -- what the candidates compete over, so it belongs on the observation, not here.
  signal_policy   text not null,
  entry_policy    text not null,
  risk_policy     text not null,

  created_at      timestamptz not null default now()
);

-- One fill per window. A second would mean the desk took two positions in one
-- window, which the exit competition has no defined meaning for.
create unique index if not exists desk_policy_fills_window
  on desk_policy_fills (ticker, close_time);

alter table desk_policy_observations
  add column if not exists fill_key text;

-- Normalise anything already recorded: one fill row per window, derived from the
-- entry values the observations already carry. The key must match what the writer
-- computes — ticker | close_time_ms | entry_t_ms — or a replayed write would not
-- recognise its own row.
insert into desk_policy_fills
  (fill_key, ticker, close_time, entry_side, entry_t, entry_cents, entry_fee_cents,
   signal_policy, entry_policy, risk_policy)
select distinct
       o.ticker || '|' || (extract(epoch from o.close_time) * 1000)::bigint
                 || '|' || (extract(epoch from o.entry_t) * 1000)::bigint,
       o.ticker, o.close_time, o.entry_side, o.entry_t, o.entry_cents, o.entry_fee_cents,
       o.signal_policy, o.entry_policy, o.risk_policy
  from desk_policy_observations o
 where o.fill_key is null
on conflict do nothing;

update desk_policy_observations o
   set fill_key = o.ticker || '|' || (extract(epoch from o.close_time) * 1000)::bigint
                            || '|' || (extract(epoch from o.entry_t) * 1000)::bigint
 where o.fill_key is null;

-- Now it can be required. Idempotent: setting NOT NULL on an already-NOT-NULL
-- column is a no-op.
alter table desk_policy_observations
  alter column fill_key set not null;

-- Structural, not conventional: an observation cannot reference a fill that was
-- never recorded, so the writer must store the fill before the candidates.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desk_policy_obs_fill_fk') then
    alter table desk_policy_observations
      add constraint desk_policy_obs_fill_fk
      foreign key (fill_key) references desk_policy_fills (fill_key);
  end if;
end $$;

create index if not exists desk_policy_obs_fill
  on desk_policy_observations (fill_key);

-- Rebuilt because the observation table gained a column and the view selects o.*.
drop view if exists desk_policy_observations_research;
create view desk_policy_observations_research as
  select o.*
    from desk_policy_observations o
    join desk_ledger l
      on l.ticker = o.ticker and l.close_time = o.close_time
   where l.research_quality = 'valid'
     and o.data_invalid = false;
