-- Receipts for the settlement basis: where our spot feed sat against the
-- strike on the last frame before the roll, how volatile the window was,
-- and how far from the close that frame was. Lets the desk measure how
-- often a small lead on our feed loses on the official index instead of
-- guessing a basis constant.
alter table desk_ledger add column if not exists close_dist double precision;
alter table desk_ledger add column if not exists close_atr  double precision;
alter table desk_ledger add column if not exists close_secs double precision;
