/**
 * Phase 1A rails: the event writer stays off the decision path,
 * and no decision module grows a call to it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const BANNED_DECISION = [
  "runChair",
  "stickLean",
  "holdScore",
  "noteCall",
  "paperBookEdgeOk",
  "reviewSeats",
  "promoteToLive",
  "evaluateComponentGates",
];

test("the system-event writer does not import or call decision logic", () => {
  const src = codeOf("src/lib/desk/system-events.server.ts");
  const pure = codeOf("src/lib/desk/system-events.ts");
  for (const token of BANNED_DECISION) {
    assert.doesNotMatch(src, new RegExp(`\\b${token}\\b`), `writer mentions ${token}`);
    assert.doesNotMatch(pure, new RegExp(`\\b${token}\\b`), `types mention ${token}`);
  }
  assert.doesNotMatch(src, /from "\.\/chair/);
  assert.doesNotMatch(src, /from "\.\/stick/);
  assert.doesNotMatch(src, /from "\.\/learner/);
  assert.doesNotMatch(src, /from "\.\/engine/);
  assert.doesNotMatch(src, /from "\.\/server-engine/);
  assert.doesNotMatch(src, /from "\.\/book-floor/);
  assert.doesNotMatch(src, /from "\.\/promotion-gates/);
});

test("no decision-path module imports the system-event writer in Phase 1A", () => {
  const desk = join(ROOT, "src/lib/desk");
  const files = readdirSync(desk).filter((n) => n.endsWith(".ts") || n.endsWith(".tsx"));
  const allowed = new Set(["system-events.ts", "system-events.server.ts", "system-events.test.ts", "board.ts"]);
  for (const name of files) {
    if (allowed.has(name)) continue;
    const src = read(join("src/lib/desk", name));
    assert.doesNotMatch(
      src,
      /system-events\.server/,
      `${name} must not import the system-event writer in Phase 1A`,
    );
    assert.doesNotMatch(src, /recordSystemEvent/, `${name} must not call recordSystemEvent in Phase 1A`);
  }
});

test("PIT_CREW is not a persisted character; reserved Board names cover the group", () => {
  const types = read("src/lib/desk/system-events.ts");
  assert.match(types, /SYSTEM_CHARACTERS/);
  assert.match(types, /"WRENCH"/);
  assert.match(types, /"SWEEP"/);
  assert.match(types, /"COACH"/);
  assert.match(types, /PIT CREW/);
});

test("board.ts rejects reserved public identities and still posts ideas", () => {
  const src = read("src/lib/desk/board.ts");
  assert.match(src, /assertPublicBoardWho/);
  assert.match(src, /systemUpdate/);
  assert.match(src, /from "\.\/system-events"/);
});
