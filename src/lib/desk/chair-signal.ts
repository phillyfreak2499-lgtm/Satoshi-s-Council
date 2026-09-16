/** Presentation only. Never imported by the Chair, a seat, or the paper book. */
export type ChairSignalInput = {
  score: number;
  bar: number;
  aggressiveness: number;
  lean: "UP" | "DOWN" | "WAIT";
};

/**
 * Current Chair score contract: the weighted signed vote average is bounded by
 * +/-1 before the diversity lift, whose maximum is 1.12. Conflict only reduces
 * magnitude. Keep the display on this fixed score scale so a marker move means
 * the Council actually leaned farther, not merely that the call bar moved.
 */
export const CHAIR_DIRECTIONAL_SCALE_MAX = 1.12;

export type ChairSignal = {
  /** Raw signed Chair score: the thing the marker visualizes. */
  score: number;
  /** score x aggressiveness: the quantity used by the Chair's bar gate. */
  effective: number;
  /** Effective confluence bar used by the Chair gate. */
  threshold: number;
  /** Raw-score magnitude needed to clear the current bar. Null when aggressiveness is zero. */
  rawThreshold: number | null;
  /** Effective signal divided by the current bar. Useful for call-distance math, not marker position. */
  ratio: number;
  /** Marker position on the fixed +/- directional-score scale. */
  position: number;
  /** Current negative and positive call-line positions on that same fixed scale. */
  thresholdDownPosition: number;
  thresholdUpPosition: number;
  /** Fraction of the fixed directional scale, signed and unclipped. Not a probability. */
  directionalFraction: number;
  margin: number;
  met: boolean;
  direction: "UP" | "DOWN" | "NEUTRAL";
  decision: ChairSignalInput["lean"];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const positionOf = (score: number) => 50 + clamp(score / CHAIR_DIRECTIONAL_SCALE_MAX, -1, 1) * 50;

export function chairSignalOf(chair: ChairSignalInput): ChairSignal | null {
  const { score, bar, aggressiveness, lean } = chair;
  if (![score, bar, aggressiveness].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (bar <= 0 || aggressiveness < 0) return null;

  const effective = score * aggressiveness;
  if (!Number.isFinite(effective)) return null;

  const ratio = effective / bar;
  const rawThreshold = aggressiveness > 0 ? bar / aggressiveness : null;
  if (!Number.isFinite(ratio) || (rawThreshold != null && !Number.isFinite(rawThreshold))) return null;

  const thresholdOffset = rawThreshold == null
    ? 50
    : clamp(rawThreshold / CHAIR_DIRECTIONAL_SCALE_MAX, 0, 1) * 50;

  return {
    score,
    effective,
    threshold: bar,
    rawThreshold,
    ratio,
    position: positionOf(score),
    thresholdDownPosition: 50 - thresholdOffset,
    thresholdUpPosition: 50 + thresholdOffset,
    directionalFraction: score / CHAIR_DIRECTIONAL_SCALE_MAX,
    margin: Math.abs(effective) - bar,
    met: Math.abs(effective) >= bar,
    direction: score > 0 ? "UP" : score < 0 ? "DOWN" : "NEUTRAL",
    decision: lean,
  };
}

export function signalReading(signal: ChairSignal | null): string {
  if (!signal) return "Signal unavailable";
  const signed = `${signal.score >= 0 ? "+" : ""}${signal.score.toFixed(3)}`;
  const line = signal.rawThreshold == null ? "unreachable" : `±${signal.rawThreshold.toFixed(3)}`;
  return `lean ${signed} · call ${line}`;
}

export function signalDescription(signal: ChairSignal | null): string {
  if (!signal) return "Chair signal unavailable. No marker is shown.";

  const pct = Math.abs(signal.directionalFraction) * 100;
  const relation = signal.rawThreshold == null
    ? "The call line is unreachable at the current aggressiveness."
    : signal.met
      ? `${signal.direction} signal threshold met.`
      : signal.direction === "NEUTRAL"
        ? "No net directional lean."
        : `${Math.abs(signal.margin).toFixed(3)} effective signal below the ${signal.direction} call threshold.`;

  return `Raw Chair lean ${signal.score >= 0 ? "+" : ""}${signal.score.toFixed(3)}, ${pct.toFixed(0)}% of the fixed directional-strength scale toward ${signal.direction}. Current call line ${signal.rawThreshold == null ? "unreachable" : `±${signal.rawThreshold.toFixed(3)} raw score`}; effective signal ${signal.effective.toFixed(3)} vs bar ${signal.threshold.toFixed(3)}. ${relation} Actual Chair decision: ${signal.decision}. Other checks and paper entry remain separate.${Math.abs(signal.directionalFraction) > 1 ? " Marker is at the end of the scale; the numeric reading is not clipped." : ""}`;
}
