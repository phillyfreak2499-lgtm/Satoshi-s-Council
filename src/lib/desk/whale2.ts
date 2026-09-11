/**
 * WHALE 2.0 — real prints, not a volume proxy.
 *
 * WHAT THE INCUMBENT DOES, AND WHY IT IS KEPT. The production WHALE seat infers
 * large participation from candle volume: a bar trading well above its median is
 * treated as someone big showing up. That is a proxy, and it cannot tell a
 * single large order from many small ones, cannot say which side was the
 * aggressor, and cannot see the print at all — it sees the bar the print landed
 * in. It stays exactly as it is, with its own calibration record. THE TWO ARE
 * NEVER MERGED: a proxy and a measurement that disagree are two pieces of
 * evidence, and pooling their histories would destroy both records.
 *
 * WHAT THIS MEASURES. Kalshi's feed carries actual executions with an aggressor
 * side, separated at the source from quotes being pulled — the lab has recorded
 * 1,473 real takes against 47 pulls, so the data exists. From that stream:
 *
 *   SIZE PERCENTILE     where this print sits in the recent distribution of
 *                       print sizes. Absolute size means nothing without it: 50
 *                       contracts is enormous at 3am and unremarkable at noon.
 *   CLUSTERING          same-side prints in quick succession. One large order
 *                       sliced into ten is one decision, not ten, and counting
 *                       it as ten is the classic way to mistake one trader for a
 *                       crowd.
 *   AGGRESSOR           which side crossed the spread. This is the whole point
 *                       of using prints over volume.
 *   IMPACT              how far the midpoint moved after the print.
 *   IMPACT PER UNIT     impact divided by size. A market that moves 3¢ on 200
 *                       contracts is thinner than one that moves 3¢ on 20, and
 *                       the raw impact cannot tell them apart.
 *   CONTINUATION        did price keep going the aggressor's way.
 *   REVERSAL            did it come back. Continuation and reversal are measured
 *                       against the SAME horizon and are mutually exclusive, so
 *                       a print cannot be scored as both.
 *   ABSORPTION          aggressive buying that fails to lift the price, or
 *                       aggressive selling that fails to drop it. The most
 *                       interesting state here: size crossing with no response
 *                       means someone is taking the other side quietly, and it
 *                       is invisible to any volume proxy.
 *   REPLENISHMENT       did the level that was hit come back. Requires book
 *                       data; reported as unknown rather than zero when the
 *                       book was not trusted at the time.
 *
 * WHY IMPACT IS MEASURED FROM THE MIDPOINT. A print moves the touch mechanically
 * — it consumes it — so measuring impact at the traded side would report the
 * mechanical consequence of the trade as its own signal. The midpoint after the
 * book refills is what a later participant would actually face.
 *
 * SHADOW. Nothing votes on any of this. No seat reads it, no skill exists for
 * it, and the incumbent WHALE is untouched.
 *
 * Pure module.
 */

/** One execution, as the feed reports it. `side` is the AGGRESSOR's side in YES terms. */
export type Print = {
  t: number;
  /** "UP" means the aggressor lifted the YES offer; "DOWN" means they hit the YES bid. */
  side: "UP" | "DOWN";
  size: number;
  /** Midpoint in YES cents at the moment of the print. */
  mid: number;
};

/** The book's midpoint at a later instant, for measuring what the print did. */
export type MidPoint = { t: number; mid: number };

/** Horizons after a print, in milliseconds. Frozen with the rest of Phase 2. */
export const IMPACT_MS = 2_000;
export const FOLLOW_MS = 30_000;
/** Prints within this of each other on the same side are one decision, not several. */
export const CLUSTER_MS = 3_000;
/** A print at or above this percentile of recent sizes is "large". */
export const LARGE_PCTILE = 90;
/** Fewer recent prints than this and a percentile is meaningless. */
export const MIN_DISTRIBUTION = 20;
/** Midpoint moves below this are noise, not a response. */
export const RESPONSE_CENTS = 0.5;

/** Where `size` sits in `recent`, 0-100. Null when there is not enough to rank against. */
export function sizePercentile(size: number, recent: readonly number[]): number | null {
  if (recent.length < MIN_DISTRIBUTION || !(size > 0)) return null;
  let below = 0;
  for (const s of recent) if (s < size) below += 1;
  return Math.round((below / recent.length) * 1000) / 10;
}

/**
 * Same-side prints within CLUSTER_MS of each other, collapsed into one. The
 * cluster's size is the total and its time is the FIRST print's — a decision is
 * made when it starts, not when the last slice lands.
 */
export function cluster(prints: readonly Print[]): (Print & { prints: number })[] {
  const sorted = [...prints].sort((a, b) => a.t - b.t);
  const out: (Print & { prints: number })[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last.side === p.side && p.t - last.t <= CLUSTER_MS) {
      last.size += p.size;
      last.prints += 1;
      continue;
    }
    out.push({ ...p, prints: 1 });
  }
  return out;
}

/** The midpoint at or after `t`, within `windowMs`. Null when the series does not reach. */
export function midAt(mids: readonly MidPoint[], t: number, windowMs = 5_000): number | null {
  let best: MidPoint | null = null;
  for (const m of mids) {
    if (m.t < t) continue;
    if (m.t > t + windowMs) break;
    if (!best || m.t < best.t) best = m;
  }
  return best ? best.mid : null;
}

export type PrintRead = {
  t: number;
  side: "UP" | "DOWN";
  size: number;
  prints: number;
  pctile: number | null;
  large: boolean;
  /** Midpoint move over IMPACT_MS, signed the aggressor's way. Null when unmeasurable. */
  impact: number | null;
  /** Impact per 100 contracts, so a thin market and a thick one are comparable. */
  impact_per_100: number | null;
  /** Midpoint move over FOLLOW_MS, signed the aggressor's way. */
  follow: number | null;
  /** It kept going: follow beyond the noise floor, the aggressor's way. */
  continued: boolean;
  /** It came back: follow beyond the noise floor, against the aggressor. */
  reversed: boolean;
  /** Size crossed and the price did not respond. The state a volume proxy cannot see. */
  absorbed: boolean;
  /** The hit level came back within the replenish window. Null when the book was not trusted. */
  replenished: boolean | null;
};

/**
 * Read one print. `mids` must contain midpoints at and after the print; `recent`
 * is the distribution of print sizes BEFORE it — passing later sizes in would
 * rank a print against the future.
 */
export function readPrint(
  p: Print & { prints?: number },
  mids: readonly MidPoint[],
  recent: readonly number[],
  replenished: boolean | null = null,
): PrintRead {
  const pctile = sizePercentile(p.size, recent);
  const sign = p.side === "UP" ? 1 : -1;
  const at = midAt(mids, p.t + IMPACT_MS);
  const later = midAt(mids, p.t + FOLLOW_MS);
  const impact = at == null ? null : r2((at - p.mid) * sign);
  const follow = later == null ? null : r2((later - p.mid) * sign);
  const moved = follow != null && Math.abs(follow) >= RESPONSE_CENTS;
  return {
    t: p.t,
    side: p.side,
    size: p.size,
    prints: p.prints ?? 1,
    pctile,
    large: pctile != null && pctile >= LARGE_PCTILE,
    impact,
    impact_per_100: impact == null || !(p.size > 0) ? null : r2((impact / p.size) * 100),
    follow,
    // Mutually exclusive by construction: one comparison, two names.
    continued: moved && follow! > 0,
    reversed: moved && follow! < 0,
    // Absorption is the absence of a response to size, so it only means
    // anything for a print big enough that a response was expected.
    absorbed: pctile != null && pctile >= LARGE_PCTILE && follow != null && Math.abs(follow) < RESPONSE_CENTS,
    replenished,
  };
}

export type WhaleCell = {
  n: number;
  /** Mean midpoint move over IMPACT_MS, the aggressor's way. */
  avg_impact: number | null;
  /** Mean impact per 100 contracts. */
  avg_impact_per_100: number | null;
  /** Share that kept going, 0-100. */
  continued_pct: number | null;
  /** Share that came back, 0-100. */
  reversed_pct: number | null;
  /** Share that moved neither way beyond the noise floor. */
  flat_pct: number | null;
  /** Share of large prints that met no response at all. */
  absorbed_pct: number | null;
  /** Share whose hit level came back, over the prints where the book could say. */
  replenished_pct: number | null;
  /** Prints where the book could not say whether the level came back. */
  replenish_unknown: number;
};

export function cellOf(reads: readonly PrintRead[]): WhaleCell {
  if (!reads.length) {
    return {
      n: 0, avg_impact: null, avg_impact_per_100: null, continued_pct: null,
      reversed_pct: null, flat_pct: null, absorbed_pct: null, replenished_pct: null, replenish_unknown: 0,
    };
  }
  const withImpact = reads.filter((r) => r.impact != null);
  const withFollow = reads.filter((r) => r.follow != null);
  const large = reads.filter((r) => r.large && r.follow != null);
  const known = reads.filter((r) => r.replenished != null);
  const pct = (k: number, of: number) => (of ? r1((k / of) * 100) : null);
  return {
    n: reads.length,
    avg_impact: withImpact.length ? r2(mean(withImpact.map((r) => r.impact!))) : null,
    avg_impact_per_100: withImpact.length ? r2(mean(withImpact.map((r) => r.impact_per_100 ?? 0))) : null,
    continued_pct: pct(withFollow.filter((r) => r.continued).length, withFollow.length),
    reversed_pct: pct(withFollow.filter((r) => r.reversed).length, withFollow.length),
    flat_pct: pct(withFollow.filter((r) => !r.continued && !r.reversed).length, withFollow.length),
    absorbed_pct: pct(large.filter((r) => r.absorbed).length, large.length),
    replenished_pct: pct(known.filter((r) => r.replenished).length, known.length),
    replenish_unknown: reads.length - known.length,
  };
}

export type WhaleReport = {
  prints: number;
  clusters: number;
  /** Every clustered print. */
  all: WhaleCell;
  /** The top decile by size — where a whale, if the idea means anything, lives. */
  large: WhaleCell;
  /** Everything below it, as the control. A result only means something against this. */
  small: WhaleCell;
  /** Large prints split by aggressor, because buying and selling need not behave alike. */
  large_up: WhaleCell;
  large_down: WhaleCell;
  /** Prints that could not be ranked, and why that is stated. */
  unranked: number;
  verdict: string;
};

export function whaleReport(reads: readonly PrintRead[], printCount: number): WhaleReport {
  const ranked = reads.filter((r) => r.pctile != null);
  const large = ranked.filter((r) => r.large);
  const small = ranked.filter((r) => !r.large);
  return {
    prints: printCount,
    clusters: reads.length,
    all: cellOf(reads),
    large: cellOf(large),
    small: cellOf(small),
    large_up: cellOf(large.filter((r) => r.side === "UP")),
    large_down: cellOf(large.filter((r) => r.side === "DOWN")),
    unranked: reads.length - ranked.length,
    verdict: verdictOf(cellOf(large), cellOf(small)),
  };
}

/** Below this many large prints nothing is said about them. */
export const MIN_LARGE = 30;

function verdictOf(large: WhaleCell, small: WhaleCell): string {
  if (large.n < MIN_LARGE) {
    return `Only ${large.n} large prints so far; ${MIN_LARGE} is the floor for saying anything about them.`;
  }
  const parts: string[] = [];
  if (large.avg_impact_per_100 != null && small.avg_impact_per_100 != null) {
    parts.push(
      `Large prints move the midpoint ${large.avg_impact_per_100}¢ per 100 contracts against ` +
        `${small.avg_impact_per_100}¢ for the rest.`,
    );
  }
  if (large.continued_pct != null && small.continued_pct != null) {
    parts.push(
      `${large.continued_pct}% of large prints kept going over ${FOLLOW_MS / 1000}s and ${large.reversed_pct}% came ` +
        `back, against ${small.continued_pct}% and ${small.reversed_pct}% for the rest.`,
    );
  }
  if (large.absorbed_pct != null) {
    parts.push(
      `${large.absorbed_pct}% met no response at all — size crossing with the price unmoved, which is someone ` +
        `taking the other side quietly and is invisible to a volume proxy.`,
    );
  }
  parts.push(
    `Descriptive and prospective-only: these are prints, not a signal, no seat reads them, and the incumbent ` +
      `volume-proxy WHALE keeps its own separate record. A difference between large and small here is a ` +
      `hypothesis to test on prints recorded afterwards.`,
  );
  return parts.join(" ");
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
function r2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
