/** Presentation only. Never imported by the Chair, a seat, or the paper book. */
export type ChairSignalInput = {
  score: number;
  bar: number;
  aggressiveness: number;
  lean: "UP" | "DOWN" | "WAIT";
};

export type ChairSignal = {
  effective: number;
  threshold: number;
  /** Signed multiples of the current threshold; not a win probability. */
  ratio: number;
  /** Display clips at twice the threshold. The numeric reading never clips. */
  position: number;
  margin: number;
  met: boolean;
  direction: "UP" | "DOWN" | "NEUTRAL";
  decision: ChairSignalInput["lean"];
};

export function chairSignalOf(chair: ChairSignalInput): ChairSignal | null {
  const { score, bar, aggressiveness, lean } = chair;
  if (![score, bar, aggressiveness].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (bar <= 0 || aggressiveness < 0) return null;
  const effective = score * aggressiveness;
  const ratio = effective / bar;
  if (!Number.isFinite(effective) || !Number.isFinite(ratio)) return null;
  return {
    effective,
    threshold: bar,
    ratio,
    position: 50 + Math.max(-2, Math.min(2, ratio)) * 25,
    margin: Math.abs(effective) - bar,
    met: Math.abs(effective) >= bar,
    direction: effective > 0 ? "UP" : effective < 0 ? "DOWN" : "NEUTRAL",
    decision: lean,
  };
}

export function signalReading(signal: ChairSignal | null): string {
  if (!signal) return "Signal unavailable";
  const signed = `${signal.effective >= 0 ? "+" : ""}${signal.effective.toFixed(3)}`;
  return `${signed} / ±${signal.threshold.toFixed(3)}`;
}

export function signalDescription(signal: ChairSignal | null): string {
  if (!signal) return "Chair signal unavailable. No marker is shown.";
  const relation = signal.met
    ? `${signal.direction} signal threshold met`
    : signal.direction === "NEUTRAL"
      ? "No net directional signal"
      : `${Math.abs(signal.margin).toFixed(3)} below the ${signal.direction} signal threshold`;
  return `Effective signal ${signal.effective.toFixed(3)}; thresholds minus and plus ${signal.threshold.toFixed(3)}. ${relation}. Actual Chair decision: ${signal.decision}. Other checks and paper entry remain separate.${Math.abs(signal.ratio) > 2 ? " Marker is at the end of the scale; the numeric reading is not clipped." : ""}`;
}
