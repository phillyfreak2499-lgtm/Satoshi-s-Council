/**
 * Chair v3 — market-prior shadow research.
 *
 * No authority over the live Chair or paper book. The market probability is a
 * fixed offset; independent Council evidence may only learn a bounded correction.
 */
export const V3_VERSION = 1;
export const V3_MAX_ADJUSTMENT = 0.10;
export const V3_MIN_TRAIN = 240;
export const V3_REFIT_EVERY = 32;
export const V3_LAMBDA = 0.12;
export const V3_STEPS = 450;
export const V3_LR = 0.035;

export const V3_FEATURES = [
  "STRIKE", "DRIFT", "STREAK", "CASCADE", "CHAIN", "TAPE", "WICK", "FADE", "fair_gap",
] as const;
export type V3FeatureName = (typeof V3_FEATURES)[number];
export type V3Features = Record<V3FeatureName, number>;

export type V3Weights = {
  version: typeof V3_VERSION;
  n: number;
  fitted_at: number;
  lambda: number;
  bias: number;
  w: Record<V3FeatureName, number>;
};
export type V3FitRow = {
  close_time: number;
  winner: "UP" | "DOWN";
  market_p: number;
  features: V3Features;
};
export type V3Prediction = {
  p_market: number;
  p_up: number;
  raw_p_up: number;
  adjustment_pp: number;
  raw_adjustment_pp: number;
  correction_logit: number;
  capped: boolean;
  model_n: number;
};
export type V3WalkForwardPoint = {
  close_time: number;
  winner: "UP" | "DOWN";
  market_p: number;
  v3_p: number;
  adjustment_pp: number;
};
export type V3Report = {
  n_rows: number;
  n_scored: number;
  min_train: number;
  refit_every: number;
  market_brier: number | null;
  v3_brier: number | null;
  brier_delta: number | null;
  market_log_loss: number | null;
  v3_log_loss: number | null;
  avg_abs_adjustment_pp: number | null;
  max_abs_adjustment_pp: number | null;
  points: V3WalkForwardPoint[];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

export function probability(p: number): number {
  return clamp(finite(p) ? p : 0.5, 0.01, 0.99);
}
export function logit(p: number): number {
  const q = probability(p);
  return Math.log(q / (1 - q));
}
export function sigmoid(z: number): number {
  if (!Number.isFinite(z)) return 0.5;
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}
function zeros(): Record<V3FeatureName, number> {
  return Object.fromEntries(V3_FEATURES.map((k) => [k, 0])) as Record<V3FeatureName, number>;
}
export function zeroV3Features(): V3Features { return zeros(); }

/** Existing v2 sample rows can seed the first strictly-forward v3 fit. */
export function v3FeaturesFromStored(
  raw: Record<string, unknown> | null | undefined,
  marketP: number,
  fairP: number | null | undefined,
): V3Features {
  const out = zeroV3Features();
  for (const k of V3_FEATURES) {
    if (k === "fair_gap") continue;
    const v = Number(raw?.[k]);
    out[k] = Number.isFinite(v) ? clamp(v, -1, 1) : 0;
  }
  const f = fairP == null ? NaN : Number(fairP);
  out.fair_gap = Number.isFinite(f) ? clamp((logit(f) - logit(marketP)) / 4, -1, 1) : 0;
  return out;
}

export function predictV3(weights: V3Weights | null, marketP: number, features: V3Features): V3Prediction {
  const prior = probability(marketP);
  if (!weights || weights.n < V3_MIN_TRAIN) {
    return { p_market: prior, p_up: prior, raw_p_up: prior, adjustment_pp: 0, raw_adjustment_pp: 0, correction_logit: 0, capped: false, model_n: weights?.n ?? 0 };
  }
  let correction = weights.bias;
  for (const k of V3_FEATURES) correction += (weights.w[k] ?? 0) * (features[k] ?? 0);
  const raw = probability(sigmoid(logit(prior) + correction));
  const p = clamp(raw, Math.max(0.01, prior - V3_MAX_ADJUSTMENT), Math.min(0.99, prior + V3_MAX_ADJUSTMENT));
  return {
    p_market: prior,
    p_up: p,
    raw_p_up: raw,
    adjustment_pp: round((p - prior) * 100, 3),
    raw_adjustment_pp: round((raw - prior) * 100, 3),
    correction_logit: round(correction),
    capped: Math.abs(p - raw) > 1e-12,
    model_n: weights.n,
  };
}

/** Ridge logistic regression with market logit as a fixed offset. */
export function fitV3(rows: readonly V3FitRow[], now = Date.now()): V3Weights | null {
  const clean = rows.filter((r) => (r.winner === "UP" || r.winner === "DOWN") && finite(r.market_p) && V3_FEATURES.every((k) => finite(r.features[k])));
  if (clean.length < V3_MIN_TRAIN) return null;
  const w = zeros();
  let bias = 0;
  const n = clean.length;
  for (let step = 0; step < V3_STEPS; step++) {
    let gb = 0;
    const gw = zeros();
    for (const r of clean) {
      let z = logit(r.market_p) + bias;
      for (const k of V3_FEATURES) z += w[k] * r.features[k];
      const err = sigmoid(z) - (r.winner === "UP" ? 1 : 0);
      gb += err;
      for (const k of V3_FEATURES) gw[k] += err * r.features[k];
    }
    bias = clamp(bias - V3_LR * (gb / n), -1.5, 1.5);
    for (const k of V3_FEATURES) {
      w[k] = clamp(w[k] - V3_LR * (gw[k] / n + V3_LAMBDA * w[k]), -2.5, 2.5);
    }
  }
  return { version: V3_VERSION, n, fitted_at: now, lambda: V3_LAMBDA, bias, w };
}

export function brier(p: number, winner: "UP" | "DOWN"): number {
  return (probability(p) - (winner === "UP" ? 1 : 0)) ** 2;
}
export function logLoss(p: number, winner: "UP" | "DOWN"): number {
  const q = clamp(probability(p), 1e-6, 1 - 1e-6);
  return winner === "UP" ? -Math.log(q) : -Math.log(1 - q);
}

/** Expanding-window walk-forward: every prediction uses only earlier closes. */
export function walkForwardV3(input: readonly V3FitRow[], minTrain = V3_MIN_TRAIN, refitEvery = V3_REFIT_EVERY): V3Report {
  const rows = [...input].filter((r) => finite(r.close_time)).sort((a, b) => a.close_time - b.close_time);
  const points: V3WalkForwardPoint[] = [];
  let weights: V3Weights | null = null;
  let fittedThrough = -1;
  for (let i = minTrain; i < rows.length; i++) {
    if (!weights || i - fittedThrough >= refitEvery) {
      weights = fitV3(rows.slice(0, i), rows[i]!.close_time);
      fittedThrough = i;
    }
    const r = rows[i]!;
    const p = predictV3(weights, r.market_p, r.features);
    points.push({ close_time: r.close_time, winner: r.winner, market_p: probability(r.market_p), v3_p: p.p_up, adjustment_pp: p.adjustment_pp });
  }
  if (!points.length) return { n_rows: rows.length, n_scored: 0, min_train: minTrain, refit_every: refitEvery, market_brier: null, v3_brier: null, brier_delta: null, market_log_loss: null, v3_log_loss: null, avg_abs_adjustment_pp: null, max_abs_adjustment_pp: null, points };
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mb = avg(points.map((p) => brier(p.market_p, p.winner)));
  const vb = avg(points.map((p) => brier(p.v3_p, p.winner)));
  const ml = avg(points.map((p) => logLoss(p.market_p, p.winner)));
  const vl = avg(points.map((p) => logLoss(p.v3_p, p.winner)));
  const abs = points.map((p) => Math.abs(p.adjustment_pp));
  return {
    n_rows: rows.length, n_scored: points.length, min_train: minTrain, refit_every: refitEvery,
    market_brier: round(mb), v3_brier: round(vb), brier_delta: round(mb - vb),
    market_log_loss: round(ml), v3_log_loss: round(vl),
    avg_abs_adjustment_pp: round(avg(abs), 3), max_abs_adjustment_pp: round(Math.max(...abs), 3), points,
  };
}

/** Positive delta means the feature improved the full model's walk-forward Brier. */
export function leaveOneOutV3(rows: readonly V3FitRow[]): Record<V3FeatureName, number | null> {
  const full = walkForwardV3(rows);
  const out = {} as Record<V3FeatureName, number | null>;
  if (full.v3_brier == null) { for (const k of V3_FEATURES) out[k] = null; return out; }
  for (const k of V3_FEATURES) {
    const muted = rows.map((r) => ({ ...r, features: { ...r.features, [k]: 0 } }));
    const r = walkForwardV3(muted);
    out[k] = r.v3_brier == null ? null : round(r.v3_brier - full.v3_brier);
  }
  return out;
}
