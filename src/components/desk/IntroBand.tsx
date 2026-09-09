import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * The band above the Floor: what this is, in one breath. It carries no live
 * Chair status — the Chair hero and the overnight ribbon below own that, so
 * there is one source of truth for the current call. "Enter the floor" only
 * scrolls to the chair stage. Under 150px tall.
 */
export function IntroBand({
  demo,
  nudge,
  onTour,
  onDismissNudge,
}: {
  demo: boolean;
  /** First visit after the welcome: the tour button says so until it is taken or dismissed. */
  nudge: boolean;
  onTour: () => void;
  onDismissNudge: () => void;
}) {
  const jump = (e: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById("chair-stage");
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };
  return (
    <section aria-labelledby="intro-title" data-intro-band className="border-b border-border bg-bg">
      <div className="gutter mx-auto w-full max-w-[var(--max)] py-3 sm:py-4">
        <p className="flex items-center gap-2 font-mono text-micro uppercase tracking-widest text-subtle">
          <span aria-hidden="true" className={cn("inline-block size-1.5 rounded-full", demo ? "bg-wait" : "bg-up")} />
          The Council is in session{demo ? " · demo tape" : ""}
        </p>
        <h1 id="intro-title" className="mt-1 max-w-[28ch] font-sans text-body font-medium leading-tight tracking-tight text-fg sm:text-call">
          Specialist seats read Bitcoin. One chair makes the call.
        </h1>
        <p className="mt-1 hidden max-w-[70ch] font-sans text-ui text-muted sm:block">
          A paper-only research desk on the Kalshi 15-minute window: seats vote, the chair weighs them, every call is graded in public.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <a href="#chair-stage" onClick={jump} className="btn btn-primary btn-sm">
            Enter the floor
          </a>
          <button type="button" onClick={onTour} className="btn btn-secondary btn-sm">
            {nudge ? "New here? Take the 60-second tour" : "60-second tour"}
          </button>
          {nudge ? (
            <button type="button" aria-label="Dismiss" onClick={onDismissNudge} className="btn btn-icon btn-sm text-subtle hover:text-fg">
              ×
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
