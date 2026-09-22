import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadCanonical() {
  const source = readFileSync(join(process.cwd(), "src/lib/desk/canonical-record.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports });
  return exports;
}

const totals = (n, calls, wins, net) => ({ n, calls, wins, net, ups: 0, breakeven: null });

test("canonical record uses the current live-floor population, not the archived trial or all-time keeper", () => {
  const { canonicalFromBooks } = loadCanonical();
  const books = {
    live_floor: {
      since: "2026-09-10T23:00:00.000Z",
      live_cents: 80,
      totals: totals(700, 12, 10, 54.5),
      max_dd: -81.2,
    },
    trial: {
      since: "2026-09-10T23:00:00.000Z",
      until: "2026-09-15T14:05:13.000Z",
      live_cents: 80,
      shadow_cents: 70,
      windows: 400,
      live: totals(400, 91, 80, 205),
      shadow: totals(400, 102, 80, -10),
      declined: 11,
    },
    floor: totals(900, 137, 117, 226),
    floor_since: "2026-09-08T20:47:00.000Z",
    keeper: { all: { max_dd: -315 }, week: { max_dd: -120 } },
  };

  const r = canonicalFromBooks(books);
  assert.equal(r.calls, 12);
  assert.equal(r.wins, 10);
  assert.equal(r.losses, 2);
  assert.equal(r.net, 54.5);
  assert.equal(r.maxDrawdown, -81.2);
  assert.equal(r.windows, 700);
  assert.equal(r.since, "2026-09-10");
  assert.match(r.scope, /Current 80¢ paper book/);
  assert.match(r.scope, /since 2026-09-10/);
  assert.match(r.scope, /through latest graded window/);
  assert.notEqual(r.calls, books.trial.live.calls, "archived trial must not become the headline record");
  assert.notEqual(r.maxDrawdown, books.keeper.all.max_dd, "all-time drawdown must not leak into the live-floor scope");
});
