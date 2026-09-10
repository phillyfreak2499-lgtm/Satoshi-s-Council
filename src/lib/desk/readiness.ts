import { TAKER_FROZEN_AT } from "./taker.ts";

/**
 * Evaluation readiness — the owner's "do we have enough data yet?" gate.
 *
 * This is a READ-ONLY signal. It decides nothing on the desk: it does not touch
 * the chair, TAKER, COACH, the learner, thresholds, or any seat. All it does is
 * count what has accumulated since the TAKER v1 freeze and say whether there is
 * enough of it to make the first serious evaluation worth running — the two-arm,
 * out-of-sample look at (a) whether TAKER carries information the Council did not
 * already have and (b) whether the chair's bar passed up calibrated edges.
 *
 * The thresholds below are deliberately conservative floors for a FIRST look,
 * not promotion bars, and they are meant to be tuned as we learn the real
 * cadence. Everything is anchored to the freeze so the experiment boundary stays
 * identifiable and the evaluation stays out-of-sample.
 *
 * Note on the chair: we do NOT gate on the chair making directional calls. The
 * chair sits out honestly, and most windows are WAIT; requiring a call count
 * would quietly pressure the bar to loosen, which is exactly what we refuse to
 * do. The bar-calibration arm is tested against WAIT windows, so WAIT volume is
 * what it needs — and that is what we count.
 */

// ~95 graded windows/day at the observed cadence, so 1,500 ≈ two-plus weeks of
// out-of-sample data — enough for a first look without waiting a month.
export const READY_MIN_WINDOWS = 1500;
// TAKER is selective (eligible + past the deadband), so its directional count is
// the binding constraint. 80 graded calls is a thin-but-honest floor for a first
// read on incremental value; it is not a promotion threshold.
export const READY_MIN_TAKER_DIR = 80;
// The chair-bar-calibration arm reads WAIT windows against realized outcomes.
export const READY_MIN_CHAIR_WAIT = 400;
// Don't evaluate on a single market context. Require breadth across regimes.
export const READY_MIN_REGIMES = 2;
export const READY_REGIME_MIN_N = 150;

export type RegimeCount = { regime: string; n: number };

export type ReadinessInput = {
  /** Graded ledger windows with close_time on/after the freeze. */
  windows_since_freeze: number;
  /** TAKER rows since the freeze that are eligible, directional, AND graded. */
  taker_dir_graded: number;
  /** Chair WAIT windows since the freeze — what the bar-calibration arm tests. */
  chair_wait_since_freeze: number;
  /** Graded TAKER rows per regime since the freeze (regime breadth). */
  regimes: RegimeCount[];
  /** Interior holes in the recent ledger from the 6-hour gap scan. */
  gaps: number;
  /** Holes beyond the reconciliation baseline (a genuine new loss). */
  recon_new_holes: number;
};

export type ReadinessCheck = {
  key: string;
  label: string;
  have: number;
  need: number;
  met: boolean;
  detail?: string;
};

export type ReadinessReport = {
  ready: boolean;
  met_count: number;
  total_count: number;
  frozen_at: string;
  checks: ReadinessCheck[];
  prompt: string;
  note: string;
};

/** Regimes that clear the per-regime volume floor, richest first. */
export function regimesMeeting(regimes: RegimeCount[], minN = READY_REGIME_MIN_N): RegimeCount[] {
  return regimes
    .filter((r) => r.regime && r.n >= minN)
    .slice()
    .sort((a, b) => b.n - a.n);
}

/**
 * The copy-paste prompt. Written to stand on its own so it can be pasted into a
 * fresh Claude session and kick off the evaluation with the full guardrails,
 * even without this conversation's context. Kept verbatim in one place so the
 * SETTINGS panel and the alert agree on exactly what "run it" means.
 */
export const READINESS_PROMPT = `Satoshi's Council — the data gate has passed. Run the first serious evaluation now, READ-ONLY.

Two arms, out-of-sample only (windows on/after the ${TAKER_FROZEN_AT} TAKER v1 freeze):

1) TAKER v1 incremental value. From /taker (desk_taker joined to desk_ledger), report n_eligible, directional-call count, raw accuracy, net EV and EV/call, confidence calibration, by-regime, the "when the chair said WAIT" cut, and the incremental-beyond-the-Council cut. Answer the real question — does the taker-flow signal carry information the Council did not already have? — not "did it beat 50%."

2) Chair bar calibration. On the same windows, test whether the chair passed up calibrated edges: compare its WAIT windows against realized outcomes and the market's implied edge, broken down by regime and confidence. Was WAIT correct, or was there a detectable edge the bar filtered out?

3) The 70¢ floor's placement. The paper book fills only at 70¢ or better (CHAIR_MIN_ASK_CENTS in book-floor.ts, live since 2026-09-08 20:47 UTC). On the same out-of-sample windows, compare the fills by price shelf — 70–79¢ against 80¢ and up — on win rate against the breakeven each shelf needed (entry plus fee), net cents, and drawdown, broken down by regime. Is 70¢ the right line, or does the edge only begin higher (or reach lower)? Report the shelves with their counts; whether the floor moves is a separate sign-off.

Rules (unchanged): read-only. Do NOT change TAKER rules, thresholds, sampling, or grading. Do NOT move the chair bar or any threshold. Do NOT promote TAKER. Keep the TAKER v1 experiment boundary clearly identifiable. If you find a real implementation bug, STOP and report the exact issue and the smallest fix before changing any code. Report findings only — acting on them (moving the bar, promoting a seat) is a separate, explicit sign-off from me.`;

/**
 * Build the gate from accumulated counts. Pure and deterministic so it can be
 * unit-tested on synthetic inputs. `ready` is the AND of every check.
 */
export function readinessReport(input: ReadinessInput, frozenAt = TAKER_FROZEN_AT): ReadinessReport {
  const okRegimes = regimesMeeting(input.regimes);
  const gaps = Math.max(0, input.gaps | 0);
  const newHoles = Math.max(0, input.recon_new_holes | 0);
  const integrityIssues = gaps + newHoles;

  const checks: ReadinessCheck[] = [
    {
      key: "windows",
      label: "Graded windows since the freeze",
      have: input.windows_since_freeze,
      need: READY_MIN_WINDOWS,
      met: input.windows_since_freeze >= READY_MIN_WINDOWS,
    },
    {
      key: "taker_dir",
      label: "TAKER directional calls graded (out-of-sample)",
      have: input.taker_dir_graded,
      need: READY_MIN_TAKER_DIR,
      met: input.taker_dir_graded >= READY_MIN_TAKER_DIR,
    },
    {
      key: "chair_wait",
      label: "Chair WAIT windows to test the bar against",
      have: input.chair_wait_since_freeze,
      need: READY_MIN_CHAIR_WAIT,
      met: input.chair_wait_since_freeze >= READY_MIN_CHAIR_WAIT,
    },
    {
      key: "regimes",
      label: `Distinct regimes with ≥${READY_REGIME_MIN_N} graded windows`,
      have: okRegimes.length,
      need: READY_MIN_REGIMES,
      met: okRegimes.length >= READY_MIN_REGIMES,
      detail: okRegimes.map((r) => `${r.regime}:${r.n}`).join(", ") || "—",
    },
    {
      key: "integrity",
      label: "Ledger integrity (holes + newly-missing)",
      have: integrityIssues,
      need: 0,
      met: integrityIssues === 0,
      detail: `gaps ${gaps} · new holes ${newHoles}`,
    },
  ];

  const met = checks.filter((c) => c.met).length;
  return {
    ready: met === checks.length,
    met_count: met,
    total_count: checks.length,
    frozen_at: frozenAt,
    checks,
    prompt: READINESS_PROMPT,
    note: "read-only owner gate; nothing here changes the chair, TAKER, or any seat",
  };
}
