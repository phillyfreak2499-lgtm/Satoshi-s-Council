/**
 * Does a seat know anything the price does not?
 *
 * This replaces nine separate "study seat X" questions with one, because they
 * are all the same question and answering them nine different ways would make
 * the answers incomparable.
 *
 * THE WRONG WAY TO ASK IT, AND WHY IT IS TEMPTING. Count how often a seat is
 * right. Every seat on this desk scores 55-90% that way, which looks like a room
 * full of talent. It is not: the market is right about 78% of the time on these
 * windows, and a seat that mostly agrees with the price inherits the price's
 * accuracy without contributing anything. A hit rate measures agreement with a
 * good forecaster, not skill.
 *
 * THE SECOND WRONG WAY, WHICH IS SUBTLER. Look only at the windows where the
 * seat DISAGREES with the price, and check whether it wins more than half. Every
 * seat fails that test badly — the best on this desk is right 43% of the time
 * when it objects. But 50% is the wrong bar: a seat objects precisely when the
 * price is lopsided, and a lopsided price is usually right. Judged against a coin
 * flip, a seat that correctly identifies an 85¢ favourite as only an 70% shot
 * still "loses" 70% of the time and looks useless.
 *
 * THE RIGHT QUESTION. On the windows where a seat objects, the market stated a
 * probability. Did that probability come true?
 *
 *     market_said     the mean probability the price implied for ITS OWN side
 *     market_actual   how often that side then won
 *     overconfident   market_said − market_actual
 *
 * A positive number means: when this seat objects, the price is worth less than
 * it claims. That is incremental information, and it is information whether or
 * not the seat's own side wins — the seat can be wrong about the direction and
 * still right that the price was too rich. On a desk that pays the ask, knowing
 * a favourite is overpriced IS the edge; picking the upset is not required.
 *
 * A negative number is worth as much and is easier to miss: the seat objects
 * exactly when the market is MORE right than it looks. That seat is not merely
 * useless, it is a contrarian indicator, and a chair that dims the price when it
 * speaks is being led away from the truth.
 *
 * WHAT THIS CANNOT DO. It is measured at one instant per window — the mid-window
 * sample — so it says nothing about a seat that is early or late rather than
 * wrong. It reads the midpoint, so it ignores the spread and the fee that decide
 * whether an overpriced favourite is actually tradeable. And it tests every seat
 * at once, so the best-looking one is partly the luckiest; the report carries
 * that count. Nothing here votes, and no seat is reweighted by it.
 *
 * Pure module.
 */
import { wilson } from "./cube.ts";

/** One graded window as the study sees it: a seat's read and the price beside it. */
export type SignalRow = {
  /** The seat's direction, from the sign of its evidence. Null when it was quiet. */
  lean: "UP" | "DOWN" | null;
  /** The market's midpoint for YES in cents at the same instant. */
  mid: number;
  winner: "UP" | "DOWN";
};

export type SignalSplit = {
  n: number;
  /** Mean probability the price implied for its own side, 0-100. */
  market_said: number | null;
  /** How often that side actually won, 0-100. */
  market_actual: number | null;
  /** said − actual. Positive: the price was worth less than it claimed. */
  overconfident: number | null;
  /** 95% bounds on market_actual, so `overconfident` can be read against noise. */
  actual_lo: number | null;
  actual_hi: number | null;
  /** How often the SEAT's own side won. Reported, but it is not the test. */
  seat_right: number | null;
};

export type SeatSignal = {
  seat: string;
  /** Windows where it spoke a direction. */
  spoke: number;
  /** Its raw hit rate — the number that flatters every seat. Kept to be argued with. */
  hit: number | null;
  /** Windows where it agreed with the price. */
  with_market: SignalSplit;
  /** Windows where it objected. The only place incremental information can live. */
  against_market: SignalSplit;
  /** The objection moved the price's honesty by more than its own interval allows. */
  informative: boolean;
  /** It objects when the market is MORE right than it says — a contrarian tell. */
  anti: boolean;
  /** Too few objections to read. */
  thin: boolean;
};

/** Below this many objections nothing can be said about a seat's disagreement. */
export const MIN_AGAINST = 15;

/** The market's own side and the probability it implied for it. */
export function marketSide(mid: number): { side: "UP" | "DOWN"; prob: number } | null {
  if (!Number.isFinite(mid) || mid <= 0 || mid >= 100 || mid === 50) return null;
  return mid > 50 ? { side: "UP", prob: mid } : { side: "DOWN", prob: 100 - mid };
}

function splitOf(rows: readonly { prob: number; marketRight: boolean; seatRight: boolean }[]): SignalSplit {
  if (!rows.length) {
    return { n: 0, market_said: null, market_actual: null, overconfident: null, actual_lo: null, actual_hi: null, seat_right: null };
  }
  const said = rows.reduce((a, r) => a + r.prob, 0) / rows.length;
  const hits = rows.filter((r) => r.marketRight).length;
  const actual = (hits / rows.length) * 100;
  const w = wilson(hits, rows.length);
  return {
    n: rows.length,
    market_said: r1(said),
    market_actual: r1(actual),
    overconfident: r1(said - actual),
    actual_lo: r1(w.lo * 100),
    actual_hi: r1(w.hi * 100),
    seat_right: r1((rows.filter((r) => r.seatRight).length / rows.length) * 100),
  };
}

export function seatSignal(seat: string, rows: readonly SignalRow[]): SeatSignal {
  const withM: { prob: number; marketRight: boolean; seatRight: boolean }[] = [];
  const against: typeof withM = [];
  let spoke = 0;
  let right = 0;
  for (const r of rows) {
    if (r.lean !== "UP" && r.lean !== "DOWN") continue;
    const m = marketSide(r.mid);
    if (!m) continue;
    spoke += 1;
    const seatRight = r.lean === r.winner;
    if (seatRight) right += 1;
    const cell = { prob: m.prob, marketRight: m.side === r.winner, seatRight };
    if (r.lean === m.side) withM.push(cell);
    else against.push(cell);
  }
  const a = splitOf(against);
  const thin = a.n < MIN_AGAINST;
  // The test is against the INTERVAL, not the point: the price is only shown to
  // be overstated when what actually happened could not plausibly have been what
  // it claimed.
  const informative = !thin && a.market_said != null && a.actual_hi != null && a.market_said > a.actual_hi;
  const anti = !thin && a.market_said != null && a.actual_lo != null && a.market_said < a.actual_lo;
  return {
    seat,
    spoke,
    hit: spoke ? r1((right / spoke) * 100) : null,
    with_market: splitOf(withM),
    against_market: a,
    informative,
    anti,
    thin,
  };
}

export type SignalReport = {
  seats: SeatSignal[];
  /** Seats whose objection says the price is overstated. */
  informative: string[];
  /** Seats whose objection says the price is understated — contrarian tells. */
  anti: string[];
  /** Seats with enough objections to be judged at all. */
  tested: number;
  verdict: string;
};

export function signalReport(bySeat: ReadonlyMap<string, readonly SignalRow[]>): SignalReport {
  const seats = [...bySeat.entries()]
    .map(([id, rows]) => seatSignal(id, rows))
    .sort((x, y) => (y.against_market.overconfident ?? -Infinity) - (x.against_market.overconfident ?? -Infinity));
  const informative = seats.filter((s) => s.informative).map((s) => s.seat);
  const anti = seats.filter((s) => s.anti).map((s) => s.seat);
  const tested = seats.filter((s) => !s.thin).length;
  return { seats, informative, anti, tested, verdict: verdictOf(seats, informative, anti, tested) };
}

function verdictOf(seats: readonly SeatSignal[], informative: string[], anti: string[], tested: number): string {
  if (!tested) return "No seat has objected to the price often enough to be judged. Nothing here is a result.";
  const parts: string[] = [];
  const best = seats.find((s) => !s.thin);
  parts.push(
    `${tested} seats objected to the price often enough to judge. Their raw hit rates run high because the ` +
      `price is right about ${r1(meanOf(seats.map((s) => s.with_market.market_actual)))}% of the time and a seat ` +
      `that agrees with it inherits that. The hit rate is not the test.`,
  );
  if (informative.length) {
    parts.push(
      `When ${informative.join(" and ")} object${informative.length === 1 ? "s" : ""}, the price is worth less ` +
        `than it claims — by ${best?.against_market.overconfident}¢ on ${best?.against_market.n} windows for ` +
        `${best?.seat}. That is incremental information and it does NOT require the seat to pick the winner: on ` +
        `a desk that pays the ask, knowing a favourite is overpriced is the edge.`,
    );
  } else {
    parts.push(`No seat's objection showed the price to be overstated by more than its own interval allows.`);
  }
  if (anti.length) {
    parts.push(
      `${anti.join(", ")} run the other way: when they object the market turns out MORE right than it said. ` +
        `A chair that dims the price on their word is being led away from the truth, which is worse than a seat ` +
        `that says nothing.`,
    );
  }
  parts.push(
    `Measured at one instant per window, off the midpoint, with ${seats.length} seats tested at once — so the ` +
      `best-looking one is partly the luckiest. Every line here is a candidate to run in SHADOW and confirm on ` +
      `windows recorded afterwards. None of it moves a weight today.`,
  );
  return parts.join(" ");
}

function meanOf(xs: readonly (number | null)[]): number {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
