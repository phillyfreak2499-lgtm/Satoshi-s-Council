/**
 * The homepage WAIT strip: the call, the reason, and one line of proof.
 *
 * Under a WAIT with no paper fill, the homepage prints the last graded
 * window from the helper /books already uses. A missing window is an
 * omitted line, never a dash. No week net, no win rate, no needed rate:
 * the front door is not a scoreboard. The block is homepage-only.
 *
 * When the last grade sat, preferFilledFact surfaces the last recorded
 * paper fill so a sit streak does not look like an empty book.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");
const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

/** Transpile a source module and its relative/alias imports on demand; type-only imports are elided by tsc. */
function load(rel, extra = {}) {
  const cache = new Map();
  const resolveId = (from, id) => {
    const base = id.startsWith("@/") ? join(process.cwd(), "src", id.slice(2)) : resolve(dirname(from), id);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.ts$/, ".tsx")]) if (existsSync(candidate) && !candidate.endsWith("/")) return candidate;
    throw new Error(`cannot resolve ${id} from ${from}`);
  };
  const run = (file) => {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    cache.set(file, exports);
    vm.runInNewContext(code, { exports, require: (id) => extra[id] ?? (id.startsWith(".") || id.startsWith("@/") ? run(resolveId(file, id)) : require(id)) });
    return exports;
  };
  return run(join(process.cwd(), rel));
}

const { lastWindowFact, lastFilledFact, preferFilledFact } = load("src/lib/desk/home-still.ts");
const { HomeStill } = load("src/components/desk/HomeStill.tsx");
const text = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");
/** Values cross a vm realm; compare structure, not prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value));
/** Anything that would turn the front door into a scoreboard. */
const SCOREBOARD = /Last 7 days|of \d+ fills?|needs \d+%|breakeven|win rate|Open the results|sat all|no paper fills/i;

const sat = { ticker: "KXBTC-26SEP1817-T115000", close_time: "2026-09-18T22:45:00.000Z", winner: "UP", official: 1, settle_avg: null, prints: null, call: null, seats: { n: 5, right: 3 }, raw: { n: 5, right: 3 }, arena: null, replay: true };
const filled = { ...sat, winner: "DOWN", call: { lean: "DOWN", entry: 61, settle: 100, ev: 34.6 } };

test("the last window prints a sit or a graded paper fill, never an invented one", () => {
  assert.deepEqual(plain(lastWindowFact(sat)), { label: "Last window", text: "2026-09-18 22:45 UTC · sat · settled UP", href: "/window/KXBTC-26SEP1817-T115000" });
  assert.equal(lastWindowFact(filled).text, "2026-09-18 22:45 UTC · paper DOWN at 61¢, +34.6¢ after fee · settled DOWN");
  assert.equal(lastWindowFact({ ...filled, call: { ...filled.call, ev: null } }).text, "2026-09-18 22:45 UTC · paper DOWN at 61¢, not yet graded · settled DOWN");
  assert.equal(lastWindowFact({ ...sat, ticker: "" }).href, "/books", "no ticker: the line links to the books");
  assert.equal(lastWindowFact(null), null);
  assert.equal(lastWindowFact(undefined), null);
  assert.equal(lastWindowFact({ ...sat, close_time: "not a time" }), null);
  assert.equal(lastWindowFact({ ...sat, winner: "TIE" }), null);
});

test("lastFilledFact skips sits and labels a recorded side as a paper fill", () => {
  assert.equal(lastFilledFact(sat), null);
  assert.equal(lastFilledFact(null), null);
  assert.deepEqual(plain(lastFilledFact(filled)), {
    label: "Last paper fill",
    text: "2026-09-18 22:45 UTC · paper DOWN at 61¢, +34.6¢ after fee · settled DOWN",
    href: "/window/KXBTC-26SEP1817-T115000",
  });
});

test("preferFilledFact keeps a live fill, else shows the last recorded fill, else the sit", () => {
  assert.equal(preferFilledFact(filled, sat).label, "Last window");
  assert.equal(preferFilledFact(sat, filled).label, "Last paper fill");
  assert.equal(preferFilledFact(sat, sat).label, "Last window");
  assert.equal(preferFilledFact(sat, null).text, "2026-09-18 22:45 UTC · sat · settled UP");
  assert.equal(preferFilledFact(null, filled).label, "Last paper fill");
  assert.equal(preferFilledFact(null, null), null);
});

test("a missing window is an omitted line; a present one is a single linked line with no dash", () => {
  assert.equal(renderToString(React.createElement(HomeStill, { last: null })), "");
  const html = renderToString(React.createElement(HomeStill, { last: sat }));
  assert.equal(text(html), "Last window · 2026-09-18 22:45 UTC · sat · settled UP");
  assert.doesNotMatch(text(html), /—/);
  assert.match(html, /<a href="\/window\/KXBTC-26SEP1817-T115000">2026-09-18 22:45 UTC · sat · settled UP<\/a>/);
  assert.equal((html.match(/<a /g) ?? []).length, 1, "one link, no second CTA");
  const preferred = renderToString(React.createElement(HomeStill, { last: sat, fill: filled }));
  assert.equal(text(preferred), "Last paper fill · 2026-09-18 22:45 UTC · paper DOWN at 61¢, +34.6¢ after fee · settled DOWN");
});

test("no week P&L, win rate or needed rate reaches the homepage block", () => {
  for (const last of [sat, filled, null]) assert.doesNotMatch(renderToString(React.createElement(HomeStill, { last })), SCOREBOARD);
  assert.doesNotMatch(read("src/components/desk/HomeStill.tsx"), SCOREBOARD);
  assert.doesNotMatch(read("src/lib/desk/home-still.ts"), SCOREBOARD);
  assert.doesNotMatch(read("src/lib/desk/home-still.ts"), /BooksColumn|BooksTotals|week/i, "the helper never reads the week column");
  const home = read("src/components/desk/CouncilHome.tsx");
  assert.doesNotMatch(home, /week|publicWeekBooks|HomeStill last=\{last\} week/i);
  assert.doesNotMatch(home.slice(home.indexOf("company-live-context"), home.indexOf("company-live-numbers")), /href="\/books"/, "no second homepage CTA beside the decision");
  assert.doesNotMatch(read("src/routes/index.tsx"), /publicWeekBooks|week/);
  assert.doesNotMatch(read("src/lib/desk/record-public.ts"), /publicWeekBooks/, "the week helper added only for the strip is gone");
});

test("the strip is homepage-only, shows under an unbooked window, and keeps the reason and the /desk link", () => {
  const home = read("src/components/desk/CouncilHome.tsx");
  assert.match(home, /const still = book !== null && book\.kind !== "booked" && lastWindowFact\(last\) !== null;/);
  assert.match(home, /\{still \? <HomeStill last=\{last\} fill=\{fill\} \/> : null\}<a href="\/desk" className="company-text-link">Read the full decision/);
  assert.match(home, /plainLine\(chair, snap, book\)/, "the chair-words sentence stays");
  assert.match(home, /\{last && !still \? <>Last graded window ·/, "the small snapshot line does not repeat the fact");
  assert.match(read("src/routes/index.tsx"), /<CouncilHome last=\{last\} fill=\{fill\} \/>/);
  assert.match(read("src/routes/index.tsx"), /publicLastFill/);
  assert.match(read("src/lib/desk/record-public.ts"), /export const publicLastFill/);
  assert.match(read("src/lib/desk/last-fill.server.ts"), /export async function lastFilledWindow/);
  assert.doesNotMatch(read("src/components/desk/DeskApp.tsx"), /HomeStill|lastWindowFact/, "/desk is unchanged");
  assert.doesNotMatch(read("src/lib/desk/chair-words.ts"), /HomeStill|lastWindowFact/);
});

test("first-use glossary keys exist for the jargon the audits flagged", () => {
  const { firstUseOf } = load("src/lib/desk/first-use-gloss.ts");
  for (const k of ["term.window", "term.chair", "term.paper-fill", "term.directional-read", "term.sat", "term.wait", "term.confluence", "term.sit-mass", "term.gold", "term.sweep", "term.brier"]) {
    assert.ok(firstUseOf(k), k);
  }
  const guided = read("src/components/desk/GuidedFloor.tsx");
  assert.match(guided, /<Tip k="term.wait">/);
  assert.match(guided, /<Tip k="term.window">/);
  assert.match(guided, /<Tip k="term.chair">/);
  assert.match(guided, /<Tip k="term.paper-fill">/);
});
