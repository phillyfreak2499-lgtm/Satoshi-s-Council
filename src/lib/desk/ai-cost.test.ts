import assert from "node:assert/strict";
import { test } from "node:test";
import { aiTokenCost, type AiTokenPrice } from "./ai-cost.ts";

const terra: AiTokenPrice = {
  input_per_million: 2,
  cached_input_per_million: 0.2,
  cache_write_per_million: 2.5,
  output_per_million: 12,
};

test("historic usage without cache details is labeled an upper bound", () => {
  const out = aiTokenCost(
    { input_tokens: 1_000_000, output_tokens: 100_000, cached_input_tokens: null, cache_write_tokens: null },
    terra,
  );
  assert.ok(out);
  assert.equal(out.quality, "upper_bound");
  assert.equal(out.usd, 3.2);
  assert.equal(out.regular_input_tokens, 1_000_000);
});

test("retained Responses API cache details produce exact token cost", () => {
  const out = aiTokenCost(
    {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cached_input_tokens: 400_000,
      cache_write_tokens: 100_000,
    },
    terra,
  );
  assert.ok(out);
  assert.equal(out.quality, "exact");
  assert.equal(out.regular_input_tokens, 500_000);
  assert.ok(Math.abs(out.usd - 2.53) < 1e-12);
});

test("impossible or unsafe usage fails closed", () => {
  assert.equal(
    aiTokenCost(
      { input_tokens: 100, output_tokens: 10, cached_input_tokens: 80, cache_write_tokens: 30 },
      terra,
    ),
    null,
  );
  assert.equal(
    aiTokenCost(
      { input_tokens: -1, output_tokens: 10, cached_input_tokens: null, cache_write_tokens: null },
      terra,
    ),
    null,
  );
});
