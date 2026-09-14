/** Per-browser preferences for the floor's chrome: first-visit flags and
 *  display choices. localStorage only; nothing here reaches the desk. */
const WELCOME_KEY = "satoshi-desk-welcome-v1";
const MOTION_KEY = "ui.motion";
const PIT_TOUR_KEY = "satoshi-pit-tour-v1";
const SEATS_KEY = "ui.seats";
const FLOOR_DENSITY_KEY = "ui.floor-density";

export const TRUST_CHIPS = ["Paper only", "Bitcoin only", "15-minute windows", "No live trades", "Not financial advice"];

function get(k: string): string {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
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
