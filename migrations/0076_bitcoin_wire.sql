-- Isolated news context only. No desk tables or policy changes.
create table if not exists news_items (
  id bigint generated always as identity primary key,
  title text not null,
  source text not null check (source in ('CoinDesk', 'The Block', 'Decrypt', 'Bitcoin Magazine', 'Reuters Markets/Crypto')),
  url text not null unique,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now()
);
create index if not exists news_items_published_idx on news_items (published_at desc, id desc);
