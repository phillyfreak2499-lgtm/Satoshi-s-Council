import type { ChairResult, Lean, Snapshot } from "./types";

const TIME_IDS = new Set(["early", "late"]);

/**
 * Spec: ≥12m and ≤2.2m cut aggressiveness. They must not hard-WAIT the window.
 * The time factor prices the SIZE of an early/late fill, not whether it exists:
 * multiplying it into the fill test just moved the veto into the bar gate
 * (|score| × 0.55 can never reach a sit-mass bar), so the fill test here uses
 * |score| × (agg ÷ time factor) — the same setup that fills mid-window can
 * fill early/late, at size 1, and only with real edge after fees.
 * Bar, top-3, edge, quote, WARDEN, LAW, chalk, leftover still veto.
 */
export function softenTimeGates(chair: ChairResult, snap: Snapshot): ChairResult {
  const gates = chair.gates.map((g) => {
    if (!TIME_IDS.has(g.id)) return g;
    return {
      ...g,
      hard: false,
      label:
        g.id === "early"
          ? "Early window — sized down (not a veto)"
          : "Late window — sized down (not a veto)",
    };
  });
  const out: ChairResult = {
    ...chair,
    gates,
    hard_fail: gates.some((g) => g.hard && !g.pass),
  };
  const inTimeBand = snap.mins_left >= 12 || snap.mins_left <= 2.2;
  if (chair.lean !== "WAIT" || !inTimeBand || chair.score === 0) return out;
  const blockedElsewhere = gates.some((g) => g.id !== "bar" && g.hard && !g.pass);
  if (blockedElsewhere) return out;
  const tf = chair.time_factor > 0 ? chair.time_factor : 1;
  const fillAgg = (chair.aggressiveness || 1) / tf;
  const vsFill = Math.abs(chair.score) * fillAgg;
  if (vsFill < chair.bar) return out;
  const lean: Lean = chair.score > 0 ? "UP" : "DOWN";
  const edge = lean === "UP" ? snap.edge_up : snap.edge_down;
  if (edge <= 0) return out;
  const bar = gates.find((g) => g.id === "bar");
  if (bar) {
    bar.pass = true;
    bar.value = `|${chair.score.toFixed(3)}| × ${fillAgg.toFixed(2)} (time ×${tf.toFixed(2)} → size) = ${vsFill.toFixed(3)} vs bar ${chair.bar.toFixed(2)}`;
  }
  return {
    ...out,
    lean,
    hard_fail: gates.some((g) => g.hard && !g.pass),
    confidence: Math.min(92, Math.round(50 + Math.abs(chair.score) * 55)),
    size: 1,
    size_note: `time ×${tf.toFixed(2)} · size 1`,
    decision: `${lean} · |${Math.abs(chair.score).toFixed(2)}| vs bar ${chair.bar.toFixed(2)} · time gates size the fill, not veto it`,
    calc: `${chair.calc} · time soften → ${lean}`,
    hypothesis: `${chair.hypothesis} · time soften → ${lean}`,
  };
}
