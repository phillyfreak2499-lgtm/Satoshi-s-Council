/**
 * Chair v2 / v3 Lab scoreboard — safety rails.
 *
 * The scoreboard reads two ledgers the desk already keeps and prints them
 * against gates written in chair-v2.ts / chair-v3.ts. These tests pin that
 * it stays a reader: no refit, no sample write, no decision call, no import
 * of the live Chair or learner, no new EXIT_CANDIDATES row, and the Lab's
 * existing "V2"/"V3" entry-policy identities untouched.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the pure module cites the source gates and imports nothing with authority", () => {
  const src = codeOf("src/lib/desk/chair-shadow-lab.ts");
  assert.match(src, /from "\.\/chair-v2\.ts"/);
  assert.match(src, /from "\.\/chair-v3\.ts"/);
  assert.match(src, /v2Gates\(st\)/, "the v2 gates come from v2Gates(), not a local rule");
  assert.match(src, /samples: V2_GATE_SAMPLES/);
  assert.match(src, /calls: V2_GATE_CALLS/);
  assert.match(src, /min_train: V3_MIN_TRAIN/);
  assert.match(src, /V3_MAX_ADJUSTMENT \* 100/);
  for (const banned of [
    "chair.ts", "learner", "bots", "clock", "seats", "crew", "skill-gate", "promotion-gates",
    "floor-policy", "book-floor", "booked-decision", "paper-book", "server-engine", "@/lib/db",
    "fitLogistic", "predictV2", "decideV2", "fitV3", "predictV3", "walkForwardV3(", "Date.now",
  ]) {
    assert.doesNotMatch(src, new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `pure module must not reference ${banned}`);
  }
});

test("the server snapshot only reads: engine frame for v2, cached walk-forward report for v3", () => {
  const src = codeOf("src/lib/desk/chair-shadow-lab.server.ts");
  assert.match(src, /import\("\.\/server-engine"\)/, "the brain is a dynamic import, never a static dependency");
  assert.match(src, /getServerFrame\(\)/);
  assert.match(src, /frame\.v2\.stats/, "v2 numbers are the engine's own V2Stats");
  assert.match(src, /chairV3Snapshot\(\)/, "v3 numbers come from the existing walk-forward snapshot");
  for (const banned of [
    "insert into", "update ", "delete from", "desk_samples", "desk_state", "getSql",
    "fitLogistic", "predictV2", "decideV2", "settleV2", "refitV2", "refreshV2Stats",
    "fitV3", "predictV3", "walkForwardV3", "persistState",
    "recordSystemEvent", "recordExitArena", "promoteToLive", "evaluateComponentGates",
    "./chair\"", "./chair.ts", "./learner", "./bots", "./clock", "./seats", "./crew",
    "./skill-gate", "./promotion-gates", "./floor-policy", "./book-floor", "./booked-decision", "./paper-book",
  ]) {
    assert.doesNotMatch(src, new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `server snapshot must not reference ${banned}`);
  }
});

test("the brain never imports the Lab scoreboard back", () => {
  for (const rel of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/chair-v2.ts",
    "src/lib/desk/chair-v3.ts",
    "src/lib/desk/chair-v3.server.ts",
    "src/lib/desk/floor-policy.ts",
    "src/lib/desk/promotion-gates.ts",
  ]) {
    assert.doesNotMatch(read(rel), /chair-shadow-lab/, `${rel} must not import the scoreboard`);
  }
});

test("the scoreboard is attached to the public Lab beside the other studies, not as a specimen", () => {
  const pub = read("src/lib/desk/lab-public.ts");
  assert.match(pub, /chairShadowLabSnapshot\(\)\.catch\(\(\) => null\)/, "an unavailable scoreboard must not take the Lab down");
  assert.match(pub, /chair_v2: chairShadow\?\.chair_v2 \?\? null/);
  assert.match(pub, /chair_v3: chairShadow\?\.chair_v3 \?\? null/);
  assert.match(pub, /createServerFn\(\{ method: "GET" \}\)/);
  assert.doesNotMatch(pub, /method:\s*"POST"/);

  const policy = read("src/lib/desk/floor-policy.ts");
  assert.doesNotMatch(policy, /CHAIR_V2|CHAIR_V3/, "no CHAIR_V2 / CHAIR_V3 candidate in floor-policy");
  assert.match(policy, /export const SELECTIVE_ENTRY_ID = "ENTRY_SELECTIVE_V3";/, "ENTRY_SELECTIVE_V3 still means entry policy");
  assert.match(policy, /policy_id: "FLOOR_SELECTIVE_V2"/, "FLOOR_SELECTIVE_V2 still means a floor policy version");
});

test("the Lab page keeps its authority copy and disambiguates the two V2/V3 meanings", () => {
  const room = read("src/components/desk/LabRoom.tsx");
  assert.match(room, /Nothing here can change the Chair/);
  assert.match(room, /<ChairShadowLab v2=\{data\.chair_v2\} v3=\{data\.chair_v3\} \/>/);
  assert.match(room, /paper-only · none/);

  const card = read("src/components/desk/ChairShadowLab.tsx");
  assert.match(card, /paper-only · none/);
  assert.match(card, /Meeting a count is not promotion\./);
  assert.match(card, /Nothing here touches the live Chair\./);
  assert.match(card, /No authority over the live Chair or paper book\./);
  assert.match(card, /NOT_THESE\[0\]\} and \{NOT_THESE\[1\]\}/, "the page names the entry policies it is not");
  assert.doesNotMatch(card, /Date\.now|toLocale/, "SSR-stable rendering");
  for (const banned of ["recordSystemEvent", "recordExitArena", "promoteToLive", "method: \"POST\"", "server-engine", "@/lib/db"]) {
    assert.doesNotMatch(card, new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the protocol doc says authority none and cites the frozen gates", () => {
  const doc = read("docs/CHAIR_SHADOW_LAB_V1.md");
  assert.match(doc, /authority.*none/i);
  assert.match(doc, /Meeting a count is not promotion/);
  assert.match(doc, /V2_GATE_SAMPLES = 300/);
  assert.match(doc, /V2_GATE_CALLS = 40/);
  assert.match(doc, /V3_MIN_TRAIN = 240/);
  assert.match(doc, /V3_MAX_ADJUSTMENT = 0\.10/);
  assert.match(doc, /FLOOR_SELECTIVE_V2/);
  assert.match(doc, /ENTRY_SELECTIVE_V3/);
});
