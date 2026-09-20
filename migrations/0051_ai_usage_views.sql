-- Unified read-only AI usage/cost surface.
--
-- The four source ledgers remain the source of truth. This view duplicates
-- nothing and writes nothing into the paper-research path.
--
-- Historic source rows do not retain Responses API cache-read/cache-write token
-- details. Their dollar number is therefore an *uncached estimate* (all input
-- priced at the normal input rate), not exact billing and not a guaranteed bound.
create or replace view ai_usage as
with usage_rows as (
  select
    'openai_shadow'::text as feature,
    'desk_openai_shadow'::text as source_table,
    (ticker || '@' || close_time::text)::text as source_ref,
    created_at as occurred_at,
    model,
    input_tokens,
    output_tokens,
    total_tokens,
    response_id,
    build_sha
  from desk_openai_shadow

  union all

  select
    'openai_blind'::text,
    'desk_openai_blind'::text,
    (ticker || '@' || close_time::text)::text,
    created_at,
    model,
    input_tokens,
    output_tokens,
    total_tokens,
    response_id,
    build_sha
  from desk_openai_blind

  union all

  select
    'openai_luna'::text,
    'desk_openai_luna'::text,
    (ticker || '@' || close_time::text)::text,
    created_at,
    model,
    input_tokens,
    output_tokens,
    total_tokens,
    response_id,
    build_sha
  from desk_openai_luna

  union all

  select
    'astra_director'::text,
    'desk_astra_director'::text,
    id::text,
    created_at,
    model,
    input_tokens,
    output_tokens,
    total_tokens,
    response_id,
    build_sha
  from desk_astra_director
)
select
  u.feature,
  u.source_table,
  u.source_ref,
  u.occurred_at,
  u.model,
  u.input_tokens,
  u.output_tokens,
  u.total_tokens,
  u.response_id,
  u.build_sha,
  'standard'::text as service_tier,
  p.context_min_input_tokens as pricing_context_min_input_tokens,
  p.effective_from as pricing_effective_from,
  p.source_url as pricing_source_url,
  case
    when u.input_tokens is null or u.output_tokens is null then 'usage_missing'
    when p.model is null then 'price_missing'
    else 'uncached_estimate'
  end::text as cost_quality,
  case
    when u.input_tokens is null or u.output_tokens is null or p.model is null then null
    else round(
      (
        u.input_tokens::numeric * p.input_per_million
        + u.output_tokens::numeric * p.output_per_million
      ) / 1000000::numeric,
      9
    )
  end as cost_usd_uncached_estimate
from usage_rows u
left join lateral (
  select price.*
  from ai_model_price price
  where price.provider = 'openai'
    and price.model = u.model
    and price.service_tier = 'standard'
    and price.effective_from <= u.occurred_at
    and price.context_min_input_tokens <= coalesce(u.input_tokens, 0)
  order by price.effective_from desc, price.context_min_input_tokens desc
  limit 1
) p on true;

create or replace view ai_usage_monthly as
select
  date_trunc('month', occurred_at) as month,
  feature,
  model,
  count(*)::bigint as calls,
  sum(coalesce(input_tokens, 0))::bigint as input_tokens,
  sum(coalesce(output_tokens, 0))::bigint as output_tokens,
  sum(coalesce(total_tokens, 0))::bigint as total_tokens,
  count(*) filter (where cost_quality = 'uncached_estimate')::bigint as estimated_calls,
  count(*) filter (where cost_quality = 'price_missing')::bigint as price_missing_calls,
  count(*) filter (where cost_quality = 'usage_missing')::bigint as usage_missing_calls,
  sum(cost_usd_uncached_estimate) as cost_usd_uncached_estimate
from ai_usage
group by date_trunc('month', occurred_at), feature, model;
