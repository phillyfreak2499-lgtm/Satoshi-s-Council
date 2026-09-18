/**
 * The homepage WAIT strip: stillness with a scoreboard.
 *
 * Under a WAIT with no paper fill, the homepage prints the last graded
 * window and the books' last-7-days column, both from helpers /books already
 * uses. A missing input is an omitted line, never a dash. The block is
 * homepage-only: /desk and the chair-words sentence are untouched.
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

const { lastWindowFact, weekFact, stillFacts } = load("src/lib/desk/home-still.ts");
const { HomeStill } = load("src/components/desk/HomeStill.tsx");
const text = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");
/** Values cross a vm realm; compare structure, not prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const sat = { ticker: "KXBTC-26SEP1817-T115000", close_time: "2026-09-18T22:45:00.000Z", winner: "UP", official: 1, settle_avg: null, prints: null, call: null, seats: { n: 5, right: 3 }, raw: { n: 5, right: 3 }, arena: null, replay: true };
const filled = { ...sat, winner: "DOWN", call: { lean: "DOWN", entry: 61, settle: 100, ev: 34.6 } };
const week = { n: 660, calls: 60, wins: 54, net: 230, breakeven: 52.4 };

test("the last window prints a sit or a graded paper fill, never an invented one", () => {
  assert.deepEqual(plain(lastWindowFact(sat)), { id: "last", label: "Last window", text: "2026-09-18 22:45 UTC · sat · settled UP", href: "/window/KXBTC-26SEP1817-T115000", link: "Open the window" });
  assert.equal(lastWindowFact(filled).text, "2026-09-18 22:45 UTC · paper DOWN at 61¢, +34.6¢ after fee · settled DOWN");
  assert.equal(lastWindowFact({ ...filled, call: { ...filled.call, ev: null } }).text, "2026-09-18 22:45 UTC · paper DOWN at 61¢, not yet graded · settled DOWN");
  assert.equal(lastWindowFact(null), null);
  assert.equal(lastWindowFact({ ...sat, close_time: "not a time" }), null);
  assert.equal(lastWindowFact({ ...sat, ticker: "" }), null);
});

test("the week line is the books' own last-7-days column, with the needed rate only when it exists", () => {
  assert.deepEqual(plain(weekFact(week)), { id: "week", label: "Last 7 days", text: "+230.0¢ paper · 54 of 60 fills won · needs 52%", href: "/books", link: "Read the record" });
  assert.equal(weekFact({ ...week, breakeven: null }).text, "+230.0¢ paper · 54 of 60 fills won");
  assert.equal(weekFact({ n: 660, calls: 0, wins: 0, net: 0, breakeven: null }).text, "sat all 660 windows · no paper fills");
  assert.equal(weekFact({ n: 12, calls: 1, wins: 0, net: -41.5, breakeven: 61 }).text, "-41.5¢ paper · 0 of 1 fill won · needs 61%");
  assert.equal(weekFact(null), null);
  assert.equal(weekFact({ n: 0, calls: 0, wins: 0, net: 0, breakeven: null }), null, "an empty week is omitted, not a zero line");
  assert.equal(weekFact({ n: 5, calls: 2, wins: 1, net: Number.NaN, breakeven: null }), null);
});

test("missing facts are omitted; no dash soup", () => {
  assert.deepEqual(plain(stillFacts(null, null)), []);
  assert.deepEqual(plain(stillFacts(sat, null).map((f) => f.id)), ["last"]);
  assert.deepEqual(plain(stillFacts(null, week).map((f) => f.id)), ["week"]);
  assert.deepEqual(plain(stillFacts(sat, week).map((f) => f.id)), ["last", "week"]);
  assert.equal(renderToString(React.createElement(HomeStill, { last: null, week: null })), "");
  const html = renderToString(React.createElement(HomeStill, { last: sat, week }));
  assert.doesNotMatch(text(html), /—/);
  assert.match(text(html), /Last window · 2026-09-18 22:45 UTC · sat · settled UP Open the window →/);
  assert.match(text(html), /Last 7 days · \+230\.0¢ paper · 54 of 60 fills won · needs 52% Read the record →/);
  assert.match(html, /<a href="\/window\/KXBTC-26SEP1817-T115000">/);
  assert.match(html, /<a href="\/books">/);
});

test("the strip is homepage-only, shows under an unbooked window, and reuses the public helpers", () => {
  const home = read("src/components/desk/CouncilHome.tsx");
  assert.match(home, /const still = book !== null && book\.kind !== "booked" && stillFacts\(last, week\)\.length > 0;/);
  assert.match(home, /\{still \? <HomeStill last=\{last\} week=\{week\} \/> : null\}/);
  assert.match(home, /\{still \? <a href="\/books" className="company-text-link">Open the results/);
  assert.match(home, /plainLine\(chair, snap, book\)/, "the chair-words sentence stays");
  assert.match(home, /\{last && !still \? <>Last graded window ·/, "the small snapshot line does not repeat the fact");
  const route = read("src/routes/index.tsx");
  assert.match(route, /publicWeekBooks\(\)\.catch\(\(\) => null\)/);
  assert.match(route, /<CouncilHome last=\{last\} week=\{week\} \/>/);
  const pub = read("src/lib/desk/record-public.ts");
  assert.match(pub, /export const publicWeekBooks = createServerFn\(\{ method: "GET" \}\)/);
  assert.match(pub, /return booksColumn\(\(await booksSummary\(\)\)\.week\);/, "the same cells /books prints");
  assert.doesNotMatch(read("src/components/desk/DeskApp.tsx"), /HomeStill|stillFacts/, "/desk is unchanged");
  assert.doesNotMatch(read("src/lib/desk/chair-words.ts"), /HomeStill|stillFacts/);
});
