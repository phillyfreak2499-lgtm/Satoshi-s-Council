/**
 * ASTRA_RESEARCH_DIRECTOR_V1 — periodic paper-research governance review.
 *
 * Pure contract only. Astra may inspect frozen aggregate evidence and nominate
 * investigations/reviews. It cannot promote, demote, reweight, vote, book, or
 * alter any live rule. Deterministic code gates remain authoritative.
 */
export const ASTRA_DIRECTOR_STUDY = "ASTRA_RESEARCH_DIRECTOR_V1";
export const ASTRA_DIRECTOR_VERSION = 1;
export const ASTRA_DIRECTOR_PROMPT_VERSION = "director-384-v1";
export const ASTRA_DIRECTOR_MODEL = "gpt-6-astra";
export const ASTRA_DIRECTOR_WINDOW_BATCH = 384;

export type AstraFloorHealth = "HEALTHY" | "WATCH" | "DEGRADED";
export type AstraConfidence = "LOW" | "MEDIUM" | "HIGH";
export type AstraPatternAction = "KEEP" | "INVESTIGATE" | "SHADOW_TEST";
export type AstraLabAction = "KEEP_SHADOW" | "PROMOTION_REVIEW" | "RETIRE_REVIEW";
export type AstraGateStatus = "ELIGIBLE" | "BLOCKED" | "INSUFFICIENT";
export type AstraSeatAction = "KEEP" | "INVESTIGATE" | "SHADOW_GAG_TEST" | "SHADOW_WEIGHT_TEST";

export type AstraDirectorReport = {
  summary: string;
  floor_health: AstraFloorHealth;
  regime_notes: string[];
  patterns: Array<{
    label: string;
    evidence: string;
    confidence: AstraConfidence;
    action: AstraPatternAction;
  }>;
  lab_actions: Array<{
    candidate_id: string;
    action: AstraLabAction;
    gate_status: AstraGateStatus;
    rationale: string;
  }>;
  seat_actions: Array<{
    seat: string;
    action: AstraSeatAction;
    rationale: string;
  }>;
  next_tests: Array<{
    title: string;
    hypothesis: string;
    measurement: string;
  }>;
  executive_note: string;
};

export const ASTRA_DIRECTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    floor_health: { type: "string", enum: ["HEALTHY", "WATCH", "DEGRADED"] },
    regime_notes: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    patterns: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
          action: { type: "string", enum: ["KEEP", "INVESTIGATE", "SHADOW_TEST"] },
        },
        required: ["label", "evidence", "confidence", "action"],
      },
    },
    lab_actions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidate_id: { type: "string" },
          action: { type: "string", enum: ["KEEP_SHADOW", "PROMOTION_REVIEW", "RETIRE_REVIEW"] },
          gate_status: { type: "string", enum: ["ELIGIBLE", "BLOCKED", "INSUFFICIENT"] },
          rationale: { type: "string" },
        },
        required: ["candidate_id", "action", "gate_status", "rationale"],
      },
    },
    seat_actions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          seat: { type: "string" },
          action: { type: "string", enum: ["KEEP", "INVESTIGATE", "SHADOW_GAG_TEST", "SHADOW_WEIGHT_TEST"] },
          rationale: { type: "string" },
        },
        required: ["seat", "action", "rationale"],
      },
    },
    next_tests: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          hypothesis: { type: "string" },
          measurement: { type: "string" },
        },
        required: ["title", "hypothesis", "measurement"],
      },
    },
    executive_note: { type: "string" },
  },
  required: [
    "summary",
    "floor_health",
    "regime_notes",
    "patterns",
    "lab_actions",
    "seat_actions",
    "next_tests",
    "executive_note",
  ],
} as const;

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export function parseAstraDirectorReport(value: unknown): AstraDirectorReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.floor_health !== "HEALTHY" && v.floor_health !== "WATCH" && v.floor_health !== "DEGRADED") return null;
  if (typeof v.summary !== "string" || typeof v.executive_note !== "string") return null;
  if (!Array.isArray(v.regime_notes) || !v.regime_notes.every((x) => typeof x === "string")) return null;
  if (!Array.isArray(v.patterns) || !Array.isArray(v.lab_actions) || !Array.isArray(v.seat_actions) || !Array.isArray(v.next_tests)) return null;

  const patterns = v.patterns.slice(0, 8).map((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    if (!["LOW", "MEDIUM", "HIGH"].includes(String(r.confidence))) return null;
    if (!["KEEP", "INVESTIGATE", "SHADOW_TEST"].includes(String(r.action))) return null;
    return {
      label: clip(r.label, 120),
      evidence: clip(r.evidence, 360),
      confidence: r.confidence as AstraConfidence,
      action: r.action as AstraPatternAction,
    };
  });
  if (patterns.some((x) => x == null)) return null;

  const lab = v.lab_actions.slice(0, 12).map((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    if (!["KEEP_SHADOW", "PROMOTION_REVIEW", "RETIRE_REVIEW"].includes(String(r.action))) return null;
    if (!["ELIGIBLE", "BLOCKED", "INSUFFICIENT"].includes(String(r.gate_status))) return null;
    return {
      candidate_id: clip(r.candidate_id, 120),
      action: r.action as AstraLabAction,
      gate_status: r.gate_status as AstraGateStatus,
      rationale: clip(r.rationale, 360),
    };
  });
  if (lab.some((x) => x == null)) return null;

  const seats = v.seat_actions.slice(0, 12).map((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    if (!["KEEP", "INVESTIGATE", "SHADOW_GAG_TEST", "SHADOW_WEIGHT_TEST"].includes(String(r.action))) return null;
    return {
      seat: clip(r.seat, 64),
      action: r.action as AstraSeatAction,
      rationale: clip(r.rationale, 360),
    };
  });
  if (seats.some((x) => x == null)) return null;

  const tests = v.next_tests.slice(0, 5).map((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    return {
      title: clip(r.title, 140),
      hypothesis: clip(r.hypothesis, 360),
      measurement: clip(r.measurement, 360),
    };
  });
  if (tests.some((x) => x == null)) return null;

  return {
    summary: clip(v.summary, 900),
    floor_health: v.floor_health,
    regime_notes: v.regime_notes.slice(0, 6).map((x) => clip(x, 300)),
    patterns: patterns as AstraDirectorReport["patterns"],
    lab_actions: lab as AstraDirectorReport["lab_actions"],
    seat_actions: seats as AstraDirectorReport["seat_actions"],
    next_tests: tests as AstraDirectorReport["next_tests"],
    executive_note: clip(v.executive_note, 900),
  };
}
