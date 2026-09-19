/**
 * The public training index names only open stations and prints clean copy.
 *
 * Renders TrainingHome the way the server does (renderToString), so the
 * assertions see the exact HTML a visitor's tools see. A label built from
 * adjacent JSX text nodes ("Enter ", name, "'s station") ships with React's
 * "<!-- -->" separators between them, which text extractors print as spaces:
 * "Enter TAPE 's station", "0 1". Each label must be a single text node.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");

function load(rel, deps) {
  const source = readFileSync(join(process.cwd(), rel), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => deps[id] ?? require(id) });
  return exports;
}

const training = load("src/lib/desk/training.ts", {});
const { screenNumber } = training;
const { TrainingHome } = load("src/components/desk/TrainingHome.tsx", {
  "@/lib/desk/training": training,
  "./PaperDisclaimer": { PaperDisclaimer: () => null },
});
const html = renderToString(React.createElement(TrainingHome));
const text = html.replace(/<!--.*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("screen numbers are two digits from one formatter", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(screenNumber), ["01", "02", "03", "04", "05", "06"]);
  for (const n of ["01", "02", "03", "04", "05", "06"]) assert.match(html, new RegExp(`<span[^>]*>${n}</span>`), `screen ${n} is one text node`);
  assert.doesNotMatch(text, /\b0 [1-6]\b/, "no split '0 1' artifact");
});

test("every enter link is one text node with a proper apostrophe", () => {
  const links = [...html.matchAll(/<a [^>]*href="\/training\/([a-z]+)"[^>]*>(.*?)<\/a>/g)];
  assert.deepEqual(links.map((m) => m[1]), ["wick", "tape", "drift"], "only open stations are enterable");
  for (const [, id, label] of links) {
    assert.equal(label, `Enter ${id.toUpperCase()}’s station ↗`);
    assert.doesNotMatch(label, /<!--/, "no comment separator inside the label");
  }
  assert.doesNotMatch(text, /\s['’]s station/, "no space before the apostrophe");
  assert.doesNotMatch(html, /[A-Z]'s/, "curly apostrophe only");
});

test("no planned-station cards; one quiet line instead", () => {
  assert.doesNotMatch(html, /PLANNED|NOT OPEN YET|coming soon/i);
  assert.doesNotMatch(html, /\bODDS\b|\bWIRE\b/, "unopened seats are not named");
  assert.doesNotMatch(html, /next-coaches|More seats to learn from/);
  assert.equal((html.match(/More seats will teach from the same desk later\./g) ?? []).length, 1);
  assert.match(html, /Also open/);
  assert.match(html, /AVAILABLE NOW · GUIDED COACH/);
});

test("stations for open coaches still resolve", () => {
  assert.equal(training.availableCoach("wick")?.name, "WICK");
  assert.equal(training.availableCoach("tape")?.name, "TAPE");
  assert.equal(training.availableCoach("drift")?.name, "DRIFT");
  assert.equal(training.availableCoach("odds"), undefined);
});
