/**
 * Copy and placement for the temporary research-stretch overlay.
 * A WAIT is a first-class decision. This notice must not read as a signal,
 * a third homepage hero CTA, or a claim that the desk is down.
 */
export const RESEARCH_QUIET_NOTICE_KEY = "sc.notice.research-quiet.v1";

export const RESEARCH_QUIET_NOTICE = {
  title: "The floor is measuring",
  body: "The desk is in a research stretch. WAIT is a real call, so many windows may sit. That is not an outage and not a signal. Paper only \u2014 the rooms stay open.",
  labLabel: "Open Research",
  labHref: "/lab" as const,
  trainingLabel: "Start Training",
  trainingHref: "/training" as const,
  dismissLabel: "Dismiss",
} as const;

/** Already on Lab or Training \u2014 do not cover the rooms the notice points to. */
export function researchQuietNoticeHiddenOn(pathname: string): boolean {
  return pathname === "/lab" || pathname.startsWith("/training") || pathname === "/legal";
}
