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

// Explicit automation signatures only. Direct visits, missing referrers, VPNs,
// and unknown/empty agents are not evidence of a bot.
const AUTOMATION_AGENT =
  /\b(?:bot|crawler|spider)\b|adsbot-google|petalbot|mj12bot|dotbot|rogerbot|screaming frog|googlebot|bingbot|duckduckbot|yandexbot|baiduspider|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|perplexitybot|facebookexternalhit|meta-externalagent|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|applebot|ahrefsbot|semrushbot|headlesschrome|phantomjs|playwright|puppeteer|selenium|python-requests|python-urllib|aiohttp|curl\/|wget\/|go-http-client|node-fetch|undici|axios\/|amazonbot|amazon-route53-health-check-service|elb-healthchecker|pingdom|uptimerobot|kalshi-bot-access/i;

export function suppressGaForAgent(userAgent: string | undefined | null): boolean {
  return AUTOMATION_AGENT.test(userAgent ?? "");
}

/** One guarded bootstrap: never fetch Google's loader before checking automation. */
export const GA_BOOTSTRAP_SCRIPT = `(() => {
  const blocked = navigator.webdriver === true || ${AUTOMATION_AGENT}.test(navigator.userAgent || '');
  window.__scGa4Blocked = blocked;
  if (blocked) return;
  window.dataLayer = window.dataLayer || [];
  function gtag(){window.dataLayer.push(arguments);}
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
  window.__scGa4Configured = true;
  const script = document.createElement('script');
  script.async = true;
  script.dataset.scGa4 = 'loader';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}';
  document.head.appendChild(script);
})();`;

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
    __scGa4Blocked?: boolean;
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
  if (
    window.__scGa4Blocked === true ||
    (typeof navigator !== "undefined" &&
      (navigator.webdriver === true || suppressGaForAgent(navigator.userAgent)))
  )
    return undefined;

  if (!Array.isArray(window.dataLayer)) window.dataLayer = [];
  const queue = window.dataLayer;

  let g = window.gtag;
  if (typeof g !== "function") {
    g = (...args: unknown[]) => {
      queue.push(args);
    };
    window.gtag = g;
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
      g("js", new Date());
      g("config", GA_MEASUREMENT_ID, { send_page_view: false });
      window.__scGa4Configured = true;
    } catch {
      return undefined;
    }
  }

  return g;
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
