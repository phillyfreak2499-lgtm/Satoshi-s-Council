import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("Replay separates the Chair read from paper action", () => {
  const pane = read("src/components/desk/ReplayPane.tsx");
  assert.match(pane, /Chair \/ paper/);
  assert.match(pane, /Paper FILLED/);
  assert.match(pane, /Paper SKIP/);
  assert.match(pane, /no directional Chair read recorded/);
  assert.ok(!pane.includes("No position · chair sat out"));
});

test("Replay SKIP is derived prospectively from recorded Chair frames, never the result", () => {
  const pane = read("src/components/desk/ReplayPane.tsx");
  assert.match(pane, /function firstChairRead/);
  assert.match(pane, /c\.lean\.findIndex\(\(v\) => v !== 0\)/);
  assert.match(pane, /chair \$\{read\.lean\} · paper skip/);
  const helper = pane.slice(pane.indexOf("function firstChairRead"), pane.indexOf("function fmtWhen"));
  assert.ok(!helper.includes("winner"));
  assert.ok(!helper.includes("settle"));
  assert.ok(!helper.includes("official"));
});

test("Replay skipped reads still carry no paper economics", () => {
  const pane = read("src/components/desk/ReplayPane.tsx");
  const skipped = pane.slice(pane.indexOf(": firstRead ? ("), pane.indexOf(") : (", pane.indexOf(": firstRead ? (")));
  assert.ok(!skipped.includes("r.call.ev"));
  assert.ok(!skipped.includes("r.call.entry"));
  assert.ok(!skipped.includes("r.call.settle"));
});
