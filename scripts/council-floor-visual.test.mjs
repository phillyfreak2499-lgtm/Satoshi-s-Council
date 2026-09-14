import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

test("the live Floor is staged inside the Council chamber without replacing live data", () => {
  const component = readFileSync("src/components/desk/SatoshiTab.tsx", "utf8");
  const room = readFileSync("src/components/desk/CouncilFloorRoom.tsx", "utf8");
  const css = readFileSync("src/styles.css", "utf8");
  const asset = "public/floor/council-chamber-v1.webp";

  assert.match(component, /<CouncilFloorRoom lean=\{chair\.lean\}/);
  assert.match(room, /className="council-floor-room"/);
  assert.match(component, /<ChairBoard snap=\{snap\}/);
  assert.match(room, /data-lean=\{lean\.toLowerCase\(\)\}/);
  assert.match(css, /url\("\/floor\/council-chamber-v1\.webp"\)/);
  assert.ok(existsSync(asset), "the chamber environment plate must ship");
  assert.ok(statSync(asset).size < 180_000, "the first-screen environment plate stays lightweight");
});
