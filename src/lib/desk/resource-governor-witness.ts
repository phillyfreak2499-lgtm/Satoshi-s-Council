/** Process-local handoff of the latest measured background-resource sample. */
import type { GovernorThresholds, ResourceSample } from "./resource-governor.ts";

export type ResourceGovernorWitness = {
  measured_at_ms: number;
  sample: ResourceSample;
  thresholds: GovernorThresholds;
};

const g = globalThis as typeof globalThis & { __resourceGovernorWitness__?: ResourceGovernorWitness };

export function publishResourceGovernorWitness(
  measuredAtMs: number,
  sample: ResourceSample,
  thresholds: GovernorThresholds,
): void {
  g.__resourceGovernorWitness__ = {
    measured_at_ms: measuredAtMs,
    sample: { ...sample },
    thresholds: { ...thresholds },
  };
}

export function readResourceGovernorWitness(): ResourceGovernorWitness | null {
  const witness = g.__resourceGovernorWitness__;
  return witness ? {
    measured_at_ms: witness.measured_at_ms,
    sample: { ...witness.sample },
    thresholds: { ...witness.thresholds },
  } : null;
}
