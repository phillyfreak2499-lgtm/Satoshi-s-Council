import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const room = fs.readFileSync("src/components/desk/ChamberRoom.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const castPath = "public/chamber/cast-v1.webp";

test("the cinematic cast asset is present and performance-budgeted", () => {
  assert.equal(fs.existsSync(castPath), true);
  const cast = fs.readFileSync(castPath);
  assert.equal(cast.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(cast.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(cast.byteLength > 20_000, "cast art unexpectedly small");
  assert.ok(cast.byteLength < 150_000, "cast art exceeds the 150 KB room budget");
  assert.match(css, /url\(["']\/chamber\/cast-v1\.webp["']\)/);
});

test("camera cuts are explicit presentation controls", () => {
  assert.match(room, /CAMERA_VIEWS/);
  assert.match(room, /\["overview", "Overview"\]/);
  assert.match(room, /\["chair", "Chair"\]/);
  assert.match(room, /\["lab", "Lab"\]/);
  assert.match(room, /\["operations", "Operations"\]/);
  assert.match(room, /aria-label="Council room camera"/);
  assert.match(room, /aria-pressed=\{view === id\}/);
  assert.match(room, /data-view=\{view\}/);
  assert.match(css, /\.chamber-stage\[data-view="chair"\]/);
  assert.match(css, /\.chamber-stage\[data-view="lab"\]/);
  assert.match(css, /\.chamber-stage\[data-view="operations"\]/);
});

test("the cinematic layer stays downstream and motion-safe", () => {
  assert.match(room, /latest\?\.speaker/);
  assert.match(room, /latest\?\.text/);
  assert.match(room, /SEAT_IDS\.map/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /html\[data-motion="reduce"\] \.chamber-scene/);
  assert.doesNotMatch(room, /recordSystemEvent|system-events\.server|method:\s*["']POST["']/);
  assert.doesNotMatch(room, /runChair|noteCall|paperBookEdgeOk|promoteToLive/);
});
