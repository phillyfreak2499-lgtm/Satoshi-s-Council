import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_REGISTRY,
  featureRegistryReport,
  validateFeatureRegistry,
  type FeatureRegistryEntry,
} from "./feature-registry.ts";

test("the shipped feature registry is internally consistent", () => {
  assert.deepEqual(validateFeatureRegistry(), []);
  assert.ok(FEATURE_REGISTRY.length >= 30, "the first inventory must cover the existing desk");
});

test("feature identifiers are unique and versions are explicit", () => {
  assert.equal(new Set(FEATURE_REGISTRY.map((row) => row.id)).size, FEATURE_REGISTRY.length);
  assert.ok(FEATURE_REGISTRY.every((row) => Number.isInteger(row.version) && row.version >= 1));
});

test("only live authority can be visible to the Chair", () => {
  for (const row of FEATURE_REGISTRY) {
    if (row.chair_visible) assert.equal(row.authority, "live", row.id);
    if (row.authority !== "live") assert.equal(row.chair_visible, false, row.id);
  }
});

test("pit-crew context and shadow research stay out of the Chair", () => {
  for (const id of [
    "lab.settlement_fair",
    "lab.microprice",
    "lab.ofi",
    "lab.cancellations",
    "lab.trade_flow",
    "lab.vel_residual",
    "lab.lead_lag",
    "lab.absorption",
    "lab.timestamped_path",
    "context.fear_greed",
    "context.regime_tag",
  ]) {
    const row = FEATURE_REGISTRY.find((candidate) => candidate.id === id);
    assert.ok(row, id);
    assert.equal(row.chair_visible, false, id);
  }
});

test("reserved research questions are named missing, not quietly active", () => {
  const missing = FEATURE_REGISTRY.filter((row) => row.authority === "missing");
  assert.ok(missing.length >= 1);
  assert.ok(missing.every((row) => !row.chair_visible && row.consumers.length === 0));
});

test("invalid authority combinations fail closed", () => {
  const base = FEATURE_REGISTRY[0]!;
  const bad: FeatureRegistryEntry[] = [
    ...FEATURE_REGISTRY,
    { ...base },
    {
      ...base,
      id: "bad.shadow-visible",
      authority: "shadow",
      chair_visible: true,
    },
    {
      ...base,
      id: "bad.pit-vote",
      owner: "WARDEN",
      chair_visible: true,
    },
  ];
  const errors = validateFeatureRegistry(bad);
  assert.ok(errors.some((error) => error.includes("duplicate feature id")));
  assert.ok(errors.some((error) => error.includes("only live features")));
  assert.ok(errors.some((error) => error.includes("pit-crew")));
});

test("the admin report is deterministic apart from its supplied clock", () => {
  const report = featureRegistryReport(Date.UTC(2026, 8, 15));
  assert.equal(report.ok, true);
  assert.equal(report.generated_at, "2026-09-15T00:00:00.000Z");
  assert.equal(Object.values(report.tally).reduce((sum, n) => sum + n, 0), FEATURE_REGISTRY.length);
  assert.match(report.note, /cannot promote/i);
  assert.match(report.note, /cannot.*change Chair inputs/i);
});


test("completed path features are measurement-only", () => {
  for (const id of ["path.strike_crossings", "path.time_above_below", "path.smoothness"]) {
    const row = FEATURE_REGISTRY.find((candidate) => candidate.id === id);
    assert.ok(row, id);
    assert.equal(row.authority, "measurement", id);
    assert.equal(row.chair_visible, false, id);
    assert.ok(row.consumers.includes("Window path study"), id);
  }
});
