import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { Crest } from "./Crest";
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
 *  A bottom sheet on a phone, a right drawer on a desk; the floor stays visible behind it.
 *  Shown once before the tour; close, Esc, a drag down, the scrim or "Watch the floor" opens the floor. */
export function Welcome({ open, onTour, onFloor }: { open: boolean; onTour: () => void; onFloor: () => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  const drag = useRef<number | null>(null);
  const [dy, setDy] = useState(0);
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
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current == null) return;
    setDy(Math.max(0, e.clientY - drag.current));
  };
  const up = () => {
    const far = dy > 80;
    drag.current = null;
    setDy(0);
    if (far) onFloor();
  };
  return createPortal(
    <>
      <button type="button" className="drawer-scrim" aria-label="Close and watch the floor" onClick={onFloor} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="drawer"
        style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
      >
        <div className="drawer-handle" aria-hidden="true" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Crest size={22} className="shrink-0" />
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">Satoshi&apos;s Council · paper desk</div>
          </div>
          <button type="button" onClick={onFloor} aria-label="Close" className="btn btn-icon btn-sm -mr-2 -mt-1 text-subtle hover:text-fg">
            ×
          </button>
        </div>
        <h2 id="welcome-title" className="mt-1 font-sans text-call font-medium text-fg">
          A Bitcoin research desk that argues out loud.
        </h2>
        <p className="mt-2 font-sans text-body leading-relaxed text-muted">
          Every 15 minutes, twenty-one specialist seats read the tape, the candles, the book and the derivatives. SATOSHI chairs the
          vote: <span className="text-up">UP</span>, <span className="text-down">DOWN</span> or <span className="text-wait">WAIT</span>. Every
          call is paper. Nothing here places a live trade.
        </p>
        <p className="mt-3 font-mono text-micro text-muted" aria-label="What this desk is and is not">
          {TRUST_CHIPS.join(" · ")}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button ref={primary} type="button" onClick={onTour} className="btn btn-primary">
            Start the 60-second tour
          </button>
          <button type="button" onClick={onFloor} className="btn btn-secondary">
            Watch the floor
          </button>
        </div>
        <p className="mt-3 font-mono text-micro text-subtle">Esc opens the floor. Replay the tour any time from ? in the header. Hover or tap a dotted label for a definition.</p>
      </div>
    </>,
    document.body,
  );
}
