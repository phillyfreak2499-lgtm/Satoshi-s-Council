import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";
const require = createRequire(import.meta.url);

test("sticky status observes the complete header including shortcuts and responds to resizing", () => {
  let height = 82;
  let inset = null;
  let effect;
  let observerCallback;
  let disconnected = false;
  let resize;
  const header = { getBoundingClientRect: () => ({ height }) };
  const mocks = {
    react: { ...React, useState: () => [inset, (value) => { inset = value; }], useEffect: (fn) => { effect = fn; } },
    "@/lib/desk/pro-floor": {},
    "@/lib/desk/hooks": { useCountdownText: () => "6m" },
    "./tones": { leanTone: () => "" },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/desk/math": { clockMs: () => "6m" },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync("src/components/desk/ProFloor/StickyDecisionHeader.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const document = { querySelector: (selector) => { assert.equal(selector, ".council-site-header"); return header; } };
  const window = { addEventListener: (_, fn) => { resize = fn; }, removeEventListener: (_, fn) => { assert.equal(fn, resize); resize = null; } };
  class Observer {
    constructor(fn) { observerCallback = fn; }
    observe(element) { assert.equal(element, header); }
    disconnect() { disconnected = true; }
  }
  new Function("require", "module", "exports", "document", "window", "ResizeObserver", code)(
    (id) => mocks[id] ?? require(id), module, module.exports, document, window, Observer,
  );
  const facts = { market: { close_time: 1 }, conclusion: { lean: "WAIT" }, paper: { held: false } };
  const render = () => module.exports.StickyDecisionHeader({ facts });
  assert.equal(render().props.style.top, "var(--header-h)");
  const cleanup = effect();
  assert.equal(render().props.style.top, 82);
  height = 126; observerCallback();
  assert.equal(render().props.style.top, 126, "shortcut row is part of the inset");
  height = 72; resize();
  assert.equal(render().props.style.top, 72);
  assert.doesNotMatch(render().props.className, /\btop-0\b/);
  cleanup();
  assert.equal(disconnected, true);
  assert.equal(resize, null);
});
