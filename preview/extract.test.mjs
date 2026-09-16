import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectComponent } from "./extract.mjs";

test("preview selects the real Chair markup without the desk engine or other panels", () => {
  const source = readFileSync("src/components/desk/SatoshiTab.tsx", "utf8");
  const selected = selectComponent(source, "SatoshiTab.tsx", "ChairBoard");
  assert.match(selected, /export function ChairBoard/);
  assert.match(selected, /function EconomicsBox/);
  assert.match(selected, /function PitChip/);
  assert.match(selected, /className="council-chair-summary"/);
  assert.doesNotMatch(selected, /useDesk|fetchBrief|ArenaPanel|server-engine|function ShadowChair/);
});

test("preview keeps price provenance from the original component", () => {
  const source = readFileSync("src/components/desk/FloorClarity.tsx", "utf8");
  const selected = selectComponent(source, "FloorClarity.tsx", "CallPrices");
  assert.match(selected, /export function CallPrices/);
  assert.match(selected, /function PriceCell/);
  assert.match(selected, /function clock/);
  assert.doesNotMatch(selected, /function CompactRecord|function EvidenceBlock/);
});

test("preview is non-indexable and prohibits data connections", () => {
  const html = readFileSync("preview/index.html", "utf8");
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
});

test("isolated preview scans the original production CSS classes", () => {
  const css = readFileSync("preview/tailwind.css", "utf8");
  assert.match(css, /@import "\.\.\/src\/styles\.css"/);
  assert.match(css, /@source "\.\.\/src"/);
});

test("Observatory reuses the real call and retains explicit demo boundaries", () => {
  const source = readFileSync("preview/Observatory.tsx", "utf8");
  assert.match(source, /import \{ ChairBoard \} from "@\/components\/desk\/SatoshiTab"/);
  assert.equal((source.match(/<ChairBoard /g) ?? []).length, 1);
  assert.match(source, /SYNTHETIC DATA · NOT A LIVE CALL/);
  assert.match(source, /21 stations does not mean 21 votes/);
  assert.match(source, /aria-pressed=\{focus\}/);
  assert.match(source, /<details className="obs-inspector">/);
  assert.doesNotMatch(source, /fetch\(|WebSocket|localStorage|beacon\(/);
  assert.match(readFileSync("preview/sample.ts", "utf8"), /source: "demo"/);
});

test("concept styles are scoped and respect reduced motion", () => {
  const css = readFileSync("preview/observatory.css", "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.observatory :focus-visible/);
  assert.match(css, /\.obs-skip:focus/);
  assert.match(css, /\.observatory \.council-chair-board/);
  assert.doesNotMatch(css, /url\(https?:|animation:[^;]*infinite/);
});

test("the immersive route is default and engineering controls stay separate", () => {
  const source = readFileSync("preview/main.tsx", "utf8");
  assert.match(source, /has\("qa"\) \? <PreviewControls \/> : <Observatory \/>/);
  const config = readFileSync("preview/vite.config.mjs", "utf8");
  assert.match(config, /conceptFiles: Object.fromEntries/);
  assert.match(config, /publicDir: false/);
  assert.match(config, /envDir: false/);
});
