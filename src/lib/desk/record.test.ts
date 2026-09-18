/**
 * The week on the record — pure brief builder.
 *
 * The score is the books' own last-7-days column. The picks are drawn only
 * from graded rows: a WAIT is shown as right only when a shadow fill lost or a
 * wrong lean never filled; a wrong fill is the week's worst real fill; an
 * empty week still produces a brief and never invents a fill.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BooksTotals, KeeperStats } from "./books.ts";
import { bestWait, booksColumn, booksParity, buildWeekRecord, chicagoDate, copyWeek, readStamp, RECORD_CACHE_CONTROL, scoreNote, scoreOf, seatNote, takerFee, wrongFill, type RecordLedgerRow } from "./record.ts";

const NOW = Date.parse("2026-09-18T15:00:00.000Z");
const WEEK: BooksTotals = { n: 640, calls: 12, wins: 7, net: 41.5, ups: 320, breakeven: 84.2 };
const KEEPER: KeeperStats = { n: 640, wait_pct: 98, booked: 12, hit_pct: 58, net: 41.5, max_dd: -63, avg_entry: 83, floor_pct: 100, conf_ratio: 1.2 };

function row(over: Partial<RecordLedgerRow> & { ticker: string }): RecordLedgerRow {
  return {
    close_time: "2026-09-17T15:00:00.000Z",
    winner: "UP",
    chair_lean: "WAIT",
    entry_lean: null,
    entry_cents: null,
    settle_cents: null,
    ev_cents: null,
    entry_fee_cents: null,
    shadow_entry_cents: null,
    shadow_ev_cents: null,
    seats: null,
    replay: false,
    ...over,
  };
}

test("the score is the books' last-7-days column, with sits derived from windows minus fills", () => {
  const s = scoreOf(WEEK, KEEPER);
  assert.deepEqual(s, { windows: 640, sits: 628, fills: 12, wins: 7, win_rate: 58, needed: 84.2, net: 41.5, max_dd: -63 });
});

test("an empty week scores zero fills honestly and leaves win rate and needed null", () => {
  const s = scoreOf({ n: 400, calls: 0, wins: 0, net: 0, ups: 200, breakeven: null }, null);
  assert.equal(s.sits, 400);
  assert.equal(s.fills, 0);
  assert.equal(s.win_rate, null);
  assert.equal(s.needed, null);
  assert.equal(s.max_dd, null, "no scorecard means no drawdown claim, not zero");
});

test("the best WAIT prefers a shadow fill that lost, largest loss first", () => {
  const rows = [
    row({ ticker: "A", shadow_entry_cents: 72, shadow_ev_cents: -20, replay: true }),
    row({ ticker: "B", shadow_entry_cents: 74, shadow_ev_cents: -74, replay: false, winner: "DOWN" }),
    row({ ticker: "C", chair_lean: "UP", winner: "DOWN", replay: true }),
  ];
  const w = bestWait(rows);
  assert.equal(w?.ticker, "B");
  assert.equal(w?.kind, "shadow-loss-avoided");
  assert.match(w!.reason, /filled at 74¢ and lost 74\.0¢ after fee/);
  assert.match(w!.reason, /settled DOWN/);
});

test("without a shadow loss, a wrong lean that never filled is the WAIT that was right", () => {
  const rows = [
    row({ ticker: "OLD", close_time: "2026-09-12T15:00:00.000Z", chair_lean: "DOWN", winner: "UP", replay: true }),
    row({ ticker: "NEW", close_time: "2026-09-17T15:00:00.000Z", chair_lean: "UP", winner: "DOWN", replay: false }),
    row({ ticker: "RIGHT", chair_lean: "UP", winner: "UP" }),
  ];
  const w = bestWait(rows);
  assert.equal(w?.kind, "wrong-lean-unfilled");
  assert.equal(w?.ticker, "OLD", "a window with a replay is preferred so the reader can check it");
  assert.match(w!.reason, /leaned DOWN/);
});

test("a WAIT is never manufactured from a filled window or a right lean", () => {
  assert.equal(bestWait([row({ ticker: "F", entry_cents: 85, ev_cents: -85, chair_lean: "UP", winner: "DOWN" })]), null);
  assert.equal(bestWait([row({ ticker: "R", chair_lean: "UP", winner: "UP" })]), null);
  assert.equal(bestWait([]), null);
});

test("the wrong fill is the week's worst real fill, with side, ask, fee and result after fee", () => {
  const rows = [
    row({ ticker: "SMALL", entry_cents: 80, settle_cents: 0, ev_cents: -82, winner: "DOWN", entry_lean: "UP" }),
    row({ ticker: "BIG", entry_cents: 90, settle_cents: 0, ev_cents: -91, winner: "UP", entry_fee_cents: 1 }),
    row({ ticker: "WIN", entry_cents: 85, settle_cents: 100, ev_cents: 14, winner: "UP" }),
  ];
  const f = wrongFill(rows);
  assert.equal(f?.ticker, "BIG");
  assert.equal(f?.side, "DOWN", "with no recorded entry side, the side is recovered from settlement");
  assert.equal(f?.ask, 90);
  assert.equal(f?.fee, 1, "a recorded fee wins over the formula");
  assert.equal(f?.ev, -91);
  assert.equal(f?.invalidate, null, "the invalidation line is attached by the server, never guessed here");
  assert.equal(wrongFill([rows[2]!]), null, "a winning week has no wrong fill");
  assert.equal(wrongFill([]), null);
});

test("the fee falls back to the desk's rounded taker formula", () => {
  assert.equal(takerFee(80), 2);
  assert.equal(takerFee(50), 2);
  assert.equal(takerFee(95), 1);
  const f = wrongFill([row({ ticker: "X", entry_cents: 80, settle_cents: 0, ev_cents: -82, winner: "UP" })]);
  assert.equal(f?.fee, 2);
});

test("the seat note is the seat with the most graded directional reads, stated as a frequency", () => {
  const rows = [
    row({ ticker: "1", seats: { WICK: { lean: "UP", hit: true }, TAPE: { lean: "DOWN", hit: false }, CLOCK: { lean: "WAIT" } } }),
    row({ ticker: "2", seats: { WICK: { lean: "UP", hit: false }, TAPE: { lean: "UP", hit: true } } }),
    row({ ticker: "3", seats: { TAPE: { lean: "UP", hit: true } } }),
  ];
  const n = seatNote(rows, { TAPE: { LIVE: 1, SHADOW: 2 } });
  assert.equal(n?.seat, "TAPE");
  assert.equal(n?.n, 3);
  assert.equal(n?.right, 2);
  assert.equal(n?.pct, 67);
  assert.match(n!.line, /TAPE spoke a direction on 3 graded windows and was right on 2 \(67%\)\. Its rules sit LIVE 1 · SHADOW 2\./);
  assert.doesNotMatch(n!.line, /buy|GOLD|signal/i);
  assert.equal(seatNote([row({ ticker: "0" })], null), null);
});

test("the brief labels a Chicago week and carries plain copy without hashtags", () => {
  const rows = [
    row({ ticker: "W", shadow_entry_cents: 72, shadow_ev_cents: -20, replay: true, winner: "DOWN" }),
    row({ ticker: "L", entry_cents: 85, settle_cents: 0, ev_cents: -87, winner: "DOWN", entry_lean: "UP", replay: true }),
    row({ ticker: "S", seats: { WICK: { lean: "UP", hit: true } } }),
  ];
  const r = buildWeekRecord({ now: NOW, rows, week: WEEK, keeper: KEEPER, missing_windows: 3, statuses: null });
  assert.equal(r.tz, "America/Chicago");
  assert.equal(r.days, 7);
  assert.equal(r.window.label, `Last 7 days, ${chicagoDate(NOW - 7 * 86_400_000)} to ${chicagoDate(NOW)}, America/Chicago`);
  assert.equal(chicagoDate(NOW), "Sep 18");
  assert.equal(r.best_wait?.ticker, "W");
  assert.equal(r.wrong_fill?.ticker, "L");
  assert.equal(r.seat_note?.seat, "WICK");
  assert.equal(r.missing_windows, 3);
  assert.match(r.copy, /^The week on the record · Satoshi's Council\n/);
  assert.match(r.copy, /Sits 628 of 640 windows\. Fills 12\. Win rate 58% vs 84% needed\. Net \+41\.5¢ after fees\. Max drawdown -63\.0¢\./);
  assert.match(r.copy, /One WAIT that was right: The older, lower floor would have filled at 72¢/);
  assert.match(r.copy, /One fill that was wrong: UP at 85¢, -87\.0¢ after fee\./);
  assert.match(r.copy, /Missing windows are outages in the record, not WAITs \(3 in 90 days\)\./);
  assert.match(r.copy, /A directional read and a recorded paper fill are different\./);
  assert.doesNotMatch(r.copy, /#|alpha|lock this|signal|buy/i);
  assert.equal(copyWeek(r), r.copy);
});

test("an empty week is still a brief: sits lead, no fill is invented, and the copy says so", () => {
  const r = buildWeekRecord({ now: NOW, rows: [row({ ticker: "Q", chair_lean: "UP", winner: "DOWN" })], week: { n: 200, calls: 0, wins: 0, net: 0, ups: 90, breakeven: null }, keeper: null, missing_windows: 0, statuses: null });
  assert.equal(r.score.fills, 0);
  assert.equal(r.score.sits, 200);
  assert.equal(r.wrong_fill, null);
  assert.equal(r.best_wait?.kind, "wrong-lean-unfilled");
  assert.match(r.copy, /Sits 200 of 200 windows\. Fills 0\. Net 0\.0¢ after fees\./);
  assert.match(r.copy, /No fills this week\. Nothing to grade there\./);
  assert.doesNotMatch(r.copy, /Missing windows/);
});

test("the record's score is every cell of the books' last-7-days column, read once, from the same object", () => {
  const b = buildWeekRecord({ now: NOW, rows: [], week: WEEK, keeper: KEEPER, missing_windows: 0, statuses: null });
  assert.deepEqual(b.books_week, { n: 640, calls: 12, wins: 7, net: 41.5, breakeven: 84.2 });
  assert.equal(b.score.windows, WEEK.n);
  assert.equal(b.score.sits, WEEK.n - WEEK.calls);
  assert.equal(b.score.fills, WEEK.calls);
  assert.equal(b.score.wins, WEEK.wins);
  assert.equal(b.score.net, WEEK.net);
  assert.equal(b.score.needed, WEEK.breakeven);
  assert.equal(b.score.max_dd, KEEPER.max_dd);
  assert.equal(booksParity(b.score, b.books_week), true);
  const note = scoreNote(b);
  assert.equal(note.same, true);
  assert.match(note.text, /^Same numbers as the books' last-7-days column, both read at 2026-09-18 15:00 UTC\./);
  assert.match(note.text, /rolls every 15 minutes/);
});

test("the record never claims to match the books while net, fills or won differ", () => {
  const score = scoreOf(WEEK, KEEPER);
  const drifted: Array<[string, Partial<BooksTotals>]> = [
    ["net", { net: 259 }],
    ["fills", { calls: 88 }],
    ["won", { wins: 78 }],
    ["windows", { n: 661 }],
    ["needed", { breakeven: 86 }],
  ];
  for (const [what, over] of drifted) {
    const column = booksColumn({ ...WEEK, ...over });
    assert.equal(booksParity(score, column), false, `${what} differs, so there is no parity`);
    const note = scoreNote({ score, books_week: column, at: "2026-09-18T15:00:00.000Z" });
    assert.equal(note.same, false, what);
    assert.doesNotMatch(note.text, /Same numbers/, `the page must not say the numbers match when ${what} differs`);
    assert.match(note.text, /disagree at 2026-09-18 15:00 UTC/);
    assert.match(note.text, /record \+41\.5¢, 12 fills, 7 won; books /, "both readings are printed, neither is invented");
  }
  // The live case that prompted this: the same book, read twelve hours apart, rolled twenty fills out of the window.
  const morning = scoreOf({ n: 661, calls: 68, wins: 60, net: 152, ups: 330, breakeven: 86 }, null);
  const lastNight = booksColumn({ n: 661, calls: 88, wins: 78, net: 259, ups: 330, breakeven: 84 });
  const note = scoreNote({ score: morning, books_week: lastNight, at: "2026-09-18T12:25:00.000Z" });
  assert.equal(note.same, false);
  assert.match(note.text, /record \+152\.0¢, 68 fills, 60 won; books \+259\.0¢, 88 calls, 78 won/);
});

test("the copy dates its read and never repeats a same-numbers claim", () => {
  const b = buildWeekRecord({ now: NOW, rows: [], week: WEEK, keeper: KEEPER, missing_windows: 0, statuses: null });
  assert.match(b.copy, /^Read 2026-09-18 15:00 UTC\. The 7-day window rolls every 15 minutes\.$/m);
  assert.doesNotMatch(b.copy, /[Ss]ame numbers/);
  assert.equal(readStamp("not a date"), "an unknown minute");
});

test("an empty week still reads as parity with an empty books column and invents no fill", () => {
  const empty: BooksTotals = { n: 400, calls: 0, wins: 0, net: 0, ups: 200, breakeven: null };
  const b = buildWeekRecord({ now: NOW, rows: [], week: empty, keeper: null, missing_windows: 0, statuses: null });
  assert.equal(b.score.fills, 0);
  assert.equal(b.wrong_fill, null);
  assert.equal(booksParity(b.score, b.books_week), true);
  assert.equal(scoreNote(b).same, true);
});

test("the brief's cache policy is no-store: a rolling week is never held by a browser or a proxy", () => {
  assert.equal(RECORD_CACHE_CONTROL, "no-store");
});
