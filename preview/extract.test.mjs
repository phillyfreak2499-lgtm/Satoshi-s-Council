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
