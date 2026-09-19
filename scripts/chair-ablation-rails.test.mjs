import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

const pure = read("src/lib/desk/chair-ablation.ts");
const server = codeOf("src/lib/desk/chair-ablation.server.ts");
const migration = read("migrations/0049_desk_chair_ablation.sql");
const health = read("server/routes/healthz.get.ts");
const astra = read("src/lib/desk/astra-director.server.ts");

test("Chair ablation has the requested isolated variants", () => {
  for (const id of [
    "control_core",
    "tape_off",
    "carry_off_when_chain",
    "authority_release",
    "raw_release",
  ]) assert.ok(pure.includes(id) || server.includes(id), `missing variant ${id}`);
  assert.match(pure, /vote\.seat !== "TAPE"/);
  assert.match(pure, /chainSpeaks/);
  assert.match(pure, /ABLATION_RELEASE::/);
});

test("Chair ablation is research-only and cannot actuate the Floor", () => {
  assert.match(server, /authority: "none"/);
  assert.match(server, /desk_chair_ablation/);
  for (const forbidden of [
    "noteCall(",
    "applyDeskOp(",
    "selectiveBlock(",
    "promoteToLive(",
    "reviewSeats(",
    "setKnob(",
  ]) assert.ok(!server.includes(forbidden), `ablation reaches ${forbidden}`);

  const writes = [...server.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual([...new Set(writes)], ["desk_chair_ablation"]);
});

test("Chair ablation is prospective at the same frozen horizons as call-quality", () => {
  assert.match(server, /qualityHorizon/);
  assert.match(server, /qualityIssues/);
  assert.match(server, /const HORIZONS = \[450, 300, 180\]/);
  assert.match(migration, /horizon in \(450, 300, 180\)/);
  assert.match(migration, /unique \(study, ticker, close_time, horizon\)/);
});

test("authority-release is cloned and synthetic, never a live learner rewrite", () => {
  assert.match(pure, /skills: \{ \.\.\.inputLearner\.skills \}/);
  assert.match(pure, /syntheticId/);
  assert.match(pure, /status: "LIVE"/);
  assert.match(pure, /manual_hold: false/);
  assert.doesNotMatch(pure, /inputLearner\.skills\[[^\]]+\]\s*=/);
});

test("observer boots beside the engine and feeds Astra research", () => {
  assert.match(health, /chair-ablation\.server/);
  assert.match(health, /ensureChairAblationObserver/);
  assert.match(astra, /chairAblationSnapshot/);
  assert.match(astra, /chair_ablation/);
});

test("production decision modules do not import the Chair ablation", () => {
  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/learner.ts",
  ]) {
    assert.ok(!read(path).includes("chair-ablation"), `${path} imports Chair ablation`);
  }
});
