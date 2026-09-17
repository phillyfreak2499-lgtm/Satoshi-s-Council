/**
 * Public, read-only Lab snapshot.
 *
 * This surface deliberately exposes aggregate paper-research evidence only. It
 * cannot write observations, alter a candidate, evaluate an actuator, or change
 * the active Floor. The underlying Lab remains the source of truth.
 */
import { createServerFn } from "@tanstack/react-start";
import { EXIT_CANDIDATES, controlFor } from "./floor-policy";
import { labStanding } from "./policy-lab.server";
import {
  seatHorizonSnapshot,
  type PublicSeatHorizonSnapshot,
} from "./horizon-calibration.server";
import { COMPONENT_MIN } from "./promotion-gates";
import { callQualitySnapshot, type CallQualitySnapshot } from "./call-quality.server";

export type PublicLabSpecimen = {
  id: string;
  label: string;
  status: "CONTROL" | "COLLECTING";
  control: boolean;
  frozen_at: string;
  hypothesis: string;
  sample_n: number;
  net_cents: number;
  avg_cents: number | null;
  profitable: number;
  losing: number;
  worst_cents: number | null;
  paired_n: number;
  paired_delta: number | null;
  sample_gate: { current: number; required: number };
};

export type PublicLabSnapshot = {
  at: string;
  champion: { policy_id: string; version: number };
  control_id: string;
  specimens: PublicLabSpecimen[];
  seat_timing: PublicSeatHorizonSnapshot | null;
  call_quality: CallQualitySnapshot | null;
  governance: {
    paper_only: true;
    authority: "none";
    sample_min: number;
    days_min: number;
    paired_control_losses_min: number;
  };
};

export const publicLabSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicLabSnapshot> => {
    const [standing, seatTiming, callQuality] = await Promise.all([
      labStanding(),
      seatHorizonSnapshot().catch(() => null),
      callQualitySnapshot().catch(() => null),
    ]);
    const byId = new Map(standing.rows.map((row) => [row.candidate_id, row]));
    const control = controlFor("exit");

    const specimens = EXIT_CANDIDATES.map((candidate): PublicLabSpecimen => {
      const row = byId.get(candidate.id);
      const sample = row?.n ?? 0;
      return {
        id: candidate.id,
        label: candidate.label,
        status: candidate.control ? "CONTROL" : "COLLECTING",
        control: candidate.control === true,
        frozen_at: candidate.frozen_at,
        hypothesis: candidate.why,
        sample_n: sample,
        net_cents: row?.net_cents ?? 0,
        avg_cents: row?.avg_cents ?? null,
        profitable: row?.profitable ?? 0,
        losing: row?.losing ?? 0,
        worst_cents: row?.worst_cents ?? null,
        paired_n: row?.paired_n ?? 0,
        paired_delta: row?.paired_delta ?? null,
        sample_gate: { current: sample, required: COMPONENT_MIN.fills },
      };
    });

    return {
      at: standing.at,
      champion: { policy_id: standing.champion.policy_id, version: standing.champion.version },
      control_id: control?.id ?? "HOLD_V1",
      specimens,
      seat_timing: seatTiming,
      call_quality: callQuality,
      governance: {
        paper_only: true,
        authority: "none",
        sample_min: COMPONENT_MIN.fills,
        days_min: COMPONENT_MIN.days,
        paired_control_losses_min: COMPONENT_MIN.paired_control_losses,
      },
    };
  },
);
