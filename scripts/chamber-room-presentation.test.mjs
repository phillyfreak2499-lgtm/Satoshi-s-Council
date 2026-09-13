import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const room = fs.readFileSync("src/components/desk/ChamberRoom.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");

test("Chamber stage preserves the accepted institutional room composition", () => {
  assert.match(room, /Council room/);
  assert.match(room, /The 21 Council seats/);
  assert.match(room, /THE LAB/);
  assert.match(room, /OPERATIONS/);
  assert.match(room, /SATOSHI/);
  assert.match(room, /SEAT_IDS\.map/);
  assert.match(css, /\.chamber-seat-ring/);
  assert.match(css, /perspective:/);
});

test("room activity is sourced from Chamber statements and remains read-only", () => {
  assert.match(room, /latest\?\.speaker/);
  assert.match(room, /latest\?\.text/);
  assert.match(room, /listChamberSpeech/);
  assert.doesNotMatch(room, /recordSystemEvent|system-events\.server|method:\s*["']POST["']/);
  assert.doesNotMatch(room, /runChair|noteCall|paperBookEdgeOk|promoteToLive/);
});

test("the stage has an honest quiet state and reduced-motion treatment", () => {
  assert.match(room, /The room is quiet\./);
  assert.match(room, /No evidence-backed dispatch/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("the cinematic room is shelved without deleting its restoration path", () => {
  assert.match(room, /const SHOW_CINEMATIC_ROOM = false/);
  assert.match(room, /SHOW_CINEMATIC_ROOM \? <RoomStage/);
  assert.match(room, /function RoomStage/);
  assert.match(room, /CAMERA_VIEWS/);
});

test("live exchanges use distinct compact speaker portraits instead of letter tiles", () => {
  assert.match(room, /className="chamber-speaker-mark"/);
  assert.match(room, /className="chamber-speaker-portrait"/);
  assert.match(room, /<Radar className="chamber-speaker-glyph"/);
  assert.doesNotMatch(room, /speaker === "ALCHEMIST" \? "A"/);
  assert.match(css, /CHAMBER CONVERSATION MODE/);
  assert.match(css, /url\("\/chamber\/cast-v1\.webp"\)/);
  assert.match(css, /data-speaker="ALCHEMIST"/);
  assert.match(css, /data-speaker="WARDEN"/);
  assert.match(css, /data-speaker="SWEEP"/);
});

