-- Chair v2 training/scoring set: one sample per window at the mid-window
-- decision point, graded at settle. features = seat evidences + market/fair
-- logits; market = the book at the time; v1_lean = the live chair's stance
-- at that same moment so the two chairs are compared on identical inputs.
create table if not exists desk_samples (
  id         serial primary key,
  ticker     text not null,
  close_time timestamptz not null,
  taken_at   timestamptz not null default now(),
  mins_left  double precision not null,
  features   jsonb not null,
  market     jsonb not null,
  v1_lean    text not null default 'WAIT',
  v2_p       double precision,
  v2_lean    text not null default 'WAIT',
  v2_entry   double precision,
  winner     text,
  v2_ev      double precision,
  graded_at  timestamptz
);
create unique index if not exists desk_samples_win_idx on desk_samples (ticker, close_time);
create index if not exists desk_samples_close_idx on desk_samples (close_time desc);
