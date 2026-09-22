/**
 * The legal stack stays one page and answers three stranger questions:
 * what "paper only" means, how data is used, and how to reach the desk.
 *
 * The domain publishes no mail exchanger, so no address is printed: the
 * Board is the only contact and the page says so. The shared footer on the
 * homepage and the Live Floor carries the "Paper only · FAQ · Legal" chrome
 * with links to /legal, /faq and /board.
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
const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

function load(rel, deps = {}) {
  const code = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => deps[id] ?? require(id) });
  return exports;
}

const legal = read("src/routes/legal.tsx");

test("/legal keeps every paper-only paragraph and adds contact and cookies in plain words", () => {
  for (const heading of ["No orders, no accounts", "Not financial advice", "Not affiliated with Kalshi", "Data and delays", "Cookies and analytics", "Audience and jurisdiction", "Your data", "Contact"]) {
    assert.ok(legal.includes(`<H2>${heading}</H2>`), `section: ${heading}`);
  }
  assert.doesNotMatch(legal, /<H2>Analytics and fonts<\/H2>/, "renamed, not duplicated");
  assert.match(legal, /Google Analytics 4 for aggregate visits and Google Fonts for Geist and IBM Plex Mono\. Ordinary request details \(IP, browser, page\) go to\s+those providers\. There is no advertising cookie wall and no account\./);
  assert.match(legal, /Questions about the desk: post on the Board at <a href="\/board"[^>]*>\/board<\/a>\. The Board is the\s+only contact\./);
  assert.doesNotMatch(legal, /mailto:|@satoshiscouncil\.com|@gmail\.com/, "no unconfirmed inbox is printed");
  assert.match(legal, /The desk can hide a callsign that breaks house rules\. Paper results\s+stay on the private record\./, "Arena house rule kept");
  assert.match(legal, /Last updated September 18, 2026/);
});

test("the shared footer prints Paper only · FAQ · Legal and links /legal, /faq and /board", () => {
  const { PaperDisclaimer } = load("src/components/desk/PaperDisclaimer.tsx");
  const html = renderToString(React.createElement(PaperDisclaimer));
  const text = html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");
  assert.match(text, /Paper only · FAQ · Legal/);
  for (const href of ["/legal", "/faq", "/board"]) assert.match(html, new RegExp(`<a href="${href}"`), `link to ${href}`);
  assert.match(html, /<a href="\/legal"[^>]*>Legal<\/a>/, "Legal is named, not only described");
  assert.match(text, /Paper research only · Bitcoin only · No live orders · Not financial advice · Not affiliated with Kalshi/);
});

test("the homepage and the Live Floor render that footer", () => {
  assert.match(read("src/components/desk/CouncilHome.tsx"), /<PaperDisclaimer \/>/);
  assert.match(read("src/components/desk/DeskApp.tsx"), /<PaperDisclaimer \/>/);
  assert.match(read("src/routes/index.tsx"), /<CouncilHome last=\{last\}/);
  // The route may pass props; what this rail protects is that it renders the
  // component that carries the disclaimer.
  assert.match(read("src/routes/desk.tsx"), /<DeskApp[\s/]/);
});
