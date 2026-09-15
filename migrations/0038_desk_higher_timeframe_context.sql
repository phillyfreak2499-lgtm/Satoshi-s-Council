-- Decision-time higher-timeframe context for the 15-minute Lab. Measurement only.
--
-- The JSON payload is calculated from the finalized Snapshot's existing hourly
-- candles and short returns, then frozen with OPENING/FIRST_DIRECTIONAL. It is
-- never read by a seat, the Chair, thresholds, learned weights, booking, or risk.
-- Existing rows remain NULL: reconstructing what an old decision knew would be a
-- backfill with hindsight, so this migration creates storage only.
alter table desk_decision_snapshots
  add column if not exists higher_context jsonb;
