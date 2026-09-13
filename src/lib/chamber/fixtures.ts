/**
 * DEV-ONLY presentation fixtures for the Chamber.
 *
 * Pure data. This module has no I/O of any kind — no network, no storage, no desk
 * imports — so it is incapable of writing production state or of being mistaken for
 * it. A fixture is a labelled picture of a state the room can show; it is never a
 * claim about the desk. The HUD always says so.
 */
import { DEFAULT_STATE, type ChamberState } from "./states.ts";

export type FixtureId = "quiet" | "considering" | "up" | "down" | "lab-active" | "ops-investigating" | "ops-alert";

export const FIXTURES: Record<FixtureId, { label: string; note: string; state: ChamberState }> = {
  quiet: { label: "Quiet chamber", note: "Everyone observing; operations clear.", state: DEFAULT_STATE },
  considering: {
    label: "Considering",
    note: "Satoshi weighing; the Alchemist inspecting.",
    state: { satoshi: "CONSIDERING", direction: null, alchemist: "INSPECTING", warden: "ALL_CLEAR" },
  },
  up: {
    label: "Directional · UP",
    note: "A directional posture, green.",
    state: { satoshi: "DIRECTIONAL", direction: "UP", alchemist: "IDLE", warden: "ALL_CLEAR" },
  },
  down: {
    label: "Directional · DOWN",
    note: "A directional posture, red.",
    state: { satoshi: "DIRECTIONAL", direction: "DOWN", alchemist: "IDLE", warden: "ALL_CLEAR" },
  },
  "lab-active": {
    label: "Lab active",
    note: "The Alchemist working; amber in the Lab.",
    state: { satoshi: "OBSERVING", direction: null, alchemist: "ACTIVE", warden: "ALL_CLEAR" },
  },
  "ops-investigating": {
    label: "Operations investigating",
    note: "The Warden turned to a screen; amber in Operations.",
    state: { satoshi: "WAIT", direction: null, alchemist: "IDLE", warden: "INVESTIGATING" },
  },
  "ops-alert": {
    label: "Operations alert",
    note: "Red in Operations; the Warden forward.",
    state: { satoshi: "WAIT", direction: null, alchemist: "IDLE", warden: "ALERT" },
  },
};

export const FIXTURE_IDS = Object.keys(FIXTURES) as FixtureId[];
export const DEFAULT_FIXTURE: FixtureId = "quiet";

export function isFixtureId(x: unknown): x is FixtureId {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(FIXTURES, x);
}

/** `?fixture=<id>` selects a fixture explicitly; anything else is the quiet default. */
export function fixtureFromSearch(search: string | null | undefined): { id: FixtureId; explicit: boolean } {
  const m = /[?&]fixture=([^&#]*)/.exec(search ?? "");
  if (!m) return { id: DEFAULT_FIXTURE, explicit: false };
  let raw = "";
  try {
    raw = decodeURIComponent(m[1] ?? "").toLowerCase();
  } catch {
    raw = "";
  }
  return isFixtureId(raw) ? { id: raw, explicit: true } : { id: DEFAULT_FIXTURE, explicit: false };
}
