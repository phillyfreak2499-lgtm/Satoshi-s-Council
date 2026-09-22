-- SELECTOR ATTRIBUTION v1 (docs/SELECTOR_ATTRIBUTION_V1_2026-09-22.md).
--
-- One row per (window, kind) recording every divergence between a BLIND
-- eligible opportunity (the price favourite at the live floor, no Council) and
-- the Chair-selected opportunity (the production paper book's fill), with the
-- decision-time facts the Chair had: ask on both price lanes, exact fee,
-- Chair gate numbers, model fair, market mid, settlement-index margin, model
-- edge, feed health, quorum state, eligible seats, directional votes, evidence
-- groups and the production rejection reason. A settle sweep adds the official
-- result, the after-fee net and the counterfactual P&L (92¢ cap, flat-3¢ vs
-- price-aware gates, whole-cent vs exact lane).
--
-- Research only. Append-only through the primary key (ON CONFLICT DO NOTHING);
-- the settle sweep touches only rows with no official result yet. Nothing here
-- can vote, book, grade, tune, promote, veto or alter production state, and
-- no decision module reads this table (scripts/selector-attribution-rails.test.mjs).
--
-- prospective_start_at is stamped on every row from the shadow manifests'
-- durable boundary, and the check below refuses any row whose window did not
-- start after that boundary: the table holds prospective evidence only.
--
-- Additive; applying twice is a no-op. Rollback: drop table desk_selector_attribution.
create table if not exists desk_selector_attribution (
  ticker               text not null,
  close_time           timestamptz not null,
  kind                 text not null,
  decided_at           timestamptz not null,
  prospective_start_at timestamptz not null,
  side                 text,
  -- Exact venue lane (deci-cents where the venue ticks in them). Never rounded.
  ask_cents            double precision,
  -- The whole-cent decision lane the Chair and the floor actually read.
  ask_whole_cents      double precision,
  fee_engine           text not null,
  fee_cents            double precision,
  spread_cents         double precision,
  size_at_ask          double precision,
  chair_lean           text,
  chair_confidence     double precision,
  chair_score          double precision,
  chair_bar            double precision,
  model_fair_yes       double precision,
  market_yes_mid       double precision,
  lab_fair_yes         double precision,
  model_edge_cents     double precision,
  index_margin_cents   double precision,
  feeds_ok             boolean,
  quorum_up            integer,
  quorum_down          integer,
  quorum_wait          integer,
  eligible             boolean,
  rejection_reason     text,
  divergence           text,
  chalk                boolean,
  cap_blocked          boolean,
  official_winner      text,
  net_cents            double precision,
  counterfactual       jsonb not null default '{}'::jsonb,
  payload              jsonb not null default '{}'::jsonb,
  build_sha            text not null default '',
  research_version     text not null default 'SELECTOR_ATTRIBUTION_V1',
  recorded_at          timestamptz not null default now(),
  primary key (ticker, close_time, kind),
  check (kind in ('BLIND_ELIGIBLE', 'CHAIR_FILL', 'WINDOW')),
  check (side is null or side in ('UP', 'DOWN')),
  check (official_winner is null or official_winner in ('UP', 'DOWN')),
  check (divergence is null or divergence in ('BLIND_ONLY', 'CHAIR_ONLY', 'BOTH_SAME_SIDE', 'BOTH_OPPOSITE', 'NEITHER')),
  check (ask_cents is null or (ask_cents > 0 and ask_cents < 100)),
  check (ask_whole_cents is null or (ask_whole_cents > 0 and ask_whole_cents < 100)),
  -- Prospective only: the window must have STARTED after the boundary.
  check (close_time - interval '15 minutes' >= prospective_start_at),
  check (jsonb_typeof(counterfactual) = 'object'),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists desk_selector_attribution_close_idx on desk_selector_attribution (close_time);
create index if not exists desk_selector_attribution_open_idx on desk_selector_attribution (close_time) where official_winner is null;
