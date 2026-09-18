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

test("Quiet density compacts the room without unmounting the call or adding navigation", () => {
  const component = readFileSync("src/components/desk/SatoshiTab.tsx", "utf8");
  const room = readFileSync("src/components/desk/CouncilFloorRoom.tsx", "utf8");
  const css = readFileSync("src/styles.css", "utf8");
  assert.match(component, /<CouncilFloorRoom lean=\{chair\.lean\} density=\{density\}>/);
  assert.match(component, /<ChairBoard snap=\{snap\}[^>]*density=\{density\}/);
  assert.match(room, /data-density=\{density\}/);
  assert.match(css, /\.council-floor-room\[data-density="quiet"\]\s*\{\s*padding-top: 78px;/);
  assert.equal((component.match(/<ChairBoard\s/g) ?? []).length, 1);
  assert.equal((component.match(/<CallPrices\s/g) ?? []).length, 1);
  assert.match(component, /<details className="council-chair-evidence">[\s\S]*?<summary>View evidence[\s\S]*?Prices, fees &amp; timestamps[\s\S]*?<\/summary>[\s\S]*?<EconomicsBox[\s\S]*?<CallPrices[\s\S]*?<\/details>/);
  assert.ok(component.indexOf("<CallPrices") > component.indexOf('id="chair-stage"'));
});

test("Chair verdict sizing does not compete with the lean color utility", () => {
  const component = readFileSync("src/components/desk/SatoshiTab.tsx", "utf8");
  const css = readFileSync("src/styles.css", "utf8");
  const heading = component.match(/<h1 className=\{cn\("council-chair-verdict[^\n]+/);
  assert.ok(heading, "the call has an explicit, scoped size class");
  assert.doesNotMatch(heading[0], /text-hero/);
  assert.match(heading[0], /tone\)/);
  assert.match(css, /\.council-chair-verdict\s*\{[^}]*font-size: clamp\(48px, 6vw, 72px\);/);
  assert.match(component, /className="council-chair-clock-value font-mono tabular">\s*<span>\{countdown\}<\/span>/);
  assert.match(css, /\.council-chair-evidence > summary:focus-visible/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.council-chair-metrics/);
});

test("Streamer labels station readings separately from the Chair voting quorum", () => {
  const component = readFileSync("src/components/atelier/streamer.tsx", "utf8");
  const css = readFileSync("src/components/atelier/streamer.css", "utf8");
  assert.match(component, /Seat readings · \{total\} stations/);
  assert.match(component, /All stations · not the Chair’s voting quorum/);
  assert.doesNotMatch(component, /Council votes ·/);
  assert.match(component, /The feed is delayed\. Showing the last received readings\./);
  assert.match(css, /@container \(max-width: 900px\)/);
  assert.match(css, /\.streamer-join:focus-visible/);
});
