import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const room = fs.readFileSync("src/components/desk/ChamberRoom.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const castPath = "public/chamber/cast-v1.webp";
const architecturePath = "public/chamber/architecture-v1.webp";

test("the cinematic cast asset is present and performance-budgeted", () => {
  assert.equal(fs.existsSync(castPath), true);
  const cast = fs.readFileSync(castPath);
  assert.equal(cast.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(cast.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(cast.byteLength > 20_000, "cast art unexpectedly small");
  assert.ok(cast.byteLength < 150_000, "cast art exceeds the 150 KB room budget");
  assert.match(css, /url\(["']\/chamber\/cast-v1\.webp["']\)/);
});


test("the room plate is an optimized decorative architecture layer", () => {
  assert.equal(fs.existsSync(architecturePath), true);
  const plate = fs.readFileSync(architecturePath);
  assert.equal(plate.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(plate.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(plate.byteLength > 40_000, "room plate unexpectedly small");
  assert.ok(plate.byteLength < 150_000, "room plate exceeds the 150 KB room budget");
  assert.match(css, /url\(["']\/chamber\/architecture-v1\.webp["']\)/);
  assert.match(css, /\.chamber-scene::before/);
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
  assert.match(css, /translate3d\(40%, 0, 0\)/);
  assert.match(css, /translate3d\(-40%, 0, 0\)/);
  assert.match(css, /\.chamber-dais-mark\s*\{\s*display:\s*none/);
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


test("the spatial pass anchors the 21 seats and protects portrait composition", () => {
  assert.match(room, /className="chamber-vault"/);
  assert.match(room, /className="chamber-aisle"/);
  assert.match(room, /--seat-scale/);
  assert.match(room, /--seat-turn/);
  assert.match(room, /--seat-z/);
  assert.match(room, /className="chamber-seat-screen"/);
  assert.match(room, /Council seat \$\{seatNumber\}/);
  assert.match(css, /\.chamber-seat-ring::before/);
  assert.match(css, /rotateZ\(var\(--seat-turn\)\)/);
  assert.match(css, /@media \(max-aspect-ratio: 1 \/ 1\)/);
  assert.match(css, /\.chamber-stage-foot span:nth-child\(2\)/);
  assert.match(css, /\.chamber-seat-name\s*\{\s*display:\s*none/);
});


test("camera pans keep the architectural shell fixed to the viewport", () => {
  assert.match(css, /\.chamber-world::before\s*\{[\s\S]*?display:\s*block/);
  assert.match(css, /\.chamber-world::before\s*\{[\s\S]*?architecture-v1\.webp/);
  assert.match(css, /\.chamber-scene::before,\s*\.chamber-scene::after\s*\{\s*background:\s*none/);
});


test("the Council ring reads as occupied stations without inventing state", () => {
  assert.match(room, /const activeSeat = latest\?\.evidence\.seat/);
  assert.match(room, /data-active=\{activeSeat === String\(seat\)\.toUpperCase\(\)/);
  assert.match(room, /"--seat-top": `\$\{23 \+ 54 \* arcDepth\}%`/);
  assert.match(css, /\.chamber-seat::before/);
  assert.match(css, /\.chamber-seat::after/);
  assert.match(css, /\.chamber-seat\[data-active="true"\]/);
  assert.match(css, /\.chamber-world::after/);
  assert.match(css, /@media \(max-aspect-ratio: 1 \/ 1\)/);
  assert.doesNotMatch(room, /Math\.random|mockSeat|fakeVote/);
});
