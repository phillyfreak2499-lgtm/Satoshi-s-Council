/**
 * Pure ALCHEMIST experiment-event builder.
 *
 * It turns already-measured, frozen Lab candidates into sparse public lifecycle
 * events. It cannot query the database, generate candidates, evaluate promotion
 * gates, or change production. The event is narration of evidence that already
 * exists — never authority.
 */
import type { SystemEventInput } from "./system-events.ts";

export const LAB_EVIDENCE_MILESTONES = Object.freeze([10, 25, 50, 100, 250] as const);

export type LabExperimentEvidence = {
  candidate_id: string;
  label: string;
  control: boolean;
  frozen_at: string;
  why: string;
  n: number;
  paired_n: number;
  paired_delta: number | null;
  observed_at: string;
  control_id: string;
};

function usable(input: LabExperimentEvidence): boolean {
  return (
    !input.control &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.candidate_id) &&
    input.label.trim().length > 0 &&
    Number.isFinite(input.n) &&
    input.n > 0 &&
    Number.isFinite(Date.parse(input.observed_at)) &&
    Number.isFinite(Date.parse(input.frozen_at))
  );
}

function payload(input: LabExperimentEvidence, text: string, milestone: number | null) {
  return {
    text,
    candidate_id: input.candidate_id,
    candidate_label: input.label,
    sample_n: Math.max(0, Math.floor(input.n)),
    paired_n: Math.max(0, Math.floor(input.paired_n)),
    paired_delta: input.paired_delta,
    milestone,
    control_id: input.control_id,
    frozen_at: input.frozen_at,
    hypothesis: input.why,
    paper_only: true,
    authority: "none",
  };
}

export function labExperimentEvents(input: LabExperimentEvidence): SystemEventInput[] {
  if (!usable(input)) return [];

  const events: SystemEventInput[] = [];
  const startText = `${input.label} is in shadow research. The specimen is frozen, paper-only, and has no production authority.`;
  events.push({
    event_key: `EXPERIMENT_STARTED:${input.candidate_id}`,
    event_type: "EXPERIMENT_STARTED",
    character: "ALCHEMIST",
    occurred_at: input.observed_at,
    source_type: "experiment",
    source_id: input.candidate_id,
    payload: payload(input, startText, null),
    public: true,
  });

  for (const milestone of LAB_EVIDENCE_MILESTONES) {
    if (input.n < milestone) continue;
    const text = `${input.label} has cleared ${milestone} countable prospective observations. Sample milestone only; it remains shadow and earns no authority.`;
    events.push({
      event_key: `EXPERIMENT_EVIDENCE_MILESTONE:${input.candidate_id}:${milestone}`,
      event_type: "EXPERIMENT_EVIDENCE_MILESTONE",
      character: "ALCHEMIST",
      occurred_at: input.observed_at,
      source_type: "experiment",
      source_id: input.candidate_id,
      payload: payload(input, text, milestone),
      public: true,
    });
  }

  return events;
}
