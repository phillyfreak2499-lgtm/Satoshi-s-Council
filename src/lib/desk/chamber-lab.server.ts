/**
 * Read-only bridge from the existing prospective policy Lab to Chamber event
 * inputs. This module never persists system events and has no production
 * authority. The central Chamber observer remains the only writer.
 */
import { EXIT_CANDIDATES, controlFor } from "./floor-policy";
import { labStanding } from "./policy-lab.server";
import { labExperimentEvents } from "./chamber-lab";
import type { SystemEventInput } from "./system-events";

export async function currentLabExperimentEvents(): Promise<SystemEventInput[]> {
  const standing = await labStanding();
  const byId = new Map(standing.rows.map((row) => [row.candidate_id, row]));
  const control = controlFor("exit");
  const out: SystemEventInput[] = [];

  for (const candidate of EXIT_CANDIDATES) {
    if (candidate.control) continue;
    const row = byId.get(candidate.id);
    if (!row || row.n <= 0) continue;
    out.push(
      ...labExperimentEvents({
        candidate_id: candidate.id,
        label: candidate.label,
        control: false,
        frozen_at: candidate.frozen_at,
        why: candidate.why,
        n: row.n,
        paired_n: row.paired_n,
        paired_delta: row.paired_delta,
        observed_at: standing.at,
        control_id: control?.id ?? "HOLD_V1",
      }),
    );
  }

  return out;
}
