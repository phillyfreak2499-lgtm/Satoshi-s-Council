-- The Lab: versioned Floor policies, and one immutable row per candidate per window.
--
-- WHY. The desk's answer was an accidental composition — the Chair picked a side,
-- the 80¢ floor gated the fill, and the position was held to settlement because
-- nothing else had been written. None of those was named as a choice, so none
-- could be competed against. These tables name the active policy and record what
-- each frozen alternative would have done to the position the Chair actually took.
--
-- NOTHING HERE CHANGES BEHAVIOUR. FLOOR_V1 is seeded as CHAMPION and is exactly
-- the current desk: CHAIR_V1 + ENTRY_80_V1 + HOLD_V1. HOLD_V1 *is* holding to
-- settlement, so naming it alters nothing. Every other candidate starts SHADOW
-- with no observations, and no row here is read by any decision path.
--
-- PAPER ONLY. These are research records of simulated exits on a paper book. No
-- table here represents, triggers, or can be turned into a real order.

-- ---------------------------------------------------------------------------
-- The versioned policy, and which version is Champion.
-- ---------------------------------------------------------------------------
create table if not exists desk_floor_policy (
  policy_id            text primary key,
  version              integer not null,
  signal_policy        text not null,
  entry_policy         text not null,
  exit_policy          text not null,
  risk_policy          text not null,
  status               text not null default 'SHADOW',
  created_at           timestamptz not null default now(),
  prospective_start_at timestamptz not null default now(),
  -- Set when a policy becomes Champion and when it stops being one. A policy that
  -- was Champion and is not any more keeps both, which is its promotion history.
  became_champion_at   timestamptz,
  left_champion_at     timestamptz
);

-- Exactly one Champion at a time. A second ACTIVE champion is not a state the
-- desk can answer from, so the database refuses it rather than picking one.
create unique index if not exists desk_floor_policy_one_champion
  on desk_floor_policy ((status = 'CHAMPION')) where status = 'CHAMPION';

-- The initial Champion: the unchanged desk, named. Idempotent, and deliberately
-- NOT overwritten on re-run — once promotion history exists here, a migration
-- re-run must not reset it.
insert into desk_floor_policy
  (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status, became_champion_at)
values
  ('FLOOR_V1', 1, 'CHAIR_V1', 'ENTRY_80_V1', 'HOLD_V1', 'RISK_NONE_V1', 'CHAMPION', now())
on conflict (policy_id) do nothing;

-- ---------------------------------------------------------------------------
-- One immutable observation per candidate per window.
-- ---------------------------------------------------------------------------
create table if not exists desk_policy_observations (
  id                serial primary key,

  -- Which window, and which candidate saw it.
  ticker            text not null,
  close_time        timestamptz not null,
  candidate_id      text not null,          -- 'HOLD_V1', 'PROVE180_V1', ...
  candidate_kind    text not null,          -- 'exit' today; 'floor' when full candidates land
  candidate_version integer not null,

  -- The composition in force when this was recorded, so the row stays readable
  -- after the Champion changes.
  signal_policy     text not null,
  entry_policy      text not null,
  exit_policy       text not null,
  risk_policy       text not null,

  -- The ONE real paper fill every candidate was handed. Identical across every
  -- row for a given window: same-entry parity is visible in the data, not just
  -- asserted in code.
  entry_side        text not null,
  entry_t           timestamptz not null,
  entry_cents       double precision not null,
  entry_fee_cents   double precision not null,

  -- What this candidate did.
  exit_t            timestamptz,
  exit_cents        double precision,
  exit_fee_cents    double precision,
  exit_reason       text not null,          -- PROVEN_HELD | DEADLINE | TARGET | SETTLEMENT | DATA_INVALID
  secs_held         double precision,
  proven_at         timestamptz,

  -- Excursions on the sellable bid while the position was open.
  mfe_cents         double precision,
  mae_cents         double precision,

  -- The two axes, kept apart on purpose: a candidate can be direction-wrong and
  -- still be the better policy because it lost less.
  settle_winner     text,
  direction_right   boolean,
  net_cents         double precision,

  -- Why a row may not count. research_quality is stored for forensics -- what was
  -- known when the row was written -- while the authoritative answer is the view
  -- below, which re-reads the ledger so a window quarantined LATER drops out of
  -- the Lab automatically instead of keeping a stale copy of its own verdict.
  research_quality  text not null default 'valid',
  data_invalid      boolean not null default false,
  invalid_why       text,

  -- Reproducibility.
  code_version      text,
  created_at        timestamptz not null default now()
);

-- Immutability and idempotence in one constraint: a candidate observes a window
-- once. A re-run inserts nothing rather than overwriting a recorded result, so a
-- restart mid-settle cannot double-count or silently revise history.
create unique index if not exists desk_policy_obs_once
  on desk_policy_observations (candidate_id, ticker, close_time);

create index if not exists desk_policy_obs_candidate_time
  on desk_policy_observations (candidate_id, close_time);

-- ---------------------------------------------------------------------------
-- What research is allowed to count.
-- ---------------------------------------------------------------------------
-- Applies the SAME predicate 0024 defines, spelled out here rather than layered on
-- the desk_ledger_research view. Stacking views read better but made 0024
-- non-idempotent: its `drop view` could not run while this one depended on it, so
-- re-applying 0024 alone -- a restore, a hand-run -- would either fail or, with
-- CASCADE, silently delete the Lab's view. Each migration must stand on its own.
--
-- The cost is one repeated predicate, and a test asserts both migrations spell it
-- identically (and identically to VALID_ONLY_SQL in research-quality.ts), so the
-- Lab and the rest of research can never disagree about which windows count.
--
-- DATA_INVALID rows are excluded here too: an observation the book could not price
-- is not a zero, it is an absence.
drop view if exists desk_policy_observations_research;
create view desk_policy_observations_research as
  select o.*
    from desk_policy_observations o
    join desk_ledger l
      on l.ticker = o.ticker and l.close_time = o.close_time
   where l.research_quality = 'valid'
     and o.data_invalid = false;
