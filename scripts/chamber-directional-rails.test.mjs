import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("directional Chamber speech is sourced only from an already-recorded paper call", () => {
  const src = read("src/lib/desk/chamber-directional.ts");
  assert.match(src, /callLog\.find/);
  assert.match(src, /row\.ticker === ticker/);
  assert.match(src, /Number\(row\.close_time\) === close/);
  assert.match(src, /event_type: "CHAIR_DIRECTIONAL"/);
  assert.match(src, /character: "SATOSHI"/);
  assert.match(src, /public: true/);
  assert.match(src, /paper book/);
  assert.doesNotMatch(src, /from "\.\/chair/);
  assert.doesNotMatch(src, /from "\.\/learner/);
  assert.doesNotMatch(src, /recordSystemEvent/);
  assert.doesNotMatch(src, /noteCall/);
  assert.doesNotMatch(src, /paperBookEdgeOk/);
});

test("server observer records the directional event without changing the engine hook", () => {
  const observer = read("src/lib/desk/chamber-wait.server.ts");
  const engine = read("src/lib/desk/server-engine.ts");
  assert.match(observer, /maybeChairDirectionalEvent\(snap, callLog\)/);
  assert.match(observer, /safeRecord\(maybeChairDirectionalEvent/);
  assert.match(engine, /void observeChairWaitMilestone\(snap, chair, e\.callLog\)\.catch\(/);
  assert.doesNotMatch(engine, /chamber-directional/);
  assert.doesNotMatch(engine, /recordSystemEvent/);
});

test("reaction and both Chamber surfaces expose directional evidence, never a write path", () => {
  const reaction = read("src/lib/desk/chamber-reactions.ts");
  assert.match(reaction, /ev\.event_type === "CHAIR_DIRECTIONAL"/);
  assert.match(reaction, /kind: "chair-directional"/);
  assert.match(reaction, /entry_cents/);
  for (const rel of ["src/components/desk/ChamberSpeech.tsx", "src/components/desk/ChamberRoom.tsx"]) {
    const src = read(rel);
    assert.match(src, /chair-directional/);
    assert.match(src, /paper entry/);
    assert.doesNotMatch(src, /recordSystemEvent/);
    assert.doesNotMatch(src, /createServerFn/);
    assert.doesNotMatch(src, /method:\s*["']POST["']/);
  }
});
