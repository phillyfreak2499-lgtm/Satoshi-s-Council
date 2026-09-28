import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPTH_CLOCKS, DEPTH_H0, collectionQuality, depthClockAt, depthH0, depthSnapshot,
  type BookRead, type EngineQuote, type SettledDepth,
} from "./book-depth.ts";
import { applySnapshot, freshBook, yesView } from "./lab-book.ts";

const close = Date.parse("2026-09-28T15:15:00Z");
const quote = (secsLeft = 180, extra: Partial<EngineQuote> = {}): EngineQuote => ({
  ticker: "KXBTC15M-D", as_of: close - secsLeft * 1000, close_time: close, yes_bid: 84, yes_ask: 85, no_bid: 15, no_ask: 16, yes_mid: 84.5, quote_seq: 1, ...extra,
});
const book = (extra: Partial<BookRead> = {}, bids = [{ price: 84, size: 100 }, { price: 83, size: 50 }, { price: 80, size: 30 }], asks = [{ price: 85, size: 40 }, { price: 86, size: 20 }]): BookRead => ({
  ticker: "KXBTC15M-D", view: { bids, asks }, ok: true, stale: false, gaps: 0, flips: 0, snap_t: close - 400_000, upd_t: close - 181_000, level_count: bids.length + asks.length, trusted: true, ...extra,
});

test("the Lab's book maps onto one YES axis: a NO bid at 15c is a YES ask at 85c, and reading it mutates nothing", () => {
  const b = freshBook("KXBTC15M-D", false);
  applySnapshot(b, { yes_dollars_fp: [["0.84", "100"], ["0.83", "50"]], no_dollars_fp: [["0.15", "40"], ["0.14", "20"]] }, close - 400_000);
  const before = JSON.stringify([...b.yes, ...b.no]);
  const v = yesView(b);
  assert.deepEqual(v.bids.map((l) => [l.price, l.size]), [[84, 100], [83, 50]]);
  assert.deepEqual(v.asks.map((l) => [l.price, l.size]), [[85, 40], [86, 20]]);
  v.bids.push({ price: 1, size: 1 });
  assert.equal(JSON.stringify([...b.yes, ...b.no]), before, "the collector's copy cannot change the Lab's book");
});

test("fixed clocks: T-10, T-5, T-3, T-1 minutes, each with a short grace", () => {
  assert.deepEqual([...DEPTH_CLOCKS], [600, 300, 180, 60]);
  assert.equal(depthClockAt(600), 600);
  assert.equal(depthClockAt(590), 600);
  assert.equal(depthClockAt(587), null);
  assert.equal(depthClockAt(181), null, "a clock's window is (c - 12, c]: 181 s is not yet T-3:00");
  assert.equal(depthClockAt(179), 180);
});

test("features: depth by side, near-touch weighting, imbalance, slope; YES and NO names describe the same orders", () => {
  const s = depthSnapshot(180, quote(), book(), null);
  assert.equal(s.quality.clean, true, String(s.quality.flags));
  const f = s.features!;
  assert.equal(f.best_yes_bid, 84);
  assert.equal(f.best_yes_ask, 85);
  assert.equal(f.spread_cents, 1);
  assert.equal(f.yes_bid_depth, 180);
  assert.equal(f.no_ask_depth, 180, "a YES bid is a NO ask");
  assert.equal(f.yes_ask_depth, 60);
  assert.equal(f.no_bid_depth, 60);
  assert.ok(Math.abs(f.near_touch_bid - (100 + 50 / 2 + 30 / 5)) < 1e-9, "weights 1/(1 + cents from touch): 84c x1, 83c x1/2, 80c x1/5");
  assert.equal(f.near_touch_ask, 40 + 20 / 2);
  assert.equal(f.imbalance, Math.round(((131 - 50) / 181) * 1e4) / 1e4);
  assert.ok(f.imbalance! > 0, "more resting YES buying than selling near the touch");
  assert.ok(f.bid_slope! > 0 && f.ask_slope! > 0);
  assert.equal(f.bid_added, null, "no previous snapshot: flow is unknown, not zero");
  assert.equal(f.imbalance_persisted, null);
  assert.equal(s.levels!.bids.length, 3);
});

test("adds, removals and persistence are measured against the previous snapshot of the same window", () => {
  const first = depthSnapshot(300, quote(300), book({ upd_t: close - 301_000 }), null);
  const second = depthSnapshot(180, quote(), book({}, [{ price: 84, size: 70 }, { price: 83, size: 90 }]), first);
  assert.equal(second.features!.bid_added, 40, "83c grew 50 -> 90");
  assert.equal(second.features!.bid_removed, 60, "84c shrank 100 -> 70, 80c (30) left the book");
  assert.equal(second.features!.ask_added, 0);
  assert.equal(second.features!.imbalance_persisted, true);
});

test("every data-quality problem is flagged, and only a flag-free snapshot is clean", () => {
  const cases: Array<[string, () => ReturnType<typeof depthSnapshot>]> = [
    ["BOOK_MISSING", () => depthSnapshot(180, quote(), null, null)],
    ["NO_SNAPSHOT_LOADED", () => depthSnapshot(180, quote(), book({ ok: false }), null)],
    ["SEQUENCE_GAP_STALE", () => depthSnapshot(180, quote(), book({ stale: true }), null)],
    ["BOOK_OLD", () => depthSnapshot(180, quote(), book({ upd_t: close - 300_000 }), null)],
    ["CROSSED", () => depthSnapshot(180, quote(), book({}, [{ price: 86, size: 10 }], [{ price: 85, size: 10 }]), null)],
    ["QUOTE_MISMATCH_ASK", () => depthSnapshot(180, quote(180, { yes_ask: 88 }), book(), null)],
    ["TICKER_MISMATCH", () => depthSnapshot(180, quote(), book({ ticker: "OTHER" }), null)],
    ["EMPTY_ASKS", () => depthSnapshot(180, quote(), book({}, undefined, []), null)],
  ];
  for (const [flag, make] of cases) {
    const s = make();
    assert.ok(s.quality.flags.includes(flag), `${flag}: ${s.quality.flags}`);
    assert.equal(s.quality.clean, false, flag);
  }
  const prev = depthSnapshot(300, quote(300), book({ upd_t: close - 301_000, gaps: 2 }), null);
  assert.ok(depthSnapshot(180, quote(), book({ gaps: 3 }), prev).quality.flags.includes("GAPS_SINCE_PREV"));
  const missing = depthSnapshot(180, quote(), null, null);
  assert.equal(missing.features, null, "a missing book is recorded as missing, never filled in");
});

test("deterministic and non-mutating", () => {
  const q = quote(), b = book();
  const before = JSON.stringify({ q, b });
  assert.deepEqual(depthSnapshot(180, q, b, null), depthSnapshot(180, q, b, null));
  assert.equal(JSON.stringify({ q, b }), before);
});

// ---------------------------------------------------------------------------
// Collection quality and the gated H0.
// ---------------------------------------------------------------------------

function settled(n: number, lean: (i: number, favWon: boolean) => number, favWon: (i: number) => boolean, clean = true): SettledDepth[] {
  const out: SettledDepth[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = close + i * 900_000;
    const yesMid = 82 + (i % 12);
    const won = favWon(i);
    const imb = lean(i, won);
    const s = depthSnapshot(180, { ...quote(), close_time: c, as_of: c - 180_000, yes_mid: yesMid, yes_ask: yesMid + 0.5, yes_bid: yesMid - 0.5 },
      book({ upd_t: c - 181_000 }, [{ price: yesMid - 0.5, size: imb > 0 ? 200 : 20 }], [{ price: yesMid + 0.5, size: imb > 0 ? 20 : imb < 0 ? 200 : 20 }]), null);
    if (!clean) s.quality.clean = false;
    out.push({ ...s, winner: won ? "UP" : "DOWN" });
  }
  return out;
}

test("collection quality reports coverage and clean rate per clock", () => {
  const rows = [...settled(10, () => 1, () => true), depthSnapshot(180, quote(), null, null) as SettledDepth];
  const q = collectionQuality(rows, 20);
  const c180 = q.by_clock.find((c) => c.clock === 180)!;
  assert.equal(c180.snapshots, 11);
  assert.equal(c180.coverage_pct, 55);
  assert.equal(c180.clean, 10);
  assert.deepEqual(c180.flags, [{ flag: "BOOK_MISSING", n: 1 }]);
});

test("H0 is pre-registered, waits for its minimum clean sample, and retires depth that merely restates price", () => {
  assert.equal(DEPTH_H0.hypothesis_kind, "PRESPECIFIED");
  assert.ok(Object.isFrozen(DEPTH_H0));
  const rng = (() => { let x = 11; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();
  const outcomes = Array.from({ length: 400 }, () => rng());
  const favWon = (i: number) => outcomes[i]! < (0.82 + (i % 12) / 100);
  assert.equal(depthH0(settled(299, () => 1, favWon)).verdict, "INSUFFICIENT_SAMPLE", "299 clean snapshots are not enough");
  assert.equal(depthH0(settled(400, () => 1, favWon, false)).verdict, "INSUFFICIENT_SAMPLE", "unclean snapshots never count");
  // Depth always leans with the favourite: it restates the price.
  const echo = depthH0(settled(400, () => 1, favWon));
  assert.equal(echo.verdict, "RETIRE_CANDIDATE");
  // Depth leans against the favourite exactly when the favourite is about to lose (and sometimes otherwise).
  const informed = depthH0(settled(400, (i, won) => (won ? 1 : -1), favWon));
  assert.equal(informed.verdict, "INFORMATIVE_CANDIDATE");
  const econ = informed.economics!;
  assert.ok(econ.depth_rule.fills > 0 && econ.same_time_price_control.fills >= econ.depth_rule.fills);
  assert.match(informed.note, /frozen prospective shadow test/);
});
