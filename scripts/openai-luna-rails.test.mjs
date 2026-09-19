import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const pure = read("src/lib/desk/openai-luna.ts");
const server = read("src/lib/desk/openai-luna.server.ts");
const shadow = read("src/lib/desk/openai-shadow.ts");
const health = read("server/routes/healthz.get.ts");
const pub = read("src/lib/desk/lab-public.ts");
const room = read("src/components/desk/LabRoom.tsx");
const astra = read("src/lib/desk/astra-director.server.ts");

test("Luna is the bounded low-cost model-tier benchmark", () => {
  assert.match(pure, /OPENAI_LUNA_DEFAULT_MODEL = "gpt-5\.6-luna"/);
  assert.match(pure, /OPENAI_LUNA_MAX_CAPTURES = 500/);
  assert.match(server, /capturedCount\(\) >= OPENAI_LUNA_MAX_CAPTURES/);
  assert.match(server, /process\.env\.OPENAI_LUNA_MODEL/);
});

test("Luna reuses the exact Terra market-aware packet and schema", () => {
  assert.match(pure, /buildOpenAIShadowPacket as buildOpenAILunaPacket/);
  assert.match(pure, /OPENAI_SHADOW_SCHEMA as OPENAI_LUNA_SCHEMA/);
  assert.match(server, /buildOpenAILunaPacket\(snap, votes\)/);
  assert.match(server, /structuredClone\(\{ snap: frame\.snap, chair: frame\.chair, votes: frame\.votes \}\)/);
  assert.match(shadow, /buildOpenAIShadowPacket\(snap: Snapshot, votes: Vote\[\]\)/);
});

test("Luna uses structured Responses API with no browsing or tools", () => {
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(server, /store:\s*false/);
  assert.match(server, /type:\s*"json_schema"/);
  assert.match(server, /OPENAI_LUNA_SCHEMA/);
  assert.doesNotMatch(server, /web_search/);
  assert.doesNotMatch(server, /tools:\s*\[/);
});

test("Luna writes only its isolated ledger and has no actuator", () => {
  const writes = [...server.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(writes, ["desk_openai_luna"]);
  for (const forbidden of [
    "promoteToLive(", "applyDeskOp(", "setKnob(", "reviewSeats(",
    "decideChair(", "runChair(", "noteCall(", "selectiveBlock(",
  ]) assert.ok(!server.includes(forbidden), `Luna observer reaches ${forbidden}`);
});

test("Luna comparison joins the Terra study after forecasts are stored", () => {
  assert.match(server, /left join desk_openai_shadow a/);
  assert.match(server, /a\.p_up as terra_p/);
  assert.match(server, /a\.side as terra_side/);
  assert.match(server, /terra_brier/);
  assert.match(server, /agreement_with_terra/);
  assert.match(server, /luna_hits/);
  assert.match(server, /terra_hits/);
});

test("Luna boots beside research observers and is public aggregate-only", () => {
  assert.match(health, /openai-luna\.server/);
  assert.match(health, /ensureOpenAILunaObserver/);
  assert.match(pub, /openAILunaSnapshot\(\)\.catch\(\(\) => null\)/);
  assert.match(pub, /openai_luna: OpenAILunaSnapshot \| null/);
  assert.match(room, /OpenAI Luna benchmark/);
  assert.match(room, /same packet as Terra/i);
});

test("Astra receives Luna evidence but production decision modules do not", () => {
  assert.match(astra, /openAILunaSnapshot/);
  assert.match(astra, /openai_luna_low_cost: luna/);
  assert.match(astra, /higher cost is buying enough measurable value/i);
  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/learner.ts",
  ]) {
    assert.ok(!read(path).includes("openai-luna"), `${path} imports openai-luna`);
  }
});
