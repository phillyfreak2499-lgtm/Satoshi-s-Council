/**
 * STRIKE 2.0 — an auditable P(UP), calibrated walk-forward, judged against the market.
 *
 * WHAT THE INCUMBENT DOES. The production STRIKE skill fires when the
 * standardised distance to the strike clears 0.7σ and votes the in-the-money
 * side with a fixed confidence. That is a threshold, not a probability: it
 * cannot say whether 0.8σ with four minutes left is a 70% proposition or a 95%
 * one, so it cannot be checked for calibration and cannot be compared with the
 * price the market is charging.
 *
 * WHAT THIS ADDS. A probability, and a way to be wrong about it in public.
 *
 * The theoretical prior is already in the desk: fair value is Φ(d/σ), the
 * chance a diffusion ends the right side of the strike. That prior is a model,
 * and models are biased — the settlement basis note in clock.ts is an admission
 * of one such bias. So the prior is CALIBRATED against what actually happened:
 * windows are bucketed by their standardised distance, and each bucket learns
 * its own empirical hit rate.
 *
 * WHY THIS CANNOT CHEAT. Calibration is strictly walk-forward. Predicting
 * window i uses a table built only from windows before i, and the table is
 * updated only after the prediction is recorded. There is no train/test split to
 * get wrong and no shuffle to leak across, because every prediction is made at a
 * point where the future genuinely did not exist. A test asserts that inserting
 * a later window cannot change an earlier prediction.
 *
 * WHY IT SHRINKS. A bucket holding four windows has no business overruling the
 * model. Each bucket's estimate is the empirical count blended toward the
 * theoretical prior with a pseudo-count, so a thin bucket is essentially the
 * prior and only a well-populated one earns the right to disagree. This is the
 * opposite of fitting thresholds until a backtest looks good.
 *
 * THE BENCHMARK IS THE MARKET. A prediction market's own price is a strong
 * probability estimate, especially near resolution, and any model that cannot
 * beat it is not evidence of anything. Brier scores are reported for the
 * calibrated model, the raw prior, and the market price, on identical windows.
 * Beating the prior is easy and means little; beating the market is the bar.
 *
 * SHADOW. Nothing here votes. No seat reads it, no skill is built on it in this
 * pass, and no path exists from this file to the chair. The incumbent STRIKE is
 * untouched.
 *
 * Pure module.
 */

/**
 * Inverse normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
 * Needed to recover the standardised distance from a stored fair value: the
 * desk already wrote Φ(z) to the ledger, so z comes back without having to
 * recompute volatility from scratch and risk disagreeing with what was used.
 */
export function probit(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Bucket width in standard deviations. */
export const Z_BUCKET = 0.25;
/** Buckets beyond this |z| all fold into the end bucket: past here the prior is already near certain. */
export const Z_MAX = 3;
/**
 * Pseudo-count pulling each bucket toward the theoretical prior. At n = 20 the
 * empirical rate carries about 2/3 of the weight; at n = 4 it carries a quarter.
 */
export const SHRINK_K = 10;

/** Bucket index for a standardised distance. Signed, so ITM and OTM never share a bucket. */
export function zBucket(z: number): number {
  if (!Number.isFinite(z)) return 0;
  const clamped = Math.max(-Z_MAX, Math.min(Z_MAX, z));
  const k = Math.round(clamped / Z_BUCKET);
  // Normalise -0, which a Map treats as 0 anyway but which would serialise as "-0".
  return k === 0 ? 0 : k;
}

export type CalibCell = { n: number; hits: number };
export type CalibTable = Map<number, CalibCell>;

export function freshCalib(): CalibTable {
  return new Map();
}

/**
 * The calibrated probability for this bucket: the bucket's own record blended
 * toward the theoretical prior by a pseudo-count, so a thin bucket stays close
 * to the model and only a well-evidenced one moves away from it.
 */
export function calibrated(table: CalibTable, z: number, prior: number): number {
  const cell = table.get(zBucket(z));
  const n = cell?.n ?? 0;
  const hits = cell?.hits ?? 0;
  const p = (hits + SHRINK_K * prior) / (n + SHRINK_K);
  return Math.max(0.001, Math.min(0.999, p));
}

/** Record an outcome into the table. Called only AFTER its prediction is made. */
export function learn(table: CalibTable, z: number, up: boolean): void {
  const k = zBucket(z);
  const cell = table.get(k) ?? { n: 0, hits: 0 };
  cell.n += 1;
  if (up) cell.hits += 1;
  table.set(k, cell);
}

/** Brier score for one forecast: lower is better, 0.25 is a coin flip. */
export function brier(p: number, up: boolean): number {
  const o = up ? 1 : 0;
  return (p - o) * (p - o);
}

/**
 * One graded window as the study sees it. `fair_yes` is the desk's own stored
 * prior in cents; `market_yes` is the price the market was charging at the same
 * moment, also in cents. Both are prediction-time values; `up` is the outcome.
 */
export type Strike2Row = {
  t: number;
  fair_yes: number;
  market_yes: number;
  up: boolean;
  /**
   * When this window's outcome became knowable — its close. A row is not allowed
   * to become evidence before this moment, which is what stops several samples
   * taken inside ONE window from teaching each other the answer they share.
   * Defaults to `t`, correct only when each row is its own settled window.
   */
  known_at?: number;
  /** The window this sample came from, for counting independent windows. */
  window?: string;
  regime?: string;
  mins_left?: number;
};

export type Strike2Score = {
  n: number;
  /** Mean Brier, lower is better. Null with nothing scored. */
  brier: number | null;
  /** Share of windows the side it favoured actually won. */
  hit_rate: number | null;
  /** Mean forecast, for sanity against the base rate. */
  mean_p: number | null;
};

/**
 * One forecast, as it stood at the moment it was made. `bucket_n` is how much
 * evidence that bucket held BEFORE this window — 0 means the forecast was the
 * untouched prior and the model deserves no credit for it either way.
 */
export type Strike2Pred = {
  t: number;
  z: number;
  p: number;
  prior: number;
  market: number | null;
  up: boolean;
  bucket_n: number;
  window?: string;
  regime?: string;
  mins_left?: number;
};

export type Strike2Bucket = { z: number; n: number; hits: number; empirical: number };

export type Strike2Walk = {
  preds: Strike2Pred[];
  /** Final bucket counts, so the calibration itself can be inspected. */
  buckets: Strike2Bucket[];
  /** Rows with unusable inputs. Stated, not silently dropped. */
  skipped: number;
  /** Distinct windows behind those rows. Several rows per window are correlated. */
  windows: number;
};

/**
 * The walk itself. Each window is predicted from the table as it stood before
 * it, and only then folded into the table. Rows are sorted here rather than
 * trusted, so a caller handing them over out of order cannot create a leak by
 * accident.
 *
 * The guarantee this buys: the forecast for window i is a function of windows
 * 0..i-1 only. Appending later windows cannot change it. That is asserted in the
 * tests by comparing a prefix run against the same prefix inside a longer run.
 */
export function strike2Predictions(rows: readonly Strike2Row[]): Strike2Walk {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const table = freshCalib();
  const preds: Strike2Pred[] = [];
  const seen = new Set<string>();
  /** Rows predicted but not yet knowable, kept in the order they become knowable. */
  let pending: { known: number; z: number; up: boolean }[] = [];
  let skipped = 0;

  const flush = (upTo: number) => {
    if (!pending.length) return;
    const ripe = pending.filter((x) => x.known <= upTo);
    if (!ripe.length) return;
    pending = pending.filter((x) => x.known > upTo);
    for (const x of ripe) learn(table, x.z, x.up);
  };

  for (const r of sorted) {
    const fair = Number(r.fair_yes);
    if (!Number.isFinite(fair) || fair <= 0 || fair >= 100) {
      skipped += 1;
      continue;
    }
    // Everything whose answer was already public by now becomes evidence first.
    flush(r.t);
    const prior = fair / 100;
    const z = probit(prior);
    const bucketN = table.get(zBucket(z))?.n ?? 0;
    // Predict from what was knowable BEFORE this moment.
    const p = calibrated(table, z, prior);
    const mkt = Number(r.market_yes);
    preds.push({
      t: r.t,
      z: round4(z),
      p,
      prior,
      market: Number.isFinite(mkt) && mkt > 0 && mkt < 100 ? mkt / 100 : null,
      up: r.up,
      bucket_n: bucketN,
      ...(r.window ? { window: r.window } : {}),
      ...(r.regime ? { regime: r.regime } : {}),
      ...(Number.isFinite(Number(r.mins_left)) ? { mins_left: Number(r.mins_left) } : {}),
    });
    if (r.window) seen.add(r.window);
    // It waits its turn: not evidence until its own window has closed.
    pending.push({ known: Number.isFinite(Number(r.known_at)) ? Number(r.known_at) : r.t, z, up: r.up });
  }
  // The tail never teaches anything — nothing is predicted after it — but the
  // final bucket counts are what the report shows, so they must be complete.
  for (const x of pending) learn(table, x.z, x.up);

  const buckets = [...table.entries()]
    .map(([k, c]) => ({
      z: round4(k * Z_BUCKET),
      n: c.n,
      hits: c.hits,
      empirical: round4(c.hits / Math.max(1, c.n)),
    }))
    .sort((a, b) => a.z - b.z);

  return { preds, buckets, skipped, windows: seen.size || preds.length };
}

export type Strike2Report = {
  n: number;
  base_rate: number | null;
  /** The calibrated model on every scorable window, evidence or not. */
  model: Strike2Score;
  /**
   * The model on the windows where its bucket already held real evidence. On a
   * young table most windows are pure prior, and scoring those as "the model"
   * flatters it; this is the number that says whether calibration is doing work.
   */
  model_informed: Strike2Score;
  /** The untouched theoretical prior, Phi(d/sigma). */
  prior: Strike2Score;
  /** The market's own price - the bar that matters. */
  market: Strike2Score;
  /** Did the calibrated model beat the market on the windows both scored? */
  beats_market: boolean | null;
  /** Did it beat its own prior? Easy, and on its own means little. */
  beats_prior: boolean | null;
  buckets: Strike2Bucket[];
  skipped: number;
  /** Independent windows behind `n`. When it is far below n, the rows are correlated. */
  windows: number;
};

const EMPTY_SCORE: Strike2Score = { n: 0, brier: null, hit_rate: null, mean_p: null };

/** Brier, lean accuracy and mean forecast over a set of predictions. */
export function scorePreds(preds: readonly { p: number; up: boolean }[]): Strike2Score {
  if (!preds.length) return EMPTY_SCORE;
  let b = 0;
  let hits = 0;
  let sum = 0;
  for (const x of preds) {
    b += brier(x.p, x.up);
    sum += x.p;
    // "Right" means the side it leaned actually won; a 50/50 forecast leans nowhere.
    if ((x.p > 0.5 && x.up) || (x.p < 0.5 && !x.up)) hits += 1;
  }
  return {
    n: preds.length,
    brier: round4(b / preds.length),
    hit_rate: round4(hits / preds.length),
    mean_p: round4(sum / preds.length),
  };
}

function round4(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : 0;
}

/**
 * Compare model, prior and market on the SAME windows. Brier scores computed over
 * different window sets are not comparable, so the market comparison is made only
 * where a market price existed.
 */
export function strike2Report(walk: Strike2Walk): Strike2Report {
  const { preds } = walk;
  const withMarket = preds.filter((x) => x.market != null);
  const informed = preds.filter((x) => x.bucket_n >= SHRINK_K);
  const model = scorePreds(preds);
  const prior = scorePreds(preds.map((x) => ({ p: x.prior, up: x.up })));
  const market = scorePreds(withMarket.map((x) => ({ p: x.market!, up: x.up })));
  // Like against like: the model restricted to the windows the market also priced.
  const modelVsMarket = scorePreds(withMarket.map((x) => ({ p: x.p, up: x.up })));
  const ups = preds.filter((x) => x.up).length;
  return {
    n: preds.length,
    base_rate: preds.length ? round4(ups / preds.length) : null,
    model,
    model_informed: scorePreds(informed),
    prior,
    market,
    beats_market:
      modelVsMarket.brier != null && market.brier != null ? modelVsMarket.brier < market.brier : null,
    beats_prior: model.brier != null && prior.brier != null ? model.brier < prior.brier : null,
    buckets: walk.buckets,
    skipped: walk.skipped,
    windows: walk.windows,
  };
}

/** Walk and score in one call. */
export function strike2WalkForward(rows: readonly Strike2Row[]): Strike2Report {
  return strike2Report(strike2Predictions(rows));
}

export type Strike2Group = {
  key: string;
  n: number;
  /** Independent windows in this group. */
  windows: number;
  model: Strike2Score;
  prior: Strike2Score;
  market: Strike2Score;
  beats_market: boolean | null;
};

/**
 * Score the same walk broken out by regime, minutes left, or anything else a
 * caller can name. The walk is NOT re-run per group: re-running would let a
 * group's own future leak into it through a table built from its members only.
 * Groups are a view on forecasts that were already made in true time order.
 */
export function strike2Groups(
  preds: readonly Strike2Pred[],
  keyOf: (p: Strike2Pred) => string | null,
): Strike2Group[] {
  const by = new Map<string, Strike2Pred[]>();
  for (const p of preds) {
    const k = keyOf(p);
    if (!k) continue;
    const arr = by.get(k) ?? [];
    arr.push(p);
    by.set(k, arr);
  }
  return [...by.entries()]
    .map(([key, xs]) => {
      const withMarket = xs.filter((x) => x.market != null);
      const market = scorePreds(withMarket.map((x) => ({ p: x.market!, up: x.up })));
      const vsMarket = scorePreds(withMarket.map((x) => ({ p: x.p, up: x.up })));
      return {
        key,
        n: xs.length,
        windows: new Set(xs.map((x) => x.window ?? String(x.t))).size,
        model: scorePreds(xs),
        prior: scorePreds(xs.map((x) => ({ p: x.prior, up: x.up }))),
        market,
        beats_market:
          vsMarket.brier != null && market.brier != null ? vsMarket.brier < market.brier : null,
      };
    })
    .sort((a, b) => b.n - a.n);
}
