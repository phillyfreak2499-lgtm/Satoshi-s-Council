import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("higher-timeframe research stays a pure measurement leaf", () => {
  const pure = read("src/lib/desk/higher-timeframe-context.ts");
  const code = pure
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
  assert.doesNotMatch(code, /^import\s/m, "the calculator must remain import-free");
  assert.doesNotMatch(code, /Chair|Vote|Learner|SeatId|fetch\(|getSql|process\.env/);

  for (const rel of [
    "bots.ts",
    "chair.ts",
    "chair-v2.ts",
    "dsl.ts",
    "features.ts",
    "learner.ts",
    "skills.ts",
    "thresholds.ts",
    "book-floor.ts",
  ]) {
    assert.ok(
      !read(`src/lib/desk/${rel}`).includes("higher-timeframe-context"),
      `${rel} must not import measurement-only higher-timeframe context`,
    );
  }
});

test("the existing hourly request has enough bars for prospective 24h context", () => {
  const feeds = read("src/lib/desk/server-feeds.ts");
  const match = feeds.match(/binanceKlines\("1h",\s*(\d+)\)/);
  assert.ok(match, "the existing 1h feed request must remain present");
  assert.ok(Number(match[1]) >= 25, "24h context requires at least 25 hourly opens");
});

test("higher-timeframe storage is nullable, prospective, and has no backfill", () => {
  const sql = read("migrations/0038_desk_higher_timeframe_context.sql");
  const code = sql.replace(/--.*$/gm, " ");
  assert.match(code, /alter table desk_decision_snapshots/i);
  assert.match(code, /add column if not exists higher_context jsonb/i);
  assert.doesNotMatch(code, /\bupdate\b|\binsert\b|\bselect\b|\bdelete\b/i);
  assert.doesNotMatch(code, /not\s+null|default/i, "old decision rows must remain unknown/NULL");
});

test("the registry keeps 4h and 24h context non-voting", () => {
  const registry = read("src/lib/desk/feature-registry.ts");
  for (const id of ["lab.context_4h", "lab.context_24h"]) {
    const at = registry.indexOf(`id: "${id}"`);
    assert.ok(at >= 0, `${id} must be registered`);
    const row = registry.slice(at, registry.indexOf("}),", at) + 3);
    assert.match(row, /authority:\s*"measurement"/);
    assert.match(row, /chair_visible:\s*false/);
  }
});
