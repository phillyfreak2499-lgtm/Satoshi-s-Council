import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const pure = read("src/lib/desk/openai-shadow.ts");
const observer = read("src/lib/desk/openai-shadow.server.ts");
const migration = read("migrations/0044_desk_openai_shadow.sql");
const health = read("server/routes/healthz.get.ts");
const labPublic = read("src/lib/desk/lab-public.ts");

test("OpenAI shadow is paper-only and has no execution surface", () => {
  assert.match(observer, /paper-only research analyst/i);
  assert.match(observer, /no execution authority/i);
  for (const forbidden of [
    "placeOrder",
    "submitOrder",
    "wallet",
    "transferFunds",
    "executeTrade",
    "KalshiClient",
  ]) {
    assert.ok(!observer.includes(forbidden), `observer reaches ${forbidden}`);
  }
});

test("OpenAI shadow uses Responses structured output without web or tools", () => {
  assert.match(observer, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(observer, /store:\s*false/);
  assert.match(observer, /type:\s*"json_schema"/);
  assert.match(observer, /strict:\s*true/);
  assert.match(observer, /OPENAI_SHADOW_SCHEMA/);
  assert.doesNotMatch(observer, /web_search/);
  assert.doesNotMatch(observer, /tools:\s*\[/);
});

test("packet builder cannot receive Chair state and contains no outcome", () => {
  assert.match(pure, /buildOpenAIShadowPacket\(snap: Snapshot, votes: Vote\[\]\)/);
  const start = pure.indexOf("export function buildOpenAIShadowPacket");
  const end = pure.indexOf("export function parseOpenAIShadowDecision", start);
  const body = pure.slice(start, end);
  assert.doesNotMatch(body, /ChairResult|chair\./);
  assert.doesNotMatch(body, /winner|settle/);
});

test("observer writes only its isolated OpenAI ledger", () => {
  assert.match(observer, /insert into desk_openai_shadow/i);
  const writes = [...observer.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(writes, ["desk_openai_shadow"]);

  for (const forbidden of [
    "noteCall",
    "applyDeskOp",
    "bookState",
    "selectiveBlock",
    "decideChair",
    "runChair",
    "promoteToLive",
    "setKnob",
    "reviewSeats",
  ]) {
    assert.ok(!observer.includes(forbidden), `OpenAI observer reaches ${forbidden}`);
  }
});

test("OpenAI shadow boots beside the brain and brain does not import it", () => {
  assert.match(health, /openai-shadow\.server/);
  assert.match(health, /ensureOpenAIShadowObserver/);
  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
  ]) {
    assert.ok(!read(path).includes("openai-shadow"), `${path} imports openai-shadow`);
  }
});

test("API key is server-only and never stored in the research row", () => {
  assert.match(observer, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(migration, /api_key|authorization|bearer/i);
  const sqlStart = observer.indexOf("insert into desk_openai_shadow");
  const sql = observer.slice(sqlStart);
  assert.doesNotMatch(sql, /apiKey|OPENAI_API_KEY/);
});

test("migration enforces one prospective UP/DOWN row per window", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(migration);
    await pg.query(`
      insert into desk_openai_shadow
        (ticker, close_time, taken_at, secs_left, study, version, prompt_version,
         model, input_hash, input_packet, p_up, side, conviction, regime,
         strongest_evidence, contradictions, data_quality, would_abstain,
         chair_lean, latency_ms)
      values
        ('KXBTC15M-TEST', '2026-09-19T12:00:00Z', '2026-09-19T11:52:35Z', 445,
         'OPENAI_SHADOW_V1', 1, 'market-aware-v1', 'gpt-5.6-terra', 'abc', '{}',
         0.61, 'UP', 70, 'trend', '[]', '[]', 'GOOD', false, 'WAIT', 100)
    `);
    await assert.rejects(
      pg.query(`
        insert into desk_openai_shadow
          (ticker, close_time, taken_at, secs_left, study, version, prompt_version,
           model, input_hash, input_packet, p_up, side, conviction, regime,
           strongest_evidence, contradictions, data_quality, would_abstain,
           chair_lean, latency_ms)
        values
          ('KXBTC15M-WAIT', '2026-09-19T12:15:00Z', '2026-09-19T12:07:35Z', 445,
           'OPENAI_SHADOW_V1', 1, 'market-aware-v1', 'gpt-5.6-terra', 'abc', '{}',
           0.50, 'WAIT', 10, 'unclear', '[]', '[]', 'POOR', true, 'WAIT', 100)
      `),
    );
    await assert.rejects(
      pg.query(`
        insert into desk_openai_shadow
          (ticker, close_time, taken_at, secs_left, study, version, prompt_version,
           model, input_hash, input_packet, p_up, side, conviction, regime,
           strongest_evidence, contradictions, data_quality, would_abstain,
           chair_lean, latency_ms)
        values
          ('KXBTC15M-LATE', '2026-09-19T12:30:00Z', '2026-09-19T12:22:45Z', 435,
           'OPENAI_SHADOW_V1', 1, 'market-aware-v1', 'gpt-5.6-terra', 'abc', '{}',
           0.50, 'UP', 10, 'unclear', '[]', '[]', 'POOR', true, 'WAIT', 100)
      `),
    );
  } finally {
    await pg.close();
  }
});

test("OpenAI shadow remains aggregate-only on the public Lab surface", () => {
  assert.match(labPublic, /openAIShadowSnapshot\(\)\.catch\(\(\) => null\)/);
  assert.match(labPublic, /openai_shadow: OpenAIShadowSnapshot \| null/);
  assert.doesNotMatch(labPublic, /method:\s*"POST"/);
  assert.match(migration, /no Chair, paper-book, learner, promotion, sizing, wallet, order/i);
});
