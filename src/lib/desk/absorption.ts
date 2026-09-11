/**
 * ABSORPTION — aggressive size crossed and the price did not respond.
 *
 * THE QUESTION, AND WHY IT IS NOT THE USUAL ONE. Every other study on this desk
 * asks some version of "which way is it going". The answer, three times over,
 * has been that the desk cannot beat Kalshi's own price at that. This asks
 * something different: someone paid the spread in size, the price should have
 * moved, and it did not — does that failure to respond tell us the price is
 * wrong?
 *
 * It is worth asking because it is the one state that is ABOUT the price being
 * wrong rather than about predicting direction, and because a volume proxy
 * cannot see it at all: the volume is identical whether the market absorbed the
 * order or ran from it.
 *
 * THE BENCHMARK IS NOT A HIT RATE. "Did UP win" is unanswerable without knowing
 * what UP was worth at the time — a 90% favourite winning is not a result. The
 * test here is conditional on the price: across a set of absorption events, the
 * market implied some average probability of UP, and UP then happened at some
 * frequency. The gap between those two is the only thing that could be
 * information, and it is information whether or not any particular call would
 * have won.
 *
 * NO PRODUCTION THRESHOLD. Nothing here decides what "large" or "no response"
 * means for the desk. Every measurement is stored continuously and the study
 * reports across a GRID of candidate bands, frozen below before any prospective
 * outcome was looked at. A single privileged threshold is how a study quietly
 * fits itself to the sample it was built on.
 *
 * BUY AND SELL ARE NEVER ASSUMED SYMMETRIC. Aggressive buying absorbed and
 * aggressive selling absorbed are reported apart, always. In a market where one
 * side is a favourite most of the time there is no reason they should behave
 * alike, and pooling them would hide it if they do not.
 *
 * SINGLE AND CLUSTERED ARE NEVER POOLED EITHER. One large order that fails to
 * move the price is a different event from ten aggressive prints in a row being
 * soaked up, and calling both "absorption" would blur two hypotheses into one.
 *
 * Pure module. Nothing here votes, and there is no rung above "measurable".
 */
import { takerFeeCentsExact } from "./clock.ts";
import { wilson } from "./cube.ts";
import type { EraId } from "./research-era.ts";

/**
 * Candidate bands. FROZEN 2026-09-11, before any post-fix outcome existed to
 * look at. They exist so a result can be reported at more than one setting and
 * its sensitivity to the setting can be seen; none of them is a production
 * threshold and none may be chosen after the fact because it reads better.
 */
export const PCTILE_BANDS = [80, 90, 95] as const;
export const RESPONSE_BANDS = [0.5, 1, 2] as const;
/** The horizon absorption is judged over. One horizon, frozen; the others are context. */
export const JUDGE_MS = 30_000;
/** No verdict at all below this many clean post-fix occurrences. */
export const MIN_PROSPECTIVE = 30;

/** One recorded print with everything measured around it. All continuous. */
export type AbsorptionRow = {
  t: number;
  era: EraId;
  /** The aggressor: UP lifted the offer (a buy), DOWN hit the bid (a sell). */
  side: "UP" | "DOWN";
  /** 1 is a single print; more is a same-side burst counted as one decision. */
  cluster_n: number;
  size: number;
  size_pctile: number | null;
  /** Size against the visible touch it crossed, and against five levels of depth. */
  size_vs_touch: number | null;
  size_vs_depth: number | null;
  impact_2s: number | null;
  impact_per_100: number | null;
  /** Midpoint move at each horizon, signed the aggressor's way. */
  move_5s: number | null;
  move_15s: number | null;
  move_30s: number | null;
  move_60s: number | null;
  /** BTC move over the same intervals, in dollars. Separates "nothing happened" from "nothing happened HERE". */
  btc_5s: number | null;
  btc_15s: number | null;
  btc_30s: number | null;
  btc_60s: number | null;
  ofi_norm: number | null;
  replenished: boolean | null;
  spread: number | null;
  depth: number | null;
  /** Spot minus strike, and the volatility that scales it. z is derivable, not stored. */
  dist: number | null;
  sigma: number | null;
  secs_left: number | null;
  /** What the market implied for UP at the print, 0-100. The benchmark. */
  market_prob_up: number;
  /** Context for the conditioning tests. */
  fair_yes: number | null;
  vel_resid: number | null;
  drift_ev: number | null;
  cascade_ev: number | null;
  regime: string;
  winner: "UP" | "DOWN" | null;
};

/** Standardised distance to the strike, when both parts were recorded. */
export function zOf(r: AbsorptionRow): number | null {
  if (r.dist == null || r.sigma == null || !(r.sigma > 0)) return null;
  return r.dist / r.sigma;
}

/**
 * Was this print absorbed, at this pair of bands? Large enough that a response
 * was owed, and no response at the judged horizon.
 *
 * A missing horizon is NOT absorption. A print near the close has no 30-second
 * future, and reading that as "the price did not move" would classify every
 * late print as absorbed — which is exactly where absorption would look most
 * impressive and mean least.
 */
export function isAbsorbed(r: AbsorptionRow, pctile: number, response: number): boolean {
  if (r.size_pctile == null || r.size_pctile < pctile) return false;
  if (r.move_30s == null) return false;
  return Math.abs(r.move_30s) < response;
}

export type PriceTest = {
  n: number;
  /** Mean probability the market implied for UP, 0-100. */
  implied_up: number | null;
  /** How often UP then happened, 0-100. */
  realized_up: number | null;
  /** realized − implied. The whole question. */
  diff: number | null;
  /** 95% bounds on realized_up. */
  lo: number | null;
  hi: number | null;
  /** The interval excludes what the market implied: the price was wrong here. */
  beyond_price: boolean;
  /** Which way the deviation points, in plain words. Null when there is none. */
  favours: "UP" | "DOWN" | null;
  /**
   * Cents per contract after the Kalshi taker fee, taking the side the deviation
   * favours at the prevailing price. Negative means the edge does not survive
   * the fee, which is the only test that matters for a desk that pays the ask.
   */
  edge_after_fee: number | null;
};

const EMPTY_TEST: PriceTest = {
  n: 0, implied_up: null, realized_up: null, diff: null, lo: null, hi: null,
  beyond_price: false, favours: null, edge_after_fee: null,
};

/**
 * The fee an edge has to clear, delegated rather than mirrored.
 *
 * The desk has two: `takerFeeCents` rounds up to the whole cent for conservative
 * paper bookkeeping, and `takerFeeCentsExact` is Kalshi's published schedule to
 * the centicent. A research edge is measured against the exact one, as the lab
 * already does — using the rounded version would make a real edge look smaller
 * than it is and quietly discard findings.
 *
 * It is imported, not reimplemented. A second copy of the fee formula is a
 * second answer, and the first thing to go stale when the schedule changes.
 */
export const feeAt = takerFeeCentsExact;

/**
 * The one measurement. Given graded events, did UP happen more or less often
 * than the price said it would?
 */
export function priceTest(rows: readonly AbsorptionRow[]): PriceTest {
  const graded = rows.filter((r) => r.winner === "UP" || r.winner === "DOWN");
  if (!graded.length) return EMPTY_TEST;
  const n = graded.length;
  const implied = graded.reduce((a, r) => a + r.market_prob_up, 0) / n;
  const ups = graded.filter((r) => r.winner === "UP").length;
  const realized = (ups / n) * 100;
  const w = wilson(ups, n);
  const lo = w.lo * 100;
  const hi = w.hi * 100;
  const beyond = implied < lo || implied > hi;
  const favours = !beyond ? null : realized > implied ? "UP" : "DOWN";
  // Taking the favoured side at the price the market was charging for it.
  let edge: number | null = null;
  if (favours) {
    const price = favours === "UP" ? implied : 100 - implied;
    const win = favours === "UP" ? realized : 100 - realized;
    edge = r2(win - price - feeAt(price));
  }
  return {
    n,
    implied_up: r1(implied),
    realized_up: r1(realized),
    diff: r1(realized - implied),
    lo: r1(lo),
    hi: r1(hi),
    beyond_price: beyond,
    favours,
    edge_after_fee: edge,
  };
}

/** One cell of the band grid, for one aggressor side and one burst shape. */
export type AbsorptionCell = {
  pctile: number;
  response: number;
  side: "UP" | "DOWN";
  shape: "single" | "clustered";
  test: PriceTest;
  /** Occurrences at these bands, graded or not. */
  occurrences: number;
  thin: boolean;
};

export function cells(rows: readonly AbsorptionRow[]): AbsorptionCell[] {
  const out: AbsorptionCell[] = [];
  for (const pctile of PCTILE_BANDS) {
    for (const response of RESPONSE_BANDS) {
      for (const side of ["UP", "DOWN"] as const) {
        for (const shape of ["single", "clustered"] as const) {
          const hit = rows.filter(
            (r) =>
              r.side === side &&
              (shape === "single" ? r.cluster_n === 1 : r.cluster_n > 1) &&
              isAbsorbed(r, pctile, response),
          );
          out.push({
            pctile,
            response,
            side,
            shape,
            test: priceTest(hit),
            occurrences: hit.length,
            thin: hit.filter((r) => r.winner).length < MIN_PROSPECTIVE,
          });
        }
      }
    }
  }
  return out;
}

/** A control: the effect measured inside each band of some other variable. */
export type Stratum = { band: string; test: PriceTest };
export type Control = {
  name: string;
  strata: Stratum[];
  /** Bands with enough graded events to read at all. */
  readable: number;
  /** Bands where the price was beaten. */
  survives_in: number;
  /**
   * The effect is not merely this variable in disguise: it shows up in more than
   * one band of it. One band only means the two are the same thing.
   */
  independent: boolean;
};

export function control(
  name: string,
  rows: readonly AbsorptionRow[],
  bandOf: (r: AbsorptionRow) => string | null,
): Control {
  const by = new Map<string, AbsorptionRow[]>();
  for (const r of rows) {
    const b = bandOf(r);
    if (b == null) continue;
    const arr = by.get(b) ?? [];
    arr.push(r);
    by.set(b, arr);
  }
  const strata = [...by.entries()]
    .map(([band, rs]) => ({ band, test: priceTest(rs) }))
    .sort((a, b) => b.test.n - a.test.n);
  const readable = strata.filter((s) => s.test.n >= MIN_PROSPECTIVE).length;
  const survives = strata.filter((s) => s.test.n >= MIN_PROSPECTIVE && s.test.beyond_price).length;
  return { name, strata, readable, survives_in: survives, independent: survives >= 2 };
}

/**
 * The falsification view: every way this could be nothing, asked explicitly.
 *
 * A green/red verdict hides which of these is true, and they call for different
 * responses. "Only near the strike" is a narrower hypothesis worth keeping;
 * "merely tracks extreme prices" means there was never anything here.
 */
export type Falsification = {
  /** No effect at all on the whole sample. */
  no_value: boolean;
  /** It only appears where the price is already extreme — it is reading the price. */
  tracks_extreme_price: boolean;
  /** It appears in one regime and nowhere else. */
  one_regime_only: boolean;
  /** It appears only close to the strike. */
  near_strike_only: boolean;
  /** It appears only in the last minutes. */
  late_window_only: boolean;
  /** The deviation is real but smaller than the fee. */
  dies_after_fees: boolean;
  /** None of the above: it is there, in more than one place, and pays for itself. */
  survives_all: boolean;
  /** Not enough clean evidence to answer any of it. */
  undecided: boolean;
  lines: string[];
};

export type AbsorptionReport = {
  /** Post-fix occurrences. The only ones counted. */
  n: number;
  /** Pre-fix occurrences, shown so the discard is visible, never added in. */
  discarded_pre_fix: number;
  graded: number;
  cells: AbsorptionCell[];
  /** The headline cell: the middle band pair, both shapes, per side. */
  buy: PriceTest;
  sell: PriceTest;
  buy_single: PriceTest;
  buy_clustered: PriceTest;
  sell_single: PriceTest;
  sell_clustered: PriceTest;
  controls: Control[];
  falsification: Falsification;
  note: string;
};

/** The middle of each frozen grid — reported as the headline, not as the truth. */
export const HEADLINE_PCTILE = 90;
export const HEADLINE_RESPONSE = 1;

function headline(rows: readonly AbsorptionRow[], side: "UP" | "DOWN", shape?: "single" | "clustered"): PriceTest {
  return priceTest(
    rows.filter(
      (r) =>
        r.side === side &&
        (shape == null || (shape === "single" ? r.cluster_n === 1 : r.cluster_n > 1)) &&
        isAbsorbed(r, HEADLINE_PCTILE, HEADLINE_RESPONSE),
    ),
  );
}

export function absorptionReport(post: readonly AbsorptionRow[], preCount: number, controls: Control[]): AbsorptionReport {
  const absorbed = post.filter((r) => isAbsorbed(r, HEADLINE_PCTILE, HEADLINE_RESPONSE));
  const graded = absorbed.filter((r) => r.winner).length;
  const overall = priceTest(absorbed);
  const buy = headline(post, "UP");
  const sell = headline(post, "DOWN");
  const f = falsify(overall, graded, controls);
  return {
    n: post.length,
    discarded_pre_fix: preCount,
    graded,
    cells: cells(post),
    buy,
    sell,
    buy_single: headline(post, "UP", "single"),
    buy_clustered: headline(post, "UP", "clustered"),
    sell_single: headline(post, "DOWN", "single"),
    sell_clustered: headline(post, "DOWN", "clustered"),
    controls,
    falsification: f,
    note:
      `Post-quantity-fix occurrences only; ${preCount} earlier ones are discarded, not pooled, because the ` +
      `sizes they were measured from were floating-point residue. The benchmark is the market's own implied ` +
      `probability, not a hit rate. Bands were frozen before any of this outcome data existed. Nothing here ` +
      `votes and no threshold from it is in production.`,
  };
}

function falsify(overall: PriceTest, graded: number, controls: readonly Control[]): Falsification {
  const lines: string[] = [];
  if (graded < MIN_PROSPECTIVE) {
    return {
      no_value: false, tracks_extreme_price: false, one_regime_only: false, near_strike_only: false,
      late_window_only: false, dies_after_fees: false, survives_all: false, undecided: true,
      lines: [
        `${graded} graded absorption events since the quantity fix; ${MIN_PROSPECTIVE} is the floor for saying ` +
          `anything at all. Every line below is withheld until then, including "no effect".`,
      ],
    };
  }
  const find = (name: string) => controls.find((c) => c.name === name);
  const price = find("market probability");
  const regime = find("regime");
  const strike = find("distance to strike");
  const clock = find("seconds remaining");

  const noValue = !overall.beyond_price;
  if (noValue) lines.push("The whole sample's interval contains the market's implied probability: no effect to explain.");

  const tracksPrice = !noValue && price != null && price.readable >= 2 && !price.independent;
  if (tracksPrice) lines.push("It survives in only one band of market probability — it is reading the price, not adding to it.");

  const oneRegime = !noValue && regime != null && regime.readable >= 2 && !regime.independent;
  if (oneRegime) lines.push("It appears in a single regime and nowhere else.");

  const nearStrike = !noValue && strike != null && strike.readable >= 2 && !strike.independent;
  if (nearStrike) lines.push("It appears only in one band of distance to the strike.");

  const late = !noValue && clock != null && clock.readable >= 2 && !clock.independent;
  if (late) lines.push("It appears only in one band of time remaining.");

  const dies = !noValue && overall.edge_after_fee != null && overall.edge_after_fee <= 0;
  if (dies) {
    lines.push(
      `The deviation is real (${overall.diff} points) but worth ${overall.edge_after_fee}¢ a contract after the ` +
        `fee: nothing a desk that pays the ask can use.`,
    );
  }
  const survives = !noValue && !tracksPrice && !oneRegime && !nearStrike && !late && !dies;
  if (survives) {
    lines.push(
      `It holds: the interval excludes the market's implied probability, it is present in more than one band ` +
        `of price, regime, strike distance and time, and it is worth ${overall.edge_after_fee}¢ after the fee. ` +
        `That earns more sample and a conversation, not a promotion.`,
    );
  }
  return {
    no_value: noValue,
    tracks_extreme_price: tracksPrice,
    one_regime_only: oneRegime,
    near_strike_only: nearStrike,
    late_window_only: late,
    dies_after_fees: dies,
    survives_all: survives,
    undecided: false,
    lines,
  };
}

function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
function r2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
