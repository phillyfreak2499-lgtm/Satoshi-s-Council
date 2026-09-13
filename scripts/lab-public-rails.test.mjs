import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("public Lab is GET-only aggregate evidence", () => {
  const src = read("src/lib/desk/lab-public.ts");
  assert.match(src, /createServerFn\(\{ method: "GET" \}\)/);
  assert.match(src, /labStanding/);
  assert.match(src, /EXIT_CANDIDATES/);
  assert.match(src, /COMPONENT_MIN/);
  assert.doesNotMatch(src, /method:\s*"POST"/);
  assert.doesNotMatch(src, /recordExitArena/);
  assert.doesNotMatch(src, /recordSystemEvent/);
  assert.doesNotMatch(src, /promoteToLive/);
  assert.doesNotMatch(src, /evaluateComponentGates/);
});

test("public Lab exposes frozen governance without authority", () => {
  const src = read("src/lib/desk/lab-public.ts");
  assert.match(src, /paper_only:\s*true/);
  assert.match(src, /authority:\s*"none"/);
  assert.match(src, /sample_min:\s*COMPONENT_MIN\.fills/);
  assert.match(src, /days_min:\s*COMPONENT_MIN\.days/);
  assert.match(src, /paired_control_losses_min:\s*COMPONENT_MIN\.paired_control_losses/);
  assert.doesNotMatch(src, /status:\s*"PROMOTED"/);
  assert.doesNotMatch(src, /status:\s*"REJECTED"/);
});

test("Lab route and room are read-only presentation", () => {
  const route = read("src/routes/lab.tsx");
  const room = read("src/components/desk/LabRoom.tsx");
  assert.match(route, /createFileRoute\("\/lab"\)/);
  assert.match(room, /publicLabSnapshot/);
  assert.match(room, /Nothing here can change the Chair/);
  for (const src of [route, room]) {
    assert.doesNotMatch(src, /recordSystemEvent/);
    assert.doesNotMatch(src, /recordExitArena/);
    assert.doesNotMatch(src, /method:\s*"POST"/);
    assert.doesNotMatch(src, /promoteToLive/);
  }
});

test("Nitro cannot shadow the public /lab page", () => {
  assert.equal(existsSync(join(process.cwd(), "server/routes/lab.get.ts")), false);

  const adminStanding = read("server/routes/lab/standing.get.ts");
  assert.match(adminStanding, /adminKeyOk/);
  assert.match(adminStanding, /labStanding/);
  assert.match(adminStanding, /promotes_nothing:\s*true/);
});
