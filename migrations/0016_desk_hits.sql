-- First-party traffic counts: one row per Chicago day and event, no people.
create table if not exists desk_hits (
  day    date not null,
  event  text not null,
  n      integer not null default 0,
  primary key (day, event)
);
