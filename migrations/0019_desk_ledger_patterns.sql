-- LEDGER's pattern cards: cross-seat vote patterns mined from the ledger's
-- per-window vote matrix. A coalition (a group of seats that, when they agree,
-- the window resolves their way at a rate and sample that beats each seat
-- alone) or a pair (two seats that reinforce or cancel). Discovered on a
-- training range of windows and promoted to "cited" only when the edge also
-- holds on the windows AFTER that range (walk-forward, never in-sample). A
-- pattern that reliably resolves against its members is inverted, not deleted.
-- Read-only on the floor; LEDGER never votes and never appears as a seat.
create table if not exists desk_ledger_patterns (
  slug          text primary key,             -- kind:sorted-members:agree-side, stable across runs
  kind          text not null,                -- 'pair' | 'coalition'
  members       text[] not null,              -- seat ids, sorted
  agree_side    text not null,                -- 'UP' | 'DOWN' — the side members lean when the pattern fires
  cited_side    text not null,                -- what it points to: agree_side (cited) or the opposite (inverted)
  status        text not null,                -- 'candidate' | 'cited' | 'inverted' | 'stale'
  train_n       integer not null default 0,
  train_hits    integer not null default 0,
  train_wilson  double precision not null default 0,
  test_n        integer not null default 0,
  test_hits     integer not null default 0,
  test_wilson   double precision not null default 0,
  member_solo   double precision not null default 0,  -- best member's solo Wilson on train — the bar the pattern beat
  net_cents     double precision not null default 0,  -- chair's after-fee cents on fired windows it booked the cited side
  booked_n      integer not null default 0,
  split_at      timestamptz,                  -- the train/test boundary (first out-of-sample window)
  found_from    timestamptz,                  -- earliest training window
  found_to      timestamptz,                  -- latest training window
  test_to       timestamptz,                  -- latest out-of-sample window
  updated_at    timestamptz not null default now(),
  note          text
);
create index if not exists desk_ledger_patterns_status_idx on desk_ledger_patterns (status, cited_side);
create index if not exists desk_ledger_patterns_updated_idx on desk_ledger_patterns (updated_at desc);
