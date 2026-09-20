import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../migrations/0051_ai_usage_views.sql", import.meta.url), "utf8");

test("unified AI usage is a read-only view over the four durable source ledgers", () => {
  assert.match(sql, /create or replace view ai_usage as/i);
  for (const table of [
    "desk_openai_shadow",
    "desk_openai_blind",
    "desk_openai_luna",
    "desk_astra_director",
  ]) assert.match(sql, new RegExp(`from ${table}\\b`));
  assert.doesNotMatch(sql, /insert into ai_usage|update ai_usage|delete from ai_usage/i);
});

test("historical dollars are explicitly estimates and missing prices fail visible", () => {
  assert.match(sql, /uncached_estimate/);
  assert.match(sql, /price_missing/);
  assert.match(sql, /usage_missing/);
  assert.match(sql, /cost_usd_uncached_estimate/);
  assert.match(sql, /left join lateral/i);
  assert.match(sql, /effective_from <= u\.occurred_at/);
  assert.match(sql, /context_min_input_tokens <= coalesce\(u\.input_tokens, 0\)/);
});

test("monthly rollup keeps feature and model visible", () => {
  assert.match(sql, /create or replace view ai_usage_monthly as/i);
  assert.match(sql, /group by date_trunc\('month', occurred_at\), feature, model/);
});
