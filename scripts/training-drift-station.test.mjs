import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";\nimport vm from "node:vm";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const html = read("public/training-desk/drift/index.html");
const js = read("public/training-desk/drift/main.js");
const css = read("public/training-desk/drift/style.css");
const route = read("server/routes/training-drift-frame.get.ts");


test("DRIFT browser modules are syntactically valid", () => {
  assert.doesNotThrow(() => new vm.Script(js.replace(/^import .*?;\\n/, "")));
  const chart = read("public/training-desk/drift/chart.js").replace(/\\bexport\\s+/g, "");
  assert.doesNotThrow(() => new vm.Script(chart));
});

test("DRIFT keeps the six-screen school grammar with momentum-specific content", () => {
  for (const label of ["What do you see?", "Let me try", "Ask DRIFT", "The chart", "DRIFT’s notes", "Practice"]) {
    assert.ok(html.includes(label), "missing six-screen label: " + label);
  }
  assert.match(html, /DRIFT’S STATION/);
  assert.match(html, /5M \/ 15M \/ 30M/);
  assert.match(html, /MOMENTUM ALIGNMENT/);
  assert.match(html, /ILLUSTRATED \/ NOT LIVE/);
});

test("DRIFT has a visibly distinct physical desk without invented live evidence", () => {
  for (const prop of ["drift-chip-rack", "drift-photo", "drift-ruler", "drift-sticky"]) assert.ok(html.includes(prop), "missing desk prop " + prop);
  for (const chip of ["5M", "15M", "30M"]) assert.ok(html.includes(">" + chip + "<"), "missing timeframe chip " + chip);
  assert.match(html, /REFERENCE \/ ILLUSTRATED/);
  assert.match(html, /MOVE ≠ TREND/);
  assert.match(css, /\.drift-chip/);
  assert.match(css, /\.drift-photo/);
  assert.match(css, /\.drift-ruler/);
});

test("DRIFT live teaching is read-only and pauses around stale evidence", () => {
  assert.match(js, /fetch\("\/training-drift-frame"/);
  assert.match(js, /LIVE LESSON PAUSED/);
  assert.match(js, /isFresh\(f\)/);
  assert.match(js, /Mixed horizons are information/);
  assert.doesNotMatch(js + route, /method\s*:\s*["']POST|placeOrder|submitOrder|wallet|deposit/i);
  assert.doesNotMatch(route, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|recordSystemEvent|db\./i);
  assert.match(route, /cache-control": "no-store"/);
});

test("DRIFT practice grades momentum structure, not a promised outcome", () => {
  assert.match(html, /Grade the structure, not whether the next window happened to win/);
  assert.match(html, /teaching flag, not a Council rule/i);
  assert.match(js, /This grades the momentum structure, not the future settlement/);
  assert.match(html, /NOT FINANCIAL ADVICE/);
});
