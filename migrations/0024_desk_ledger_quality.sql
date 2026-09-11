-- Research quality: which recorded windows may be counted as evidence.
--
-- Some windows are recorded faithfully and are still not evidence, because what
-- was recorded was not what happened. On 2026-09-10 the ledger took eight
-- consecutive windows -- 07:15 through 09:00 UTC inclusive -- whose settlement
-- belonged to a market that had already closed: the feed stopped advancing the
-- ticker, and the settlement matcher accepted a settle on ticker alone, so every
-- one of those rows carries KXBTC15M-26SEP100300-00's result and official_value.
-- The 07:00 row is the legitimate one.
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not delete a row, rewrite a
-- settlement, recompute a winner, clear an entry or adjust a cent. The records
-- stay exactly as recorded, because a record of a fault is the only evidence the
-- fault happened, and "repairing" it would destroy that. Every recorded value in
-- those eight rows is untouched by this file.
--
-- WHAT IT ADDS. One metadata column describing the record rather than changing
-- it, so SQL aggregates can exclude in the query instead of pulling every row
-- and hoping each caller remembers to filter. Default 'valid', so every existing
-- and future row counts unless something is known about it.
--
--   valid     recorded as intended; counts everywhere
--   excluded  known invalid; never counts in an aggregate
--   partial   recorded but incomplete
--   suspect   not proven invalid, flagged for review
--
-- The ranges here are the same ranges as EXCLUSIONS in
-- src/lib/desk/research-quality.ts, which is the registry of record. A test
-- asserts the two cannot drift apart.
--
-- Excluded rows stay readable: this is a filter, never a deletion, so the block
-- can still be inspected and explained. It simply cannot arrive unannounced in
-- a hit rate.

alter table desk_ledger
  add column if not exists research_quality text not null default 'valid';

alter table desk_ledger
  add column if not exists research_quality_rule text;

-- Stamp the known block. Idempotent: re-running sets the same values, and the
-- predicate is the window range, so a row that does not exist yet is stamped if
-- it is ever backfilled into that interval.
update desk_ledger
   set research_quality = 'excluded',
       research_quality_rule = '2026-09-10-ticker-reuse'
 where close_time >= timestamptz '2026-09-10T07:15:00Z'
   and close_time <= timestamptz '2026-09-10T09:00:00Z'
   and research_quality <> 'excluded';

-- Research reads filter on this on every aggregate, so it carries the read.
create index if not exists desk_ledger_quality_idx
  on desk_ledger (research_quality, close_time);

-- ONE definition, not a predicate repeated in every report.
--
-- Research reads this view; nothing else. A new aggregate that says
-- `from desk_ledger_research` is correct by construction, and auditing coverage
-- becomes a single question -- does this query touch the bare table? -- instead
-- of checking that thirteen separate WHERE clauses each still carry a filter.
--
-- Dropped and recreated rather than CREATE OR REPLACE: `select *` fixes the
-- column list at creation time, so a later migration that adds a desk_ledger
-- column leaves the view behind. A test asserts the view's columns still match
-- the table's, which fails loudly if that happens -- so a migration adding a
-- ledger column must refresh this view too.
drop view if exists desk_ledger_research;
create view desk_ledger_research as
  select * from desk_ledger where research_quality = 'valid';
