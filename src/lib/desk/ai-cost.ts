/** Pure AI token-cost math. No database, network, or research authority. */

export type AiTokenPrice = {
  input_per_million: number;
  cached_input_per_million: number;
  cache_write_per_million: number;
  output_per_million: number;
};

export type AiTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  /** Null means the historic row did not retain the Responses API breakdown. */
  cached_input_tokens: number | null;
  /** Null means the historic row did not retain the Responses API breakdown. */
  cache_write_tokens: number | null;
};

export type AiCost = {
  usd: number;
  quality: "exact" | "upper_bound";
  regular_input_tokens: number;
  cached_input_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number;
};

const validCount = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const dollars = (tokens: number, perMillion: number): number =>
  (tokens * perMillion) / 1_000_000;

/**
 * Calculate standard text-token cost from one API usage receipt.
 *
 * Historical Council rows retain total input/output tokens but not the
 * Responses API input-token breakdown. In that case the honest result is an
 * upper bound that prices every input token at the uncached input rate.
 *
 * When cached + cache-write counts are retained, input_tokens is treated as the
 * total and the detail counts as its breakdown; impossible breakdowns fail
 * closed rather than producing a negative regular-token count.
 */
export function aiTokenCost(usage: AiTokenUsage, price: AiTokenPrice): AiCost | null {
  if (!validCount(usage.input_tokens) || !validCount(usage.output_tokens)) return null;
  for (const rate of [
    price.input_per_million,
    price.cached_input_per_million,
    price.cache_write_per_million,
    price.output_per_million,
  ]) {
    if (!Number.isFinite(rate) || rate < 0) return null;
  }

  const cached = usage.cached_input_tokens;
  const writes = usage.cache_write_tokens;
  const detailsKnown = cached != null && writes != null;

  if (!detailsKnown) {
    const usd =
      dollars(usage.input_tokens, price.input_per_million) +
      dollars(usage.output_tokens, price.output_per_million);
    return {
      usd,
      quality: "upper_bound",
      regular_input_tokens: usage.input_tokens,
      cached_input_tokens: null,
      cache_write_tokens: null,
      output_tokens: usage.output_tokens,
    };
  }

  if (!validCount(cached) || !validCount(writes) || cached + writes > usage.input_tokens) return null;
  const regular = usage.input_tokens - cached - writes;
  const usd =
    dollars(regular, price.input_per_million) +
    dollars(cached, price.cached_input_per_million) +
    dollars(writes, price.cache_write_per_million) +
    dollars(usage.output_tokens, price.output_per_million);

  return {
    usd,
    quality: "exact",
    regular_input_tokens: regular,
    cached_input_tokens: cached,
    cache_write_tokens: writes,
    output_tokens: usage.output_tokens,
  };
}
