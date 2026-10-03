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
