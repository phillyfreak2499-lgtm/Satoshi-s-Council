import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

function loadPure() {
  const js = ts.transpileModule(read("src/lib/desk/lab-registry.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Object, Date, Number, Math });
  return exports;
}

test("whole-Lab registry has one unique lifecycle row for every audited research path", () => {
  const v = loadPure();
  const rows = Array.from(v.LAB_RESEARCH_REGISTRY);
  const ids = rows.map((row) => row.id);
  assert.equal(ids.length, 23);
  assert.equal(ids.length, new Set(ids).size, "registry ids must be unique");
  for (const id of [
    "chair-v2", "chair-v3", "taker-v1", "forced-v4", "openai-shadow-v1", "openai-blind-v1", "astra-director", "policy-exit",
    "seat-timing", "call-quality", "tape2", "vel2", "strike2", "whale2",
    "absorption", "path-parity", "decision-snapshots", "higher-context",
    "null-horizon", "index-settlement-fair", "lag-events", "basis-minutes",
    "hourly-book",
  ]) {
    assert.ok(ids.includes(id), `missing lifecycle row: ${id}`);
  }
  assert.ok(rows.every((row) => row.authority === "none"), "every registry row is authority-none");
});

test("freshness semantics do not mislabel manual or event-driven research as stale", () => {
  const v = loadPure();
  const now = Date.parse("2026-09-18T21:00:00Z");
  const base = {
    id: "x", label: "x", type: "measurement", authority: "none",
    purpose: "x", cadence: "x", visible_at: "x",
  };

  const manual = { ...base, cadence_kind: "manual", stale_after_ms: null, missing_is_error: false };
  assert.equal(v.labStudyHealth(manual, 0, null, now), "manual");

  const event = { ...base, cadence_kind: "event", stale_after_ms: null, missing_is_error: false };
  assert.equal(v.labStudyHealth(event, 0, null, now), "no-sample");
  assert.equal(v.labStudyHealth(event, 3, "2026-09-17T00:00:00Z", now), "event-driven");

  const fixed = { ...base, cadence_kind: "window", stale_after_ms: 35 * 60_000, missing_is_error: true };
  assert.equal(v.labStudyHealth(fixed, 5, "2026-09-18T20:45:00Z", now), "collecting");
  assert.equal(v.labStudyHealth(fixed, 5, "2026-09-18T19:00:00Z", now), "stale");
});

test("registry server is aggregate read-only and has no actuator path", () => {
  const src = codeOf("src/lib/desk/lab-registry.server.ts");
  assert.match(src, /from "\.\/lab-registry"/);
  assert.match(src, /select 'chair-v2'/i);
  for (const table of [
    "desk_samples", "desk_v3_samples", "desk_taker", "desk_v4_forced",
    "desk_openai_shadow", "desk_openai_blind", "desk_astra_director", "desk_policy_fills", "desk_replay", "desk_call_quality", "desk_absorption",
    "desk_path_parity", "desk_decision_snapshots", "desk_lag_events",
    "desk_basis_minutes", "desk_hour_ledger",
  ]) {
    assert.ok(src.includes(table), `missing source table ${table}`);
  }
  assert.match(src, /jsonb_array_elements\(cols -> 'imb'\)/);
  assert.match(src, /jsonb_array_elements\(cols -> 'resid'\)/);
  assert.match(src, /jsonb_array_elements\(cols -> 'fair'\)/);
  assert.doesNotMatch(src, /insert\s+into|update\s+desk_|delete\s+from/i);
  for (const forbidden of [
    "noteCall(", "applyDeskOp", "decideChair(", "runChair(", "selectiveBlock",
    "promoteToLive", "setKnob", "reviewSeats",
  ]) {
    assert.ok(!src.includes(forbidden), `registry reaches ${forbidden}`);
  }
});

test("public Lab exposes the registry but production decision modules never import it", () => {
  const pub = read("src/lib/desk/lab-public.ts");
  const room = read("src/components/desk/LabRoom.tsx");
  assert.match(pub, /labRegistrySnapshot\(\)\.catch\(\(\) => null\)/);
  assert.match(pub, /registry: PublicLabRegistrySnapshot \| null/);
  assert.match(room, /Research systems health/);
  assert.match(room, /Full inventory/);
  assert.match(room, /awaiting first sample/);
  assert.doesNotMatch(room, /fixed cadences healthy/);

  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/learner.ts",
  ]) {
    assert.ok(!read(path).includes("lab-registry"), `${path} imports lifecycle registry`);
  }
});
