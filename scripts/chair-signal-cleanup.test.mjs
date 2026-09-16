import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/components/desk/ChairSignalGauge.css", import.meta.url), "utf8");

test("the Chair gauge hides its redundant threshold badge and bar blocker", () => {
  assert.match(css, /\.chair-signal \+ \.mt-2 > span:first-child/);
  assert.match(css, /span\[title\*="confluence bar"\]/);
  assert.match(css, /display: none/);
});
