/**
 * The performance cube: the book's record cut every way that might matter, and
 * an honest account of what cutting it that many ways does to the answers.
 *
 * THE PROBLEM THIS SOLVES, AND THE ONE IT CREATES.
 *
 * "Net cents, all-time" is one number over a hundred-odd calls and it hides
 * everything: which side, which hours, which prices, how sure the chair was, how
 * wide the book was. The cube cuts the same calls along each of those and shows
 * the record inside every slice. That is the useful part.
 *
 * The dangerous part is that a hundred calls cut nine ways produces dozens of
 * cells, and some of them will look excellent by luck alone. A desk that reads
 * the best cell as a finding and changes a rule for it has not learned anything;
 * it has fitted noise, and it will do it again next week with a different cell.
 * That failure mode is the reason the 70¢ floor existed on 52 calls and the 80¢
 * floor is a trial rather than a conclusion.
 *
 * So every cell carries three things it is easy to leave out:
 *
 *   1. n, always, and a WILSON interval rather than a bare rate. Eight wins from
 *      ten is 80% and also anywhere from 49% to 94%; printing "80%" alone is a
 *      lie of precision.
 *   2. The breakeven this cell's own prices demanded, beside the rate it got.
 *      A 75% hit rate is excellent at 60¢ and a disaster at 90¢, and net cents is
 *      the only verdict that cannot disagree with itself.
 *   3. A LOOK-ELSEWHERE count. The report says how many cells were examined and
 *      how many would be expected to clear the "significant" bar by chance alone.
 *      When that expected number is close to the number actually found, the
 *      correct reading is that nothing was found.
 *
 * Nothing here votes, gates, or tunes anything. It is a way of looking at the
 * ledger, and looking is not evidence.
 *
 * Pure module.
 */

/** A graded window, flattened to what the cube can slice on. */
export type CubeRow = {
  close_time: number;
  /**
   * The side the book booked. Null when it never filled AND when the side
   * cannot be honestly recovered — a multi-leg scalp exited at a mid price says
   * nothing about who won, and guessing would be worse than admitting it.
   */
  side: "UP" | "DOWN" | null;
  /** Legs in the position. 1 is one contract; more is the retired scalp. */
  legs: number;
  /**
   * The position ran to settlement and paid 0 or 100 on one leg. Only then is
   * the side recoverable, and only then does "the side won" mean the same thing
   * as "the call made money".
   */
  settled: boolean;
  winner: "UP" | "DOWN" | null;
  /** What the book paid, in cents. Null when there was no fill. */
  entry: number | null;
  /** Settle minus entry minus the fee. Null when there was no fill. */
  ev: number | null;
  conf: number | null;
  score: number | null;
  bar: number | null;
  /** Decision-time state, present only on windows recorded after it was stored. */
  regime: string | null;
  secs_left: number | null;
  fair_yes: number | null;
  spread: number | null;
  leftover: number | null;
  touch: number | null;
  fee: number | null;
  /** Seats that spoke a direction, and whether each was right. */
  seats: Record<string, { lean: string; conf: number; hit: boolean | null }>;
};

/** z for a 95% interval. */
const Z = 1.959964;

/**
 * Wilson score interval. Chosen over the textbook normal interval because that
 * one is badly wrong exactly where the cube lives — small n and rates near 0 or
 * 1 — and can hand back bounds outside [0, 1], which would be worse than saying
 * nothing.
 */
export function wilson(hits: number, n: number): { lo: number; hi: number } {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const p = hits / n;
  const d = 1 + (Z * Z) / n;
  const c = p + (Z * Z) / (2 * n);
  const s = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  return { lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d) };
}

/**
 * Fewer calls than this and the cell is shown but never counted as a finding.
 * Ten is not a claim that ten is enough — it is the point below which a rate is
 * not worth reading at all.
 */
export const MIN_CELL_N = 10;

export type CubeCell = {
  key: string;
  /** Graded windows in this cell, filled or not. */
  n: number;
  /** Windows the book actually paid for. Rates below are over these. */
  calls: number;
  wins: number;
  /** Wins over calls, 0-100. Null with no calls. */
  hit: number | null;
  /** 95% Wilson bounds on that rate, 0-100. */
  lo: number | null;
  hi: number | null;
  /** Net cents after fees. The verdict — it cannot disagree with itself. */
  net: number;
  /** Net per call. */
  per_call: number | null;
  /** The rate these prices needed to stand still: mean of (entry + fee). */
  needs: number | null;
  /** hit − needs. Positive means the cell cleared its own bar. */
  margin: number | null;
  /** Mean entry price, so a rate can be read against what it cost. */
  avg_entry: number | null;
  /**
   * True when the cell cleared its breakeven with the whole interval above it —
   * the only cells worth a second look, and still not a finding on their own.
   */
  clears: boolean;
  /** Too few calls to read. */
  thin: boolean;
};

function cellOf(key: string, rows: CubeRow[]): CubeCell {
  // A call is a window the book paid for. The SIDE is not required: the early
  // scalp rows were exited at a mid price and their side is not recoverable, and
  // dropping them would quietly hide the era that lost the most money.
  const filled = rows.filter((r) => r.entry != null && r.ev != null);
  const calls = filled.length;
  // A win is a call that made money after fees — the desk's own definition,
  // shared with BOOKS. For a binary held to settlement that is exactly "the side
  // won", since entry plus fee is always under 100. For a scalp exit it is the
  // only definition that means anything. Comparing side to winner instead would
  // score a scalp that was exited at a profit as a loss whenever the window later
  // went the other way.
  const wins = filled.filter((r) => (r.ev ?? 0) > 0).length;
  const net = round1(filled.reduce((a, r) => a + (r.ev ?? 0), 0));
  const hit = calls ? (wins / calls) * 100 : null;
  const w = calls ? wilson(wins, calls) : null;
  // Breakeven for a contract held to settlement is what it cost: price plus fee.
  // Averaged over the cell, because the cell holds a spread of prices.
  const costs = filled.map((r) => (r.entry ?? 0) + (r.fee ?? feeOf(r.entry ?? 0)));
  const needs = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const thin = calls < MIN_CELL_N;
  return {
    key,
    n: rows.length,
    calls,
    wins,
    hit: hit == null ? null : round1(hit),
    lo: w ? round1(w.lo * 100) : null,
    hi: w ? round1(w.hi * 100) : null,
    net,
    per_call: calls ? round1(net / calls) : null,
    needs: needs == null ? null : round1(needs),
    margin: hit != null && needs != null ? round1(hit - needs) : null,
    avg_entry: calls ? round1(filled.reduce((a, r) => a + (r.entry ?? 0), 0) / calls) : null,
    // The bar for "worth a second look": not the point estimate, the whole
    // interval. A cell whose lower bound is under its own breakeven has not shown
    // anything, however good its headline rate.
    clears: !thin && w != null && needs != null && w.lo * 100 > needs,
    thin,
  };
}

/**
 * The Kalshi taker fee, for rows recorded before the fee was stored. Kept here
 * rather than imported so the cube stays a pure leaf; it matches clock.ts and a
 * test pins the two together.
 */
function feeOf(price: number): number {
  if (!(price > 0) || price >= 100) return 0;
  const p = price / 100;
  return Math.ceil(7 * p * (1 - p) * 100) / 100;
}

export type CubeDim = {
  /** What this dimension is called on the read-out. */
  name: string;
  /** Cells, biggest first. */
  cells: CubeCell[];
  /** Rows this dimension could not place — it does not know them, and says so. */
  unknown: number;
  /** Cells with enough calls to read at all. */
  readable: number;
  /** Cells whose whole interval cleared their own breakeven. */
  clearing: number;
};

/** Slice rows by a naming function. Rows the function cannot name are counted, not dropped. */
export function cubeDim(name: string, rows: readonly CubeRow[], keyOf: (r: CubeRow) => string | null): CubeDim {
  const by = new Map<string, CubeRow[]>();
  let unknown = 0;
  for (const r of rows) {
    const k = keyOf(r);
    if (k == null) {
      unknown += 1;
      continue;
    }
    const arr = by.get(k) ?? [];
    arr.push(r);
    by.set(k, arr);
  }
  const cells = [...by.entries()].map(([k, rs]) => cellOf(k, rs)).sort((a, b) => b.calls - a.calls);
  return {
    name,
    cells,
    unknown,
    readable: cells.filter((c) => !c.thin).length,
    clearing: cells.filter((c) => c.clears).length,
  };
}

export type LookElsewhere = {
  /** Every cell the cube built, across every dimension. */
  cells: number;
  /** Cells with enough calls to be read at all — the ones actually tested. */
  tested: number;
  /** Cells whose interval cleared their own breakeven. */
  found: number;
  /**
   * How many of those would be expected from chance alone if no cell had any
   * edge. A one-sided 95% bound is wrong about 2.5% of the time in this
   * direction, so this is 0.025 × tested.
   */
  expected_by_chance: number;
  /** The reading, in words, so the number cannot be skimmed past. */
  verdict: string;
};

/**
 * The look-elsewhere accounting. This is the part of the cube that argues
 * against the cube: it states how many chances the data was given to look good,
 * and how many wins that many chances buys for free.
 */
export function lookElsewhere(dims: readonly CubeDim[]): LookElsewhere {
  const cells = dims.reduce((a, d) => a + d.cells.length, 0);
  const tested = dims.reduce((a, d) => a + d.readable, 0);
  const found = dims.reduce((a, d) => a + d.clearing, 0);
  const expected = round2(0.025 * tested);
  let verdict: string;
  if (!tested) {
    verdict = "No cell has enough calls to read yet. Nothing here is a result.";
  } else if (found === 0) {
    verdict = `Nothing cleared its own breakeven on ${tested} readable cells. That is the honest answer, not a failure of the cut.`;
  } else if (found <= expected * 2) {
    verdict =
      `${found} cell${found === 1 ? "" : "s"} cleared, and about ${expected} would be expected from chance alone across ${tested} ` +
      `readable cells. That is not a finding — it is the number of chances taken. Treat it as a hypothesis to test on windows recorded from now on.`;
  } else {
    verdict =
      `${found} cells cleared against about ${expected} expected by chance across ${tested} readable cells. More than luck would supply, ` +
      `which makes them worth WATCHING prospectively — not worth changing a rule for. The same cut produced the 70¢ floor, which then had to move.`;
  }
  return { cells, tested, found, expected_by_chance: expected, verdict };
}

export type Cube = {
  /** Graded windows behind the whole cube. */
  n: number;
  /** Of those, the ones the book actually filled. */
  calls: number;
  /** The book as a whole, undivided — the number every cell should be read against. */
  overall: CubeCell;
  dims: CubeDim[];
  look_elsewhere: LookElsewhere;
  /** Dimensions that exist but cannot be cut yet, and why. */
  not_yet: { name: string; why: string }[];
};

export function buildCube(rows: readonly CubeRow[], dims: readonly CubeDim[], notYet: { name: string; why: string }[] = []): Cube {
  return {
    n: rows.length,
    calls: rows.filter((r) => r.entry != null && r.side != null).length,
    overall: cellOf("all", [...rows]),
    dims: [...dims],
    look_elsewhere: lookElsewhere(dims),
    not_yet: notYet,
  };
}

/* ---- the standard bands, shared so the server and its tests cannot disagree ---- */

/** Price shelves, matching how the floor conversation has always been framed. */
export function priceBand(entry: number | null): string | null {
  if (entry == null || !(entry > 0)) return null;
  if (entry < 60) return "<60¢";
  if (entry < 70) return "60-69¢";
  if (entry < 80) return "70-79¢";
  if (entry < 90) return "80-89¢";
  return "90¢+";
}

export function confBand(conf: number | null): string | null {
  if (conf == null || !Number.isFinite(conf)) return null;
  if (conf < 60) return "<60";
  if (conf < 70) return "60-69";
  if (conf < 80) return "70-79";
  return "80+";
}

/** How far past the bar the chair was — the margin it acted on. */
export function marginBand(score: number | null, bar: number | null): string | null {
  if (score == null || bar == null || !Number.isFinite(score) || !Number.isFinite(bar)) return null;
  const gap = Math.abs(score) - bar;
  if (gap < 0) return "under bar";
  if (gap < 0.1) return "0-0.1 over";
  if (gap < 0.25) return "0.1-0.25 over";
  return "0.25+ over";
}

export function minsBand(secs: number | null): string | null {
  if (secs == null || !Number.isFinite(secs)) return null;
  const m = secs / 60;
  if (m >= 12) return "12m+";
  if (m >= 8) return "8-12m";
  if (m >= 4) return "4-8m";
  if (m >= 2) return "2-4m";
  return "<2m";
}

export function spreadBand(cents: number | null): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  if (cents <= 1) return "1¢";
  if (cents <= 2) return "2¢";
  if (cents <= 4) return "3-4¢";
  return "5¢+";
}

export function touchBand(size: number | null): string | null {
  if (size == null || !Number.isFinite(size)) return null;
  if (size <= 0) return "empty";
  if (size < 50) return "<50";
  if (size < 200) return "50-199";
  return "200+";
}

function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
