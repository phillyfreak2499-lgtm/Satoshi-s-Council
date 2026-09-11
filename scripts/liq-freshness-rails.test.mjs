/**
 * S2-3 measurement rails. Source-text only — packLiq stays in server-feeds.ts.
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

test("S2-3 packLiq stays in server-feeds and keeps the behavioral clock", () => {
  const raw = read("src/lib/desk/server-feeds.ts");
  const src = codeOf("src/lib/desk/server-feeds.ts");
  assert.match(src, /function packLiq\(/);
  assert.match(src, /const t = e\.t > 0 \? e\.t : Date\.now\(\)/);
  assert.match(src, /const recent = uniq\.filter\(\(e\) => e\.t >= cutoff\)/);
  assert.match(src, /const use = recent\.length \? recent : uniq\.slice\(-8\)/);
  assert.match(src, /last_t: trustedLiqLastT\(use\)/);
  assert.match(src, /liq_last_t: liq\.last_t/);
  assert.match(src, /const provider_t = e\.t > 0 && Number\.isFinite\(e\.t\) \? e\.t : 0/);
  assert.doesNotMatch(src, /filter\(\(e\) => e\.provider_t/);
  assert.doesNotMatch(src, /sort\(\(a, b\) => a\.provider_t/);
  assert.doesNotMatch(raw, /last_t: use\[use\.length - 1\]/);
});

test("S2-3 live.ts holds liq_last_t with USD/n/source on empty poll", () => {
  const src = codeOf("src/lib/desk/live.ts");
  assert.match(src, /liq_last_t: b\.liq_n > 0 \? b\.liq_last_t : \(prev\?\.liq_last_t \?\? 0\)/);
  assert.doesNotMatch(src, /liq_last_t: b\.as_of/);
  assert.doesNotMatch(src, /liq_last_t: now/);
  assert.doesNotMatch(src, /liq_last_t: Date\.now\(\)/);
});

test("S2-3 snapshot derives liq_age_s; unknown is null; no clamp", () => {
  const src = codeOf("src/lib/desk/live.ts");
  assert.match(src, /liqAgeSeconds\(/);
  assert.match(src, /liq_age_s:/);
  assert.doesNotMatch(src, /liq_age_s = 999/);
  assert.doesNotMatch(src, /Math\.max\(0,\s*\(as_of - .*liq_last/);
});

test("S2-3 types and demo carry the measurement fields", () => {
  const types = codeOf("src/lib/desk/types.ts");
  const demo = codeOf("src/lib/desk/demo.ts");
  assert.match(types, /liq_last_t: number/);
  assert.match(types, /liq_age_s: number \| null/);
  assert.match(demo, /liq_last_t: 0/);
  assert.match(demo, /liq_age_s: null/);
});

test("S2-3 decision consumers do not read measurement fields", () => {
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

test("S2-3 helpers refuse Date.now as trusted freshness", () => {
  const src = codeOf("src/lib/desk/liq-time.ts");
  assert.match(src, /export function trustedLiqLastT/);
  assert.match(src, /export function liqAgeSeconds/);
  assert.doesNotMatch(src, /Date\.now\(\)/);
});
