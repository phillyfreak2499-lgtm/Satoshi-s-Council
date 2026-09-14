-- Preserve the Chair decision the paper book actually held, and grade it in a
-- disconnected research view. Measurement only: no Chair, seat, learner,
-- threshold, booking, settlement, or promotion path reads this view.
--
-- desk_ledger.chair_* is the GRADE frame. A position usually goes quiet before
-- the close, so those fields cannot truthfully stand in for the earlier booked
-- decision. The entry_* fields already preserve its score frame; these two
-- columns complete the receipt with its side and the code build that made it.
-- Existing rows stay NULL. There is deliberately no historical reconstruction.

alter table desk_ledger add column if not exists entry_lean text;
alter table desk_ledger add column if not exists entry_build_sha text;

-- 0024's select-* view fixes its column list when created. Refresh it so every
-- valid research read sees the additive columns and excluded rows stay excluded.
drop view if exists desk_booked_chair_mirror;
drop view if exists desk_ledger_research;
create view desk_ledger_research as
  select * from desk_ledger where research_quality = 'valid';

-- A prospective mirror grade of the booked decision. This is queryable evidence,
-- not learner state: nothing writes its result back into the live desk.
--
-- Read the ledger directly with the canonical quality predicate instead of
-- depending on desk_ledger_research. Older migrations deliberately refresh that
-- select-* view when the full directory is replayed; keeping this mirror as a
-- sibling makes the migration directory idempotent.
create view desk_booked_chair_mirror as
  select
    ticker,
    close_time,
    entry_build_sha,
    entry_lean as lean,
    entry_conf as confidence,
    entry_score as score,
    entry_bar as bar,
    entry_cents,
    settle_cents,
    winner,
    (entry_lean = winner) as hit,
    case
      when entry_conf between 0 and 100 then
        power(entry_conf / 100.0 - case when entry_lean = winner then 1.0 else 0.0 end, 2)
      else null
    end as brier,
    ev_cents
  from desk_ledger
  where research_quality = 'valid'
    and entry_lean in ('UP', 'DOWN')
    and entry_cents is not null
    and settle_cents is not null
    and winner in ('UP', 'DOWN');
