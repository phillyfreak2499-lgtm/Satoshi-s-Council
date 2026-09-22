-- 5. ask_path: both-side quote checkpoints and event sequences around intentions.
-- The replay path is desk_replay.cols (jsonb columns per tick). Parquet conversion is the caller's step.
select r.ticker, r.close_time, r.strike, r.winner, r.n, r.step_ms, r.partial, r.cols
from desk_replay r where r.close_time >= :from and r.close_time < :to order by r.close_time;
-- Decision-time snapshots (OPENING / FIRST_DIRECTIONAL) with both sides and sizes:
select ticker, close_time, snapshot_kind, decision_at, secs_left, quote_age_s, quote_seq, yes_bid, yes_ask, no_bid, no_ask, yes_bid_size, no_bid_size, spread_cents, fair_yes, lab_fair_yes, edge_up, edge_down, fee_yes, fee_no
from desk_decision_snapshots where decision_at >= :from and decision_at < :to order by decision_at;
-- Favourite-side swaps inside the window:
select * from desk_ask_lead_swaps where taken_at >= :from and taken_at < :to order by taken_at;
