/**
 * REQ-EXT-001 / PRICE-SETTLEMENT-A regression coverage.
 *
 * Quote ingestion and official settlement, exercised through the real
 * production functions (no re-implementations here). Venue fixtures are
 * verbatim captures from Kalshi's public Trade API v2 on 2026-09-28/29 UTC.
 *
 * Primary rules the expectations are pinned to:
 * - Orderbook is bid-only; best YES ask = $1 − best NO bid
 *   (https://docs.kalshi.com/getting_started/orderbook_responses).
 * - KXBTC15M price grid `tapered_deci_cent`: 0.1¢ below 10¢ and from 90¢, 1¢
 *   between (market.price_ranges; https://docs.kalshi.com/getting_started/fixed_point_migration).
 * - Settlement: YES iff the simple average of the 60 BRTI seconds before
 *   close, rounded to 2 decimals, is AT LEAST the prior window's average
 *   (market.rules_primary / rules_secondary, strike_type greater_or_equal;
 *   https://assets.kalshi.com/contract_terms/CRYPTO.pdf: "at least X means X or
 *   greater"; missing/incomplete data resolves No).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { freshBrti, pushBrti, settleFair } from "./brti.ts";
import { feeCents } from "./fee-engine.ts";
import { interpretKalshiBook } from "./kalshi-book.ts";
import { collectSettles, parseKalshiResult, type KalshiMarketRow } from "./kalshi-settle.ts";
import { onTickGrid, storedAskUncertaintyCents } from "./price-precision.ts";
import { settleReceipt, type ShadowReceipt } from "./shadow-lab.ts";
import { matchSettle } from "./window-identity.ts";
import type { OfficialSettle } from "./types";

// --- Venue captures --------------------------------------------------------

/** GET /markets/KXBTC15M-26SEP281815-15/orderbook?depth=3, ~2026-09-28T22:10Z. */
const LIVE_BOOK_281815 = {
  orderbook_fp: { no_dollars: [["0.9970", "9049.53"], ["0.9980", "6189.01"], ["0.9990", "42412.93"]], yes_dollars: [] },
};

/** KXBTC15M-26SEP281815-15 market object, price_ranges field. */
const LIVE_PRICE_RANGES = [
  { end: "0.1000", start: "0.0000", step: "0.0010" },
  { end: "0.9000", start: "0.1000", step: "0.0100" },
  { end: "1.0000", start: "0.9000", step: "0.0010" },
];

/** GET /markets?series_ticker=KXBTC15M&status=settled, 2026-09-29T04:41Z (fields verbatim; absent keys omitted). */
const LIVE_FINALIZED: Array<KalshiMarketRow & { status: string; floor_strike: number; settlement_value_dollars: string }> = [
  { ticker: "KXBTC15M-26SEP290030-30", status: "finalized", close_time: "2026-09-29T04:30:00Z", result: "yes", settlement_value_dollars: "1.0000", expiration_value: "83198.58", settlement_ts: "2026-09-29T04:30:06.48886Z", floor_strike: 83103.78 },
  { ticker: "KXBTC15M-26SEP290015-15", status: "finalized", close_time: "2026-09-29T04:15:00Z", result: "yes", settlement_value_dollars: "1.0000", expiration_value: "83103.78", settlement_ts: "2026-09-29T04:15:06.493849Z", floor_strike: 83027.21 },
  { ticker: "KXBTC15M-26SEP290000-00", status: "finalized", close_time: "2026-09-29T04:00:00Z", result: "no", settlement_value_dollars: "0.0000", expiration_value: "83027.21", settlement_ts: "2026-09-29T04:00:06.494508Z", floor_strike: 83099.54 },
];

/** An active market as the open-market list returns it: result is the empty string. */
const LIVE_ACTIVE: KalshiMarketRow = { ticker: "KXBTC15M-26SEP290045-45", close_time: "2026-09-29T04:45:00Z", result: "" };

const legacyFallback = { yes_bid: 84, yes_ask: 16, no_bid: 83, no_ask: 17 };

const fill = (ask: number, side: "UP" | "DOWN"): ShadowReceipt => ({
  experiment: "PRICE_SETTLEMENT_A_FIXTURE", arm: "X", ticker: "KXBTC15M-26SEP290030-30", close_ms: Date.parse("2026-09-29T04:30:00Z"),
  kind: "fill", decided_ms: Date.parse("2026-09-29T04:24:00Z"), side, ask_cents: ask, fee_engine: "KALSHI_TAKER_7PCT_CEIL_CENT_V1",
  fee_cents: feeCents(ask), size_at_ask: 10, spread_cents: 1, feeds_ok: true, hittable_150ms: null, hittable_500ms: null,
  official_winner: null, net_cents: null, note: null,
});

// --- 1. Quote ingestion ----------------------------------------------------

test("live venue book: YES ask is 100 − the MAX NO bid (not row [0]); fixed-point sizes survive; empty YES side falls back to market fields with zero size", () => {
  const q = interpretKalshiBook(LIVE_BOOK_281815, legacyFallback);
  // Exact lane: best NO bid is 99.9¢ (last row), so the YES ask is 0.1¢ with that level's depth.
  assert.equal(q.no_bid_exact, 99.9);
  assert.equal(q.yes_ask_exact, 0.1);
  assert.equal(q.no_bid_size_exact, 42412.93);
  // Legacy lane: 99.7–99.9¢ all round to 100¢, are outside 1–99 and rejected, so the
  // whole-cent decision quote falls back to the market-object fields.
  assert.equal(q.no_bid, 83);
  assert.equal(q.yes_ask, 16);
  assert.equal(q.no_bid_size, 0);
  // No YES bids at all: the NO ask comes from the market field, with no depth claimed.
  assert.equal(q.yes_bid, 84);
  assert.equal(q.no_ask, 17);
  assert.equal(q.yes_bid_size, 0);
  assert.equal(q.yes_bid_size_exact, 0);
});

test("missing book payload never invents depth: both lanes use the market fields and sizes are 0", () => {
  for (const raw of [null, {}, { orderbook_fp: null }, { orderbook_fp: { yes_dollars: "bad", no_dollars: [["x", "1"]] } }]) {
    const q = interpretKalshiBook(raw, { yes_bid: 94, yes_ask: 95, no_bid: 5, no_ask: 6, yes_ask_exact: 95.4, no_bid_exact: 4.6 });
    assert.equal(q.yes_ask, 95);
    assert.equal(q.yes_ask_exact, 95.4);
    assert.equal(q.no_bid_exact, 4.6);
    assert.equal(q.yes_bid_size, 0);
    assert.equal(q.no_bid_size, 0);
    assert.equal(q.no_bid_size_exact, 0);
  }
});

test("above 90¢ the exact lane keeps every 0.1¢ ask; the whole-cent decision lane stays within its declared ±0.5¢ bound", () => {
  // Every valid NO bid on the 0.1¢ grid from 1.0¢ to 9.9¢ gives a YES ask from 90.1¢ to 99.0¢.
  for (let tenths = 10; tenths <= 99; tenths++) {
    const noBid = tenths / 10;
    const q = interpretKalshiBook({ orderbook_fp: { no_dollars: [[(noBid / 100).toFixed(4), "7.00"]], yes_dollars: [] } }, legacyFallback);
    const exact = Math.round((100 - noBid) * 1000) / 1000;
    assert.equal(q.yes_ask_exact, exact, `exact ask at NO bid ${noBid}¢`);
    assert.equal(onTickGrid(q.yes_ask_exact!), true, `${exact}¢ is on the venue grid`);
    assert.equal(Number.isInteger(q.yes_ask), true);
    assert.ok(Math.abs(q.yes_ask - exact) <= storedAskUncertaintyCents(q.yes_ask) + 1e-9, `legacy ${q.yes_ask} vs exact ${exact}`);
  }
  // The legacy rounding error runs BOTH ways: half-cent NO bids round up (ask understated),
  // others round down (ask overstated). Receipts must therefore carry the exact ask.
  const at = (noBid: string) => interpretKalshiBook({ orderbook_fp: { no_dollars: [[noBid, "1"]], yes_dollars: [] } }, legacyFallback);
  assert.deepEqual([at("0.0450").yes_ask, at("0.0450").yes_ask_exact], [95, 95.5]);
  assert.deepEqual([at("0.0440").yes_ask, at("0.0440").yes_ask_exact], [96, 95.6]);
});

test("CHARACTERIZATION (legacy lane): when two venue levels round to the same cent, the decision size is the WORSE level's depth", () => {
  // NO bids 4.5¢ ×100 and 4.6¢ ×5: true best YES ask is 95.4¢ with 5 contracts.
  const q = interpretKalshiBook({ orderbook_fp: { no_dollars: [["0.0450", "100.00"], ["0.0460", "5.00"]], yes_dollars: [] } }, legacyFallback);
  assert.equal(q.yes_ask_exact, 95.4);
  assert.equal(q.no_bid_size_exact, 5);
  // Legacy chooser keeps the first of the tied rounded levels (documented as deliberate, to
  // preserve Chair behavior): it reports 95¢ with 100 contracts of touch.
  assert.equal(q.yes_ask, 95);
  assert.equal(q.no_bid_size, 100);
});

test("venue price grid (captured price_ranges) and the desk's onTickGrid agree on every 0.1¢ point in (0, 100)", () => {
  const venueOnGrid = (cents: number): boolean => {
    const d = cents / 100;
    return LIVE_PRICE_RANGES.some((r) => {
      const start = Number(r.start), end = Number(r.end), step = Number(r.step);
      if (d < start - 1e-12 || d > end + 1e-12) return false;
      const k = (d - start) / step;
      return Math.abs(k - Math.round(k)) < 1e-6;
    });
  };
  for (let tenths = 1; tenths < 1000; tenths++) {
    const c = tenths / 10;
    assert.equal(onTickGrid(c), venueOnGrid(c), `grid disagreement at ${c}¢`);
  }
});

test("receipts are priced at the exact ask: a 95.4¢ fill keeps its fraction through fee and net; a 99.9¢ fill loses money even when it wins", () => {
  const won = settleReceipt(fill(95.4, "UP"), "UP");
  const lost = settleReceipt(fill(95.4, "UP"), "DOWN");
  assert.equal(won.fee_cents, 1);
  assert.equal(Math.round(won.net_cents! * 1000) / 1000, 3.6);
  assert.equal(Math.round(lost.net_cents! * 1000) / 1000, -96.4);
  const edge = settleReceipt(fill(99.9, "DOWN"), "DOWN");
  assert.equal(Math.round(edge.net_cents! * 1000) / 1000, -0.9);
  // Unpriceable ask: official winner recorded, no net invented.
  const hole = settleReceipt({ ...fill(95, "UP"), ask_cents: 100 }, "UP");
  assert.equal(hole.official_winner, "UP");
  assert.equal(hole.net_cents, null);
});

// --- 2. Official settlement -----------------------------------------------

test("official result is read from Kalshi's `result`: live finalized rows grade UP/DOWN with the settled 60s-average value and settlement time", () => {
  const into: OfficialSettle[] = [];
  collectSettles(LIVE_FINALIZED, 1_000, "external-api.kalshi.com", into);
  assert.deepEqual(into.map((s) => [s.ticker, s.lean, s.value]), [
    ["KXBTC15M-26SEP290030-30", "UP", 83198.58],
    ["KXBTC15M-26SEP290015-15", "UP", 83103.78],
    ["KXBTC15M-26SEP290000-00", "DOWN", 83027.21],
  ]);
  assert.equal(into[0]!.close_time, Date.parse("2026-09-29T04:30:00Z"));
  assert.equal(into[0]!.provider_ts, Date.parse("2026-09-29T04:30:06.48886Z"));
  // Reference basis (venue fact, not desk code): each window's strike is the previous
  // window's settled average — the "prior-window comparison" in rules_primary.
  assert.equal(Number(LIVE_FINALIZED[0]!.expiration_value), 83198.58);
  assert.equal(LIVE_FINALIZED[0]!.floor_strike, Number(LIVE_FINALIZED[1]!.expiration_value));
  assert.equal(LIVE_FINALIZED[1]!.floor_strike, Number(LIVE_FINALIZED[2]!.expiration_value));
  // The 04:30 and 04:15 YES outcomes agree with ≥ on the published values.
  for (const r of LIVE_FINALIZED) assert.equal(Number(r.expiration_value) >= r.floor_strike, r.result === "yes", r.ticker);
});

test("an exact tie is YES by rule, and the desk grades a tie from Kalshi's result, not from a local comparison", () => {
  // Synthetic row built from the rule: settled average equal to the strike, Kalshi result 'yes'.
  const tie = { ticker: "KXBTC15M-26SEP290030-30", close_time: "2026-09-29T04:30:00Z", result: "yes", expiration_value: "83103.78", settlement_ts: "2026-09-29T04:30:06Z" };
  assert.equal(parseKalshiResult(tie), "UP");
  const into: OfficialSettle[] = [];
  collectSettles([tie], 1, "h", into);
  const v = matchSettle(into, tie.ticker, Date.parse(tie.close_time));
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.settle.lean, "UP");
});

test("unavailable or undetermined official results leave the window ungraded (never a default side)", () => {
  for (const result of ["", "void", "scalar", "all_no", "YESNO", undefined]) {
    assert.equal(parseKalshiResult({ ...LIVE_ACTIVE, result }), null, `result=${String(result)}`);
  }
  const into: OfficialSettle[] = [];
  collectSettles([LIVE_ACTIVE], 1, "h", into);
  assert.equal(into.length, 0);
  const v = matchSettle(into, LIVE_ACTIVE.ticker!, Date.parse(LIVE_ACTIVE.close_time!));
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.fault, "no-settle-for-window");
  // A settle for a different window cannot grade this one.
  collectSettles(LIVE_FINALIZED, 1, "h", into);
  const other = matchSettle(into, LIVE_ACTIVE.ticker!, Date.parse(LIVE_ACTIVE.close_time!));
  assert.equal(other.ok, false);
});

test("first reader wins per ticker: a later duplicate row (e.g. from the closed list) cannot overwrite an already collected result", () => {
  const into: OfficialSettle[] = [];
  collectSettles([LIVE_FINALIZED[2]!], 1, "settled", into);
  collectSettles([{ ...LIVE_FINALIZED[2]!, result: "yes" }], 2, "closed", into);
  assert.equal(into.length, 1);
  assert.equal(into[0]!.lean, "DOWN");
  assert.equal(into[0]!.source, "settled");
});

test("PROVISIONAL, not settlement: with all 60 prints known and the average exactly on the strike, settleFair is a coin flip while the official rule is YES", () => {
  const close = Date.parse("2026-09-29T04:30:00Z");
  const strike = 83103.78;
  const st = freshBrti();
  for (let s = 59; s >= 0; s--) pushBrti(st, strike, close - s * 1000, close - s * 1000);
  const f = settleFair(st, strike, close, close, 1);
  assert.equal(f.k, 60);
  assert.equal(f.locked, true);
  assert.ok(Math.abs(f.mean - strike) < 1e-6);
  assert.ok(Math.abs(f.p_up - 0.5) < 1e-6, `model estimate at a tie is ~0.5 (${f.p_up}); Kalshi's rule resolves YES`);
  // Half-cent band below the strike: the rule rounds the average to 2dp (→ equal → YES);
  // the provisional model compares unrounded and leans DOWN.
  const st2 = freshBrti();
  for (let s = 59; s >= 0; s--) pushBrti(st2, strike - 0.004, close - s * 1000, close - s * 1000);
  const f2 = settleFair(st2, strike, close, close, 1);
  assert.equal(Math.round(f2.mean * 100) / 100, strike);
  assert.ok(f2.p_up < 0.5, `provisional p_up ${f2.p_up}`);
});
