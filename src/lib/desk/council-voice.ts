export const COUNCIL_VOICE_SPEAKERS = [
  "SATOSHI",
  "WICK",
  "DRIFT",
  "TAPE",
  "WARDEN",
  "ALCHEMIST",
  "SWEEP",
] as const;

export type CouncilVoiceSpeaker = (typeof COUNCIL_VOICE_SPEAKERS)[number];
export type CouncilVoiceSource = "intro" | "live" | "chamber";

export function isCouncilVoiceSpeaker(value: unknown): value is CouncilVoiceSpeaker {
  return typeof value === "string" && (COUNCIL_VOICE_SPEAKERS as readonly string[]).includes(value);
}

export function isCouncilVoiceSource(value: unknown): value is CouncilVoiceSource {
  return value === "intro" || value === "live" || value === "chamber";
}
