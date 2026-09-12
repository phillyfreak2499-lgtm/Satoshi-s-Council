-- S2-5: the Chair's decision-time market snapshot. Measurement only.
--
-- THE GAP THIS CLOSES. The desk re-reads the market every brain tick, and the
-- finalized (snap, chair) pair at that tick is what the Chair actually knew when
-- it spoke. Until now nothing persisted that pair. What the desk stored instead
-- was derivative and later:
--   * the FILL frame (desk_ledger.entry_*), and only when a paper position booked;
--   * the GRADE frame (desk_ledger.chair_*), as of the close;
--   * a V2-study sample (desk_samples), at one fixed mid-window tick, a market
--     subset, the Chair side only.
-- None of those is the Chair's decision-time market state. A fill is not a read,
-- a grade is not a read, and a current quote is not a read. This table records
-- the read itself, prospectively.
--
-- TWO BOUNDED EVENTS PER EXACT WINDOW, AND NO MORE.
--   OPENING            the FIRST finalized Chair read for the window -- UP, DOWN,
--                      or WAIT. Immutable.
--   FIRST_DIRECTIONAL  the first LATER UP/DOWN read, and ONLY if OPENING was WAIT.
--                      A directional OPENING is already the window's first
--                      directional read, so it is stored once as OPENING and no
--                      FIRST_DIRECTIONAL row is written.
-- Later transitions (UP->DOWN, ->WAIT, any subsequent flip) are deliberately out
-- of scope. This is NOT a per-tick decision archive -- replay and path-parity
-- already carry the high-frequency path. The semantics live in
-- src/lib/desk/decision-snapshot.ts and are behaviorally tested.
--
-- IDENTITY IS THE WINDOW, NEVER THE TICKER. close_time is carried as timestamptz
-- to match desk_ledger (0005), desk_replay (0014/0028) and every other desk table,
-- so (ticker, close_time) compares exactly across them. On 2026-09-10 nine closes
-- shared one ticker; a ticker-only key could not tell them apart. The primary key
-- is (ticker, close_time, snapshot_kind), so the two events of one window coexist
-- and a repeated attempt at the same event collides instead of duplicating.
--
-- NO HISTORICAL BACKFILL. This migration creates structure only. No INSERT, no
-- INSERT-SELECT, no population from desk_ledger.entry_*, desk_replay, desk_samples,
-- a current quote, or settlement. Old decision reads are unknown and stay unknown;
-- the table begins prospectively at deploy. Rows before that simply do not exist.
--
-- FIELD CLASSIFICATION (also in the PR body):
--   CLOCK        decision_at, secs_left, quote_age_s, quote_seq, print_age_s,
--                quote_last_change_at, receipt_at
--   CHAIR_OUTPUT chair_lean, chair_confidence, chair_score, chair_bar,
--                chair_sit_mass, chair_hard_fail, chair_quorum_*, chair_size,
--                chair_gates, chair_hypothesis, chair_evidence, chair_counter,
--                chair_decision, chair_invalidate_if
--   OBSERVED     spot, spot_source, strike, yes_bid, yes_ask, no_bid, no_ask,
--                yes_bid_size, no_bid_size, kalshi_taker_yes, kalshi_trade_n
--   DERIVED      fair_yes, lab_fair_yes, yes_mid, spread_cents, combined_ask_cents,
--                leftover_cents, edge_up, edge_down, fee_yes, fee_no, regime_key,
--                clock_key, atr, imbalance, range_pos
--
-- CLOCK TRUTH. decision_at is the tick's own clock (snap.as_of), never a fill,
-- insert, or settlement time. receipt_at is the server write time, named as such.
-- quote_last_change_at is snap.quote_ts -- a LAST-CHANGE clock -- and is named for
-- exactly that. The known-misnamed ObsStamp.provider_ts is NOT stored here under
-- any name, and no fabricated freshness is recorded as provider-observed.
--
-- No ask-size columns: the production snapshot carries yes_bid_size and
-- no_bid_size only. An executable price is not a separate column; for an UP read
-- it is yes_ask, for a DOWN read no_ask, both stored OBSERVED. A WAIT read has no
-- directional executable price, and none is manufactured.
--
-- PAPER ONLY. No order, no venue, no size, no execution path. A research table
-- that no seat, DSL rule, threshold, Chair input, learned weight or skill reads.

create table if not exists desk_decision_snapshots (
  ticker        text not null,
  close_time    timestamptz not null,
  snapshot_kind text not null,

  -- CLOCK
  decision_at          timestamptz not null,
  secs_left            double precision,
  quote_age_s          double precision,
  quote_seq            bigint,
  print_age_s          double precision,
  quote_last_change_at timestamptz,
  receipt_at           timestamptz not null default now(),

  -- CHAIR_OUTPUT
  chair_lean          text not null,
  chair_confidence    double precision,
  chair_score         double precision,
  chair_bar           double precision,
  chair_sit_mass      double precision,
  chair_hard_fail     boolean not null default false,
  chair_quorum_up     integer,
  chair_quorum_down   integer,
  chair_quorum_wait   integer,
  chair_size          integer,
  chair_gates         jsonb,
  chair_hypothesis    text not null default '',
  chair_evidence      jsonb,
  chair_counter       text not null default '',
  chair_decision      text not null default '',
  chair_invalidate_if text not null default '',

  -- OBSERVED
  spot             double precision,
  spot_source      text not null default '',
  strike           double precision,
  yes_bid          double precision,
  yes_ask          double precision,
  no_bid           double precision,
  no_ask           double precision,
  yes_bid_size     double precision,
  no_bid_size      double precision,
  kalshi_taker_yes double precision,
  kalshi_trade_n   integer,

  -- DERIVED (computed upstream by liveSnap on this same tick; nothing new is invented here)
  fair_yes          double precision,
  lab_fair_yes      double precision,
  yes_mid           double precision,
  spread_cents      double precision,
  combined_ask_cents double precision,
  leftover_cents    double precision,
  edge_up           double precision,
  edge_down         double precision,
  fee_yes           double precision,
  fee_no            double precision,
  regime_key        text not null default '',
  clock_key         text not null default '',
  atr               double precision,
  imbalance         double precision,
  range_pos         double precision,

  research_version  text not null default '',

  -- The window is the identity; the two semantic events are distinct rows. A
  -- second attempt at the same (window, kind) collides here, so `on conflict do
  -- nothing` keeps the first-observed read and a later tick can never rewrite it.
  primary key (ticker, close_time, snapshot_kind),

  -- Only the two bounded events exist. A third kind is a bug, and the database
  -- refuses it rather than storing a silent third category.
  constraint desk_decision_snapshots_kind
    check (snapshot_kind in ('OPENING', 'FIRST_DIRECTIONAL'))
);

-- Newest-first window scans for the research read.
create index if not exists desk_decision_snapshots_close_idx
  on desk_decision_snapshots (close_time desc);

-- SELF-HEALING. `create table if not exists` is a no-op on a database that already
-- has the table, so any column added to this file later would never arrive. Each
-- nullable column is therefore also added idempotently. (The primary key and the
-- check constraint are part of the initial create; they are not re-added here
-- because a constraint cannot be added with `if not exists`, and on the only
-- database without them the create above installs them.)
alter table desk_decision_snapshots add column if not exists secs_left double precision;
alter table desk_decision_snapshots add column if not exists quote_age_s double precision;
alter table desk_decision_snapshots add column if not exists quote_seq bigint;
alter table desk_decision_snapshots add column if not exists print_age_s double precision;
alter table desk_decision_snapshots add column if not exists quote_last_change_at timestamptz;
alter table desk_decision_snapshots add column if not exists receipt_at timestamptz not null default now();
alter table desk_decision_snapshots add column if not exists chair_sit_mass double precision;
alter table desk_decision_snapshots add column if not exists chair_quorum_up integer;
alter table desk_decision_snapshots add column if not exists chair_quorum_down integer;
alter table desk_decision_snapshots add column if not exists chair_quorum_wait integer;
alter table desk_decision_snapshots add column if not exists chair_size integer;
alter table desk_decision_snapshots add column if not exists chair_gates jsonb;
alter table desk_decision_snapshots add column if not exists chair_evidence jsonb;
alter table desk_decision_snapshots add column if not exists kalshi_taker_yes double precision;
alter table desk_decision_snapshots add column if not exists kalshi_trade_n integer;
alter table desk_decision_snapshots add column if not exists lab_fair_yes double precision;
alter table desk_decision_snapshots add column if not exists combined_ask_cents double precision;
alter table desk_decision_snapshots add column if not exists leftover_cents double precision;
alter table desk_decision_snapshots add column if not exists edge_up double precision;
alter table desk_decision_snapshots add column if not exists edge_down double precision;
alter table desk_decision_snapshots add column if not exists fee_yes double precision;
alter table desk_decision_snapshots add column if not exists fee_no double precision;
alter table desk_decision_snapshots add column if not exists atr double precision;
alter table desk_decision_snapshots add column if not exists imbalance double precision;
alter table desk_decision_snapshots add column if not exists range_pos double precision;
alter table desk_decision_snapshots add column if not exists research_version text not null default '';
