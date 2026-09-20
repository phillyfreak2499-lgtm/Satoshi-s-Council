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
export const GA_MEASUREMENT_ID = "G-JMQGD1WTVT";

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
    __scGa4Configured?: boolean;
    __scGa4LastPageView?: string;
  }
}

/**
 * Make analytics resilient to head-script ordering or omission:
 * - create the dataLayer/gtag queue when needed;
 * - restore the Google tag loader if the rendered document lost it;
 * - configure GA exactly once with automatic page_view disabled.
 *
 * Page views are emitted explicitly by GaPageViews so SPA navigations are counted
 * without double-counting the initial document.
 */
function ensureGtag(): ((...args: unknown[]) => void) | undefined {
  if (typeof window === "undefined") return undefined;

  if (!Array.isArray(window.dataLayer)) window.dataLayer = [];
  const queue = window.dataLayer;

  if (typeof window.gtag !== "function") {
    window.gtag = (...args: unknown[]) => {
      queue.push(args);
    };
  }

  if (typeof document !== "undefined") {
    const hasLoader = Array.from(document.scripts).some((script) =>
      script.src.includes(`googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`),
    );
    if (!hasLoader) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
      script.dataset.scGa4 = "loader";
      document.head.appendChild(script);
    }
  }

  if (!window.__scGa4Configured) {
    try {
      window.gtag("js", new Date());
      window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
      window.__scGa4Configured = true;
    } catch {
      return undefined;
    }
  }

  return window.gtag;
}

/** Emit one explicit page_view for the current route key. Duplicate same-route effects are ignored. */
export function gtagPageView(routeKey: string): void {
  if (typeof window === "undefined" || !routeKey) return;
  if (window.__scGa4LastPageView === routeKey) return;
  const g = ensureGtag();
  if (typeof g !== "function") return;
  try {
    g("event", "page_view");
    window.__scGa4LastPageView = routeKey;
  } catch {
    /* never break navigation for analytics */
  }
}

/** Fire a named product event with no params / no PII. */
export function gtagEvent(name: GaEventName): void {
  const g = ensureGtag();
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
