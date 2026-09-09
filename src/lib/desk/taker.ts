import type { Lean } from "./types";

/**
 * TAKER — the Kalshi taker-flow shadow seat. A FROZEN experiment, defined a
 * priori and never fit to the ledger: aggressive taker flow into YES (buyers
 * lifting the YES offer on the contract) is read as pressure toward the window
 * resolving UP, and flow into NO toward DOWN. The rules and constants below are
 * frozen as of TAKER_FROZEN_AT; new windows grade it prospectively. Do NOT tune
 * these against history — the whole point is to find out whether the signal has
 * edge, not to manufacture one by overfitting the past.
 *
 * Shadow ONLY. Nothing here votes; no engine path feeds TAKER into the chair,
 * the learner, COACH, thresholds, or any existing seat. It is recorded and
 * graded alongside the desk, and judged out-of-sample before promotion is ever
 * discussed.
 */
export const TAKER_FROZEN_AT = "2026-09-09";

// Frozen constants — chosen by reasoning, not fit. Do not tune against the ledger.
export const TAKER_MIN_TRADES = 8; // fewer taker prints than this → too little flow to read (ineligible)
export const TAKER_DEADBAND = 0.06; // |taker_yes − 0.5| under this → WAIT (no clear side)
export const TAKER_FULL_AT = 0.25; // imbalance at which confidence saturates (≈75/25 flow)

export type TakerCall = { eligible: boolean; lean: Lean; conf: number; imbalance: number };

/** The frozen signal: taker-YES fraction and trade count → a shadow call. */
export function takerSignal(takerYes: number, tradeN: number): TakerCall {
  const yes = Number.isFinite(takerYes) ? takerYes : 0.5;
  const imbalance = yes - 0.5;
  if (!Number.isFinite(tradeN) || tradeN < TAKER_MIN_TRADES) {
    return { eligible: false, lean: "WAIT", conf: 0, imbalance };
  }
  if (Math.abs(imbalance) < TAKER_DEADBAND) {
    return { eligible: true, lean: "WAIT", conf: 0, imbalance };
  }
  const span = TAKER_FULL_AT - TAKER_DEADBAND;
  const scaled = Math.min(1, (Math.abs(imbalance) - TAKER_DEADBAND) / span);
  const conf = Math.max(50, Math.min(100, Math.round(50 + 50 * scaled)));
  return { eligible: true, lean: imbalance > 0 ? "UP" : "DOWN", conf, imbalance };
}

/** Cents after fees for a shadow fill settled at 100/0 — same rule the desk uses.
 *  Fee is the Kalshi taker fee at the entry price. WAIT / no entry = 0. */
export function takerEvCents(lean: Lean, entry: number | null, winner: Lean, fee: (cents: number) => number): number {
  if (lean === "WAIT" || entry == null || (winner !== "UP" && winner !== "DOWN")) return 0;
  const f = fee(entry);
  return lean === winner ? 100 - entry - f : -entry - f;
}

// --- the experiment's read-out (pure, so it is unit-testable on synthetic rows) ---

export type TakerRow = {
  eligible: boolean;
  lean: Lean; // the taker call
  conf: number;
  regime: string;
  winner: Lean | null; // graded outcome; null = not yet graded
  ev_cents: number | null;
  chair_lean: Lean; // the Council's final call on the same window (from the ledger)
};

export type Bucket = { bucket: string; n: number; hit_rate: number | null };
export type TakerReport = {
  frozen_at: string;
  n_sampled: number;
  n_eligible: number;
  n_calls: number; // eligible & directional
  n_graded_calls: number;
  raw_accuracy: number | null;
  net_ev_cents: number;
  ev_per_call: number | null;
  calibration: Bucket[];
  by_regime: { regime: string; n: number; hit_rate: number | null; ev: number }[];
  when_chair_wait: { n: number; hit_rate: number | null; ev: number };
  vs_chair: {
    agree_rate: number | null; // of graded directional calls, how often taker agreed with the chair
    taker_right_chair_wrong: number;
    chair_right_taker_wrong: number;
    both_right: number;
    both_wrong: number;
  };
  incremental: { n_chair_wait_or_wrong: number; taker_hit_rate: number | null; taker_ev: number };
  note: string;
};

const CONF_BUCKETS: [string, number, number][] = [
  ["50-59", 50, 60],
  ["60-69", 60, 70],
  ["70-79", 70, 80],
  ["80-89", 80, 90],
  ["90-100", 90, 101],
];

const rate = (hits: number, n: number): number | null => (n > 0 ? Math.round((hits / n) * 1000) / 1000 : null);

/**
 * Compute the experiment's metrics from graded/sampled rows. Descriptive and
 * prospective — this is not a promotion trigger; promotion is judged only
 * out-of-sample once enough windows have graded under the frozen rules.
 */
export function takerReport(rows: TakerRow[], frozenAt = TAKER_FROZEN_AT): TakerReport {
  const eligible = rows.filter((r) => r.eligible);
  const calls = eligible.filter((r) => r.lean === "UP" || r.lean === "DOWN");
  const graded = calls.filter((r) => r.winner === "UP" || r.winner === "DOWN");
  const hits = graded.filter((r) => r.lean === r.winner).length;
  const netEv = graded.reduce((s, r) => s + (r.ev_cents ?? 0), 0);

  const calibration: Bucket[] = CONF_BUCKETS.map(([label, lo, hi]) => {
    const inb = graded.filter((r) => r.conf >= lo && r.conf < hi);
    return { bucket: label, n: inb.length, hit_rate: rate(inb.filter((r) => r.lean === r.winner).length, inb.length) };
  });

  const regimes = [...new Set(graded.map((r) => r.regime || "—"))].sort();
  const by_regime = regimes.map((reg) => {
    const inb = graded.filter((r) => (r.regime || "—") === reg);
    return {
      regime: reg,
      n: inb.length,
      hit_rate: rate(inb.filter((r) => r.lean === r.winner).length, inb.length),
      ev: Math.round(inb.reduce((s, r) => s + (r.ev_cents ?? 0), 0) * 10) / 10,
    };
  });

  const chairWait = graded.filter((r) => r.chair_lean === "WAIT");
  const when_chair_wait = {
    n: chairWait.length,
    hit_rate: rate(chairWait.filter((r) => r.lean === r.winner).length, chairWait.length),
    ev: Math.round(chairWait.reduce((s, r) => s + (r.ev_cents ?? 0), 0) * 10) / 10,
  };

  // vs the Council: only where BOTH the taker and the chair made a directional call.
  const bothDir = graded.filter((r) => r.chair_lean === "UP" || r.chair_lean === "DOWN");
  let agree = 0;
  let takerRight = 0;
  let chairRight = 0;
  let bothRight = 0;
  let bothWrong = 0;
  for (const r of bothDir) {
    if (r.lean === r.chair_lean) agree += 1;
    const tk = r.lean === r.winner;
    const ch = r.chair_lean === r.winner;
    if (tk && ch) bothRight += 1;
    else if (tk && !ch) takerRight += 1;
    else if (!tk && ch) chairRight += 1;
    else bothWrong += 1;
  }

  // Incremental: where the Council added nothing (WAIT) or was wrong, did taker help?
  const chairGap = graded.filter((r) => r.chair_lean === "WAIT" || r.chair_lean !== r.winner);
  const incremental = {
    n_chair_wait_or_wrong: chairGap.length,
    taker_hit_rate: rate(chairGap.filter((r) => r.lean === r.winner).length, chairGap.length),
    taker_ev: Math.round(chairGap.reduce((s, r) => s + (r.ev_cents ?? 0), 0) * 10) / 10,
  };

  return {
    frozen_at: frozenAt,
    n_sampled: rows.length,
    n_eligible: eligible.length,
    n_calls: calls.length,
    n_graded_calls: graded.length,
    raw_accuracy: rate(hits, graded.length),
    net_ev_cents: Math.round(netEv * 10) / 10,
    ev_per_call: graded.length ? Math.round((netEv / graded.length) * 10) / 10 : null,
    calibration,
    by_regime,
    when_chair_wait,
    vs_chair: {
      agree_rate: rate(agree, bothDir.length),
      taker_right_chair_wrong: takerRight,
      chair_right_taker_wrong: chairRight,
      both_right: bothRight,
      both_wrong: bothWrong,
    },
    incremental,
    note: "shadow, non-voting; frozen rules graded prospectively; judge only out-of-sample",
  };
}
