-- Durable, privacy-safe evidence for push attempts. This records only the
-- subscription row id and provider outcome; endpoints and encryption keys are
-- deliberately excluded. A provider acceptance is not claimed as proof that a
-- person saw the notification.
create table if not exists desk_push_delivery_receipts (
  id                bigserial primary key,
  event_kind        text not null,
  event_key         text not null,
  subscription_id   bigint not null,
  outcome           text not null,
  provider_status   integer,
  error_code        text,
  build_sha         text not null default '',
  attempted_at      timestamptz not null default now(),
  check (event_kind in ('call', 'settle', 'watchdog', 'test')),
  check (outcome in ('accepted', 'gone', 'failed')),
  check (length(event_key) between 1 and 300),
  check (error_code is null or length(error_code) <= 120)
);

create index if not exists desk_push_delivery_receipts_recent_idx
  on desk_push_delivery_receipts (attempted_at desc);

create index if not exists desk_push_delivery_receipts_event_idx
  on desk_push_delivery_receipts (event_kind, event_key, attempted_at desc);
