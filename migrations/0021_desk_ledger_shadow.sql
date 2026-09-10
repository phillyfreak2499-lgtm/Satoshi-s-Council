-- The shadow book for the 80¢ floor trial.
--
-- The live book fills only at FLOOR_LIVE_CENTS. A window the live floor
-- declines records no entry at all, so "what would 70¢ have done on the same
-- windows" cannot be reconstructed after the fact — the ask that was refused is
-- nowhere in the row. These two columns carry it: the first ask during the
-- window at which the OLD floor would have filled, and what that fill made
-- after the fee once the window settled.
--
-- Research only. Nothing reads these to decide a fill, and they are never part
-- of the headline net. Existing rows stay NULL, which is the honest value: the
-- desk was not running a shadow book before the trial.
alter table desk_ledger add column if not exists shadow_entry_cents double precision;
alter table desk_ledger add column if not exists shadow_ev_cents double precision;
