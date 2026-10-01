import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const plugin = read("server/plugins/desk-runtime.ts");
const bootstrap = read("src/lib/desk/runtime-bootstrap.server.ts");
const health = read("server/routes/healthz.get.ts");
const vite = read("vite.config.ts");
const engine = read("src/lib/desk/server-engine.ts");

const observers = [
  ["server-engine", "ensureServerEngine"],
  ["chair-v3-prospective.server", "ensureChairV3ProspectiveObserver"],
  ["call-quality.server", "ensureCallQualityObserver"],
  ["chair-ablation.server", "ensureChairAblationObserver"],
  ["lab-registry.server", "ensureLabRegistryObserver"],
  ["astra-director.server", "ensureAstraDirectorObserver"],
  ["hour-closer.server", "ensureHourCloser"],
];

test("Nitro auto-registers a Render-only startup bootstrap", () => {
  assert.match(vite, /serverDir:\s*"\.\/server"/);
  assert.match(plugin, /definePlugin/);
  assert.match(plugin, /process\.env\.RENDER\s*!==\s*"true"/);
  assert.match(plugin, /process\.env\.RENDER_SERVICE_TYPE\s*!==\s*"web"/);
  assert.match(plugin, /ensureDeskRuntime\(\)/);
});

test("startup bootstrap covers active long-running Council observers", () => {
  for (const [moduleName, starter] of observers) {
    assert.ok(bootstrap.includes(`"./${moduleName}"`), `startup missing ${moduleName}`);
    assert.ok(bootstrap.includes(`m.${starter}()`), `startup missing ${starter}`);
  }
});

test("healthz remains an independent idempotent fallback", () => {
  for (const [moduleName, starter] of observers) {
    assert.ok(health.includes(moduleName), `health fallback missing ${moduleName}`);
    assert.ok(health.includes(`m.${starter}()`), `health fallback missing ${starter}`);
  }
});

test("research bootstrap still has no return path into the Floor engine", () => {
  for (const researchModule of [
    "chair-v3-prospective.server",
    "forced-v4.server",
    "openai-shadow.server",
    "openai-blind.server",
    "openai-luna.server",
    "chair-ablation.server",
    "astra-director.server",
  ]) {
    assert.equal(engine.includes(researchModule), false, `engine imports ${researchModule}`);
  }
});

const retiredObservers = [
  ["forced-v4.server", "ensureForcedV4Observer"],
  ["openai-shadow.server", "ensureOpenAIShadowObserver"],
  ["openai-blind.server", "ensureOpenAIBlindObserver"],
  ["openai-luna.server", "ensureOpenAILunaObserver"],
];
test("retired research observers cannot start from boot or health checks", () => {
  const registry = read("src/lib/desk/lab-registry.ts");
  const ids = ["forced-v4", "openai-shadow-v1", "openai-blind-v1", "openai-luna-v1"];
  for (const [i, [moduleName, starter]] of retiredObservers.entries()) {
    const start = registry.indexOf('id: "' + ids[i] + '"');
    assert.ok(start >= 0, ids[i] + " must exist in the registry");
    const definition = registry.slice(start);
    assert.match(definition.slice(0, definition.indexOf('purpose:')), /lifecycle: "retired"/);
    for (const entry of [bootstrap, health]) {
      assert.equal(entry.includes(moduleName), false, moduleName + " must not be imported at startup");
      assert.equal(entry.includes(starter), false, starter + " must not be invoked at startup");
    }
  }
});
