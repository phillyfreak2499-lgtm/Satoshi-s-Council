/**
 * MAE and MFE: what a booked call was worth while it was still open.
 *
 * The ledger records two prices — what the book paid and what the contract
 * settled at — and nothing in between. So a call that entered at 84¢ and settled
 * at 0 reads identically whether it was under water the whole time or was
 * quotable at 95¢ four minutes in. Those are different mistakes. The first is a
 * bad entry; the second is a good entry held too long, and no amount of staring
 * at entry and settle can tell them apart.
 *
 * The replay already stores the book every four seconds, so the path exists. This
 * walks it and reports, per call:
 *
 *   MFE  maximum favourable excursion — the best the position was ever worth.
 *   MAE  maximum adverse excursion — the worst it was ever worth.
 *
 * Both marked at the BID on the side held, because a position is worth what
 * someone will pay for it, not what it would cost to buy again. Using the ask
 * would inflate every MFE by the spread and invent profits the desk could never
 * have taken.
 *
 * THE TRAP THIS MUST NOT SET. MFE is hindsight. "The average loser was up 9¢, so
 * take profits at 9¢" is the purest form of fitting the past: the 9¢ is an
 * average of peaks located after the fact, and no rule can stand at a peak it
 * cannot see coming. What MFE can honestly support is narrower and still useful:
 * whether losers were EVER meaningfully in profit at all. If they were not, exit
 * timing is not the problem and the entries are; if they routinely were, then a
 * rule MIGHT exist, and it would then have to be specified in advance and tested
 * on later windows like anything else. The report says this in the payload so it
 * cannot be read off a table without it.
 *
 * Pure module.
 */

/** One instant of the book on a window, as the replay stored it. */
export type Mark = { t: number; yes_bid: number; yes_ask: number };

export type Excursion = {
  /** Cents the position was up at its best, never negative. */
  mfe: number;
  /** Cents it was down at its worst, never positive. */
  mae: number;
  /** Seconds from entry to the best mark. */
  mfe_at: number | null;
  /** Seconds from entry to the worst mark. */
  mae_at: number | null;
  /** Marks the path was measured over. Under ~10 the numbers mean little. */
  n: number;
  /** Settle minus entry: what the call actually made, before the fee. */
  realized: number;
  /** It was quotable above entry at some point. */
  ever_up: boolean;
};

/** The bid on the side held: what the position could have been sold for. */
export function markOf(side: "UP" | "DOWN", m: Mark): number | null {
  // A NO position is sold into the NO bid, which is 100 minus the YES ask.
  const v = side === "UP" ? m.yes_bid : 100 - m.yes_ask;
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/**
 * Walk the marks from entry onward. `entryT` is when the book filled; marks
 * before it are not part of the position and are excluded — including them
 * would credit the call with moves it was not exposed to.
 */
export function excursionOf(
  side: "UP" | "DOWN",
  entry: number,
  entryT: number,
  settle: number | null,
  marks: readonly Mark[],
): Excursion | null {
  if (!(entry > 0) || entry >= 100) return null;
  const path = marks.filter((m) => m.t >= entryT).sort((a, b) => a.t - b.t);
  let mfe = 0;
  let mae = 0;
  let mfeAt: number | null = null;
  let maeAt: number | null = null;
  let n = 0;
  for (const m of path) {
    const v = markOf(side, m);
    if (v == null) continue;
    n += 1;
    const d = v - entry;
    if (d > mfe) {
      mfe = d;
      mfeAt = Math.round((m.t - entryT) / 1000);
    }
    if (d < mae) {
      mae = d;
      maeAt = Math.round((m.t - entryT) / 1000);
    }
  }
  if (!n) return null;
  return {
    mfe: r1(mfe),
    mae: r1(mae),
    mfe_at: mfeAt,
    mae_at: maeAt,
    n,
    realized: settle == null ? 0 : r1(settle - entry),
    ever_up: mfe > 0,
  };
}

export type ExcursionRow = Excursion & { won: boolean; entry: number };

export type ExcursionGroup = {
  key: string;
  n: number;
  /** Mean best mark, in cents above entry. */
  avg_mfe: number;
  /** Mean worst mark, in cents below entry. */
  avg_mae: number;
  /** Median best mark — the mean is dragged by a few windows that ran a long way. */
  med_mfe: number;
  /** Share that were ever quotable above what they paid, 0-100. */
  ever_up_pct: number;
  /** Share that were ever up by at least MEANINGFUL cents. */
  up_meaningful_pct: number;
  /** Mean seconds to the best mark, over the ones that had one. */
  avg_mfe_at: number | null;
};

/**
 * "Up a bit" is noise: at a 1-2¢ spread a position is quotable a cent above
 * entry constantly without anything having happened. This is the threshold for
 * having been genuinely in profit.
 */
export const MEANINGFUL_CENTS = 5;

export function groupExcursions(key: string, rows: readonly ExcursionRow[]): ExcursionGroup | null {
  if (!rows.length) return null;
  const mfes = rows.map((r) => r.mfe).sort((a, b) => a - b);
  const withPeak = rows.filter((r) => r.mfe_at != null);
  return {
    key,
    n: rows.length,
    avg_mfe: r1(mean(rows.map((r) => r.mfe))),
    avg_mae: r1(mean(rows.map((r) => r.mae))),
    med_mfe: r1(mfes[Math.floor((mfes.length - 1) / 2)] ?? 0),
    ever_up_pct: r1((rows.filter((r) => r.ever_up).length / rows.length) * 100),
    up_meaningful_pct: r1((rows.filter((r) => r.mfe >= MEANINGFUL_CENTS).length / rows.length) * 100),
    avg_mfe_at: withPeak.length ? Math.round(mean(withPeak.map((r) => r.mfe_at!))) : null,
  };
}

export type ExcursionReport = {
  n: number;
  winners: ExcursionGroup | null;
  losers: ExcursionGroup | null;
  /** The only question this evidence can answer, and its answer. */
  verdict: string;
};

/**
 * The comparison that matters: what the losers looked like while they were open.
 * Winners are shown beside them only as a scale — a winner is up by definition,
 * so its MFE says nothing on its own.
 */
export function excursionReport(rows: readonly ExcursionRow[]): ExcursionReport {
  const winners = groupExcursions("won", rows.filter((r) => r.won));
  const losers = groupExcursions("lost", rows.filter((r) => !r.won));
  return { n: rows.length, winners, losers, verdict: verdictOf(winners, losers) };
}

/**
 * The reading. Two things have to be said together, and saying either alone
 * produces a wrong conclusion:
 *
 *   what the losers were worth at their best, AND
 *   what the winners were worth at their worst.
 *
 * A rule that exits losers at their peak has to let winners through their
 * trough, and the two ranges overlap far more than a table of loser-MFEs alone
 * suggests. Every "take profits early" rule dies on exactly that overlap, so the
 * verdict states it whenever it holds rather than leaving it to be noticed.
 */
function verdictOf(winners: ExcursionGroup | null, losers: ExcursionGroup | null): string {
  if (!losers || losers.n < 10) {
    return `Fewer than 10 losing calls with a stored path. Nothing can be said about exit timing yet.`;
  }
  const thin = losers.n < 30 ? ` On only ${losers.n} losing calls, so this is a direction to look, not a result.` : "";
  const pct = losers.up_meaningful_pct;
  if (pct < 25) {
    return (
      `Only ${pct}% of losing calls were ever up ${MEANINGFUL_CENTS}¢ or more (average best mark ` +
      `${losers.avg_mfe}¢). There was mostly nothing to exit into, so exit timing is NOT the problem — ` +
      `these were entries that were wrong from the start. Look at what the desk is paying for, not when it sells.${thin}`
    );
  }
  // The overlap test: would a rule fired at the losers' typical peak also have
  // fired against the winners on their way down?
  const overlap =
    winners && winners.n >= 10 && -winners.avg_mae >= losers.avg_mfe
      ? ` But the winners went under water by ${-winners.avg_mae}¢ on average — more than the ${losers.avg_mfe}¢ ` +
        `the losers were up at their best. Any rule that cuts a loser at its peak has to survive a winner falling ` +
        `further than that first, and most do not.`
      : "";
  return (
    `${pct}% of losing calls were up ${MEANINGFUL_CENTS}¢ or more at some point, averaging ${losers.avg_mfe}¢ at ` +
    `their best, about ${losers.avg_mfe_at ?? "?"}s after entry.${overlap} That is enough to make an exit rule WORTH ` +
    `SPECIFYING — and nothing more. These peaks are located with hindsight; no rule can stand at one it cannot ` +
    `see coming. Any rule has to be written down first and then tested on windows recorded afterwards.${thin}`
  );
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
