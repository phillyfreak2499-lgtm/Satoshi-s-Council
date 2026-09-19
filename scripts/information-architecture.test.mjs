import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const board = read("src/components/desk/Feedback.tsx");
const books = read("src/components/desk/BooksTab.tsx");
const chamber = read("src/components/desk/ChamberRoom.tsx");
const lab = read("src/components/desk/LabRoom.tsx");
const security = read("server/middleware/security-headers.ts");

test("the Board separates and paginates public threads", () => {
  assert.match(board, /const PAGE_SIZE = 6/);
  assert.match(board, /function BoardPager/);
  assert.match(board, /<details id="board-updates"/);
  assert.match(board, /Desk updates · \{updates\.length\}/);
  assert.match(board, /Ideas · \{ideas\.length\}/);
  assert.match(board, /Feedback · \{notes\.length\}/);
  assert.match(board, /pageRows\(newestIdeas, ideaPage\)/);
  assert.match(board, /pageRows\(newestNotes, feedbackPage\)/);
});

test("Books gain section anchors and one responsive window table", () => {
  assert.match(books, /aria-label="Paper book sections"/);
  for (const id of [
    "books-overview",
    "books-process",
    "books-curve",
    "books-calibration",
    "books-lab",
    "books-windows",
  ]) {
    assert.match(books, new RegExp(`id="${id}"`));
  }
  assert.equal((books.match(/className="books-window-table /g) || []).length, 1);
  assert.doesNotMatch(books, /className="grid gap-2 sm:hidden"/);
  assert.match(books, /data-label="Close"/);
  assert.match(read("src/styles.css"), /\.books-window-table/);
  assert.match(books, /open replay/);
  assert.match(books, /<span className="hidden sm:inline">ARENA ·<\/span>/);
  assert.match(books, /w\.arena\.n === 1 \? "CALL" : "CALLS"/);
});

test("the Lab leads with comparison and stable humanized ages", () => {
  assert.match(lab, /function ageLabel/);
  assert.doesNotMatch(lab.slice(lab.indexOf("function ageLabel"), lab.indexOf("function LabSummary")), /Date\.now/);
  assert.match(lab, /Comparison first/);
  assert.match(lab, /What the ledger says/);
  assert.match(lab, /Paired difference vs/);
  assert.match(lab, /labComparisons\(data.specimens, data.control_id\)/);
  assert.match(lab, /count only · not promotion/);
  assert.match(lab, /ageLabel\(row\.frozen_at, asOf\)/);
});

test("the Chamber compacts only consecutive identical WAIT dispatches", () => {
  assert.match(chamber, /function waitFingerprint/);
  assert.match(chamber, /statement\.speaker !== "SATOSHI"/);
  assert.match(chamber, /statement\.evidence\.kind !== "chair-wait"/);
  assert.match(chamber, /compactRepeatedWaits\(groupExchanges\(rows\)\)/);
  assert.match(chamber, /earlier identical WAIT/);
  assert.match(chamber, /full evidence/);
});

test("the CSP permits the injected Grok extension without widening defaults", () => {
  assert.match(security, /script-src 'self' 'unsafe-inline' https:\/\/www\.googletagmanager\.com https:\/\/grok\.com/);
  assert.match(security, /connect-src 'self'/);
  assert.match(security, /https:\/\/\*\.grok\.com/);
  assert.match(security, /default-src 'self'/);
});
