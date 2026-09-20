import { getSql } from "@/lib/db";

type CostRow = {
  feature: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_calls: number;
  price_missing_calls: number;
  usage_missing_calls: number;
  cost_usd_uncached_estimate: string | number | null;
  last_at: Date | string | null;
};

export type AiCostFeature = {
  feature: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_calls: number;
  price_missing_calls: number;
  usage_missing_calls: number;
  cost_usd_uncached_estimate: number;
  last_at: string | null;
};

export type AiCostSnapshot = {
  generated_at: string;
  month_utc: string;
  scope: "month_to_date";
  accounting: {
    quality: "uncached_estimate";
    exact_billing: false;
    complete: boolean;
    note: string;
  };
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_calls: number;
    price_missing_calls: number;
    usage_missing_calls: number;
    cost_usd_uncached_estimate: number;
  };
  by_feature: AiCostFeature[];
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const iso = (value: Date | string | null): string | null =>
  value == null ? null : new Date(value).toISOString();

/**
 * Owner-only observability snapshot. Reads the unified AI usage view and does
 * not touch any research writer, Chair path, learner, paper book or Lab gate.
 */
export async function aiCostSnapshot(now = new Date()): Promise<AiCostSnapshot> {
  const db = await getSql();
  const rows = await db<CostRow>`
    with bounds as (
      select
        (date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'UTC') at time zone 'UTC') as start_utc,
        ((date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'UTC') + interval '1 month') at time zone 'UTC') as end_utc
    )
    select
      u.feature,
      u.model,
      count(*)::int as calls,
      coalesce(sum(u.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(u.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(u.total_tokens), 0)::bigint as total_tokens,
      count(*) filter (where u.cost_quality = 'uncached_estimate')::int as estimated_calls,
      count(*) filter (where u.cost_quality = 'price_missing')::int as price_missing_calls,
      count(*) filter (where u.cost_quality = 'usage_missing')::int as usage_missing_calls,
      coalesce(sum(u.cost_usd_uncached_estimate), 0)::numeric as cost_usd_uncached_estimate,
      max(u.occurred_at) as last_at
    from ai_usage u, bounds b
    where u.occurred_at >= b.start_utc
      and u.occurred_at < b.end_utc
    group by u.feature, u.model
    order by u.feature, u.model
  `;

  const byFeature: AiCostFeature[] = rows.map((row) => ({
    feature: row.feature,
    model: row.model,
    calls: num(row.calls),
    input_tokens: num(row.input_tokens),
    output_tokens: num(row.output_tokens),
    total_tokens: num(row.total_tokens),
    estimated_calls: num(row.estimated_calls),
    price_missing_calls: num(row.price_missing_calls),
    usage_missing_calls: num(row.usage_missing_calls),
    cost_usd_uncached_estimate: num(row.cost_usd_uncached_estimate),
    last_at: iso(row.last_at),
  }));

  const totals = byFeature.reduce(
    (sum, row) => ({
      calls: sum.calls + row.calls,
      input_tokens: sum.input_tokens + row.input_tokens,
      output_tokens: sum.output_tokens + row.output_tokens,
      total_tokens: sum.total_tokens + row.total_tokens,
      estimated_calls: sum.estimated_calls + row.estimated_calls,
      price_missing_calls: sum.price_missing_calls + row.price_missing_calls,
      usage_missing_calls: sum.usage_missing_calls + row.usage_missing_calls,
      cost_usd_uncached_estimate:
        sum.cost_usd_uncached_estimate + row.cost_usd_uncached_estimate,
    }),
    {
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_calls: 0,
      price_missing_calls: 0,
      usage_missing_calls: 0,
      cost_usd_uncached_estimate: 0,
    },
  );

  const complete =
    totals.price_missing_calls === 0 &&
    totals.usage_missing_calls === 0 &&
    totals.estimated_calls === totals.calls;

  return {
    generated_at: now.toISOString(),
    month_utc: now.toISOString().slice(0, 7),
    scope: "month_to_date",
    accounting: {
      quality: "uncached_estimate",
      exact_billing: false,
      complete,
      note:
        "Historic Council rows do not retain cache-read/cache-write token details. " +
        "This prices recorded input tokens at the ordinary uncached rate plus recorded output tokens; " +
        "it is an operational estimate, not the OpenAI invoice.",
    },
    totals,
    by_feature: byFeature,
  };
}
