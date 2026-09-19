/**
 * Thin GA4 helpers for the existing gtag snippet in `__root.tsx`
 * (Measurement ID G-JMQGD1WTVT). No vendor, no GTM rebuild.
 *
 * Final event names only:
 * - enter_the_floor — intentional Enter/Open the floor CTA click
 * - feedback_submitted — Ideas & feedback board post succeeded
 * - paper_call_locked — human Arena paper UP/DOWN lock succeeded
 * - character_voice_played — an optional Council character audio clip actually began playback
 *
 * Never: signup / sign_up / generate_lead / purchase / Chair/Council auto.
 */
export const GA_EVENT_NAMES = [
  "enter_the_floor",
  "feedback_submitted",
  "paper_call_locked",
  "character_voice_played",
] as const;

export type GaEventName = (typeof GA_EVENT_NAMES)[number];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Safe no-op when gtag is absent (SSR, blocked, or before the snippet loads). */
export function gtagEvent(name: GaEventName): void {
  if (typeof window === "undefined") return;
  const g = window.gtag;
  if (typeof g !== "function") return;
  try {
    g("event", name);
  } catch {
    /* never break the desk for analytics */
  }
}

/**
 * Fire `name` only after `work` resolves. Failures / rejects skip the event.
 * Used for feedback_submitted and paper_call_locked (success-only).
 */
export async function gtagEventAfterSuccess(
  name: Extract<GaEventName, "feedback_submitted" | "paper_call_locked">,
  work: () => Promise<void>,
): Promise<void> {
  await work();
  gtagEvent(name);
}
