/**
 * Copy and placement for the temporary research-stretch overlay.
 * A WAIT is a first-class decision. This notice must not read as a signal,
 * a third homepage hero CTA, or a claim that the desk is down.
 *
 * Audit leftover 1: the overlay is retired. The last-call panel on both
 * floors is the proof the desk is selective. This module stays so existing
 * tests and imports keep compiling.
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

/** Overlay retired — last-call panel carries the proof instead. */
export function researchQuietNoticeHiddenOn(_pathname: string): boolean {
  return true;
}
