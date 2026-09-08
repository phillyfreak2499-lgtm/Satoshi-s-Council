/**
 * Chair v2 — a probability chair learned from the desk's own ledger.
 *
 * Every seat's RAW read (before the whisper filter) becomes signed evidence
 * in [-1, 1]; the market's implied probability and the desk's fair model
 * enter as scaled logits. A ridge-regularized logistic regression, fit on
 * the mid-window samples the engine records, turns them into one P(UP).
 * It trades — on paper, in shadow — only where that probability beats the
 * ask by more than the taker fee plus a margin. Nothing here touches the
 * live chair; it competes with it on the same windows and the ledger keeps
 * score.
 */
import { takerFeeCents } from "./clock";
import { SEAT_IDS, type Lean, type Snapshot, type Vote } from "./types";

export const V2_SEATS = SEAT_IDS.filter((s) => s !== "WARDEN");
export const V2_FEATURES: readonly string[] = [...V2_SEATS, "market", "fair"];
/** Below this many graded samples the chair is the (shrunk) market. */
export const V2_MIN_SAMPLES = 30;
/** Cents of edge after fees required before a shadow fill. */
export const V2_MARGIN_CENTS = 6;
/** No shadow fills under this ask: the tails are where a young model's calibration is worst. */
export const V2_MIN_ENTRY_CENTS = 35;
/** One sample per window, at the first tick at or under this many minutes left. */
export const V2_SAMPLE_MINS = 7.5;

/** Shadow scoreboard for v2 against the chair and the market on identical windows. */
export type V2Stats = {
  n_samples: number;
  n_graded: number;
  brier_v2: number | null;
  brier_market: number | null;
  ev_v2: number;
  ev_v1: number;
  calls_v2: number;
  calls_v1: number;
};

/** The promotion rule, written down: v2 replaces the chair only when all
 *  three hold on a serious sample. Nobody moves these goalposts later. */
export const V2_GATE_SAMPLES = 300;
export const V2_GATE_CALLS = 40;
export function v2Gates(st: V2Stats): { samplesOk: boolean; callsOk: boolean; brierOk: boolean; met: number } {
  const samplesOk = st.n_graded >= V2_GATE_SAMPLES;
  const callsOk = st.calls_v2 >= V2_GATE_CALLS && st.ev_v2 > 0;
  const brierOk = st.brier_v2 != null && st.brier_market != null && st.brier_v2 < st.brier_market;
  return { samplesOk, callsOk, brierOk, met: Number(samplesOk) + Number(callsOk) + Number(brierOk) };
}

/** How far v2 may disagree with the market, earned by calibration: full voice
 *  at a Brier 25% better than the market's, none while the market is better.
 *  With no record yet it keeps full voice; the fill floor and margin still guard. */
export function v2Voice(st: V2Stats | null): number {
  if (!st || st.brier_v2 == null || st.brier_market == null || !(st.brier_market > 0)) return 1;
  return Math.max(0, Math.min(1, 4 * (1 - st.brier_v2 / st.brier_market)));
}

export type V2Features = Record<string, number>;
export type V2Weights = { w: Record<string, number>; b: number; n: number; fitted_at: number; loss: number };
export type V2Decision = {
  p_up: number;
  lean: Lean;
  /** Best edge after fees in cents; null when there is no live book to price against. */
  edge_cents: number | null;
  entry_cents: number | null;
};

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function logit(p: number): number {
  const q = Math.min(0.97, Math.max(0.03, p));
  return Math.log(q / (1 - q));
}

/** Signed evidence from a seat's own read: +conf/100 for UP, -conf/100 for DOWN, 0 for WAIT. */
export function seatEvidence(v: Vote | undefined): number {
  if (!v) return 0;
  const lean = v.raw_lean ?? v.lean;
  const conf = Math.min(100, Math.max(0, v.raw_conf ?? v.confidence));
  if (lean === "UP") return conf / 100;
  if (lean === "DOWN") return -conf / 100;
  return 0;
}

export function extractFeatures(votes: Vote[], snap: Snapshot): V2Features {
  const bySeat = new Map(votes.map((v) => [v.seat, v] as const));
  const f: V2Features = {};
  for (const s of V2_SEATS) f[s] = seatEvidence(bySeat.get(s));
  const mid = snap.yes_mid > 0 ? snap.yes_mid / 100 : 0.5;
  f.market = logit(mid) / 3.5;
  f.fair = logit((snap.fair_yes || 50) / 100) / 3.5;
  return f;
}

/** P(UP). Before enough samples exist, the honest prior is the market, lightly shrunk. */
export function predictV2(weights: V2Weights | null, f: V2Features, snap: Snapshot, voice = 1): number {
  const mkt = snap.yes_mid > 0 ? snap.yes_mid / 100 : 0.5;
  if (!weights || weights.n < V2_MIN_SAMPLES) return 0.5 + (mkt - 0.5) * 0.9;
  let z = weights.b;
  for (const k of V2_FEATURES) z += (weights.w[k] ?? 0) * (f[k] ?? 0);
  const p = sigmoid(z);
  // The model may pull away from the market only as far as its record has earned.
  return mkt + Math.max(0, Math.min(1, voice)) * (p - mkt);
}

/** Ridge logistic regression by full-batch gradient descent. Features are
 *  bounded (|x| ≲ 1), so a fixed step is stable; 400 passes over a few
 *  thousand rows is a few million flops. */
export function fitLogistic(
  rows: { x: V2Features; y: number }[],
  opts: { lambda?: number; iters?: number; lr?: number } = {},
): V2Weights | null {
  // Seat evidence is sparse (most seats sit most windows), so feature variance
  // is low and a heavy ridge would shrink real weights to a fraction of truth.
  // Light L2, more passes; features are bounded so the step is stable.
  const n = rows.length;
  if (n < V2_MIN_SAMPLES) return null;
  // Shrink hard while the ledger is thin (a fixed prior against a small
  // sample) and relax as windows accumulate: λ = 0.004 + 2/n.
  const lambda = opts.lambda ?? 0.004 + 2 / n;
  const iters = opts.iters ?? 800;
  const lr = opts.lr ?? 0.6;
  const keys = V2_FEATURES;
  const w: Record<string, number> = {};
  for (const k of keys) w[k] = 0;
  let b = 0;
  const gw: Record<string, number> = {};
  for (let it = 0; it < iters; it++) {
    for (const k of keys) gw[k] = 0;
    let gb = 0;
    for (const r of rows) {
      let z = b;
      for (const k of keys) z += w[k]! * (r.x[k] ?? 0);
      const err = sigmoid(z) - r.y;
      gb += err;
      for (const k of keys) gw[k]! += err * (r.x[k] ?? 0);
    }
    b -= lr * (gb / n);
    for (const k of keys) w[k] = w[k]! - lr * (gw[k]! / n + lambda * w[k]!);
  }
  let loss = 0;
  for (const r of rows) {
    let z = b;
    for (const k of keys) z += w[k]! * (r.x[k] ?? 0);
    const p = sigmoid(z);
    loss += -(r.y * Math.log(Math.max(1e-9, p)) + (1 - r.y) * Math.log(Math.max(1e-9, 1 - p)));
  }
  return { w, b, n, fitted_at: Date.now(), loss: loss / n };
}

/** Shadow decision: buy the side whose probability beats its ask by fee + margin. */
export function decideV2(p: number, snap: Snapshot): V2Decision {
  const yesAsk = snap.yes_ask || snap.yes_mid || 0;
  const noAsk = snap.no_ask || (snap.yes_mid ? 100 - snap.yes_mid : 0);
  const edgeUp = yesAsk > 0 && yesAsk < 100 ? p * 100 - yesAsk - takerFeeCents(yesAsk) : null;
  const edgeDn = noAsk > 0 && noAsk < 100 ? (1 - p) * 100 - noAsk - takerFeeCents(noAsk) : null;
  const upOk = edgeUp != null && yesAsk >= V2_MIN_ENTRY_CENTS && edgeUp >= V2_MARGIN_CENTS;
  const dnOk = edgeDn != null && noAsk >= V2_MIN_ENTRY_CENTS && edgeDn >= V2_MARGIN_CENTS;
  if (upOk && edgeUp! >= (dnOk ? edgeDn! : -Infinity)) {
    return { p_up: p, lean: "UP", edge_cents: edgeUp, entry_cents: yesAsk };
  }
  if (dnOk) {
    return { p_up: p, lean: "DOWN", edge_cents: edgeDn, entry_cents: noAsk };
  }
  const best = edgeUp == null && edgeDn == null ? null : Math.max(edgeUp ?? -Infinity, edgeDn ?? -Infinity);
  return { p_up: p, lean: "WAIT", edge_cents: best, entry_cents: null };
}

/** Cents after fees for a shadow fill settled at 100/0. WAIT = 0. */
export function settleV2(lean: Lean, entry: number | null, winner: "UP" | "DOWN"): number {
  if (lean === "WAIT" || entry == null) return 0;
  const fee = takerFeeCents(entry);
  return lean === winner ? 100 - entry - fee : -entry - fee;
}

export function brier(p: number, up: boolean): number {
  const y = up ? 1 : 0;
  return (p - y) ** 2;
}

/** Fixed map from a seat's signed evidence to a probability, for the leaderboard. */
export function seatProb(evidence: number): number {
  return 0.5 + 0.4 * Math.max(-1, Math.min(1, evidence));
}
