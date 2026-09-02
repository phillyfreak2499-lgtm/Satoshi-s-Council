create table if not exists board (
  id         serial primary key,
  who        text not null,
  body       text not null,
  lean       text not null default '',
  ticker     text not null default '',
  conf       integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists board_created_idx on board (created_at desc);
