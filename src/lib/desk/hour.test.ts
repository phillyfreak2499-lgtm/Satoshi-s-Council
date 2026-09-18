/**
 * The hour on the record — pure builder tests.
 *
 * The hourly contract is a strike ladder and is never described as UP/DOWN.
 * An empty hourly ledger renders as no fills and invents nothing. The copy
 * says the two books are graded separately, and the book's authority is none.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOUR_BOOK_AUTHORITY,
  HOUR_EMPTY_COPY,
  HOUR_POSTURE,
  HOUR_SEPARATE_COPY,
  HOUR_SERIES,
  buildHourBrief,
  hourQuestion,
  hourRightWait,
  hourScore,
  hourWrongFill,
  parseHourTicker,
  pickHourWindow,
  quoteCents,
  type HourLedgerRow,
} from "./hour.ts";

const NOW = Date.parse("2026-09-18T18:20:00.000Z"); // 2:20 PM Eastern (EDT)

function row(over: Partial<HourLedgerRow> & { ticker: string }): HourLedgerRow {
  return { close_time: "2026-09-18T18:00:00.000Z", question: "", chair_lean: "WAIT", entry_side: null, entry_cents: null, entry_fee_cents: null, ev_cents: null, result: "YES", ...over };
}

test("the series is KXBTCD, the authority is none, and the posture is WAIT with no live rule", () => {
  assert.equal(HOUR_SERIES, "KXBTCD");
  assert.equal(HOUR_BOOK_AUTHORITY, "none");
  assert.equal(HOUR_POSTURE.lean, "WAIT");
  assert.equal(HOUR_POSTURE.live_rule, false);
  assert.match(HOUR_POSTURE.reason, /No hourly rule exists/);
});

test("an hourly ticker parses to the top of the hour in Eastern time and a strike, never an UP/DOWN", () => {
  const t = parseHourTicker("KXBTCD-26SEP1815-T78249.99");
  assert.ok(t);
  assert.equal(t.series, "KXBTCD");
  assert.equal(t.event_ticker, "KXBTCD-26SEP1815");
  assert.equal(new Date(t.close_ms).toISOString(), "2026-09-18T19:00:00.000Z", "3 PM EDT is 19:00 UTC");
  assert.equal(t.kind, "above");
  assert.equal(t.strike, 78249.99);
  assert.equal(parseHourTicker("KXBTCD-26DEC0109-B77000")?.kind, "between");
  assert.equal(new Date(parseHourTicker("KXBTCD-26DEC0109-B77000")!.close_ms).toISOString(), "2026-12-01T14:00:00.000Z", "9 AM EST is 14:00 UTC");
  assert.equal(parseHourTicker("KXBTC15M-26SEP181445-45"), null, "the 15-minute series is not this clock");
  assert.equal(parseHourTicker("KXBTCD-26SEP1899-T1"), null);
  assert.equal(parseHourTicker("nonsense"), null);
});

test("the question comes from the contract when the feed carries it, else from the ticker, and is never UP or DOWN", () => {
  const parsed = parseHourTicker("KXBTCD-26SEP1815-T78250")!;
  assert.equal(hourQuestion({ title: "Bitcoin price at 3pm EDT?", yes_sub_title: "$78,250 or above" }, parsed), "Bitcoin price at 3pm EDT: yes pays if $78,250 or above.");
  const derived = hourQuestion({}, parsed);
  assert.match(derived, /at or above \$78,250 at 3:00 PM Eastern/);
  assert.doesNotMatch(derived, /\bUP\b|\bDOWN\b/);
  assert.match(hourQuestion({ cap_strike: "78500" }, parseHourTicker("KXBTCD-26SEP1815-B78000")!), /between \$78,000 and \$78,500/);
});

test("quotes read dollars on the new field and cents on the legacy one, and a bare dollar value is not one cent", () => {
  assert.equal(quoteCents("0.86", undefined), 86);
  assert.equal(quoteCents(undefined, 86), 86);
  assert.equal(quoteCents(undefined, 0.86), 86);
  assert.equal(quoteCents(undefined, undefined), null);
  assert.equal(quoteCents("", ""), null);
});

test("the live window is the next hour to close and the rung nearest spot, dropping rows whose clocks disagree", () => {
  const rows = [
    { ticker: "KXBTCD-26SEP1814-T77000", close_time: "2026-09-18T18:00:00.000Z", yes_ask_dollars: "0.90" }, // already closed at NOW
    { ticker: "KXBTCD-26SEP1815-T77000", close_time: "2026-09-18T19:00:00.000Z", yes_ask_dollars: "0.91", floor_strike: 77000 },
    { ticker: "KXBTCD-26SEP1815-T78000", close_time: "2026-09-18T19:00:00.000Z", yes_ask_dollars: "0.62", floor_strike: 78000 },
    { ticker: "KXBTCD-26SEP1815-T79000", close_time: "2026-09-18T19:00:00.000Z", yes_ask: 21, floor_strike: 79000 },
    { ticker: "KXBTCD-26SEP1815-T80000", close_time: "2026-09-18T23:00:00.000Z", yes_ask_dollars: "0.05", floor_strike: 80000 }, // provider clock disagrees with the ticker
    { ticker: "KXBTCD-26SEP1816-T78000", close_time: "2026-09-18T20:00:00.000Z", yes_ask_dollars: "0.55", floor_strike: 78000 },
  ];
  const w = pickHourWindow(rows, NOW, 78120);
  assert.ok(w);
  assert.equal(w.ticker, "KXBTCD-26SEP1815-T78000");
  assert.equal(w.close_time, "2026-09-18T19:00:00.000Z");
  assert.equal(w.strike, 78000);
  assert.equal(w.yes_ask, 62);
  assert.equal(w.pick, "nearest-spot");
  assert.equal(w.ladder, 3, "the disagreeing row and the other hour are not rungs on this hour");
  assert.equal(w.kind, "above");
  const noSpot = pickHourWindow(rows, NOW, null);
  assert.equal(noSpot?.pick, "middle-rung");
  assert.equal(noSpot?.ticker, "KXBTCD-26SEP1815-T78000");
  assert.equal(pickHourWindow([], NOW, 78120), null);
  assert.equal(pickHourWindow(undefined, NOW, null), null);
});

test("an empty hourly ledger scores zero windows and zero fills, and invents nothing", () => {
  const s = hourScore([]);
  assert.deepEqual(s, { windows: 0, sits: 0, fills: 0, wins: 0, win_rate: null, needed: null, net: 0, max_dd: 0 });
  assert.equal(hourRightWait([]), null);
  assert.equal(hourWrongFill([]), null);
  const b = buildHourBrief({ now: NOW, live: null, rows: [] });
  assert.equal(b.score.fills, 0);
  assert.equal(b.right_wait, null);
  assert.equal(b.wrong_fill, null);
  assert.equal(b.ledger_unavailable, false);
  assert.equal(b.authority, "none");
  assert.equal(b.copy.empty, "No hourly fills yet. The 15-minute floor is a different book.");
  assert.equal(b.copy.separate, "The 15-minute floor and the hourly book are graded separately.");
  assert.equal(HOUR_EMPTY_COPY, b.copy.empty);
  assert.equal(HOUR_SEPARATE_COPY, b.copy.separate);
});

test("an unreadable ledger is flagged as unavailable rather than scored as empty", () => {
  const b = buildHourBrief({ now: NOW, live: null, rows: null });
  assert.equal(b.ledger_unavailable, true);
  assert.equal(b.score.windows, 0);
});

test("sits without fills are graded windows with no record, and a WAIT is right only when a lean missed", () => {
  const rows = [row({ ticker: "A" }), row({ ticker: "B", chair_lean: "YES", result: "NO", close_time: "2026-09-18T17:00:00.000Z" })];
  const s = hourScore(rows);
  assert.equal(s.windows, 2);
  assert.equal(s.sits, 2);
  assert.equal(s.fills, 0);
  assert.equal(s.net, 0);
  const w = hourRightWait(rows);
  assert.equal(w?.ticker, "B");
  assert.match(w!.reason, /leaned YES, nothing filled, and NO paid/);
  assert.equal(hourWrongFill(rows), null, "a sit is never a wrong fill");
});

test("real fills score with break-even at the prices paid, and the wrong fill is the worst real loss", () => {
  const rows = [
    row({ ticker: "W", entry_side: "YES", entry_cents: 80, entry_fee_cents: 2, ev_cents: 18, result: "YES" }),
    row({ ticker: "L", entry_side: "YES", entry_cents: 85, entry_fee_cents: 1, ev_cents: -86, result: "NO", close_time: "2026-09-18T17:00:00.000Z", question: "Bitcoin at or above $78,000 at 1:00 PM Eastern?" }),
    row({ ticker: "S" }),
  ];
  const s = hourScore(rows);
  assert.equal(s.windows, 3);
  assert.equal(s.fills, 2);
  assert.equal(s.sits, 1);
  assert.equal(s.wins, 1);
  assert.equal(s.win_rate, 50);
  assert.equal(s.needed, 82.7, "L/(W+L) with W=18 and L=86");
  assert.equal(s.net, -68);
  assert.equal(s.max_dd, -86);
  const f = hourWrongFill(rows);
  assert.equal(f?.ticker, "L");
  assert.equal(f?.side, "YES");
  assert.equal(f?.ask, 85);
  assert.equal(f?.fee, 1);
  assert.equal(f?.ev, -86);
  assert.equal(f?.result, "NO");
});

test("the brief carries the live window and never mentions the 15-minute contract's sides", () => {
  const live = pickHourWindow([{ ticker: "KXBTCD-26SEP1815-T78000", close_time: "2026-09-18T19:00:00.000Z", yes_ask_dollars: "0.62", floor_strike: 78000, title: "Bitcoin price at 3pm EDT?", yes_sub_title: "$78,000 or above" }], NOW, null);
  const b = buildHourBrief({ now: NOW, live, rows: [] });
  assert.equal(b.live?.question, "Bitcoin price at 3pm EDT: yes pays if $78,000 or above.");
  assert.doesNotMatch(JSON.stringify(b), /"UP"|"DOWN"|buy|signal/i);
  assert.match(b.window.label, /Last 7 days of hourly windows/);
});
