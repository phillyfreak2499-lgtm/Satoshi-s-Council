-- Versioned OpenAI standard-processing price book.
-- Observability only: nothing in the Floor, Chair, seats, learner, Lab promotion,
-- paper book, or execution path reads this table.
--
-- Prices are USD per 1M text tokens. `context_min_input_tokens` makes the
-- >272K long-context tier explicit instead of hiding pricing rules in code.
create table if not exists ai_model_price (
  provider text not null default 'openai',
  model text not null,
  service_tier text not null default 'standard',
  context_min_input_tokens integer not null default 0
    check (context_min_input_tokens >= 0),
  effective_from timestamptz not null,
  input_per_million numeric(14,6) not null check (input_per_million >= 0),
  cached_input_per_million numeric(14,6) not null check (cached_input_per_million >= 0),
  cache_write_per_million numeric(14,6) not null check (cache_write_per_million >= 0),
  output_per_million numeric(14,6) not null check (output_per_million >= 0),
  source_url text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (provider, model, service_tier, context_min_input_tokens, effective_from)
);

create index if not exists ai_model_price_lookup_idx
  on ai_model_price (provider, model, service_tier, effective_from desc, context_min_input_tokens desc);

-- Luna/Terra standard pricing was reduced effective 2026-07-30.
-- Source checked 2026-09-20:
-- https://developers.openai.com/api/docs/pricing
insert into ai_model_price (
  provider, model, service_tier, context_min_input_tokens, effective_from,
  input_per_million, cached_input_per_million, cache_write_per_million,
  output_per_million, source_url, note
) values
  ('openai','gpt-5.6-luna','standard',0,'2026-07-30T00:00:00Z',
   0.20,0.02,0.25,1.20,'https://developers.openai.com/api/docs/pricing',
   'standard short-context pricing; current observer requests do not set another service tier'),
  ('openai','gpt-5.6-luna','standard',272001,'2026-07-30T00:00:00Z',
   0.40,0.04,0.50,1.80,'https://developers.openai.com/api/docs/pricing',
   'standard long-context pricing for prompts above 272K input tokens'),
  ('openai','gpt-5.6-terra','standard',0,'2026-07-30T00:00:00Z',
   2.00,0.20,2.50,12.00,'https://developers.openai.com/api/docs/pricing',
   'standard short-context pricing; current observer requests do not set another service tier'),
  ('openai','gpt-5.6-terra','standard',272001,'2026-07-30T00:00:00Z',
   4.00,0.40,5.00,18.00,'https://developers.openai.com/api/docs/pricing',
   'standard long-context pricing for prompts above 272K input tokens')
on conflict do nothing;

-- GPT-6 Astra API availability/pricing was announced 2026-09-04.
insert into ai_model_price (
  provider, model, service_tier, context_min_input_tokens, effective_from,
  input_per_million, cached_input_per_million, cache_write_per_million,
  output_per_million, source_url, note
) values
  ('openai','gpt-6-astra','standard',0,'2026-09-04T00:00:00Z',
   10.00,1.00,12.50,50.00,'https://developers.openai.com/api/docs/pricing',
   'standard short-context pricing'),
  ('openai','gpt-6-astra','standard',272001,'2026-09-04T00:00:00Z',
   20.00,2.00,25.00,75.00,'https://developers.openai.com/api/docs/pricing',
   'standard long-context pricing for prompts above 272K input tokens')
on conflict do nothing;
