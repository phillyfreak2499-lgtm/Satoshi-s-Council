/**
 * Audit leftover 1 + 10: last-call panel on both floors, measuring modal gone,
 * /books summary collapses sit runs and dates missing closes.
 * Presentation only. Does not change Chair, book, or policy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

function load(rel) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Intl, Date, Number, Math, String });
  return exports;
}

test("lastCallLine names side, settlement, net, and windows ago", () => {
  const { lastCallLine, windowsAgo } = load("src/lib/desk/last-call-panel.ts");
  const fill = {
    ticker: "KXBTC15M-26SEP101445-45",
    close_time: "2026-09-10T14:45:00.000Z",
    winner: "DOWN",
    official: 1,
    settle_avg: null,
    prints: null,
    call: { lean: "UP", entry: 62, settle: 0, ev: -12 },
    seats: { n: 0, right: 0 },
    raw: { n: 0, right: 0 },
    arena: null,
    replay: true,
  };
  const latest = { ...fill, call: null, close_time: "2026-09-10T16:00:00.000Z", ticker: "later" };
  assert.equal(windowsAgo(fill.close_time, latest.close_time), 5);
  const line = lastCallLine(fill, latest);
  assert.match(line.text, /UP/);
  assert.match(line.text, /settled DOWN/);
  assert.match(line.text, /-12\.0¢/);
  assert.match(line.text, /5 windows ago/);
  assert.equal(line.replayHref, "/window/KXBTC15M-26SEP101445-45");
  assert.equal(lastCallLine({ ...fill, call: null }), null);
  assert.match(read("src/lib/desk/last-call-panel.ts"), /latest\?\.close_time \?\? null/);
});

test("both floors mount LastCallPanel and the measuring modal is dead", () => {
  const guided = read("src/components/desk/GuidedFloorView.tsx");
  const pro = read("src/components/desk/ProFloor/ProOverview.tsx");
  assert.match(guided, /LastCallPanel/);
  assert.match(pro, /LastCallPanel/);
  assert.match(read("src/components/desk/LastCallPanel.tsx"), /Watch a real call/);
  const notice = read("src/lib/desk/research-quiet-notice.ts");
  assert.match(notice, /return true/);
  assert.match(read("src/components/desk/ResearchQuietNotice.tsx"), /killed by the last-call panel/);
});

test("collapseWindowLog keeps fills open and collapses sit runs", () => {
  const { collapseWindowLog, sitRunLabel, datedClose } = load("src/lib/desk/books-window-log.ts");
  const sit = (t) => ({
    ticker: t,
    close_time: t,
    winner: "UP",
    official: null,
    settle_avg: null,
    prints: null,
    call: null,
    seats: { n: 0, right: 0 },
    raw: { n: 0, right: 0 },
    arena: null,
    replay: false,
  });
  const fill = {
    ...sit("2026-09-10T14:45:00.000Z"),
    call: { lean: "DOWN", entry: 58, settle: 100, ev: 41 },
    winner: "DOWN",
    replay: true,
  };
  const rows = collapseWindowLog([
    sit("2026-09-10T15:00:00.000Z"),
    sit("2026-09-10T15:15:00.000Z"),
    fill,
    sit("2026-09-10T15:45:00.000Z"),
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, "sit-run");
  assert.equal(rows[0].count, 2);
  assert.equal(sitRunLabel(rows[0]), "sat out · 2 windows");
  assert.equal(rows[1].kind, "fill");
  assert.equal(rows[1].window.call.lean, "DOWN");
  assert.equal(rows[2].count, 1);
  assert.match(datedClose("2026-09-17T22:00:00.000Z"), /Sep/);
});

test("Books page leads with one collapsed summary and dated missing closes", () => {
  const page = read("src/routes/books.tsx");
  const summary = read("src/components/desk/BooksRecentWindows.tsx");
  const helper = read("src/lib/desk/books-window-log.ts");
  const legacy = read("src/components/desk/BooksTab.tsx");
  assert.match(page, /BooksRecentWindows/);
  assert.match(summary, /sitRunLabel/);
  assert.match(helper, /sat out ·/);
  assert.match(summary, /Show missing closes/);
  assert.match(summary, /datedClose/);
  assert.match(summary, /data-label="Close"/);
  assert.match(summary, />replay</);
  assert.doesNotMatch(legacy, /id="books-windows"|windowRows|missingWindowsLine/);
});
