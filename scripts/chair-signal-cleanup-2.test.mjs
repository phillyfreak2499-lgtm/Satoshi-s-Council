import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const css=readFileSync(new URL("../src/components/desk/ChairSignalGauge.css",import.meta.url),"utf8");
test("gauge owns threshold status",()=>{assert.match(css,/chair-signal \+ \.mt-2/);assert.match(css,/confluence bar/);});
