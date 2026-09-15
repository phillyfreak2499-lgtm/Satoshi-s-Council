-- Off-site archive manifest: one row per planned (or later uploaded) partition.
--
-- PHASE 1. This file creates the bookkeeping table and nothing else. It does not
-- copy a row off-site, it does not delete a row, and it does not rewrite a value
-- in any research or operational table. The planner that reads candidate tables
-- is inspect-only; it does not INSERT into this table until a later phase.
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not touch desk_ledger, desk_state,
-- desk_samples, chair decisions, seats, settlement, grading, thresholds, APIs or
-- the UI. It does not attach a disk. It does not schedule a worker. Bad history
-- stays flagged (0024) rather than rewritten.
--
-- Identity of an archive object is (table, UTC day range, schema version,
-- source database). A ticker is not an identity. Window-shaped tables are planned
-- under (ticker, close_time) in the planner, never the ticker alone — the
-- 2026-09-10 reuse block is why.
--
-- PAPER ONLY. No order, no venue, no size.

create table if not exists desk_archive_manifest (
  archive_id          text primary key,
  table_name          text not null,
  partition_start     timestamptz not null,
  partition_end       timestamptz not null,
  object_key          text not null,
  schema_version      text not null,
  row_count           bigint not null default 0,
  byte_size           bigint,
  checksum            text,
  created_at          timestamptz not null default now(),
  uploaded_at         timestamptz,
  verified_at         timestamptz,
  status              text not null default 'planned',
  error_message       text,
  source_identity     text not null,
  constraint desk_archive_manifest_status_chk
    check (status in ('planned', 'created', 'uploaded', 'verified', 'failed', 'cancelled')),
  constraint desk_archive_manifest_range_chk
    check (partition_end > partition_start),
  constraint desk_archive_manifest_table_chk
    check (table_name in (
      'desk_path_parity',
      'desk_lag_events',
      'desk_absorption',
      'desk_basis_minutes',
      'desk_replay'
    )),
  constraint desk_archive_manifest_row_count_chk
    check (row_count >= 0),
  constraint desk_archive_manifest_byte_size_chk
    check (byte_size is null or byte_size >= 0)
);

-- Idempotent object identity: the same partition from the same database at the
-- same schema version cannot be planned twice under two keys.
create unique index if not exists desk_archive_manifest_object_key_idx
  on desk_archive_manifest (object_key);

create unique index if not exists desk_archive_manifest_partition_idx
  on desk_archive_manifest (source_identity, table_name, partition_start, partition_end, schema_version);

create index if not exists desk_archive_manifest_status_idx
  on desk_archive_manifest (status, created_at desc);

create index if not exists desk_archive_manifest_table_idx
  on desk_archive_manifest (table_name, partition_start);
