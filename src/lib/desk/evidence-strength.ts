/**
 * Evidence strength for a small-n record, without touching status.
 *
 * Three numbers per seat or card: the point win rate, the Wilson 95% lower
 * bound, and the win rate its actual booked average ask needs after fee.
 * The label says whether the lower bound clears the need. 17/17 is "promising,
 * insufficient": its lower bound (≈ 0.82) sits under most 80¢-plus needs.
 * Below minN (default 10) no comparison is attempted at all (INSUFFICIENT_N);
 * `small_n` additionally flags anything under 20.
 *
 * Pure module. Labels only.
 */
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";
import { wilsonLower } from "./math.ts";

export type EvidenceLabel = "INSUFFICIENT_N" | "PROMISING_INSUFFICIENT" | "LOWER_BOUND_CLEARS_NEED" | "BELOW_NEED";

export type EvidenceStrength = {
  id: string;
  n: number; hits: number;
  point_wr_pct: number | null;
  wilson_lower_pct: number | null;
  avg_booked_ask: number | null;
  needed_wr_pct: number | null;
  /** n < 20: the point estimate is reported but is not evidence on its own. */
  small_n: boolean;
  label: EvidenceLabel;
  note: string;
};

export const SMALL_N = 20;

export function evidenceStrength(id: string, hits: number, n: number, avgBookedAsk: number | null, minN = 10, engine: FeeEngineId = DEFAULT_FEE_ENGINE): EvidenceStrength {
  const point = n ? Math.round((1000 * hits) / n) / 10 : null;
  const lb = n ? Math.round(wilsonLower(hits, n) * 1000) / 10 : null;
  const needed = avgBookedAsk != null && realAskCents(avgBookedAsk) ? Math.round((avgBookedAsk + feeCents(avgBookedAsk, engine)) * 10) / 10 : null;
  let label: EvidenceLabel, note: string;
  if (n < minN) { label = "INSUFFICIENT_N"; note = `${n} < ${minN} graded observations`; }
  else if (needed == null) { label = lb != null && lb >= 55 ? "PROMISING_INSUFFICIENT" : "BELOW_NEED"; note = "no booked average ask: the need cannot be priced"; }
  else if (lb != null && lb >= needed) { label = "LOWER_BOUND_CLEARS_NEED"; note = `Wilson lower ${lb}% ≥ needed ${needed}% at ${avgBookedAsk}¢`; }
  else if (point != null && point >= needed) { label = "PROMISING_INSUFFICIENT"; note = `point ${point}% ≥ needed ${needed}% but lower bound ${lb}% does not clear it`; }
  else { label = "BELOW_NEED"; note = `point ${point}% < needed ${needed}% at ${avgBookedAsk}¢`; }
  return { id, n, hits, point_wr_pct: point, wilson_lower_pct: lb, avg_booked_ask: avgBookedAsk, needed_wr_pct: needed, small_n: n < SMALL_N, label, note };
}
