import type { MouseEvent } from "react";
import { gtagEvent } from "@/lib/desk/ga";
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
  returning = false,
}: {
  demo: boolean;
  /** First visit after the welcome: the tour button says so until it is taken or dismissed. */
  nudge: boolean;
  onTour: () => void;
  onDismissNudge: () => void;
  /**
   * The visitor has seen the Welcome before. The standing explanation is compressed
   * rather than removed: the session line, the identity line, the paper-only context
   * and every control stay — only the full paragraph a returning reader has already
   * read is dropped, which also gives the CALL more of the first screen.
   */
  returning?: boolean;
}) {
  const jump = (e: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById("chair-stage");
    if (!el) return;
    e.preventDefault();
    gtagEvent("enter_the_floor", { link_text: "Enter the floor" });
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
        <h1
          id="intro-title"
          className={cn(
            "mt-1 max-w-[28ch] font-sans font-medium leading-tight tracking-tight text-fg",
            returning ? "text-ui" : "text-body sm:text-call",
          )}
        >
          Specialist seats read Bitcoin. One chair makes the call.
        </h1>
        {returning ? (
          // Still says what this is and that it is paper — just once, in one line.
          <p className="mt-1 font-mono text-micro uppercase tracking-widest text-subtle">
            Paper-only · Kalshi 15-minute windows · every call graded in public
          </p>
        ) : (
          <p className="mt-1 hidden max-w-[70ch] font-sans text-ui text-muted sm:block">
            A paper-only research desk on the Kalshi 15-minute window: seats vote, the chair weighs them, every call is graded in public.
          </p>
        )}
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
