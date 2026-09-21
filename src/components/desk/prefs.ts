/** Per-browser preferences for the floor's chrome: first-visit flags and
 *  display choices. localStorage only; nothing here reaches the desk. */
const WELCOME_KEY = "satoshi-desk-welcome-v1";
const MOTION_KEY = "ui.motion";
const PIT_TOUR_KEY = "satoshi-pit-tour-v1";
const SEATS_KEY = "ui.seats";
const FLOOR_DENSITY_KEY = "ui.floor-density";
const FLOOR_ROOM_KEY = "ui.floor-room-hidden";
const FLOOR_MODE_KEY = "ui.floor-mode";

export const TRUST_CHIPS = [
  "Paper only",
  "Bitcoin only",
  "15-minute windows",
  "No live trades",
  "Not financial advice",
];

function get(k: string): string {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}

/**
 * The raw stored value, or null when the key was never written.
 *
 * `get` collapses "absent" and "empty string" into `""`, which is fine for the
 * on/off flags above. The floor mode needs the difference: see
 * `floorModeFromStored`.
 */
function getRaw(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function set(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export function welcomeSeen(): boolean {
  if (typeof window === "undefined") return true;
  return get(WELCOME_KEY) === "done";
}

export function markWelcomeSeen(): void {
  set(WELCOME_KEY, "done");
}

export function readMotion(): boolean {
  return get(MOTION_KEY) === "reduce";
}

export function setMotion(reduce: boolean): void {
  set(MOTION_KEY, reduce ? "reduce" : "");
  applyDisplayPrefs();
}

/** Apply the saved preference at boot; the CSS reads html[data-motion]. */
export function applyDisplayPrefs(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = readMotion() ? "reduce" : "";
}

/** "auto" folds sitting seats into one row each; "all" keeps every card open. */
export type SeatView = "auto" | "all";
export function readSeatView(): SeatView {
  return get(SEATS_KEY) === "all" ? "all" : "auto";
}
export function setSeatView(v: SeatView): void {
  set(SEATS_KEY, v === "all" ? "all" : "");
}

/** Quiet is the first-visit/mobile default; Full restores the complete evidence desk. */
export type FloorDensity = "quiet" | "full";
export function readFloorDensity(): FloorDensity {
  return get(FLOOR_DENSITY_KEY) === "full" ? "full" : "quiet";
}
export function setFloorDensity(v: FloorDensity): void {
  set(FLOOR_DENSITY_KEY, v === "full" ? "full" : "");
}

export function pitTourSeen(): boolean {
  if (typeof window === "undefined") return true;
  return get(PIT_TOUR_KEY) === "done";
}

export function markPitTourSeen(): void {
  set(PIT_TOUR_KEY, "done");
}

/** Collapse only the decorative room; the live Chair call remains visible. */
export function readFloorRoomHidden(): boolean {
  return get(FLOOR_ROOM_KEY) === "hidden";
}
export function setFloorRoomHidden(hidden: boolean): void {
  set(FLOOR_ROOM_KEY, hidden ? "hidden" : "");
}

/**
 * The two ways to watch the same live Council window. Browser-only: nothing
 * here reaches the desk, and the server has no say in which view you get.
 */
export type FloorMode = "pro" | "guided";

/** Where a browser that has never chosen lands. Guided is the gentler door. */
export const FIRST_VISIT_FLOOR_MODE: FloorMode = "guided";

/**
 * Read a stored choice out of its raw value, or null for "never chose".
 *
 * THE LEGACY EMPTY STRING IS A PRO CHOICE, NOT AN ABSENCE. `setFloorMode`
 * used to write `""` for Pro, so a browser that deliberately picked Pro looks
 * identical to one that never picked anything — unless we look at the raw
 * value, where "never written" is `null` and "picked Pro" is `""`. Collapsing
 * the two would silently move every existing Pro reader to Guided, which is
 * exactly the kind of quiet preference change a returning visitor would read
 * as a bug. Pure, and exported so a test can pin every case.
 */
export function floorModeFromStored(raw: string | null): FloorMode | null {
  if (raw === null) return null;
  return raw === "guided" ? "guided" : "pro";
}

/** The stored choice, or null when this browser has never made one. */
export function readStoredFloorMode(): FloorMode | null {
  return floorModeFromStored(getRaw(FLOOR_MODE_KEY));
}

/** The view to open: the stored choice, else the first-visit default. */
export function readFloorMode(): FloorMode {
  return readStoredFloorMode() ?? FIRST_VISIT_FLOOR_MODE;
}

/** Records the choice explicitly, so "Pro" is never again stored as "". */
export function setFloorMode(mode: FloorMode): void {
  set(FLOOR_MODE_KEY, mode === "guided" ? "guided" : "pro");
}
