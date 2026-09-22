import { useEffect, useId, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  RESEARCH_QUIET_NOTICE as COPY,
  RESEARCH_QUIET_NOTICE_KEY,
  researchQuietNoticeHiddenOn,
} from "@/lib/desk/research-quiet-notice.ts";

/** One dismissible overlay. Not a homepage hero button. */
export function ResearchQuietNotice() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (researchQuietNoticeHiddenOn(pathname)) {
      setOpen(false);
      return;
    }
    try {
      setOpen(window.localStorage.getItem(RESEARCH_QUIET_NOTICE_KEY) !== "dismissed");
    } catch {
      setOpen(true);
    }
  }, [pathname]);

  function dismiss() {
    try {
      window.localStorage.setItem(RESEARCH_QUIET_NOTICE_KEY, "dismissed");
    } catch {
      /* private mode */
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/70 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-lg border border-border bg-bg p-5 shadow-lg sm:p-6"
      >
        <button
          type="button"
          className="absolute right-3 top-3 min-h-11 min-w-11 font-mono text-title text-muted hover:text-fg"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          \u00d7
        </button>
        <p className="company-eyebrow">Notice</p>
        <h2 id={titleId} className="mt-2 font-sans text-title font-medium tracking-tight text-fg">
          {COPY.title}
        </h2>
        <p className="mt-3 font-sans text-body leading-relaxed text-muted">{COPY.body}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={COPY.labHref} className="company-button" onClick={dismiss}>
            {COPY.labLabel}
          </a>
          <a href={COPY.trainingHref} className="company-button company-button-outline" onClick={dismiss}>
            {COPY.trainingLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
