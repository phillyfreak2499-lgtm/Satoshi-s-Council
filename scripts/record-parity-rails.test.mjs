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

test("/record is never served from a cache, and its first paint is the books snapshot the site is printing right now", () => {
  assert.match(read("src/lib/desk/record.ts"), /export const RECORD_CACHE_CONTROL = "no-store";/);
  const route = read("src/routes/record.tsx");
  assert.match(route, /headers: \(\) => \(\{ "cache-control": RECORD_CACHE_CONTROL \}\)/, "the document response says no-store");
  const pub = read("src/lib/desk/record-public.ts");
  assert.match(pub, /setResponseHeader\("cache-control", RECORD_CACHE_CONTROL\)/, "the server function's own response says no-store");
  const server = read("src/lib/desk/record.server.ts");
  assert.match(server, /if \(cache && cache\.books_at === books\.at\) return cache\.body;/, "cached against the books snapshot, not on a clock of its own");
  assert.doesNotMatch(server, /Date\.now\(\) - cache\.at < 30_000/, "no independent 30 s window that could straddle a roll");
  assert.match(server, /now: books\.at,/, "stamped with the minute the books cells were read");
  assert.match(server, /async function build\(books: Books\)/, "built from the same object /books prints");
});

test("an open or restored /record tab corrects itself: reread on mount when stale, on a timer, and on pageshow", () => {
  const room = read("src/components/desk/RecordRoom.tsx");
  assert.match(room, /void reread\(\);\n\s+const timer = setInterval\(onVisible, REREAD_AFTER_MS\);/, "reread once on mount, then on a timer");
  assert.match(room, /window\.addEventListener\("pageshow", onVisible\)/, "a page restored from the back-forward cache rereads");
  assert.match(room, /readAt\.current = Date\.parse\(next\.at\) \|\| Date\.now\(\)/, "freshness is judged by the brief's own stamp");
  assert.match(room, /clearInterval\(timer\)/);
});
