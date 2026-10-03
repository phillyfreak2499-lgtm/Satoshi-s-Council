-- News context only: existing headlines remain Bitcoin; no desk tables touched.
alter table news_items add column if not exists feed text not null default 'btc';
alter table news_items drop constraint if exists news_items_source_check;
alter table news_items drop constraint if exists news_items_feed_source_check;
alter table news_items add constraint news_items_feed_source_check check (
  (feed = 'btc' and source in ('CoinDesk', 'The Block', 'Decrypt', 'Bitcoin Magazine', 'Reuters Markets/Crypto'))
  or (feed = 'ai' and source in ('TechCrunch AI', 'MIT Tech Review AI'))
);
create index if not exists news_items_feed_published_idx on news_items (feed, published_at desc, id desc);
