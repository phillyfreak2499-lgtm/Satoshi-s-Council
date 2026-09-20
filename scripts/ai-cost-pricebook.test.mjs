import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("migrations/0050_ai_model_price.sql");
const cost = read("src/lib/desk/ai-cost.ts");

test("price book is versioned by model, service tier, context band and effective date", () => {
  assert.match(migration, /create table if not exists ai_model_price/);
  assert.match(migration, /primary key \(provider, model, service_tier, context_min_input_tokens, effective_from\)/);
  assert.match(migration, /gpt-5\.6-luna/);
  assert.match(migration, /gpt-5\.6-terra/);
  assert.match(migration, /gpt-6-astra/);
  assert.match(migration, /272001/);
  assert.match(migration, /source_url text not null/);
});

test("price book is observability-only and cost math never imports desk authority", () => {
  for (const forbidden of ["chair", "learner", "book-floor", "server-engine", "policy-lab", "arena.server"]) {
    assert.equal(cost.includes(`from "./${forbidden}`), false, forbidden);
  }
  assert.match(cost, /quality: "exact" \| "upper_bound"/);
  assert.match(cost, /cached_input_tokens: number \| null/);
});
