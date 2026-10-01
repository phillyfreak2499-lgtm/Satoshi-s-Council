import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);

test("blocked browser permission retains a working unsubscribe without requesting permission", async () => {
  let index = 0;
  let disabled = 0;
  let enabled = 0;
  let cleared = false;
  const values = [{ on_call: true, on_settle: true, owner: true }, true, false, null];
  const mocks = {
    react: { ...React, useEffect() {}, useState() {
      const slot = index++;
      return [values[slot], (next) => { if (slot === 0 && next === null) cleared = true; }];
    } },
    "@/lib/desk/push": {
      pushSupported: () => true, pushPermission: () => "denied", needsHomeScreen: () => false,
      disablePush: async () => { disabled++; }, enablePush: async () => { enabled++; },
    },
    "@/lib/desk/engine": { getAdminKey: () => "" },
    "./Tip": { Tip: ({ children }) => React.createElement("span", null, children) },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync("src/components/desk/AlertsPanel.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)((id) => mocks[id] ?? require(id), module, module.exports);
  const tree = module.exports.AlertsPanel({ ownerMode: true });
  assert.match(renderToStaticMarkup(tree), /Notifications are blocked/);
  function find(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button" && node.props.children === "Turn off alerts in this browser") return node;
    return React.Children.toArray(node.props?.children).map(find).find(Boolean);
  }
  const button = find(tree);
  assert.ok(button, "blocked permission must not remove opt-out");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disabled, 1);
  assert.equal(enabled, 0, "opt-out must not request notification permission");
  assert.equal(cleared, true);
});
