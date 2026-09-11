-- The dimensions a performance cube needs, recorded at the moment of the fill.
--
-- desk_ledger describes a window at its GRADE frame: chair_conf, score, bar and
-- close_secs are all as of the close, and the regime, the spread, the time left
-- and the economics at the moment the book actually paid were never written at
-- all. None of that can be reconstructed afterwards, so every window that closes
-- without it is permanently un-sliceable: you cannot ask "does this seat work
-- late but not early" or "only in quiet regimes" of data that never held the
-- answer.
--
-- These columns are captured on the existing decision path when a fill happens,
-- alongside the shadow-book entry. Research only: nothing reads them to decide
-- anything. Existing rows stay NULL, which is honest — the desk was not
-- recording them before.
alter table desk_ledger add column if not exists entry_regime text;
alter table desk_ledger add column if not exists entry_secs_left double precision;
alter table desk_ledger add column if not exists entry_conf integer;
alter table desk_ledger add column if not exists entry_score double precision;
alter table desk_ledger add column if not exists entry_bar double precision;
alter table desk_ledger add column if not exists entry_fair_yes double precision;
alter table desk_ledger add column if not exists entry_spread_cents double precision;
alter table desk_ledger add column if not exists entry_leftover_cents double precision;
alter table desk_ledger add column if not exists entry_touch_size double precision;
alter table desk_ledger add column if not exists entry_fee_cents double precision;
