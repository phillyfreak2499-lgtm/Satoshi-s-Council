import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("public evidence routes load their first paint on the server", () => {
  const cases = [
    ["src/routes/seat.$id.tsx", "publicSeatSnapshot", "Route.useLoaderData()"],
    ["src/routes/window.$ticker.tsx", "loadReplay", "Route.useLoaderData()"],
    ["src/routes/chamber.tsx", "listChamberSpeech", "Route.useLoaderData()"],
    ["src/routes/lab.tsx", "publicLabSnapshot", "Route.useLoaderData()"],
    ["src/routes/arena.tsx", "publicArenaSnapshot", "Route.useLoaderData()"],
  ];

  for (const [path, loader, data] of cases) {
    const source = read(path);
    assert.match(source, new RegExp(`loader:[\\s\\S]*${loader}`), `${path} calls its server loader`);
    assert.match(source, new RegExp(data.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${path} hands loader data to the page`);
  }
});

test("public SSR readers are GET-only and expose no Arena identity", () => {
  const seat = read("src/lib/desk/seat-public.ts");
  const arena = read("src/lib/desk/arena-public.ts");
  const replay = read("src/lib/desk/replay.ts");

  for (const source of [seat, arena, replay]) {
    assert.match(source, /createServerFn\(\{ method: "GET" \}\)/);
    assert.doesNotMatch(source, /method:\s*"POST"|insert\s+into|update\s+desk_|delete\s+from/i);
  }

  assert.match(arena, /rackFor\(null\)/, "SSR rack has no device token");
  assert.match(arena, /arenaSummary\(null\)/, "SSR board has no device token");
  assert.doesNotMatch(arena, /arenaToken\(|arenaName\(/);
  assert.doesNotMatch(seat, /return\s+\{[\s\S]*learner\s*[:,]/, "seat pages return a bounded summary, not the learner");
});

test("persisted data seeds each component instead of a loading shell", () => {
  const chamber = read("src/components/desk/ChamberRoom.tsx");
  const lab = read("src/components/desk/LabRoom.tsx");
  const arena = read("src/components/desk/PitRoom.tsx");
  const replay = read("src/components/desk/ReplayPane.tsx");

  assert.match(chamber, /useState<ChamberStatement\[\]>\(initial\)/);
  assert.match(lab, /useState<PublicLabSnapshot \| null>\(initial \?\? null\)/);
  assert.match(arena, /useState<Rack \| null>\(initial\?\.rack \?\? null\)/);
  assert.match(arena, /useState<Arena \| null>\(initial\?\.board \?\? null\)/);
  assert.match(replay, /useState<Replay \| null>\(initial \?\? null\)/);

  assert.doesNotMatch(chamber, /toLocaleDateString\(/, "Chamber SSR dates are timezone-stable");
  assert.doesNotMatch(lab, /toLocaleTimeString\(/, "Lab SSR clock is timezone-stable");
});

test("a syntactically valid ticker without a replay reaches the branded 404", () => {
  const route = read("src/routes/window.$ticker.tsx");
  assert.match(route, /const replay = await loadReplay/);
  assert.match(route, /if \(!replay\) throw notFound\(\)/);
});
