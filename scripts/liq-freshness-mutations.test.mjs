/**
 * S2-3 M1–M10 independent mutations.
 *
 * Each mutation is applied to an in-memory copy of the production source.
 * The matching rail must FAIL on the mutant and PASS on the original.
 * packLiq is never extracted; decision files are only grepped.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const feeds = read("src/lib/desk/server-feeds.ts");
const live = read("src/lib/desk/live.ts");
const helpers = read("src/lib/desk/liq-time.ts");
const types = read("src/lib/desk/types.ts");
const demo = read("src/lib/desk/demo.ts");

function mustMatch(src, re, label) {
  assert.match(src, re, label);
}
function mustNot(src, re, label) {
  assert.doesNotMatch(src, re, label);
}

const rails = {
  packStays: (s) => /function packLiq\(/.test(s),
  behavioralT: (s) => /const t = e\.t > 0 \? e\.t : Date\.now\(\)/.test(s),
  trustedLast: (s) => /last_t: trustedLiqLastT\(use\)/.test(s),
  notBehavioralLast: (s) => !/last_t: use\[use\.length - 1\]/.test(s),
  providerStamp: (s) =>
    /const provider_t = e\.t > 0 && Number\.isFinite\(e\.t\) \? e\.t : 0/.test(s),
  noProviderFilter: (s) => !/filter\(\(e\) => e\.provider_t/.test(strip(s)),
  noProviderSort: (s) => !/sort\(\(a, b\) => a\.provider_t/.test(strip(s)),
  bundleField: (s) => /liq_last_t: liq\.last_t/.test(s),
  liveHold: (s) =>
    /liq_last_t: b\.liq_n > 0 \? b\.liq_last_t : \(prev\?\.liq_last_t \?\? 0\)/.test(
      strip(s),
    ),
  ageHelper: (s) => /liqAgeSeconds\(/.test(s) && /liq_age_s:/.test(s),
  noAge999: (s) => !/liq_age_s = 999/.test(s),
  helpersNoNow: (s) => !/Date\.now\(\)/.test(strip(s)),
};

test("clean tree satisfies every rail used by M1–M10", () => {
  assert.equal(rails.packStays(feeds), true);
  assert.equal(rails.behavioralT(feeds), true);
  assert.equal(rails.trustedLast(feeds), true);
  assert.equal(rails.notBehavioralLast(feeds), true);
  assert.equal(rails.providerStamp(feeds), true);
  assert.equal(rails.noProviderFilter(feeds), true);
  assert.equal(rails.noProviderSort(feeds), true);
  assert.equal(rails.bundleField(feeds), true);
  assert.equal(rails.liveHold(live), true);
  assert.equal(rails.ageHelper(live), true);
  assert.equal(rails.noAge999(live), true);
  assert.equal(rails.helpersNoNow(helpers), true);
  assert.match(types, /liq_last_t: number/);
  assert.match(types, /liq_age_s: number \| null/);
  assert.match(demo, /liq_last_t: 0/);
  assert.match(demo, /liq_age_s: null/);
});

function expectCaught(name, mutant, rail) {
  test(`${name} is caught`, () => {
    assert.equal(rail(mutant), false, `${name} should fail its rail`);
  });
}

expectCaught(
  "M1 false-now trusted last_t",
  feeds.replace("last_t: trustedLiqLastT(use)", "last_t: use[use.length - 1]!.t"),
  rails.trustedLast,
);

expectCaught(
  "M2 empty-poll drops last_t",
  live.replace(
    "liq_last_t: b.liq_n > 0 ? b.liq_last_t : (prev?.liq_last_t ?? 0)",
    "liq_last_t: b.liq_n > 0 ? b.liq_last_t : 0",
  ),
  rails.liveHold,
);

test("M3 mixed dated+undated stays a hard 0 in the helper", () => {
  mustMatch(helpers, /t <= 0\) return 0/);
});

expectCaught(
  "M4 future age clamped",
  live.replace("liqAgeSeconds(", "Math.max(0, (as_of - snap.liq_last"),
  rails.ageHelper,
);

expectCaught(
  "M5 unknown age sentinel 999",
  live.replace("liq_age_s:", "liq_age_s = 999; const ignore:"),
  rails.noAge999,
);

expectCaught(
  "M6 pack filters on provider_t",
  feeds.replace(
    "const recent = uniq.filter((e) => e.t >= cutoff);",
    "const recent = uniq.filter((e) => e.provider_t >= cutoff);",
  ),
  (s) => /uniq\.filter\(\(e\) => e\.t >= cutoff\)/.test(s),
);

expectCaught(
  "M7 pack last_t is behavioral t",
  feeds.replace("last_t: trustedLiqLastT(use)", "last_t: use[use.length - 1]!.t"),
  rails.notBehavioralLast,
);

test("M8 decision consumers do not reference measurement fields", () => {
  for (const rel of [
    "src/lib/desk/derivs.ts",
    "src/lib/desk/features.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/chair-v2.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/dsl.ts",
  ]) {
    const src = strip(read(rel));
    mustNot(src, /liq_last_t/, rel);
    mustNot(src, /liq_age_s/, rel);
    mustNot(src, /trustedLiqLastT/, rel);
  }
});

expectCaught(
  "M9 packLiq moved out of server-feeds",
  feeds.replace("function packLiq(", "function packLiqMoved("),
  rails.packStays,
);

expectCaught(
  "M10 Date.now as trusted freshness",
  helpers.replace(
    "if (!selected.length) return 0;",
    "if (!selected.length) return Date.now();",
  ),
  rails.helpersNoNow,
);
