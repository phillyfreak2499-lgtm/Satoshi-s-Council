import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("public Chamber route is read-only and mounted in the generated route tree", () => {
  const route = read("src/routes/chamber.tsx");
  const room = read("src/components/desk/ChamberRoom.tsx");
  const tree = read("src/routeTree.gen.ts");

  assert.match(route, /createFileRoute\("\/chamber"\)/);
  assert.match(route, /ChamberRoom/);
  assert.match(tree, /'\/chamber'/);

  assert.match(room, /listChamberSpeech/);
  assert.match(room, /Read only/);
  assert.match(room, /downstream only/);
  assert.match(room, /room stays quiet/);
  assert.doesNotMatch(room, /recordSystemEvent/);
  assert.doesNotMatch(room, /observeChairWaitMilestone/);
  assert.doesNotMatch(room, /system-events\.server/);
  assert.doesNotMatch(room, /method:\s*["']POST["']/);
  assert.doesNotMatch(room, /createServerFn/);
});

test("Floor Chamber strip links to the full room without gaining a writer", () => {
  const strip = read("src/components/desk/ChamberSpeech.tsx");
  assert.match(strip, /href="\/chamber"/);
  assert.match(strip, /Enter the Chamber/);
  assert.doesNotMatch(strip, /recordSystemEvent/);
  assert.doesNotMatch(strip, /method:\s*["']POST["']/);
});

test("public Chamber names only currently evidence-backed speakers as active voices", () => {
  const room = read("src/components/desk/ChamberRoom.tsx");
  assert.match(room, /SATOSHI/);
  assert.match(room, /WARDEN/);
  for (const who of ["ALCHEMIST", "WRENCH", "SWEEP", "COACH"]) {
    assert.match(room, new RegExp(`${who}[^]*?Silent`, "m"));
  }
});
