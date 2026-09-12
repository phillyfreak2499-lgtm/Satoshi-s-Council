/**
 * S2-3 named M1–M10 evidence. Source-text against the branch tree.
 * Does not change pack / types / demo / live / helpers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("M1 packLiq stays in server-feeds.ts", () => {
  const src = codeOf("src/lib/desk/server-feeds.ts");
  assert.match(src, /function packLiq\(/);
  assert.doesNotMatch(codeOf("src/lib/desk/liq-time.ts"), /function packLiq\(/);
  assert.doesNotMatch(codeOf("src/lib/desk/live.ts"), /function packLiq\(/);
});

test("M2 Date.now is not the trusted last_t", () => {
  const feeds = codeOf("src/lib/desk/server-feeds.ts");
  const helpers = codeOf("src/lib/desk/liq-time.ts");
  assert.match(feeds, /last_t: trustedLiqLastT\(use\)/);
  assert.doesNotMatch(helpers, /Date\.now\(/);
  assert.doesNotMatch(feeds, /last_t:\s*Date\.now\(/);
  assert.doesNotMatch(feeds, /last_t:\s*as_of/);
});

test("M3 empty poll holds previous liq_last_t", () => {
  const src = codeOf("src/lib/desk/live.ts");
  assert.match(src, /liq_last_t: b\.liq_n > 0 \? b\.liq_last_t : \(prev\?\.liq_last_t \?\? 0\)/);
  assert.match(codeOf("src/lib/desk/liq-time.ts"), /export function holdLiqLastT/);
});

test("M4 mixed dated pack must not use behavioral t as last_t", () => {
  const raw = read("src/lib/desk/server-feeds.ts");
  const src = codeOf("src/lib/desk/server-feeds.ts");
  assert.match(src, /const provider_t = e\.t > 0 && Number\.isFinite\(e\.t\) \? e\.t : 0/);
  assert.match(src, /last_t: trustedLiqLastT\(use\)/);
  assert.doesNotMatch(raw, /last_t: use\[use\.length - 1\]/);
  assert.doesNotMatch(src, /filter\(\(e\) => e\.provider_t/);
});

test("M5 future provider time is not clamped to zero age", () => {
  const live = codeOf("src/lib/desk/live.ts");
  const helpers = codeOf("src/lib/desk/liq-time.ts");
  assert.match(live, /liqAgeSeconds\(/);
  assert.doesNotMatch(live, /Math\.max\(0,\s*\(as_of - .*liq_last/);
  assert.doesNotMatch(helpers, /Math\.max\(0,/);
  assert.match(helpers, /return \(as_of - liq_last_t\) \/ 1000/);
});

test("M6 unknown age is null, never 999", () => {
  const live = codeOf("src/lib/desk/live.ts");
  const helpers = codeOf("src/lib/desk/liq-time.ts");
  assert.doesNotMatch(live, /liq_age_s = 999/);
  assert.doesNotMatch(helpers, /999/);
  assert.match(helpers, /return null/);
});

test("M7 freshness helpers refuse Date.now", () => {
  const src = codeOf("src/lib/desk/liq-time.ts");
  assert.match(src, /export function trustedLiqLastT/);
  assert.match(src, /export function liqAgeSeconds/);
  assert.doesNotMatch(src, /Date\.now\(/);
});

test("M8 demo stamps unknown clock as 0 / null", () => {
  const src = codeOf("src/lib/desk/demo.ts");
  assert.match(src, /liq_last_t:\s*0/);
  assert.match(src, /liq_age_s:\s*null/);
});

test("M9 types carry measurement fields on bundle and snapshot", () => {
  const src = codeOf("src/lib/desk/types.ts");
  assert.match(src, /liq_last_t:\s*number/);
  assert.match(src, /liq_age_s:\s*number\s*\|\s*null/);
  const snap = src.slice(src.indexOf("export type Snapshot"), src.indexOf("export type ShadowLean"));
  const bundle = src.slice(src.indexOf("export type LiveBundle"));
  assert.match(snap, /liq_last_t:\s*number/);
  assert.match(snap, /liq_age_s:\s*number\s*\|\s*null/);
  assert.match(bundle, /liq_last_t:\s*number/);
});

test("M10 decision consumers do not read measurement fields", () => {
  for (const rel of [
    "src/lib/desk/derivs.ts",
    "src/lib/desk/features.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/chair-v2.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/dsl.ts",
  ]) {
    const src = codeOf(rel);
    assert.doesNotMatch(src, /liq_last_t/, `${rel} must not read liq_last_t`);
    assert.doesNotMatch(src, /liq_age_s/, `${rel} must not read liq_age_s`);
    assert.doesNotMatch(src, /trustedLiqLastT/, `${rel} must not import the measurement helper`);
  }
});
