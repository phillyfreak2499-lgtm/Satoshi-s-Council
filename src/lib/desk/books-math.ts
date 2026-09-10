/**
 * The pure arithmetic behind BOOKS, kept out of the SQL so it can be tested
 * on synthetic rows.
 *
 * Breakeven is the win rate a set of calls needed to stand still, given what
 * its wins paid and what its losses cost: L / (W + L), with W the average
 * cents a winning call made and L the average a losing call lost, both after
 * the fee (a scratch — a call that settled flat — counts in neither). Across
 * the decided calls, net = wins·W − losses·L, so the win rate clears breakeven
 * exactly when the net is at or above zero; the page colours the verdict by
 * the net itself, so colour and cents can never disagree. For one contract
 * held to settlement a win pays 100 − entry − fee and a loss costs entry +
 * fee, so this is simply the price paid plus the fee, in percent: a 70¢
 * favourite needs about 72%, not 70%. A set with no losses yet is charged
 * what a loss would have cost (entry + fee); one with no wins yet is paid
 * what a win would have paid.
 *
 * The calibration shelves group booked calls by the price paid. The ledger
 * query buckets by ten cents; the thin ends fold into one shelf each (under
 * 50¢, where the chair rarely buys; 90¢ and up), and every average is
 * re-weighted by its count, so a merged shelf's numbers are true averages
 * over its calls, never averages of averages.
 */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Win rate needed to break even, 0–100. `winAvg` is the average cents a win
 * made, `lossAvg` the average a loss lost (positive), `costAvg` what a loss
 * would cost a call held to settlement (entry + fee). Null with nothing to go on.
 */
export function breakevenPct(winAvg: number | null, lossAvg: number | null, costAvg: number | null): number | null {
  const L = lossAvg ?? costAvg;
  const W = winAvg ?? (costAvg == null ? null : 100 - costAvg);
  if (L == null || W == null || !(W + L > 0)) return null;
  return (100 * L) / (W + L);
}

export type ShelfRow = {
  /** Ten-cent bucket, 0–9. */
  b: number;
  n: number;
  wins: number;
  /** Calls that lost cents; n − wins − losses are scratches. */
  losses: number;
  avg_entry: number;
  /** Average cents a winning call made, after the fee; null with no wins. */
  win_avg: number | null;
  /** Average cents a losing call lost (positive), after the fee; null with no losses. */
  loss_avg: number | null;
  /** Average entry plus fee: what a loss costs a call held to settlement. */
  cost_avg: number;
  net: number;
};

export type Shelf = {
  lo: number;
  hi: number;
  n: number;
  wins: number;
  /** Average price paid on the shelf, cents. */
  avg_entry: number;
  /** Win rate the shelf needed to break even, 0–100. */
  breakeven: number;
  /** Net cents after fees. */
  net: number;
};

/** Ten-cent bucket (0–9) to shelf: under 50¢ is one shelf, 90¢ and up is another. */
export function shelfOf(b: number): number {
  return b < 5 ? 0 : b > 8 ? 9 : b;
}

/** Fold ten-cent bucket rows into shelves, weighting every average by its count. Sorted by price. */
export function mergeShelves(rows: ShelfRow[]): Shelf[] {
  type Acc = {
    lo: number;
    hi: number;
    n: number;
    wins: number;
    losses: number;
    entry_sum: number;
    win_sum: number;
    loss_sum: number;
    cost_sum: number;
    net: number;
  };
  const byShelf = new Map<number, Acc>();
  for (const r of rows) {
    const s = shelfOf(r.b);
    const cur = byShelf.get(s) ?? {
      lo: s === 0 ? 0 : s * 10,
      hi: s === 0 ? 50 : s === 9 ? 100 : s * 10 + 10,
      n: 0,
      wins: 0,
      losses: 0,
      entry_sum: 0,
      win_sum: 0,
      loss_sum: 0,
      cost_sum: 0,
      net: 0,
    };
    cur.n += r.n;
    cur.wins += r.wins;
    cur.losses += r.losses;
    cur.entry_sum += r.avg_entry * r.n;
    cur.win_sum += (r.win_avg ?? 0) * r.wins;
    cur.loss_sum += (r.loss_avg ?? 0) * r.losses;
    cur.cost_sum += r.cost_avg * r.n;
    cur.net += r.net;
    byShelf.set(s, cur);
  }
  return [...byShelf.values()]
    .sort((a, b) => a.lo - b.lo)
    .map((c) => {
      const be = breakevenPct(c.wins ? c.win_sum / c.wins : null, c.losses ? c.loss_sum / c.losses : null, c.n ? c.cost_sum / c.n : null);
      return {
        lo: c.lo,
        hi: c.hi,
        n: c.n,
        wins: c.wins,
        avg_entry: round1(c.n ? c.entry_sum / c.n : 0),
        breakeven: round1(be ?? 0),
        net: round1(c.net),
      };
    });
}
