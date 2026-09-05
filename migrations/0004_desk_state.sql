-- Shared-brain persistence: one row per desk (id 'live'), JSON state blob.
create table if not exists desk_state (
  id         text primary key,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Board updates lane: slug makes checked-in changelog posts idempotent.
-- Unique index on a nullable column: normal posts (slug null) are unlimited.
alter table board add column if not exists slug text;
create unique index if not exists board_slug_idx on board (slug);
