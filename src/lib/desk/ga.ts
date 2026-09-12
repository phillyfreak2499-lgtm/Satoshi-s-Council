/**
 * Thin GA4 helpers for the existing gtag snippet in `__root.tsx`
 * (Measurement ID G-JMQGD1WTVT). No vendor, no GTM rebuild.
 *
 * Event names (fire only on real UI success / click):
 * - enter_the_floor — primary CTA ("Enter the floor" / "Open the floor")
 * - generate_lead — Ideas & feedback board post succeeds
 * - signup — visitor locks a paper Arena call (UP/DOWN) successfully
 */
export type GaEventName = "enter_the_floor" | "generate_lead" | "signup";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Safe no-op when gtag is absent (SSR, blocked, or before the snippet loads). */
export function gtagEvent(name: GaEventName, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const g = window.gtag;
  if (typeof g !== "function") return;
  try {
    g("event", name, params);
  } catch {
    /* never break the desk for analytics */
  }
}
