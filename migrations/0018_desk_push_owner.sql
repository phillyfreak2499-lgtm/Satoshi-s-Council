-- Desk watchdog: the owner's browsers, flagged with the admin key, get a push
-- when the desk stops grading windows. Nobody else can carry the flag.
alter table desk_push_subs add column if not exists owner boolean not null default false;
