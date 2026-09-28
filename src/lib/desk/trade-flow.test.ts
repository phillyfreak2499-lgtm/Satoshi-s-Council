import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOW_DEF, FLOW_H0, MAX_GAP_MINUTES, applyPoll, flowH0, flowQuality, flowSpan, freshVenue, indexMinutes, okxContractMatches, overlaps,
  parseCoinbaseTrades, parseOkxTrades, sealReady, type FlowWindow, type NormTrade, type StoredMinute,
} from "./trade-flow.ts";

const T0 = Date.parse("2026-09-28T15:00:00Z");
const tr = (id: number, secs: number, aggressor: "BUY" | "SELL" = "BUY", base = 1, px = 60_000): NormTrade => ({ id, ts: T0 + secs * 1000, px, base, aggressor });

test("the aggressor is frozen per venue: Coinbase reports the maker's side (inverted), OKX the taker's; OKX contracts are 0.01 BTC", () => {
  assert.ok(Object.isFrozen(FLOW_DEF) && Object.isFrozen(FLOW_DEF.venues) && Object.isFrozen(FLOW_DEF.venues.OKX_PERP));
  const cb = parseCoinbaseTrades([
    { trade_id: 10, time: "2026-09-28T15:00:01.5Z", price: "60000.10", size: "0.25", side: "buy" },  // maker bought: an aggressive SELL
    { trade_id: 11, time: "2026-09-28T15:00:02Z", price: "60001", size: "0.5", side: "sell" },       // maker sold: an aggressive BUY
    { trade_id: 12, time: "nope", price: "1", size: "1", side: "buy" },
    { trade_id: 2 ** 60, time: "2026-09-28T15:00:02Z", price: "1", size: "1", side: "buy" },
  ]);
  assert.deepEqual(cb.trades.map((t) => [t.id, t.aggressor, t.base]), [[10, "SELL", 0.25], [11, "BUY", 0.5]]);
  assert.equal(cb.rejected, 2, "malformed rows and unsafe ids are rejected, never guessed");
  const okx = parseOkxTrades({ code: "0", data: [
    { instId: "BTC-USDT-SWAP", tradeId: "900", ts: String(T0 + 1000), px: "60000", sz: "12", side: "buy" },
    { instId: "BTC-USDT-SWAP", tradeId: "901", ts: String(T0 + 2000), px: "60000", sz: "3", side: "sell" },
  ] });
  assert.deepEqual(okx.trades.map((t) => [t.id, t.aggressor, t.base]), [[900, "BUY", 0.12], [901, "SELL", 0.03]]);
  assert.deepEqual(parseOkxTrades({ code: "50011", data: [] }), { trades: [], rejected: 0 }, "an error body is no data, not zero flow");
  assert.equal(okxContractMatches({ data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.01", ctValCcy: "BTC" }] }), true);
  assert.equal(okxContractMatches({ data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.001", ctValCcy: "BTC" }] }), false, "a changed contract halts the venue");
});

test("continuity: the first partial minute is never written; a minute seals only after a poll lands past its end; empty minutes are written as zero", () => {
  const vs = freshVenue("COINBASE_SPOT");
  applyPoll(vs, [tr(1, 30), tr(2, 45, "SELL")], true, T0 + 50_000);        // first seen at 15:00:30: minute 15:00 partly seen
  assert.equal(vs.coverageFrom, T0 + 60_000);
  let batch = [tr(1, 30), tr(2, 45, "SELL"), tr(3, 61, "BUY", 2, 60_010), tr(4, 70, "SELL", 0.5, 59_990), tr(5, 119, "BUY", 1, 60_020)];
  assert.equal(overlaps(vs, batch), true);
  applyPoll(vs, batch, true, T0 + 125_000);
  assert.deepEqual(sealReady(vs, 10_000), [], "15:01 ends at 15:02:00; 15:02:05 is inside the seal lag");
  batch = [...batch, tr(6, 200)];
  applyPoll(vs, batch, overlaps(vs, batch), T0 + 250_000);
  const rows = sealReady(vs, 10_000);
  assert.deepEqual(rows.map((r) => new Date(r.minute_ms).toISOString()), ["2026-09-28T15:01:00.000Z", "2026-09-28T15:02:00.000Z", "2026-09-28T15:03:00.000Z"]);
  const m1 = rows[0]!;
  assert.equal(m1.complete, true);
  assert.deepEqual([m1.n_buy, m1.n_sell, m1.buy_base, m1.sell_base], [2, 1, 3, 0.5]);
  assert.deepEqual([m1.open_px, m1.close_px, m1.high_px, m1.low_px, m1.first_trade_id, m1.last_trade_id], [60_010, 60_020, 60_020, 59_990, "3", "5"]);
  assert.equal(m1.buy_quote, 2 * 60_010 + 60_020);
  assert.equal(rows[1]!.n_buy + rows[1]!.n_sell, 0, "15:02 had no trades: written as a zero minute, not skipped");
  assert.equal(rows[1]!.complete, true);
  assert.equal(vs.buckets.has(T0 + 180_000), false, "15:03 is written; its bucket is released");
});

test("a poll that cannot reach the trades it saw last is a GAP on every minute it touches, never filled in; a long break leaves minutes absent", () => {
  const vs = freshVenue("OKX_PERP");
  applyPoll(vs, [tr(1, 5)], true, T0 + 10_000);
  applyPoll(vs, [tr(1, 5), tr(2, 70)], true, T0 + 80_000);
  const batch = [tr(50, 190), tr(51, 250)];                    // ids 3..49 never fetched
  assert.equal(overlaps(vs, batch), false);
  applyPoll(vs, batch, false, T0 + 320_000);
  const rows = sealReady(vs, 10_000);
  assert.deepEqual(rows.map((r) => [new Date(r.minute_ms).toISOString().slice(11, 16), r.complete, r.flags]), [
    ["15:01", false, ["GAP"]], ["15:02", false, ["GAP"]], ["15:03", false, ["GAP"]], ["15:04", true, []],
  ]);
  assert.equal(vs.counters.gaps, 1);
  // A break longer than MAX_GAP_MINUTES is skipped, not written as hundreds of flagged rows.
  const long = [tr(900, 250 + (MAX_GAP_MINUTES + 5) * 60)];
  applyPoll(vs, long, false, long[0]!.ts + 80_000);
  const after = sealReady(vs, 10_000);
  assert.equal(vs.counters.long_gaps, 1);
  assert.ok(after.length <= 2 && after.every((r) => r.minute_ms > long[0]!.ts - 60_000), "only minutes after the break are written");
});

test("a trade that lands in an already-written minute is counted, never rewrites the row; skew and disorder are flagged", () => {
  const vs = freshVenue("COINBASE_SPOT");
  applyPoll(vs, [tr(1, 1)], true, T0 + 2_000);
  applyPoll(vs, [tr(1, 1), tr(2, 70)], true, T0 + 140_000);
  assert.equal(sealReady(vs, 10_000).length, 1);
  applyPoll(vs, [tr(2, 70), tr(3, 100), tr(4, 150), tr(5, 135)], true, T0 + 150_000);
  assert.equal(vs.counters.late, 1, "trade 3 at 15:01:40 arrived after 15:01 was written");
  applyPoll(vs, [tr(5, 135), tr(6, 400)], true, T0 + 200_000);   // stamped 200 s after our clock
  const rows = sealReady(vs, 10_000);
  const m2 = rows.find((r) => r.minute_ms === T0 + 120_000)!;
  assert.deepEqual(m2.flags, ["OUT_OF_ORDER"], "trade 5 is stamped earlier than trade 4");
  assert.ok(vs.counters.clock_skew >= 1);
});

// ---------------------------------------------------------------------------
// Features, collection quality and the gated H0.
// ---------------------------------------------------------------------------

const CLOSE = Date.parse("2026-09-28T15:15:00Z");
function spotMinutes(closeMs: number, lean: number, complete = true, venue: StoredMinute["venue"] = "COINBASE_SPOT"): StoredMinute[] {
  const at = closeMs - 180_000;
  return Array.from({ length: 5 }, (_, k) => ({ venue, minute_ms: at - (5 - k) * 60_000, complete, flags: complete ? [] : ["GAP"], buy_base: lean > 0 ? 3 : 1, sell_base: lean < 0 ? 3 : 1, n: 10 }));
}

test("a span is null unless every minute is present and complete; normalized delta is signed volume over volume", () => {
  const idx = indexMinutes(spotMinutes(CLOSE, 1));
  const s = flowSpan(idx, "COINBASE_SPOT", CLOSE - 180_000, 5);
  assert.deepEqual([s.complete, s.delta_base, s.volume_base, s.norm], [true, 10, 20, 0.5]);
  assert.equal(flowSpan(idx, "COINBASE_SPOT", CLOSE - 120_000, 5).complete, false, "a minute not collected makes the span incomplete");
  assert.equal(flowSpan(indexMinutes(spotMinutes(CLOSE, 1, false)), "COINBASE_SPOT", CLOSE - 180_000, 5).norm, null, "a GAP minute never feeds a feature");
  assert.equal(flowSpan(idx, "OKX_PERP", CLOSE - 180_000, 5).complete, false, "venues are kept separate");
});

function windows(n: number, lean: (i: number, favWon: boolean) => number, favWon: (i: number) => boolean, opts: { complete?: boolean; staleMark?: boolean } = {}) {
  const ws: FlowWindow[] = [], mins: StoredMinute[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = CLOSE + i * 900_000, yesMid = 82 + (i % 12), won = favWon(i);
    ws.push({ ticker: `KXBTC15M-F${i}`, close_ms: c, winner: won ? "UP" : "DOWN", marks: { 180: { yes_mid: yesMid, yes_bid: yesMid - 0.5, yes_ask: yesMid + 0.5, no_bid: 100 - yesMid - 0.5, no_ask: 100 - yesMid + 0.5, quote_age_ms: opts.staleMark ? 60_000 : 400 } } });
    mins.push(...spotMinutes(c, lean(i, won), opts.complete ?? true));
  }
  return { ws, idx: indexMinutes(mins), mins };
}

test("collection quality reports each venue's coverage and complete rate, then complete windows per clock", () => {
  const { ws, idx, mins } = windows(3, () => 1, () => true);
  mins.push({ ...mins[0]!, venue: "OKX_PERP", minute_ms: mins[0]!.minute_ms, complete: false, flags: ["GAP"] });
  const q = flowQuality(mins, ws, indexMinutes(mins));
  const spot = q.venues.find((v) => v.venue === "COINBASE_SPOT")!;
  assert.equal(spot.minutes_recorded, 15);
  assert.equal(spot.complete_pct, 100);
  assert.ok(spot.coverage_pct! < 100, "minutes between windows were not collected");
  assert.deepEqual(q.venues.find((v) => v.venue === "OKX_PERP")!.flags, [{ flag: "GAP", n: 1 }]);
  const c180 = q.by_clock.find((c) => c.clock === 180)!;
  assert.deepEqual([c180.settled_windows, c180.marks, c180.fresh_marks, c180.complete_spot_5m, c180.complete_perp_5m], [3, 3, 3, 3, 0]);
  assert.equal(idx.size, 15);
});

test("H0 is pre-registered, waits for its minimum clean sample, and retires flow that merely restates price", () => {
  assert.equal(FLOW_H0.hypothesis_kind, "PRESPECIFIED");
  assert.ok(Object.isFrozen(FLOW_H0) && Object.isFrozen(FLOW_H0.primary));
  assert.equal(FLOW_H0.primary.venue, "COINBASE_SPOT");
  const rng = (() => { let x = 11; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();
  const outcomes = Array.from({ length: 400 }, () => rng());
  const favWon = (i: number) => outcomes[i]! < (0.82 + (i % 12) / 100);
  let w = windows(299, () => 1, favWon);
  assert.equal(flowH0(w.ws, w.idx).verdict, "INSUFFICIENT_SAMPLE", "299 clean windows are not enough");
  w = windows(400, () => 1, favWon, { complete: false });
  assert.equal(flowH0(w.ws, w.idx).verdict, "INSUFFICIENT_SAMPLE", "incomplete minutes never count");
  w = windows(400, () => 1, favWon, { staleMark: true });
  assert.equal(flowH0(w.ws, w.idx).clean_observations, 0, "a stale price mark is not a clean control");
  w = windows(400, () => 1, favWon);
  assert.equal(flowH0(w.ws, w.idx).verdict, "RETIRE_CANDIDATE", "flow always leaning with the favourite restates price");
  w = windows(400, (_i, won) => (won ? 1 : -1), favWon);
  const informed = flowH0(w.ws, w.idx);
  assert.equal(informed.verdict, "INFORMATIVE_CANDIDATE");
  assert.ok(informed.economics!.same_time_price_control.fills >= informed.economics!.flow_rule.fills);
  assert.equal(informed.exploratory!.hypothesis_kind, "EXPLORATORY");
  assert.equal(informed.exploratory!.perp.n, 0, "no perp minutes: the secondary has nothing to say");
  assert.match(informed.note, /frozen prospective shadow test/);
});

test("deterministic and non-mutating", () => {
  const w = windows(40, (i) => (i % 2 ? 1 : -1), (i) => i % 3 !== 0);
  const before = JSON.stringify(w.ws);
  assert.deepEqual(flowH0(w.ws, w.idx), flowH0(w.ws, w.idx));
  assert.deepEqual(flowQuality(w.mins, w.ws, w.idx), flowQuality(w.mins, w.ws, w.idx));
  assert.equal(JSON.stringify(w.ws), before);
});
