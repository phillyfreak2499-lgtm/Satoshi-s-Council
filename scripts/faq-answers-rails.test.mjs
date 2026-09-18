/**
 * /faq — the answers are on the page.
 *
 * A stranger who views source, or reads without JavaScript, must find a real
 * answer under every question. The accordion may fold an answer away, never
 * drop it from the HTML, and the first three stay open on first paint.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const src = readFileSync(join(process.cwd(), "src/routes/faq.tsx"), "utf8");

test("every listed question carries a real answer, and no question was added", () => {
  const body = src.slice(src.indexOf("const QA"), src.indexOf("const OPEN_FIRST"));
  const items = body.split(/\n {2}\{\n/).slice(1);
  assert.equal(items.length, 11, "the eleven questions the page already listed, no more");
  for (const item of items) {
    const q = item.match(/q: "([^"]+)"/)?.[1];
    assert.ok(q, "each item names its question");
    const a = item.slice(item.indexOf("a:") + 2).replace(/<[^>]+>/g, "").replace(/[\s(),]+/g, " ").trim();
    assert.ok(a.length >= 80, `"${q}" has a real answer, not an empty panel (${a.length} chars)`);
    assert.doesNotMatch(a, /\bbuy\b|lock this|guaranteed|live order/i, `"${q}" stays paper-only`);
  }
});

test("the first three answers are open on first paint and closed ones stay in the HTML", () => {
  assert.match(src, /const OPEN_FIRST = \["q0", "q1", "q2"\];/);
  assert.match(src, /<Accordion\.Root type="multiple" defaultValue=\{OPEN_FIRST\}/);
  assert.match(src, /<Accordion\.Content forceMount /, "closed answers are rendered, not unmounted");
  assert.match(src, /data-\[state=closed\]:hidden/, "a closed answer is hidden, not missing");
});

test("the page keeps its footing: paper only, WAIT is a decision, no Kalshi affiliation", () => {
  assert.match(src, /No order is ever sent/);
  assert.match(src, /WAIT is the honest answer/);
  assert.match(src, /It has no relationship with Kalshi and places no orders anywhere/);
  assert.doesNotMatch(src, /\bbuy\b/i);
});
