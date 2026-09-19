/**
 * Ledger gaps on /books and /record: named outages, excluded from totals.
 *
 * A missing window is never a WAIT, a win, a loss or 0¢. Every room says so
 * with one sentence, the Books banner is one calm line with the closes behind
 * a details element, and the gap list is display-only: it never joins the
 * totals or the windows the books grade.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
function load(rel) {
  const code = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports;
}

const { missingWindowsLine } = load("src/lib/desk/books.ts");
const SENTENCE = /^12 windows in the last 90 days have no recorded result\. They are outages, not sits, and they are not in the totals\.$/;

test("one sentence, singular and plural, empty when there is no gap", () => {
  assert.match(missingWindowsLine(12), SENTENCE);
  assert.equal(missingWindowsLine(1), "1 window in the last 90 days has no recorded result. It is an outage, not a sit, and it is not in the totals.");
  assert.equal(missingWindowsLine(0), "");
  assert.equal(missingWindowsLine(-3), "");
  assert.equal(missingWindowsLine(Number.NaN), "");
  assert.equal(missingWindowsLine(2.9), "2 windows in the last 90 days have no recorded result. They are outages, not sits, and they are not in the totals.");
  for (const n of [1, 2, 12]) assert.doesNotMatch(missingWindowsLine(n), /\bWAIT\b|\bwins?\b|\bloss\b|0¢|—/);
});

test("the Books banner is one calm line with the closes collapsed, and no error tint", () => {
  const src = read("src/components/desk/BooksTab.tsx");
  const banner = src.slice(src.indexOf('aria-label="Missing ledger windows"'), src.indexOf('id="books-overview"'));
  assert.match(banner, /\{missingWindowsLine\(missing\.length\)\}/, "the shared sentence");
  assert.doesNotMatch(banner, /missing \{missing\.length === 1|of recorded coverage|not WAITs, wins, losses|zero-profit/, "old banner copy is gone");
  assert.doesNotMatch(banner, /border-wait|bg-wait|text-wait|text-down|text-up/, "no amber or error tint");
  assert.match(banner, /<details[^>]*>\s*<summary[^>]*>Show missing closes · \{tz\}<\/summary>/, "closes stay behind the summary");
  assert.match(banner, /· no recorded result<\/li>/);
  assert.equal((banner.match(/<p className/g) ?? []).length, 1, "one line above the details");
  const row = src.slice(src.indexOf('"missing" in w ? ('), src.indexOf(") : (", src.indexOf('"missing" in w ? (')));
  assert.match(row, /No recorded result · an outage, not a sit · not in the totals/);
  assert.doesNotMatch(row, /border-wait|bg-wait|text-wait|WAIT|0\.0¢|—/);
});

test("the Record room and the copy block say the same sentence and still link to the books", () => {
  const room = read("src/components/desk/RecordRoom.tsx");
  assert.match(room, /\{missingWindowsLine\(data\.missing_windows\)\} <a href="\/books"/);
  assert.doesNotMatch(room, /outages in the record, not WAITs/);
  const record = read("src/lib/desk/record.ts");
  assert.match(record, /missingWindowsLine\(r\.missing_windows\),/);
  assert.doesNotMatch(record, /Missing windows are outages in the record/);
});

test("gaps are derived from ledger coverage and never enter the windows or the totals", () => {
  const server = read("src/lib/desk/books.server.ts");
  assert.match(server, /const missingWindows = ledgerGaps\(coverage\.map\(\(r\) => Number\(r\.ms\)\), \{ maxReport: 10_000 \}\)/);
  assert.match(server, /missing_windows: missingWindows,/);
  assert.doesNotMatch(server, /windows\.push|insert into desk_ledger/, "the books never write a gap into the ledger");
  const tab = read("src/components/desk/BooksTab.tsx");
  assert.match(tab, /missing\.filter\(\(close\) => oldest && newest && close >= oldest && close <= newest\)\.map\(\(close_time\) => \(\{ close_time, missing: true as const \}\)\)/, "gap rows are display-only markers");
  const record = read("src/lib/desk/record.server.ts");
  assert.match(record, /missing_windows: \(books\.missing_windows \?\? \[\]\)\.length,/, "the record counts them, never grades them");
});
