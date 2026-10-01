import assert from "node:assert/strict";
import test from "node:test";
import { EFFORT_RESULT, WICK_SHADOW_H0, effortResult, wickShadowH0, wickShadowQuality, type ShadowRow } from "./wick-effort.ts";
import type { Candle } from "./types.ts";

const T0 = Date.parse("2026-09-28T14:00:00Z");
type Bar = { o: number; c: number; h: number; l: number; v: number };
const flat = (p: number): Bar => ({ o: p, c: p, h: p + 3, l: p - 3, v: 100 });
const rising = (p: number): Bar => ({ o: p, c: p + 3, h: p + 4.5, l: p - 1.5, v: 100 });

/** 30 flat bars, a 5-bar run up, then S and F. `mirror` reflects every price (the run becomes a run down). */
function series(S: (p: number) => Bar, F: (s: Bar) => Bar, mirror = false): Candle[] {
  const bars: Bar[] = [];
  let p = 1000;
  for (let i = 0; i < 30; i += 1) bars.push(flat(p));
  for (let i = 0; i < 5; i += 1) { bars.push(rising(p)); p += 3; }
  const s = S(p);
  bars.push(s, F(s));
  const m = (x: number) => (mirror ? 2000 - x : x);
  return bars.map((b, i) => ({ t: T0 + i * 60_000, open: m(b.o), close: m(b.c), high: mirror ? m(b.l) : b.h, low: mirror ? m(b.h) : b.l, volume: b.v, closed: true, receipt_ts: 0, source: "binance" }));
}
const asOfFor = (cs: Candle[]) => cs[cs.length - 1]!.t + 60_000 + 5_000;

// A quiet up bar on half the usual volume; the next bar makes no new high.
const noDemandS = (p: number): Bar => ({ o: p, c: p + 0.5, h: p + 1.5, l: p - 1, v: 50 });
const noFollow = (s: Bar): Bar => ({ o: s.c, c: s.c - 0.5, h: s.h - 0.1, l: s.c - 1, v: 80 });
// Heavy volume, a wide bar with a small body and a long upper wick; the next close is lower.
const absorbS = (p: number): Bar => ({ o: p, c: p + 1, h: p + 11, l: p - 1, v: 250 });

test("the predicate is frozen before any row exists", () => {
  assert.ok(Object.isFrozen(EFFORT_RESULT) && Object.isFrozen(EFFORT_RESULT.low_effort) && Object.isFrozen(EFFORT_RESULT.absorption));
  assert.equal(EFFORT_RESULT.id, "WICK_EFFORT_RESULT_V1");
  assert.ok(Object.isFrozen(WICK_SHADOW_H0));
  assert.equal(WICK_SHADOW_H0.hypothesis_kind, "PRESPECIFIED");
});

test("no demand after a run up leans DOWN; its mirror, no supply after a run down, leans UP", () => {
  const cs = series(noDemandS, noFollow);
  const r = effortResult(cs, asOfFor(cs));
  assert.equal(r.quality.clean, true, String(r.quality.flags));
  assert.deepEqual([r.label, r.stance], ["NO_DEMAND", "DOWN"]);
  const f = r.features!;
  assert.equal(f.rel_vol, 0.5, "effort is the signal bar's volume over the 30-bar median");
  assert.ok(f.spread_atr <= EFFORT_RESULT.low_effort.max_spread_atr && f.run_atr >= 1, JSON.stringify(f));
  assert.equal(f.next_new_high, false);
  const m = series(noDemandS, noFollow, true);
  assert.deepEqual([effortResult(m, asOfFor(m)).label, effortResult(m, asOfFor(m)).stance], ["NO_SUPPLY", "UP"]);
});

test("absorption: heavy effort, wide range, small body and a long wick, with no follow-through", () => {
  const cs = series(absorbS, (s) => ({ o: s.c, c: s.c - 1, h: s.c + 0.5, l: s.c - 2, v: 120 }));
  const r = effortResult(cs, asOfFor(cs));
  assert.deepEqual([r.label, r.stance], ["ABSORPTION_TOP", "DOWN"]);
  assert.ok(r.features!.upper_wick_frac >= 0.5 && r.features!.body_frac <= 0.35 && r.features!.rel_vol >= 1.8);
  const m = series(absorbS, (s) => ({ o: s.c, c: s.c - 1, h: s.c + 0.5, l: s.c - 2, v: 120 }), true);
  assert.equal(effortResult(m, asOfFor(m)).label, "ABSORPTION_BOTTOM");
});

test("follow-through, ordinary effort or no prior run keeps it silent", () => {
  let cs = series(noDemandS, (s) => ({ o: s.c, c: s.c + 2, h: s.h + 2, l: s.c - 0.5, v: 80 }));
  assert.equal(effortResult(cs, asOfFor(cs)).label, "NONE", "the next bar made a new high: demand followed through");
  cs = series((p) => ({ ...noDemandS(p), v: 100 }), noFollow);
  assert.equal(effortResult(cs, asOfFor(cs)).label, "NONE", "ordinary volume is not low effort");
  cs = series(noDemandS, noFollow).map((c, i) => (i >= 30 && i < 35 ? { ...c, open: 1015, close: 1015, high: 1018, low: 1012 } : c));
  assert.equal(effortResult(cs, asOfFor(cs)).label, "NONE", "no run up: there is nothing for missing demand to end");
});

test("data-quality problems are flagged, a bar not yet closed at as_of is never used, and inputs are not mutated", () => {
  const cs = series(noDemandS, noFollow);
  assert.deepEqual(effortResult(cs.slice(-20), asOfFor(cs)).quality.flags, ["INSUFFICIENT_BARS"]);
  assert.ok(effortResult(cs, asOfFor(cs) + 300_000).quality.flags.includes("BARS_STALE"));
  const gapped = cs.filter((_, i) => i !== cs.length - 10);
  assert.ok(effortResult(gapped, asOfFor(cs)).quality.flags.includes("GAPPED_BARS"));
  const mixed = cs.map((c, i) => (i === cs.length - 3 ? { ...c, source: "coinbase" } : c));
  assert.ok(effortResult(mixed, asOfFor(cs)).quality.flags.includes("MIXED_SOURCE"));
  // At an as_of before F has closed, S is the last bar and F is ignored: a different, earlier read.
  const early = effortResult(cs, cs[cs.length - 1]!.t + 30_000);
  assert.equal(early.features!.next_bar_t, cs[cs.length - 2]!.t);
  const before = JSON.stringify(cs);
  assert.deepEqual(effortResult(cs, asOfFor(cs)), effortResult(cs, asOfFor(cs)));
  assert.equal(JSON.stringify(cs), before);
});

// ---------------------------------------------------------------------------
// Collection quality, the WICK comparison and the gated H0.
// ---------------------------------------------------------------------------

const CLOSE = Date.parse("2026-09-28T15:15:00Z");
function rows(n: number, stance: (i: number, favWon: boolean) => "UP" | "DOWN" | null, favWon: (i: number) => boolean, wick: (i: number) => string = () => "WAIT", clean = true): ShadowRow[] {
  return Array.from({ length: n }, (_, i) => {
    const yesMid = 82 + (i % 12), won = favWon(i);
    return {
      ticker: `KXBTC15M-W${i}`, close_ms: CLOSE + i * 900_000, clock: 180, clean, flags: clean ? [] : ["BARS_STALE"],
      label: stance(i, won) ? (stance(i, won) === "UP" ? "NO_SUPPLY" : "NO_DEMAND") : "NONE", stance: stance(i, won),
      wick: { lean: wick(i), status: "LIVE", conf: 60, folded: false },
      market: { yes_bid: yesMid - 0.5, yes_ask: yesMid + 0.5, no_bid: 100 - yesMid - 0.5, no_ask: 100 - yesMid + 0.5, yes_mid: yesMid, quote_age_ms: 500 },
      winner: won ? "UP" : "DOWN",
    } satisfies ShadowRow;
  });
}

test("collection quality: coverage, clean rate, flags, fire rate and label mix per clock", () => {
  const rs = [...rows(8, (i) => (i < 2 ? "DOWN" : null), () => true), ...rows(2, () => null, () => true, undefined, false)];
  const q = wickShadowQuality(rs, 20);
  const c = q.by_clock.find((x) => x.clock === 180)!;
  assert.deepEqual([c.rows, c.coverage_pct, c.clean, c.clean_pct, c.fire_rate_pct], [10, 50, 8, 80, 25]);
  assert.deepEqual(c.flags, [{ flag: "BARS_STALE", n: 2 }]);
  assert.deepEqual(c.labels, [{ label: "NONE", n: 6 }, { label: "NO_DEMAND", n: 2 }]);
});

test("H0 waits for 300 clean rows and 30 fires, retires a predicate that restates price, and compares with WICK descriptively", () => {
  const rng = (() => { let x = 11; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();
  const outcomes = Array.from({ length: 400 }, () => rng());
  const favWon = (i: number) => outcomes[i]! < (0.82 + (i % 12) / 100);
  assert.equal(wickShadowH0(rows(299, () => "UP", favWon)).verdict, "INSUFFICIENT_SAMPLE");
  const quiet = wickShadowH0(rows(400, (i) => (i < 20 ? "UP" : null), favWon));
  assert.equal(quiet.verdict, "INSUFFICIENT_SAMPLE", "20 fires are not enough, however many rows");
  assert.equal(quiet.fires, 20);
  assert.equal(wickShadowH0(rows(400, () => "UP", favWon, undefined, false)).clean_observations, 0, "unclean rows never count");
  assert.equal(wickShadowH0(rows(400, () => "UP", favWon)).verdict, "RETIRE_CANDIDATE", "always leaning with the favourite restates price");
  const informed = wickShadowH0(rows(400, (_i, won) => (won ? "UP" : "DOWN"), favWon, (i) => (i % 2 ? "UP" : "WAIT")));
  assert.equal(informed.verdict, "INFORMATIVE_CANDIDATE");
  const vs = informed.versus_wick;
  assert.equal(vs.hypothesis_kind, "EXPLORATORY");
  assert.equal(vs.both_speak, 200);
  assert.equal(vs.agree.n + vs.disagree.n, 200);
  assert.equal(vs.predicate_only.n, 200);
  assert.equal(vs.disagree.predicate.right, vs.disagree.n, "in this fixture the predicate is always right, so WICK is right on none of the disagreements");
  assert.equal(vs.disagree.wick.right, 0);
  assert.match(informed.note, /frozen prospective shadow test/);
});
