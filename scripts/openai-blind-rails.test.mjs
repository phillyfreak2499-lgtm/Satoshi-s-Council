import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const pure = read("src/lib/desk/openai-blind.ts");
const server = read("src/lib/desk/openai-blind.server.ts");
const migration = read("migrations/0045_desk_openai_blind.sql");

test("blind packet structurally excludes market, Council and Chair inputs", () => {
  const start = pure.indexOf("export function buildOpenAIBlindPacket");
  const body = pure.slice(start);
  for (const forbidden of [
    "yes_bid", "yes_ask", "no_bid", "no_ask", "yes_mid", "fair_yes",
    "edge_up", "edge_down", "kalshi_taker_yes", "quote_age_s", "chalk",
    "votes", "chair", "council",
  ]) {
    assert.ok(!body.includes(forbidden), `blind packet leaks ${forbidden}`);
  }
  assert.match(body, /bitcoin:/);
  assert.match(body, /derivatives:/);
  assert.match(body, /spot_health:/);
});

test("blind and market-aware studies use the same Terra model tier for a clean input ablation", () => {
  assert.match(pure, /OPENAI_BLIND_DEFAULT_MODEL = "gpt-5\.6-terra"/);
  assert.match(pure, /OPENAI_BLIND_MAX_CAPTURES = 500/);
  assert.match(server, /capturedCount\(\) >= OPENAI_BLIND_MAX_CAPTURES/);
  assert.match(read("src/lib/desk/openai-shadow.ts"), /OPENAI_SHADOW_DEFAULT_MODEL = "gpt-5\.6-terra"/);
});

test("blind forecast freezes before market and Chair comparators are recorded", () => {
  const forecast = server.indexOf("const forecast = await requestForecast");
  const chair = server.indexOf("const chairLean", forecast);
  const market = server.indexOf("const marketP", forecast);
  assert.ok(forecast > 0 && chair > forecast && market > forecast);
  assert.match(server, /Only snap enters the blind builder/);
});

test("blind observer writes only its isolated ledger and has no actuator", () => {
  const writes = [...server.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(writes, ["desk_openai_blind"]);
  for (const forbidden of [
    "promoteToLive(", "applyDeskOp(", "setKnob(", "reviewSeats(",
    "decideChair(", "runChair(", "noteCall(", "selectiveBlock(",
  ]) assert.ok(!server.includes(forbidden), `blind observer reaches ${forbidden}`);
});

test("blind observer uses structured Responses API with no web or tools", () => {
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(server, /store:\s*false/);
  assert.match(server, /type:\s*"json_schema"/);
  assert.doesNotMatch(server, /web_search/);
  assert.doesNotMatch(server, /tools:\s*\[/);
});

test("database rejects market/Council/Chair objects inside blind packet", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(migration);
    const base = `
      insert into desk_openai_blind
        (ticker, close_time, taken_at, secs_left, study, version, prompt_version,
         model, input_hash, input_packet, p_up, side, conviction, regime,
         strongest_evidence, contradictions, data_quality, would_abstain,
         chair_lean, latency_ms)
      values
        ('KXBTC15M-BLIND', '2026-09-19T15:00:00Z', '2026-09-19T14:52:35Z', 445,
         'OPENAI_BLIND_V1', 1, 'blind-marketless-v1', 'gpt-5.6-terra', 'abc',
         $1::jsonb, 0.61, 'UP', 70, 'trend', '[]', '[]', 'GOOD', false, 'WAIT', 100)
    `;
    await pg.query(base, [JSON.stringify({ bitcoin: {}, derivatives: {}, context: {} })]);
    for (const leaked of [{ market: {} }, { council: [] }, { chair: {} }]) {
      await assert.rejects(
        pg.query(
          base.replace("KXBTC15M-BLIND", `KXBTC15M-BLIND-${Object.keys(leaked)[0]}`),
          [JSON.stringify({ bitcoin: {}, ...leaked })],
        ),
      );
    }
  } finally {
    await pg.close();
  }
});

test("production decision modules do not import the blind observer", () => {
  for (const path of [
    "src/lib/desk/server-engine.ts", "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts", "src/lib/desk/book-floor.ts", "src/lib/desk/learner.ts",
  ]) {
    assert.ok(!read(path).includes("openai-blind"), `${path} imports openai-blind`);
  }
});

test("blind observer boots beside the engine and is public aggregate-only in Lab", () => {
  const health = read("server/routes/healthz.get.ts");
  const pub = read("src/lib/desk/lab-public.ts");
  const room = read("src/components/desk/LabRoom.tsx");
  assert.match(health, /openai-blind\.server/);
  assert.match(health, /ensureOpenAIBlindObserver/);
  assert.match(pub, /openAIBlindSnapshot\(\)\.catch\(\(\) => null\)/);
  assert.match(pub, /openai_blind: OpenAIBlindSnapshot \| null/);
  assert.match(room, /OpenAI blind analyst/);
  assert.match(room, /Structurally hidden: Kalshi prices/);
});
