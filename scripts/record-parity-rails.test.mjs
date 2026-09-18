/**
 * /record and /books — one book, one column, one read.
 *
 * The record's score must be the books' last-7-days column read from the same
 * object, and the page may say so only through the guarded note that checks
 * every cell. A hard-coded "same numbers" sentence is exactly the line that was
 * false in production when a tab read the rolling week twelve hours apart.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("the record score is built from the books' own week column, not a second query", () => {
  const server = read("src/lib/desk/record.server.ts");
  assert.match(server, /booksSummary\(\)/, "the record reads the books summary");
  assert.match(server, /week: books\.week/, "the score is books.week, the object /books prints as last 7 days");
  assert.match(server, /keeper: books\.keeper\?\.week/, "the drawdown is the scorecard's week column");
  assert.doesNotMatch(server, /interval '7 days'|count\(\*\) filter \(where entry_cents/, "no parallel 7-day total of its own");
  const books = read("src/lib/desk/books.server.ts");
  assert.match(books, /close_time > now\(\) - interval '7 days' as week/, "the books' week is the rolling 7 days");
  assert.match(read("src/components/desk/BooksTab.tsx"), /<Totals label="last 7 days" t=\{books\.week\} \/>/, "and /books prints that same object");
});

test("the /record page only claims to match the books through the guarded note", () => {
  const room = read("src/components/desk/RecordRoom.tsx");
  assert.doesNotMatch(room, /Same numbers/, "no hard-coded sameness claim in the page");
  assert.match(room, /scoreNote\(data\)/, "the note is computed from the record's own cells");
  assert.match(room, /\{note\?\.text\}/);
  assert.match(room, /href="\/books"/, "the claim links the page that owns the column");
  assert.match(room, /visibilitychange/, "a tab brought back into view rereads instead of printing last night's week");
  const record = read("src/lib/desk/record.ts");
  assert.match(record, /export function booksParity\(/);
  const copyFn = record.slice(record.indexOf("export function copyWeek("), record.indexOf("export function buildWeekRecord("));
  assert.ok(copyFn.length > 0, "copyWeek precedes buildWeekRecord");
  assert.doesNotMatch(copyFn, /[Ss]ame numbers/, "the copy block never carries the claim");
  assert.match(copyFn, /readStamp\(r\.at\)/, "the copy dates its read instead");
});
