-- Replay identity: a replay row is one WINDOW, not one ticker.
--
-- desk_replay was created in 0014 with `ticker text primary key`, while the ledger's
-- identity has been `unique (ticker, close_time)` since 0005. A ticker is not a
-- window: on 2026-09-10 nine consecutive closes carried one ticker because the feed
-- stopped advancing it. Under a ticker-only key a second close sharing a ticker
-- cannot be stored at all -- the writer's `on conflict (ticker) do nothing` discards
-- it with no error, no counter and no log line.
--
-- WHAT THIS CHANGES. The primary key, and nothing else. No column is added, dropped,
-- renamed or retyped. No value is written, cleared or recomputed. No row is deleted.
-- `desk_replay_close_idx` on (close_time desc) is untouched.
--
-- WHY EVERY EXISTING ROW SURVIVES WITHOUT INFERENCE. Read-only against production
-- immediately before this file was written, at 2026-09-11T22:05:25Z:
--
--   413  rows
--   413  distinct tickers
--   413  distinct (ticker, close_time) pairs  -> no two rows would collide on the new key
--     0  rows with a null close_time          -> every row can carry it in a key
--     0  rows whose (ticker, close_time) fails to match exactly one ledger window
--     0  tickers mapping to more than one ledger row
--
-- The new key is already satisfied by the data AS RECORDED. Nothing is backfilled,
-- nothing is inferred from a neighbouring row or from another table, and no row needs
-- a close_time invented for it: the column has been NOT NULL since 0014, which is
-- also what makes it eligible for a primary key without altering the column.
--
-- THE TICKER-ONLY LOOKUP IS NOT DEGRADED. The composite key's index leads with
-- `ticker`, so the public replay page's `where ticker = $1` is still index-served. No
-- replacement index is needed and none is added.
--
-- IDEMPOTENT BY INSPECTION, not by `if not exists`: a primary key cannot be added
-- conditionally, so the current state is checked first. A second application is a
-- no-op, and a key that is already correct is never dropped and rebuilt.
do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'desk_replay'
       and c.contype = 'p'
       and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (ticker, close_time)'
  ) then
    alter table desk_replay drop constraint if exists desk_replay_pkey;
    alter table desk_replay add constraint desk_replay_pkey primary key (ticker, close_time);
  end if;
end $$;
