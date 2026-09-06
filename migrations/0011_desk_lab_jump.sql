-- Separate a true stale quote (the index jumped within a second and the
-- book had no time to answer) from drift (the model disagreeing with a book
-- that has had time), and record how old the book's best quotes were.
alter table desk_lag_events add column if not exists jump_ms     integer;
alter table desk_lag_events add column if not exists book_age_ms integer;
