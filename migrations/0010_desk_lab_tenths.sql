-- Kalshi's 15-minute books tick in tenths of a cent: the ask a shock saw is
-- no longer a whole number.
alter table desk_lag_events alter column ask_before type double precision;
