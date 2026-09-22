/**
 * Audit 11 + 12: Gallery is one name and one URL; Arena gates entry as paper.
 * Presentation only. Does not change Chair, book, or policy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

function load(rel) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports });
  return exports;
}

test("Gallery public chrome drops SIGNAL and uses /gallery", () => {
  const gallery = read("src/components/atelier/gallery.tsx");
  const catalog = read("src/lib/atelier/catalog.ts");
  const nav = read("src/lib/desk/navigation.ts");
  const route = read("src/routes/gallery.tsx");
  assert.match(gallery, /Gallery /);
  assert.doesNotMatch(gallery, /Signal Gallery/);
  assert.doesNotMatch(catalog, /Signal Veil|Signal Current|SIGNAL VEIL|SIGNAL GALLERY/);
  assert.match(catalog, /name: "Veil"/);
  assert.match(catalog, /name: "Current"/);
  assert.match(nav, /href: "\/gallery"/);
  assert.match(nav, /label: "Gallery"/);
  assert.doesNotMatch(nav, /href: "\/\?tab=atelier"/);
  assert.match(route, /createFileRoute\("\/gallery"\)/);
  assert.match(route, /\/\?tab=atelier/);
  assert.match(nav, /label: "Support"/);
});

test("old atelier bookmarks still light the Gallery item", () => {
  const { sitePathActive } = load("src/lib/desk/navigation.ts");
  assert.equal(sitePathActive("/", "/gallery", "?tab=atelier&room=streamer"), true);
  assert.equal(sitePathActive("/desk", "/gallery", "?tab=atelier"), true);
  assert.equal(sitePathActive("/gallery", "/gallery"), true);
  assert.equal(sitePathActive("/lab", "/gallery", "?tab=atelier"), false);
  assert.equal(sitePathActive("/", "/?tab=atelier", "?tab=atelier&room=streamer"), true);
});

test("Arena entry requires the paper acknowledgement and labels Kalshi tickers", () => {
  const { ARENA_ACK, KALSHI_NONAFFILIATION } = load("src/lib/desk/arena-gate.ts");
  assert.match(ARENA_ACK, /paper calls/);
  assert.match(ARENA_ACK, /No money, no account, no orders/);
  assert.match(ARENA_ACK, /SATOSHI/);
  assert.doesNotMatch(ARENA_ACK, /\bbuy\b|\bbet\b/i);
  assert.equal(KALSHI_NONAFFILIATION, "Not affiliated with Kalshi.");
  const room = read("src/components/desk/PitRoom.tsx");
  const tour = read("src/components/desk/PitTour.tsx");
  assert.match(room, /ARENA_ACK/);
  assert.match(room, /disabled=\{!acked\}/);
  assert.match(room, /KALSHI_NONAFFILIATION/);
  assert.match(room, /\{w\.ticker\}/);
  assert.match(tour, /title: "Paper only"/);
  assert.match(tour, /ARENA_ACK/);
  assert.match(tour, /PIT_STEPS\.length/);
});
