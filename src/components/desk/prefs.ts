/** Per-browser preferences for the floor's chrome: first-visit flags and
 *  display choices. localStorage only; nothing here reaches the desk. */
const WELCOME_KEY = "satoshi-desk-welcome-v1";
const MOTION_KEY = "ui.motion";

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
