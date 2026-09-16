import { demoTick, newDemoWindow } from "@/lib/desk/demo";
import type { ChairResult, Lean, WindowMemory } from "@/lib/desk/types";
import type { SatoshiPaint } from "@/components/atelier/gallery";

/** Synthetic fixtures only. They are never forecasts, live calls or saved grades. */
export function sample(lean: Lean) {
  const memory: WindowMemory = { prior_settles: [], path_since_entry: [], streak_n: 0,
    streak_side: null, entry_spot: 0, entry_lean: null, tapes: [] };
  const snapshot = demoTick(newDemoWindow(memory, 7 * 60_000 + 20_000), memory);
  snapshot.ticker = "DEMO-PREVIEW-15M";
  snapshot.yes_ask = lean === "UP" ? 84 : lean === "DOWN" ? 18 : 52;
  snapshot.no_ask = lean === "DOWN" ? 84 : lean === "UP" ? 18 : 51;
  snapshot.yes_bid = 100 - snapshot.no_ask;
  snapshot.no_bid = 100 - snapshot.yes_ask;
  snapshot.yes_mid = (snapshot.yes_bid + snapshot.yes_ask) / 2;
  const chair: ChairResult = {
    lean, confidence: lean === "WAIT" ? 42 : 76, score: lean === "UP" ? 0.82 : lean === "DOWN" ? -0.82 : 0.18,
    bar: 0.65, aggressiveness: 1, time_factor: 1, diversity: 0.9, sit_mass: 0.1, conflict_frac: 0.2,
    fade_fold: "", invert_cap: "", tax: "", tax_applied: false, law_dimmer: "", full_conf_raw: 76,
    calc: "Synthetic display fixture; no live calculation or trading connection.", gates: [], hard_fail: false,
    hypothesis: "Preview only", evidence: [], counter: "Preview only", decision: "Preview only",
    invalidate_if: "Preview only", huddle_line: "", last_settle: "", knn_note: "", wait_note: "", walk: null,
    quorum: lean === "WAIT" ? { up: 7, down: 5, wait: 3 } : lean === "UP" ? { up: 12, down: 2, wait: 1 } : { up: 2, down: 12, wait: 1 },
    rows: [], categories_agree: 3, size: 1, size_note: "Demo only", pit_tags: [],
  };
  const paint: SatoshiPaint = {
    lean, remainingMs: snapshot.close_time - snapshot.as_of, ticker: snapshot.ticker, phase: snapshot.phase,
    confidence: chair.confidence, score: chair.score, bar: chair.bar, brainAge: 0, source: "demo",
    asOf: snapshot.as_of, spotAge: 0, log: [], spot: snapshot.spot, strike: snapshot.strike,
    yesMid: snapshot.yes_mid, settleAvg: null, locked: 0, closeTime: snapshot.close_time,
    candles: snapshot.candles_1m.map(candle => ({ t: candle.t, close: candle.close })),
    settled: "", lastSettled: "", lastSettledAt: 0, lastSettledTicker: "",
    votes: Array.from({ length: 21 }, (_, index) => ({
      seat: index === 0 ? "WICK" : index === 1 ? "DRIFT" : `DEMO-${index + 1}`,
      lean: index % 4 === 0 ? "DOWN" : index % 3 === 0 ? "WAIT" : "UP",
      confidence: 64,
      reasoning: index === 0 ? "Demo reading: a long lower wick suggests buyers defended the latest dip."
        : "Demo reading: the short trend is improving, with momentum above its recent baseline.",
    })),
  };
  return { snapshot, chair, paint };
}
