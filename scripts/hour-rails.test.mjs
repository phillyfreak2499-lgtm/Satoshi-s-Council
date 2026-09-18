/**
 * The hourly book — safety rails.
 *
 * The hour is a separate book. Its reader never touches the 15-minute ledger,
 * the Chair, the learner, or the paper book, and it writes nothing. The page
 * says the two books are graded separately, renders an empty book honestly,
 * and the book's authority is printed as none in code.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the hourly ledger is its own table with no tie to the 15-minute ledger, and the migration writes no rows", () => {
  const sql = read("migrations/0041_desk_hour_ledger.sql");
  assert.match(sql, /create table if not exists desk_hour_ledger/);
  assert.doesNotMatch(sql, /references\s+desk_ledger/i);
  assert.doesNotMatch(sql, /create (or replace )?view/i);
  assert.doesNotMatch(sql, /insert into|update |delete from/i);
  assert.match(sql, /check \(chair_lean in \('WAIT', 'YES', 'NO'\)\)/, "the hourly posture is WAIT/YES/NO on a strike ladder, not UP/DOWN");
  assert.match(sql, /Authority: none/);
});

test("the hourly reader only reads: its own table and the public market list, never the 15-minute book", () => {
  const src = codeOf("src/lib/desk/hour.server.ts");
  assert.match(src, /from desk_hour_ledger/);
  assert.match(src, /series_ticker=\$\{HOUR_SERIES\}/);
  for (const banned of [
    "desk_ledger ", "desk_ledger_research", "desk_samples", "desk_state", "desk_policy",
    "insert into", "update desk", "delete from",
    "./chair\"", "./chair.ts", "./learner", "./bots", "./book-floor", "./booked-decision", "./paper-book",
    "./floor-policy", "./promotion-gates", "./skill-gate", "./books.server", "./record",
    "recordSystemEvent", "recordExitArena", "promoteToLive", "persistState",
  ]) {
    assert.doesNotMatch(src, new RegExp(esc(banned)), `hour.server must not reference ${banned}`);
  }
  assert.match(src, /import\("\.\/server-engine"\)/, "the frame is read for spot only, through a dynamic import");
  assert.match(src, /frame\?\.snap\?\.spot/);
});

test("the pure hourly module prints authority none, posture WAIT, and the separate-book copy", () => {
  const src = codeOf("src/lib/desk/hour.ts");
  assert.match(src, /export const HOUR_BOOK_AUTHORITY = "none" as const;/);
  assert.match(src, /lean: "WAIT" as const/);
  assert.match(src, /live_rule: false/);
  assert.match(src, /No hourly fills yet\. The 15-minute floor is a different book\./);
  assert.match(src, /The 15-minute floor and the hourly book are graded separately\./);
  assert.match(src, /HOUR_SERIES = "KXBTCD"/);
  for (const banned of ["./chair-v2", "./chair-v3", "./chair\"", "./learner", "./server-engine", "@/lib/db", "Date.now"]) {
    assert.doesNotMatch(src, new RegExp(esc(banned)), `hour.ts must not reference ${banned}`);
  }
});

test("the brain, the Chair, the learner and the 15-minute books never import the hourly book or its closer", () => {
  for (const rel of [
    "src/lib/desk/server-engine.ts", "src/lib/desk/chair.ts", "src/lib/desk/learner.ts",
    "src/lib/desk/books.server.ts", "src/lib/desk/book-floor.ts", "src/lib/desk/floor-policy.ts",
    "src/lib/desk/promotion-gates.ts", "src/lib/desk/record.server.ts", "src/lib/desk/record.ts",
  ]) {
    assert.doesNotMatch(read(rel), /\/hour["']|hour\.server|hour-public|hour-closer|desk_hour_ledger/, `${rel} must not import the hourly book`);
  }
});

test("the hourly closer writes only its own table, only WAIT sits, and never imports the Chair, the learner, desk_ledger or the paper book", () => {
  const server = codeOf("src/lib/desk/hour-closer.server.ts");
  const pure = codeOf("src/lib/desk/hour-closer.ts");
  for (const banned of [
    "desk_ledger ", "desk_ledger_research", "desk_ledger(", "desk_samples", "desk_state", "desk_policy", "desk_replay", "desk_taker",
    "./server-engine", "./chair\"", "./chair.ts", "./chair-v2", "./chair-v3", "./learner", "./bots", "./book-floor", "./booked-decision", "./paper-book",
    "./floor-policy", "./promotion-gates", "./skill-gate", "./books.server", "./record", "./hour.server", "./hour-public",
    "recordSystemEvent", "recordExitArena", "promoteToLive", "persistState", "getServerFrame", "currentSnap",
  ]) {
    assert.doesNotMatch(server, new RegExp(esc(banned)), `hour-closer.server must not reference ${banned}`);
    assert.doesNotMatch(pure, new RegExp(esc(banned)), `hour-closer must not reference ${banned}`);
  }
  const inserts = server.match(/insert into\s+(\w+)/g) ?? [];
  assert.deepEqual(inserts, ["insert into desk_hour_ledger"], "one insert, into the hourly ledger only");
  assert.doesNotMatch(server, /update desk|delete from/);
  assert.match(server, /where not exists \(select 1 from desk_hour_ledger h where h\.close_time = /, "one row per closed hour, on any rung");
  assert.match(server, /on conflict \(ticker, close_time\) do nothing/, "a rerun on the same window writes nothing");
  assert.match(server, /null, null, null, null, null,/, "entry_side, entry_cents, entry_fee_cents, settle_cents, ev_cents are written as null: no fill is invented");
  assert.match(server, /status=settled/, "only settled contracts are read");
  assert.match(pure, /return HOUR_POSTURE\.live_rule \? HOUR_POSTURE\.lean : "WAIT";/, "the posture at close is WAIT until a rule is frozen and live");
  assert.match(pure, /if \(!settled\.length\) \{[\s\S]*?out\.skipped\.push/, "an unsettled hour is skipped, never guessed");
  assert.doesNotMatch(pure, /"UP"|"DOWN"/, "a strike ladder, never UP/DOWN");
  assert.match(server, /catch \(err\)[\s\S]*?st\.error = /, "the closer swallows its own errors");
  assert.doesNotMatch(server, /await import\("\.\/server-engine"\)/);
});

test("the closer is kicked from the health check beside the other observers, fire-and-forget, and never from the engine tick", () => {
  const health = read("server/routes/healthz.get.ts");
  assert.match(health, /import\("\.\.\/\.\.\/src\/lib\/desk\/hour-closer\.server"\)\s*\.then\(\(m\) => m\.ensureHourCloser\(\)\)\s*\.catch\(\(\) => \{\}\)/);
  assert.match(health, /void import\("\.\.\/\.\.\/src\/lib\/desk\/hour-closer\.server"\)/, "not awaited: health stays instant");
  assert.doesNotMatch(read("src/lib/desk/server-engine.ts"), /ensureHourCloser|hour-closer/);
  const server = codeOf("src/lib/desk/hour-closer.server.ts");
  assert.match(server, /st\.timer = setInterval\(\(\) => void closeHoursOnce\(\), HOUR_CLOSER_EVERY_MS\)/, "its own timer");
  assert.match(server, /if \(st\.timer\) return;/, "idempotent boot");
});

test("the /hour page renders the empty book honestly and links the three rooms, and never says buy or signal", () => {
  const room = read("src/components/desk/HourRoom.tsx");
  assert.match(room, /The hour on the record\./);
  assert.match(room, /Same index\. Longer window\. Paper only\./);
  assert.match(room, /data\.score\.fills === 0 \?/, "an empty book takes the empty branch, not the numbers");
  assert.match(room, /\{data\.copy\.empty\}/);
  assert.match(room, /\{data\.copy\.separate\}/);
  assert.match(room, /No real hourly fill has lost, because there is no hourly fill yet\. Nothing is invented here\./);
  assert.match(room, /There is no hourly WAIT to show yet\./);
  assert.match(room, /A strike ladder, not the 15-minute UP\/DOWN contract\./);
  assert.match(room, /href="\/desk"[^>]*>Live 15-minute floor/);
  assert.match(room, /href="\/record"[^>]*>This week \(15-minute\)/);
  assert.match(room, /href="\/training\/wick"[^>]*>Start with WICK/);
  assert.doesNotMatch(room, /\bbuy\b|\bsignal\b|lock this|\bETH\b/i);
  assert.doesNotMatch(room, /Date\.now\(|toLocaleTimeString\(/, "SSR-stable");
  const route = read("src/routes/hour.tsx");
  assert.match(route, /createFileRoute\("\/hour"\)/);
  assert.match(route, /loader:[\s\S]*publicHourBrief/);
  const pub = read("src/lib/desk/hour-public.ts");
  assert.match(pub, /createServerFn\(\{ method: "GET" \}\)/);
  assert.doesNotMatch(pub, /method:\s*"POST"/);
});

test("the hour is reachable from nav, sitemap, the week brief and the about page; the homepage keeps two actions", () => {
  assert.match(read("src/lib/desk/navigation.ts"), /href: "\/hour", label: "The hour", menuLabel: "Results \/ The hour"/);
  assert.match(read("src/lib/desk/site.server.ts"), /\{ path: "\/hour"/);
  assert.match(read("src/components/desk/RecordRoom.tsx"), /A longer Bitcoin clock is graded separately <a href="\/hour"/);
  assert.match(read("src/routes/about.tsx"), /The live floor grades 15-minute windows\. A separate <a href="\/hour"[^>]*>hourly book<\/a> uses the same settlement family and keeps its own record\./);
  const home = read("src/components/desk/CouncilHome.tsx");
  const actions = home.slice(home.indexOf('className="company-actions"'), home.indexOf("company-hero-note"));
  assert.equal((actions.match(/<a /g) ?? []).length, 2, "exactly two hero actions");
  assert.doesNotMatch(actions, /\/hour/);
});
