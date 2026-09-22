/**
 * First-impression rails from the multi-reviewer UX audit.
 *
 * 1. ?view=pro is shareable and outranks the saved preference.
 * 2. The homepage paper-only line is a chip under the H1, not dim footnote type.
 * 3. The quiet-notice close control is a real ×, not the six-character escape text.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) =>
  read(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const APP = "src/components/desk/DeskApp.tsx";
const HOME = "src/components/desk/CouncilHome.tsx";
const NOTICE = "src/components/desk/ResearchQuietNotice.tsx";
const CSS = "src/components/desk/company-design.css";

test("?view=pro pins Pro and the homepage Pro door names that URL", () => {
  const app = codeOf(APP);
  const pin = app.slice(app.indexOf("function urlPinsFloorMode"), app.indexOf("const NAV_TAB ="));
  assert.match(pin, /get\("view"\) === "pro"/, "?view=pro pins Pro against the saved preference");
  assert.match(pin, /get\("view"\) === "guided"/, "?view=guided still pins Guided");
  assert.match(app, /searchParams\.set\("view", floorMode\)/, "the address keeps the view that is on screen");
  const home = read(HOME);
  assert.match(home, /href="\/desk\?view=pro"/, "Open Pro Floor is a shareable Pro link");
  assert.match(home, /href="\/desk\?view=guided"/, "Guided keeps its own door");
});

test("the paper-only line is a chip under the H1, above the CTAs, at body contrast", () => {
  const home = read(HOME);
  const h1 = home.indexOf('id="home-title"');
  const chip = home.indexOf("company-hero-chip");
  const actions = home.indexOf('className="company-actions"');
  assert.ok(h1 > 0 && chip > h1 && actions > chip, "chip sits between the H1 and the two doors");
  assert.match(home, /Paper research\. Public prices\. No live orders\. · Not affiliated with Kalshi\./);
  const chipBlock = home.slice(home.indexOf("company-hero-chip"), actions);
  assert.doesNotMatch(chipBlock, /Start with WICK/, "WICK is not inside the chip");
  assert.match(home, /className="company-hero-note"/);
  assert.match(home.slice(actions), /Start with WICK/, "WICK sits on its own line after the doors");
  const css = read(CSS);
  assert.match(css, /\.company-hero-chip\s*\{/);
  assert.match(css, /\.company-hero-chip[\s\S]{0,280}color:\s*var\(--company-ink\)/);
});

test("the quiet-notice dismiss glyph is a multiplication sign, not an escape sequence", () => {
  const src = read(NOTICE);
  assert.match(src, /aria-label="Dismiss"/);
  const raw = "\\" + "u00d7";
  const jsxTextLine = src.split("\n").some((line) => line.trim() === raw);
  assert.equal(jsxTextLine, false, "the six-character sequence must not be JSX text");
  const jsNeedle = "{\"" + raw + "\"}";
  assert.ok(src.includes(jsNeedle) || src.includes("×"), "the close control renders ×");
});
