import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const pure = read("src/lib/desk/astra-director.ts");
const server = read("src/lib/desk/astra-director.server.ts");
const migration = read("migrations/0046_desk_astra_director.sql");
const jobsMigration = read("migrations/0048_desk_astra_director_jobs.sql");
const health = read("server/routes/healthz.get.ts");
const lab = read("src/lib/desk/lab-public.ts");
const room = read("src/components/desk/LabRoom.tsx");

test("Astra director runs in the requested 300-500 window band", () => {
  assert.match(pure, /ASTRA_DIRECTOR_WINDOW_BATCH = 384/);
  assert.match(pure, /ASTRA_DIRECTOR_MODEL = "gpt-6-astra"/);
  assert.match(migration, /window_batch between 300 and 500/);
  assert.match(server, /lastTotal \+ ASTRA_DIRECTOR_WINDOW_BATCH/);
});

test("Astra director is report-only with no production actuator", () => {
  assert.match(server, /Astra report\/job research ledgers/i);
  assert.match(server, /model_can_promote: false/);
  assert.match(server, /model_can_demote: false/);
  assert.match(server, /model_can_reweight: false/);
  assert.match(server, /model_can_trade: false/);
  for (const forbidden of [
    "promoteToLive(",
    "applyDeskOp(",
    "setKnob(",
    "reviewSeats(",
    "decideChair(",
    "runChair(",
    "noteCall(",
    "selectiveBlock(",
  ]) {
    assert.ok(!server.includes(forbidden), `Astra director reaches ${forbidden}`);
  }
  const writes = [...server.matchAll(/insert into\s+(\w+)|update\s+(\w+)\s+set|delete from\s+(\w+)/gi)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual([...new Set(writes)].sort(), ["desk_astra_director", "desk_astra_director_jobs"].sort());
  assert.doesNotMatch(migration, /update\s+desk_floor_policy|insert\s+into\s+desk_floor_policy/i);
});

test("Astra uses structured Responses API with no tools or browsing", () => {
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(server, /store:\s*false/);
  assert.match(server, /background:\s*true/);
  assert.match(server, /\/v1\/responses\/\$\{encodeURIComponent\(responseId\)\}/);
  assert.match(server, /desk_astra_director_jobs/);
  assert.match(jobsMigration, /response_id\s+text not null/);
  assert.match(jobsMigration, /status in \('queued','in_progress','completed','failed','incomplete','expired','cancelled'\)/);
  assert.match(server, /type:\s*"json_schema"/);
  assert.match(server, /ASTRA_DIRECTOR_SCHEMA/);
  assert.doesNotMatch(server, /web_search/);
  assert.doesNotMatch(server, /tools:\s*\[/);
});

test("deterministic promotion gates remain authoritative", () => {
  assert.match(server, /evaluateComponentGates/);
  assert.match(server, /gate_status/);
  assert.match(server, /PROMOTION_REVIEW/);
  assert.match(server, /without deterministic eligibility/);
  assert.match(server, /deterministic_gates_control_eligibility: true/);
});

test("Astra reads research views and existing studies, never bare outcome hindsight in a live path", () => {
  assert.match(server, /desk_ledger_research/);
  assert.match(server, /desk_policy_observations_research/);
  for (const study of [
    "callQualitySnapshot",
    "cubeStudy",
    "forcedV4Snapshot",
    "labRegistrySnapshot",
    "openAIShadowSnapshot",
    "labStanding",
    "redundancyStudy",
    "signalStudy",
  ]) assert.ok(server.includes(study), `missing research source ${study}`);
});

test("Astra observer boots beside the engine and is visible only as Lab research", () => {
  assert.match(health, /astra-director\.server/);
  assert.match(health, /ensureAstraDirectorObserver/);
  assert.match(lab, /astraDirectorSnapshot\(\)\.catch\(\(\) => null\)/);
  assert.match(lab, /astra_director: AstraDirectorSnapshot \| null/);
  assert.match(room, /Astra research director/);
  assert.match(room, /report only · no Floor write/);

  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/floor-policy.ts",
  ]) {
    assert.ok(!read(path).includes("astra-director"), `${path} imports Astra director`);
  }
});

test("Lab registry lifecycle scan is warmed off the request path", () => {
  const registry = read("src/lib/desk/lab-registry.server.ts");
  assert.match(registry, /ensureLabRegistryObserver/);
  assert.match(registry, /setInterval\(\(\) => void refreshLabRegistrySnapshot\(\), REFRESH_MS\)/);
  const requestReader = registry.slice(registry.indexOf("export async function labRegistrySnapshot"));
  assert.doesNotMatch(requestReader, /getSql\(/);
  assert.match(requestReader, /Lab registry snapshot is warming/);
  const registryPos = health.indexOf("ensureLabRegistryObserver");
  const astraPos = health.indexOf("ensureAstraDirectorObserver");
  assert.ok(registryPos >= 0 && astraPos > registryPos, "registry observer must warm before Astra");
});
