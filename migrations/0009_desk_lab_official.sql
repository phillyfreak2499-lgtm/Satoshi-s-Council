-- Settlement receipts against Kalshi's own numbers: the streamed
-- accumulating final-minute average and the official expiration value
-- (the settled 60s BRTI average, 2 decimals). Fees to the centicent.
alter table desk_ledger add column if not exists settle_feed    double precision;
alter table desk_ledger add column if not exists settle_feed_n  integer;
alter table desk_ledger add column if not exists official_value double precision;
alter table desk_lag_events alter column fee type double precision;
