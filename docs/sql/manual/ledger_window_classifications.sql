-- MANUAL ONLY. Not under migrations/ and never imported by application boot.
-- Executed only by the separately owner-approved classification command.
create table if not exists public.desk_window_classifications (
  close_ms bigint not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  classification text not null check (classification = 'NO_CONTRACT'),
  reason text not null check (reason = 'VENUE_PAUSE'),
  record jsonb not null,
  owner_approval_id text not null check (length(trim(owner_approval_id)) > 0),
  integrity_effect text not null check (integrity_effect in ('NONE', 'EXCLUDE_FROM_MISSING_CONTRACT_COUNT')),
  appended_at timestamptz not null default now(),
  primary key (close_ms, manifest_sha256, integrity_effect),
  check (record ?& array['contract_ticker','official_winner','official_value','final_grading_snapshot','final_grading_votes','source_hashes']),
  check (record->'contract_ticker' = 'null'::jsonb),
  check (record->'official_winner' = 'null'::jsonb),
  check (record->'official_value' = 'null'::jsonb),
  check (record->'final_grading_snapshot' = 'null'::jsonb),
  check (record->'final_grading_votes' = 'null'::jsonb),
  check (jsonb_array_length(record->'source_hashes') >= 2)
);

create or replace function public.reject_window_classification_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'window classifications are append-only';
end;
$$;

drop trigger if exists window_classifications_append_only on public.desk_window_classifications;
create trigger window_classifications_append_only before update or delete on public.desk_window_classifications
for each row execute function public.reject_window_classification_mutation();
