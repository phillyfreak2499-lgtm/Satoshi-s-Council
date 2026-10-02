/**
 * Guard on the FOLDED status tooltip attribution (FOLDED-COPY-A).
 *
 * The Chair sets FOLDED in its fold logic (foldSameSide and the conditional
 * CLOCK fold in chair.ts); the learner never sets it. The glossary tooltip for
 * `status.FOLDED` previously credited the learner ("Learner parked this seat
 * for poor EV"), contradicting seat-lean.ts STATUS_PLAIN.FOLDED ("SATOSHI
 * folded this read; it is not separate entry support.") shown on seat pages.
 *
 * These rails assert against the source text so they fail loudly if the
 * tooltip ever re-introduces the learner attribution or drifts away from the
 * seat-lean attribution.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("glossary status.FOLDED attributes the fold to SATOSHI, not the learner", () => {
  const src = read("src/lib/desk/glossary.ts");
  const m = src.match(/"status\.FOLDED":\s*\{\s*title:\s*"FOLDED",\s*body:\s*"([^"]*)"\s*\},/);
  assert.ok(m, "glossary status.FOLDED entry not found");
  const body = m[1];
  assert.ok(
    body.includes("SATOSHI folded this read"),
    `glossary status.FOLDED body does not attribute the fold to SATOSHI: ${body}`,
  );
  assert.ok(
    body.includes("not separate entry support"),
    `glossary status.FOLDED body lost the entry-support clarification: ${body}`,
  );
});

test("glossary status.FOLDED never credits the learner for a fold", () => {
  const src = read("src/lib/desk/glossary.ts");
  const m = src.match(/"status\.FOLDED":\s*\{\s*title:\s*"FOLDED",\s*body:\s*"([^"]*)"\s*\},/);
  assert.ok(m, "glossary status.FOLDED entry not found");
  const body = m[1];
  assert.ok(!/learner/i.test(body), `glossary status.FOLDED still blames the learner: ${body}`);
  assert.ok(!/poor EV/i.test(body), `glossary status.FOLDED still implies an EV demotion: ${body}`);
});

test("glossary FOLDED and seat-lean FOLDED agree on who folded", () => {
  const glossary = read("src/lib/desk/glossary.ts");
  const lean = read("src/lib/desk/seat-lean.ts");
  const g = glossary.match(/"status\.FOLDED":\s*\{\s*title:\s*"FOLDED",\s*body:\s*"([^"]*)"\s*\},/);
  const l = lean.match(/FOLDED:\s*"([^"]*)",/);
  assert.ok(g && l, "FOLDED copy entry missing in glossary.ts or seat-lean.ts");
  assert.ok(
    /SATOSHI folded/i.test(g[1]) && /SATOSHI folded/i.test(l[1]),
    `attribution drift: glossary=${g[1]} | seat-lean=${l[1]}`,
  );
});
