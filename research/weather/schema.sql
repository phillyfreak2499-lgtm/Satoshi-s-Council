-- Separate schema. Applied only by the standalone private runner, never Council migrations.
create schema if not exists weather_research;
create table if not exists weather_research.study (
 id text primary key, spec_hash text not null, spec jsonb not null, registered_at timestamptz not null default now(),
 first_collection timestamptz, first_target_date date, evaluation_start date, stopped_at timestamptz, stop_reason text
);
create table if not exists weather_research.jobs (
 study text references weather_research.study(id), city text, slot text, scheduled_date date,
 started_at timestamptz not null, finished_at timestamptz, state text not null,
 detail text, primary key(study,city,slot,scheduled_date)
);
create table if not exists weather_research.receipts (
 id bigserial primary key, study text references weather_research.study(id), city text,
 kind text not null, url text not null, received_at timestamptz not null, source_time timestamptz,
 body jsonb not null
);
create table if not exists weather_research.snapshots (
 study text references weather_research.study(id), city text, target_date date, slot text,
 captured_at timestamptz not null, source_time timestamptz, forecast_f double precision, observation_floor_f double precision,
 forecast_receipt bigint references weather_research.receipts(id), observation_receipt bigint references weather_research.receipts(id),
 market_receipt bigint references weather_research.receipts(id), training_days int not null, quality jsonb not null,
 primary key(study,city,target_date,slot)
);
create table if not exists weather_research.predictions (
 study text, city text, target_date date, slot text, ticker text,
 captured_at timestamptz not null, model_p double precision check(model_p between 0 and 1),
 floor_p double precision check(floor_p between 0 and 1), market_mid double precision check(market_mid between 0 and 1),
 market jsonb not null, primary key(study,city,target_date,slot,ticker),
 foreign key(study,city,target_date,slot) references weather_research.snapshots(study,city,target_date,slot)
);
create table if not exists weather_research.outcomes (
 study text references weather_research.study(id), city text, target_date date, ticker text,
 discovered_at timestamptz not null, result text check(result in ('yes','no')), official_high_f double precision,
 receipt bigint references weather_research.receipts(id), raw jsonb not null,
 primary key(study,city,target_date,ticker)
);
create table if not exists weather_research.scores (
 study text,city text,target_date date,slot text,ticker text,
 model_brier double precision, floor_brier double precision, market_brier double precision, scored_at timestamptz not null,
 primary key(study,city,target_date,slot,ticker),
 foreign key(study,city,target_date,slot,ticker) references weather_research.predictions(study,city,target_date,slot,ticker)
);
create index if not exists weather_predictions_lookup on weather_research.predictions(study,city,target_date);
create index if not exists weather_outcomes_time on weather_research.outcomes(study,city,discovered_at);
