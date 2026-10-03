import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PURE = [
  "src/lib/desk/council-room-narration.ts",
  "src/lib/desk/council-room-feed.ts",
  "src/lib/desk/council-room-snapshot.ts",
  "src/lib/desk/council-room-lite.ts",
];

test("Council Room adapter modules are pure: no writer, database, engine, network or voice", () => {
  for (const rel of PURE) {
    const src = code(rel);
    assert.doesNotMatch(src, /system-events\.server|recordSystemEvent|@\/lib\/db|getSql/, rel);
    assert.doesNotMatch(src, /server-engine|from "\.\/engine|startEngine|runChair|noteCall|learner|follower/, rel);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|EventSource|WebSocket|createServerFn/, rel);
    assert.doesNotMatch(src, /council-voice|speechSynthesis|Audio\(/, rel);
    assert.doesNotMatch(src, /Math\.random/, rel);
  }
});

test("Chamber page is text-only: no voice controls, voice copy or voice requests", () => {
  const room = read("src/components/desk/ChamberRoom.tsx");
  assert.doesNotMatch(room, /CouncilVoiceButton|council-voice|label="Hear"|AI-generated (fictional )?character voice/);
  assert.match(room, /Text only\./);
});

test("Chamber page does not start the desk engine or poll with setInterval", () => {
  const room = code("src/components/desk/ChamberRoom.tsx");
  assert.doesNotMatch(room, /useDesk|@\/lib\/desk\/store|@\/lib\/desk\/engine|startEngine/);
  assert.doesNotMatch(room, /setInterval/);
  assert.doesNotMatch(room, /method:\s*["']POST["']|createServerFn|recordSystemEvent/);
  assert.match(room, /createPoller/);
  assert.match(room, /fetch\("\/frame", \{ headers: \{ accept: "application\/json" \}/, "only the existing public GET snapshot");
});

test("retained history is labelled recorded, not live, and the stage stays disabled", () => {
  const room = read("src/components/desk/ChamberRoom.tsx");
  assert.doesNotMatch(room, /Live exchanges/);
  assert.match(room, /Recorded exchanges/);
  assert.match(room, /history: "History"/);
  assert.match(room, /const SHOW_CINEMATIC_ROOM = false/);
  assert.match(room, /not a recorded event/);
});

test("the Phase 1 source stays the existing bounded public GET", () => {
  const speech = read("src/lib/desk/chamber-speech.ts");
  assert.match(speech, /createServerFn\(\{ method: "GET" \}\)/);
  assert.match(speech, /listPublicChamberEvents\(5\)/);
  const reader = read("src/lib/desk/system-events-read.server.ts");
  assert.match(reader, /where public = true/);
});

test("decision producers keep no dependency on the Council Room", () => {
  for (const rel of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/chamber-directional.ts",
    "src/lib/desk/chamber-wait.server.ts",
  ]) {
    assert.doesNotMatch(read(rel), /council-room/, rel);
  }
});

test("page-load rows carry the server receipt time from the route loader", () => {
  const route = read("src/routes/chamber.tsx");
  assert.match(route, /const rows = await listChamberSpeech\(\);\s*return \{ rows, received_ms: Date\.now\(\) \};/);
  assert.match(route, /receivedMs=\{data\.received_ms\}/);
  const room = read("src/components/desk/ChamberRoom.tsx");
  assert.match(room, /initialFeed\(seed, receivedMs\)/);
  assert.doesNotMatch(room, /with page load/);
});

test("Phase 2 room is presentation only: no engine, network, 3D, canvas, audio or new assets", () => {
  const room = code("src/components/desk/CouncilRoomLite.tsx");
  assert.doesNotMatch(room, /fetch\(|createServerFn|EventSource|WebSocket|@\/lib\/desk\/(store|engine|server-engine)|startEngine/);
  assert.doesNotMatch(room, /three|<canvas|WebGL|getContext|\.glb|\.gltf|Audio|speechSynthesis|council-voice/i);
  assert.doesNotMatch(room, /<img|url\(|\.webp|\.png/);
  const chamber = read("src/components/desk/ChamberRoom.tsx");
  assert.match(chamber, /const SHOW_CINEMATIC_ROOM = false/);
  assert.match(chamber, /<CouncilRoomLite model=\{room\} paused=\{userPaused\} onTogglePause=\{togglePause\} \/>/);
  assert.equal((chamber.match(/fetch\(/g) ?? []).length, 1, "the only fetch stays the allowlisted GET /frame");
  const pkg = JSON.parse(read("package.json"));
  for (const dep of ["three", "@react-three/fiber"]) assert.ok(!(dep in (pkg.dependencies ?? {})), dep);
});

test("the room model keeps no previous snapshot and reads flashes only from fresh feed events", () => {
  const model = code("src/lib/desk/council-room-lite.ts");
  assert.doesNotMatch(model, /prev(ious)?Snap|lastSnapshot|diff/i);
  assert.match(model, /e\.arrival === "fresh"/);
  assert.doesNotMatch(model, /arrival === "(history|live|late)"/);
});

test("the page hook uses the tested cycle wiring, not a parallel copy", () => {
  const chamber = code("src/components/desk/ChamberRoom.tsx");
  assert.match(chamber, /createChamberCycle\(\{/);
  assert.match(chamber, /readEvents: listChamberSpeech/);
  assert.match(chamber, /readSnapshot: readRosterSnapshot/);
  assert.match(chamber, /updateSnapshot: setSnapshot/);
  assert.equal((chamber.match(/setSnapshot\(/g) ?? []).length, 0, "no snapshot writes outside the cycle wiring");
  assert.equal((chamber.match(/listChamberSpeech\(\)/g) ?? []).length, 0, "the event read is only called through the cycle");
});

test("CR-CLAUDE-003: the viewer pause goes through the poller; no new timer, endpoint or read path", () => {
  const chamber = code("src/components/desk/ChamberRoom.tsx");
  assert.match(chamber, /pollerRef\.current\?\.setPaused\(next\)/);
  assert.match(chamber, /if \(env\.hidden \|\| userPaused\) return;/, "the display clock (ages) also stops while viewer-paused");
  assert.equal((chamber.match(/setTimeout\(/g) ?? []).length, 2, "only the existing poller timer and display clock");
  assert.equal((chamber.match(/fetch\(/g) ?? []).length, 1, "still only the allowlisted GET /frame");
  const room = code("src/components/desk/CouncilRoomLite.tsx");
  assert.doesNotMatch(room, /fetch\(|setTimeout|setInterval|createPoller|useEffect/, "the room renders the button; it does not poll");
  const feed = code("src/lib/desk/council-room-feed.ts");
  assert.match(feed, /setPaused\(next\)/);
  assert.equal((feed.match(/deps\.setTimer\(/g) ?? []).length, 1, "one scheduling site in the poller");
});
