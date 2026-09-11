import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEANINGFUL_CENTS,
  excursionOf,
  excursionReport,
  groupExcursions,
  markOf,
  type ExcursionRow,
  type Mark,
} from "./excursion.ts";

/** A path of (yes_bid, yes_ask) pairs, four seconds apart from t0. */
function path(pairs: [number, number][], t0 = 0): Mark[] {
  return pairs.map(([b, a], i) => ({ t: t0 + i * 4000, yes_bid: b, yes_ask: a }));
}

test("a position is marked at the bid, because that is what it can be sold for", () => {
  const m = { t: 0, yes_bid: 78, yes_ask: 82 };
  assert.equal(markOf("UP", m), 78);
  // A NO position sells into the NO bid, which is 100 minus the YES ask.
  assert.equal(markOf("DOWN", m), 18);
  // Marking at the ask would invent 4¢ of profit on every UP call that never existed.
  assert.notEqual(markOf("UP", m), m.yes_ask);
});

test("a nonsense mark is skipped rather than counted", () => {
  assert.equal(markOf("UP", { t: 0, yes_bid: NaN, yes_ask: 50 }), null);
  assert.equal(markOf("DOWN", { t: 0, yes_bid: 5, yes_ask: 140 }), null);
});

test("MFE and MAE are the best and worst the position was ever worth", () => {
  //            entry 80                 peak 91          trough 62
  const p = path([[80, 82], [85, 87], [91, 93], [70, 72], [62, 64], [75, 77]]);
  const e = excursionOf("UP", 80, 0, 100, p)!;
  assert.equal(e.mfe, 11);
  assert.equal(e.mae, -18);
  assert.equal(e.mfe_at, 8);
  assert.equal(e.mae_at, 16);
  assert.equal(e.n, 6);
  assert.equal(e.realized, 20);
  assert.equal(e.ever_up, true);
});

test("a position never above entry reports zero, not a negative MFE", () => {
  const e = excursionOf("UP", 80, 0, 0, path([[80, 82], [74, 76], [61, 63]]))!;
  assert.equal(e.mfe, 0);
  assert.equal(e.ever_up, false);
  assert.equal(e.mae, -19);
});

test("marks before the fill are not part of the position", () => {
  // The book was quotable 15¢ higher before the desk bought. Counting that would
  // credit the call with a move it was never exposed to.
  const before = path([[95, 97], [93, 95]], 0);
  const after = path([[80, 82], [83, 85]], 100_000);
  const e = excursionOf("UP", 80, 100_000, 100, [...before, ...after])!;
  assert.equal(e.n, 2);
  assert.equal(e.mfe, 3);
});

test("the DOWN side is measured on its own book, not the YES one", () => {
  // YES falls, so a NO position gains. Entry 30 on NO; YES ask 70 -> NO bid 30,
  // then YES ask 45 -> NO bid 55.
  const e = excursionOf("DOWN", 30, 0, 100, path([[68, 70], [55, 57], [43, 45]]))!;
  assert.equal(e.mfe, 25);
  assert.equal(e.mae, 0);
});

test("a path with nothing usable is null, not a zeroed row", () => {
  assert.equal(excursionOf("UP", 80, 0, 100, []), null);
  assert.equal(excursionOf("UP", 80, 5000, 100, path([[80, 82]])), null, "all marks precede the fill");
  assert.equal(excursionOf("UP", 0, 0, 100, path([[80, 82]])), null);
  assert.equal(excursionOf("UP", 100, 0, 100, path([[80, 82]])), null);
});

function rows(spec: { mfe: number; mae: number; won: boolean; at?: number }[]): ExcursionRow[] {
  return spec.map((s) => ({
    mfe: s.mfe,
    mae: s.mae,
    mfe_at: s.mfe > 0 ? (s.at ?? 60) : null,
    mae_at: s.mae < 0 ? 120 : null,
    n: 50,
    realized: s.won ? 20 : -80,
    ever_up: s.mfe > 0,
    won: s.won,
    entry: 80,
  }));
}

test("a group reports the median beside the mean, because a few runners drag it", () => {
  const g = groupExcursions("x", rows([
    { mfe: 1, mae: -10, won: false },
    { mfe: 1, mae: -10, won: false },
    { mfe: 1, mae: -10, won: false },
    { mfe: 1, mae: -10, won: false },
    { mfe: 60, mae: -10, won: false },
  ]))!;
  assert.equal(g.med_mfe, 1);
  assert.ok(g.avg_mfe > 12, "the mean should be dragged by the runner");
});

test("being up a cent is not being up: the meaningful threshold is separate", () => {
  const g = groupExcursions("x", rows(Array.from({ length: 10 }, () => ({ mfe: 2, mae: -20, won: false }))))!;
  assert.equal(g.ever_up_pct, 100);
  assert.equal(g.up_meaningful_pct, 0, `2¢ is inside the spread and must not count as profit`);
});

test("losers that were never really up point at entries, not exits", () => {
  const r = excursionReport(rows(Array.from({ length: 20 }, () => ({ mfe: 1, mae: -25, won: false }))));
  assert.match(r.verdict, /exit timing is NOT the problem/);
  assert.match(r.verdict, /entries that were wrong from the start/);
});

test("losers that were genuinely up earn a hypothesis, never a rule", () => {
  const r = excursionReport(rows(Array.from({ length: 20 }, () => ({ mfe: 12, mae: -30, won: false, at: 90 }))));
  assert.match(r.verdict, /WORTH SPECIFYING/);
  // The whole point: this must not read as "so take profits at 12¢".
  assert.match(r.verdict, /hindsight/);
  assert.match(r.verdict, /tested on windows recorded afterwards/);
  assert.ok(!/take profit/i.test(r.verdict));
});

test("too few losers says so instead of producing a verdict", () => {
  const r = excursionReport(rows(Array.from({ length: 9 }, () => ({ mfe: 20, mae: -5, won: false }))));
  assert.match(r.verdict, /Fewer than 10 losing calls/);
});

test("winners are reported beside losers only as a scale", () => {
  const r = excursionReport(rows([
    ...Array.from({ length: 12 }, () => ({ mfe: 18, mae: -2, won: true })),
    ...Array.from({ length: 12 }, () => ({ mfe: 3, mae: -40, won: false })),
  ]));
  assert.equal(r.winners!.n, 12);
  assert.equal(r.losers!.n, 12);
  assert.equal(r.n, 24);
  // The verdict is about the losers; a winner being up proves nothing.
  assert.match(r.verdict, new RegExp(`${MEANINGFUL_CENTS}¢`));
});

test("an empty book of calls reports nothing rather than zeros", () => {
  const r = excursionReport([]);
  assert.equal(r.n, 0);
  assert.equal(r.winners, null);
  assert.equal(r.losers, null);
  assert.match(r.verdict, /Nothing can be said/);
});

test("the winners' drawdown is put beside the losers' peak, because a rule must survive both", () => {
  // The real shape of this book: losers peaked around +11, winners dipped to −17.
  // A "cut it at +11" rule fires on winners long before it saves a loser.
  const r = excursionReport(rows([
    ...Array.from({ length: 20 }, () => ({ mfe: 18, mae: -17, won: true })),
    ...Array.from({ length: 14 }, () => ({ mfe: 11, mae: -70, won: false })),
  ]));
  assert.match(r.verdict, /winners went under water by 17¢ on average/);
  assert.match(r.verdict, /more than the 11¢ the losers were up/);
  assert.match(r.verdict, /has to survive a winner falling further/);
});

test("the overlap warning is omitted when the ranges do not overlap", () => {
  const r = excursionReport(rows([
    ...Array.from({ length: 20 }, () => ({ mfe: 25, mae: -2, won: true })),
    ...Array.from({ length: 20 }, () => ({ mfe: 20, mae: -60, won: false })),
  ]));
  assert.ok(!/under water/.test(r.verdict), "an overlap was claimed where none exists");
  assert.match(r.verdict, /WORTH SPECIFYING/);
});

test("a thin sample of losers is labelled thin even when it produces a verdict", () => {
  const r = excursionReport(rows(Array.from({ length: 14 }, () => ({ mfe: 11, mae: -70, won: false }))));
  assert.match(r.verdict, /On only 14 losing calls/);
  assert.match(r.verdict, /a direction to look, not a result/);
});
