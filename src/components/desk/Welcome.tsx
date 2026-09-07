import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { TRUST_CHIPS } from "./prefs";

export function TrustStrip({ className = "" }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="What this desk is and is not">
      {TRUST_CHIPS.map((c) => (
        <li key={c} className="rounded-sm border border-border bg-surface-2 px-1.5 py-px font-mono text-micro uppercase tracking-wider text-muted">
          {c}
        </li>
      ))}
    </ul>
  );
}

/** First visit: what this is, what it is not, and one thing to do next.
 *  Shown once before the tour; Esc or "Watch the floor" opens the floor. */
export function Welcome({ open, onTour, onFloor }: { open: boolean; onTour: () => void; onFloor: () => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFloor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onFloor]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/85 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="w-full max-w-md rounded-md border border-border bg-surface p-4 shadow-[0_24px_80px_rgba(0,0,0,0.6)] sm:p-5">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">Satoshi&apos;s Council · paper desk</div>
        <h2 id="welcome-title" className="mt-1 font-sans text-[1.375rem] font-medium leading-tight text-fg">
          A Bitcoin research desk that argues out loud.
        </h2>
        <p className="mt-2 font-sans text-body leading-relaxed text-muted">
          Every 15 minutes, twenty specialist seats read the tape, the candles, the book and the derivatives. SATOSHI chairs the
          vote: <span className="text-up">UP</span>, <span className="text-down">DOWN</span> or <span className="text-wait">WAIT</span>. Every
          call is paper. Nothing here places a live trade.
        </p>
        <TrustStrip className="mt-3" />
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            ref={primary}
            type="button"
            onClick={onTour}
            className="min-h-11 flex-1 rounded-sm bg-fg px-4 py-2.5 font-mono text-ui font-medium text-bg hover:bg-chip"
          >
            Start the 60-second tour
          </button>
          <button type="button" onClick={onFloor} className="min-h-11 rounded-sm border border-border px-4 py-2.5 font-mono text-ui text-muted hover:text-fg">
            Watch the floor
          </button>
        </div>
        <p className="mt-3 font-mono text-micro text-subtle">Esc opens the floor. Replay the tour any time from ? in the header. Hover or tap a dotted label for a definition.</p>
      </div>
    </div>,
    document.body,
  );
}
