import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";
const require = createRequire(import.meta.url);

const read = (path) => readFileSync(path, "utf8");

test("operator status is the single sticky decision summary and uses only the real header inset", () => {
  const mocks = {
    "@/lib/desk/pro-floor": {},
    "@/lib/desk/hooks": { useCountdownText: () => "6m" },
    "../DecisionLayerMark": { DecisionLayerMark: (props) => React.createElement("span", { "data-decision-layer": props.layer }) },
    "./tones": { leanTone: () => "" },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/desk/math": { clockMs: () => "6m" },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(read("src/components/desk/ProFloor/StickyDecisionHeader.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (id) => mocks[id] ?? require(id), module, module.exports,
  );
  const facts = {
    market: { close_time: 1 },
    conclusion: { lean: "WAIT", confidence: { value: 79 } },
    health: { all_clear: true, blockers: [] },
    paper: { held: false },
  };
  const rendered = module.exports.StickyDecisionHeader({ facts });
  const marks = rendered.props.children.flatMap((column) => {
    const children = Array.isArray(column.props.children) ? column.props.children : [column.props.children];
    return children.flatMap((child) => child?.props?.children ?? []).filter((child) => child?.props?.layer);
  });
  assert.deepEqual(marks.map((mark) => mark.props.layer), ["decision", "position"]);
  assert.ok(marks.every((mark) => mark.props.compact));
  assert.equal(rendered.props.style.top, "var(--header-h)");
  assert.match(rendered.props.className, /\blg:sticky\b/);
  assert.doesNotMatch(rendered.props.className, /(^|\s)sticky(\s|$)/, "phones and tablets do not pin the status card");
  const stickySource = read("src/components/desk/ProFloor/StickyDecisionHeader.tsx");
  assert.doesNotMatch(stickySource, /querySelector|ResizeObserver|getBoundingClientRect/,
    "shortcut-row height must never become part of the sticky inset");
  assert.match(stickySource, /gate confidence/);
  assert.match(stickySource, /feeds live/);
  assert.match(stickySource, /no position booked/);
});

test("market context does not repeat SATOSHI decision or time beneath the operator status", () => {
  const strip = read("src/components/desk/ProFloor/ProDecisionStrip.tsx");
  assert.doesNotMatch(strip, /DecisionLayerMark/);
  assert.doesNotMatch(strip, /label="Time"/);
  assert.doesNotMatch(strip, /gate confidence/);
  assert.doesNotMatch(strip, /useCountdownText/);
  assert.match(strip, /label="BTC \/ line"/);
  assert.match(strip, /label="Market"/);
  assert.match(strip, /label="Desk value"/);
  assert.match(strip, /sm:grid-cols-3/);
});
