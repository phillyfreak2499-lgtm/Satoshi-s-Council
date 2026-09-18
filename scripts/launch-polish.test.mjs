import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const security = read("server/middleware/security-headers.ts");
const prefs = read("src/components/desk/prefs.ts");
const app = read("src/components/desk/DeskApp.tsx");
const floor = read("src/components/desk/SatoshiTab.tsx");
const arena = read("src/components/desk/PitRoom.tsx");
const welcome = read("src/components/desk/Welcome.tsx");
const legal = read("src/routes/legal.tsx");

test("public responses ship the baseline browser security policy", () => {
  assert.match(security, /default-src 'self'/);
  assert.match(security, /frame-ancestors 'none'/);
  assert.match(security, /strict-transport-security/);
  assert.match(security, /max-age=31536000/);
  assert.match(security, /x-frame-options/);
  assert.match(security, /DENY/);
  assert.match(security, /x-content-type-options/);
  assert.match(security, /nosniff/);
  assert.match(security, /fonts\.googleapis\.com/);
  assert.match(security, /www\.googletagmanager\.com/);
});

test("the Floor opens quietly and remembers a deliberate Full desk choice", () => {
  assert.match(prefs, /export type FloorDensity = "quiet" \| "full"/);
  assert.match(prefs, /=== "full" \? "full" : "quiet"/);
  assert.match(prefs, /localStorage\.setItem/);
  assert.match(app, /useState<FloorDensity>\("quiet"\)/);
  assert.match(app, /setFloorDensityState\(readFloorDensity\(\)\)/);
  assert.match(app, /density=\{floorDensity\}/);
  assert.match(app, /onDensityChange=\{setFloorDensity\}/);
  assert.match(floor, /Quiet keeps the call, reason, clock and live Bitcoin-vs-strike view/);
  assert.match(floor, /Full adds evidence, record, council and diagnostics/);
  assert.match(floor, /density === "full" \? <OvernightRibbon/);
  assert.match(floor, /density === "full" && strip/);
  assert.match(floor, /onDensityChange\(choice\)/);
});

test("launch polish covers desktop Arena, touch onboarding and legal truth", () => {
  assert.match(arena, /lg:max-w-3xl/);
  assert.match(welcome, /Tap × or Watch the floor to close/);
  assert.match(welcome, /hidden sm:inline">Esc opens the floor/);
  assert.match(legal, /pageHead\("\/legal",/);
  assert.match(legal, /Last updated September 18, 2026/);
  assert.match(legal, /Google Analytics 4/);
  assert.match(legal, /Google Fonts/);
  assert.match(legal, /United States audience/);
});
