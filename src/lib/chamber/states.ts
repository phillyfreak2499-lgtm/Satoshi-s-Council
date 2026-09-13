/**
 * The Chamber's state vocabulary and the WORLD's colour language.
 *
 * Pure: no React, no three.js, no network, no desk engine imports. Everything the
 * 3D room can "say" about a figure is one of these enumerated states; the room then
 * only ever changes pose, material and light. That is the truth rule made
 * structural — ambient life (breathing, typing, flicker) is time-based and carries no
 * meaning, while a semantic state can only arrive as a value of this type, from a
 * fixture (Phase 0) or, later, the read-only adapter.
 *
 * WORLD vs HUD colour: the world maps WAIT / inactive / observing to a DIM NEUTRAL
 * and reserves amber for research / attention — spatial system-state language. The
 * HUD keeps the site's canonical product language (where WAIT is gold). Both are
 * intentional; see docs/CHAMBER_VISUAL_DOCTRINE.md.
 */
export const SATOSHI_STATES = ["OBSERVING", "CONSIDERING", "DIRECTIONAL", "WAIT"] as const;
export const ALCHEMIST_STATES = ["IDLE", "INSPECTING", "ACTIVE"] as const;
export const WARDEN_STATES = ["ALL_CLEAR", "INVESTIGATING", "ALERT"] as const;

export type SatoshiState = (typeof SATOSHI_STATES)[number];
export type AlchemistState = (typeof ALCHEMIST_STATES)[number];
export type WardenState = (typeof WARDEN_STATES)[number];
/** Only meaningful while Satoshi is DIRECTIONAL. */
export type Direction = "UP" | "DOWN" | null;

export type ChamberState = {
  satoshi: SatoshiState;
  direction: Direction;
  alchemist: AlchemistState;
  warden: WardenState;
};

export type Figure = "SATOSHI" | "ALCHEMIST" | "WARDEN";
export type Station = "OVERVIEW" | "DAIS" | "LAB" | "OPS";

export const FIGURES: readonly Figure[] = ["SATOSHI", "ALCHEMIST", "WARDEN"];
export const STATIONS: readonly Station[] = ["OVERVIEW", "DAIS", "LAB", "OPS"];

/** Tapping a figure travels to its station: EXPERIMENT → JUDGMENT → INTEGRITY. */
export function stationFor(figure: Figure): Station {
  return figure === "SATOSHI" ? "DAIS" : figure === "ALCHEMIST" ? "LAB" : "OPS";
}

/**
 * The world's palette. Green/red/amber/crt are the brand hexes, so the world and the
 * HUD agree on what those colours ARE; `dim` is the world's own WAIT — never gold.
 */
export const WORLD = {
  dim: "#2b2e37",
  neutral: "#5d5a53",
  amber: "#c4a574",
  green: "#3fae7a",
  red: "#d15b4a",
  crt: "#5ba8b5",
} as const;

export type Accent = { hex: string; intensity: number };

export function satoshiAccent(s: SatoshiState, d: Direction): Accent {
  if (s === "DIRECTIONAL") {
    if (d === "UP") return { hex: WORLD.green, intensity: 1.4 };
    if (d === "DOWN") return { hex: WORLD.red, intensity: 1.4 };
    return { hex: WORLD.dim, intensity: 0.4 }; // DIRECTIONAL without a side is not a claim
  }
  if (s === "CONSIDERING") return { hex: WORLD.amber, intensity: 0.9 };
  return { hex: WORLD.dim, intensity: 0.35 }; // OBSERVING, WAIT: dim neutral, never gold
}

export function alchemistAccent(s: AlchemistState): Accent {
  if (s === "ACTIVE") return { hex: WORLD.amber, intensity: 1.3 };
  if (s === "INSPECTING") return { hex: WORLD.amber, intensity: 0.6 };
  return { hex: WORLD.dim, intensity: 0.3 };
}

export function wardenAccent(s: WardenState): Accent {
  if (s === "ALERT") return { hex: WORLD.red, intensity: 1.5 };
  if (s === "INVESTIGATING") return { hex: WORLD.amber, intensity: 0.9 };
  return { hex: WORLD.green, intensity: 0.7 };
}

export const DEFAULT_STATE: ChamberState = {
  satoshi: "OBSERVING",
  direction: null,
  alchemist: "IDLE",
  warden: "ALL_CLEAR",
};

const has = (list: readonly string[], x: unknown): boolean => typeof x === "string" && list.includes(x);

/** Coerce anything into a valid state; unknown values fall to the quiet defaults (fail safe, never invent). */
export function normalizeState(x: Partial<ChamberState> | null | undefined): ChamberState {
  const satoshi = has(SATOSHI_STATES, x?.satoshi) ? (x!.satoshi as SatoshiState) : DEFAULT_STATE.satoshi;
  const alchemist = has(ALCHEMIST_STATES, x?.alchemist) ? (x!.alchemist as AlchemistState) : DEFAULT_STATE.alchemist;
  const warden = has(WARDEN_STATES, x?.warden) ? (x!.warden as WardenState) : DEFAULT_STATE.warden;
  const d = x?.direction;
  const direction: Direction = satoshi === "DIRECTIONAL" && (d === "UP" || d === "DOWN") ? d : null;
  return { satoshi, direction, alchemist, warden };
}

/** Plain words for the HUD. */
export function stateWord(figure: Figure, st: ChamberState): string {
  if (figure === "SATOSHI") return st.satoshi === "DIRECTIONAL" && st.direction ? `${st.satoshi} · ${st.direction}` : st.satoshi;
  if (figure === "ALCHEMIST") return st.alchemist;
  return st.warden;
}
