-- Isolated prospective paper research. No production rows are updated.
create table if not exists desk_voice_meta (
  experiment text primary key, fingerprint text not null, build_sha text not null,
  start_ms bigint not null, end_ms bigint not null, revision bigint not null default 0,
  state jsonb not null, status text not null default 'SHADOW', reason text,
  bytes_used bigint not null default 0
);
create table if not exists desk_voice_windows (
  experiment text not null references desk_voice_meta(experiment), close_ms bigint not null,
  ticker text, first_ms bigint, last_ms bigint, checkpoint jsonb, invalid text, replay_base text,
  result jsonb, changed boolean not null default false, primary key(experiment,close_ms)
);
create table if not exists desk_voice_frames (
  experiment text not null, close_ms bigint not null, as_of bigint not null,
  input_gzip text not null, output jsonb not null,
  primary key(experiment,close_ms,as_of),
  foreign key(experiment,close_ms) references desk_voice_windows(experiment,close_ms)
);
create index if not exists desk_voice_pending on desk_voice_windows(experiment,close_ms) where result is null;
