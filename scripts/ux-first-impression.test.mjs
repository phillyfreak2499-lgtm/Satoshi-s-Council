/**
 * First-impression rails from the multi-reviewer UX audit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { floorModeFromSearch } from "../src/lib/desk/floor-view-url.ts";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

const HOME = "src/components/desk/CouncilHome.tsx";
const NOTICE = "src/components/desk/ResearchQuietNotice.tsx";
const CHIP = "src/components/desk/hero-chip.css";
const APP = "src/components/desk/DeskApp.tsx";

test("?view=pro pins Pro and the homepage Pro door names that URL", () => {
  assert.equal(floorModeFromSearch("?view=pro"), "pro");
  assert.equal(floorModeFromSearch("?view=guided"), "guided");
  assert.equal(floorModeFromSearch("?tab=books"), "pro");
  assert.equal(floorModeFromSearch("?seat=INDEX"), "pro");
  assert.equal(floorModeFromSearch(""), null);
  const home = read(HOME);
  assert.match(home, /href="\/desk\?view=pro"/);
  assert.match(home, /href="\/desk\?view=guided"/);
  const app = read(APP);
  assert.match(app, /function urlPinsFloorMode/);
});

test("the paper-only line is a chip under the H1, above the CTAs, at body contrast", () => {
  const home = read(HOME);
  const h1 = home.indexOf('id="home-title"');
  const chip = home.indexOf("company-hero-chip");
  const actions = home.indexOf('className="company-actions"');
  assert.ok(h1 > 0 && chip > h1 && actions > chip);
  assert.match(home, /Paper research\. Public prices\. No live orders\. · Not affiliated with Kalshi\./);
  assert.doesNotMatch(home.slice(chip, actions), /Start with WICK/);
  assert.match(home.slice(actions), /Start with WICK/);
  const css = read(CHIP);
  assert.match(css, /\.company-hero-chip\s*\{/);
  assert.match(css, /color:\s*var\(--company-ink\)/);
});

test("the quiet-notice dismiss glyph is a multiplication sign, not an escape sequence", () => {
  const src = read(NOTICE);
  assert.match(src, /aria-label="Dismiss"/);
  const raw = "\\" + "u00d7";
  assert.equal(src.split("\n").some((line) => line.trim() === raw), false);
  assert.ok(src.includes("×") || src.includes("{\"" + raw + "\"}"));
});
