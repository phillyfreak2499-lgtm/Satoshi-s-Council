import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { markPitTourSeen } from "./prefs";

type PitStep = { target: "window" | "lock" | "pit" | "record"; title: string; body: string };

const PIT_STEPS: PitStep[] = [
  {
    target: "window",
    title: "One window at a time",
    body: "This is the live Bitcoin 15-minute market on Kalshi. The clock counts down to the close. UP wins if the final minute's average price finishes above the strike; DOWN wins if it does not.",
  },
  {
    target: "lock",
    title: "Lock once",
    body: "Pick a callsign, then UP or DOWN. Your lock is booked at the ask plus Kalshi's fee, on paper. One lock per window, and nothing inside the last 30 seconds.",
  },
  {
    target: "pit",
    title: "The room shows itself after you lock",
    body: "Everyone can see how many have locked. The UP/DOWN split and the average paper lock appear only once you have locked this window yourself.",
  },
  {
    target: "record",
    title: "Come back when it settles",
    body: "The window settles on Kalshi's official value. Your ticket turns green or red, your record updates, and the week board ranks you after three settled locks. Paper only, never money.",
  },
];

/** Four anchored stops for a first visit to the room. Skippable, replayable. */
export function PitTour({
  open,
  step,
  onStep,
  onClose,
  onDone,
}: {
  open: boolean;
  step: number;
  onStep: (n: number) => void;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = PIT_STEPS[step];

  useEffect(() => {
    if (!open || !s) return;
    const el = document.querySelector(`[data-pit="${s.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => {
      const target = document.querySelector(`[data-pit="${s.target}"]`);
      setRect(target ? target.getBoundingClientRect() : null);
    };
    measure();
    const t = window.setInterval(measure, 120);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, s]);

  const finish = () => {
    markPitTourSeen();
    onClose();
  };
  const next = () => {
    if (step >= PIT_STEPS.length - 1) {
      markPitTourSeen();
      onDone?.();
      onClose();
    } else onStep(step + 1);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (step > 0) onStep(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, onClose, onStep]);

  if (!open || !s || typeof document === "undefined") return null;

  const pad = 6;
  const highlight = rect
    ? { top: Math.max(4, rect.top - pad), left: Math.max(4, rect.left - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="How the Arena works">
      <button type="button" className="absolute inset-0 bg-bg/70" aria-label="Skip" onClick={finish} />
      {highlight ? <div className="pointer-events-none absolute rounded-md ring-1 ring-fg/80" style={highlight} /> : null}
      <div className="absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-md border border-border bg-surface p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between font-mono text-micro uppercase tracking-widest text-subtle">
          <span>
            {step + 1} / {PIT_STEPS.length}
          </span>
          <span className="flex gap-1" aria-hidden="true">
            {PIT_STEPS.map((p, i) => (
              <span key={p.target} className={i <= step ? "size-1.5 rounded-full bg-fg" : "size-1.5 rounded-full bg-border-strong"} />
            ))}
          </span>
        </div>
        <div className="mt-1 font-sans text-title font-medium text-fg">{s.title}</div>
        <p className="mt-1.5 font-sans text-ui leading-snug text-muted">{s.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" className="min-h-11 rounded-sm px-2 py-1.5 font-mono text-ui text-muted hover:text-fg" onClick={finish}>
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button type="button" className="min-h-11 rounded-sm border border-border px-3 py-1.5 font-mono text-ui text-fg hover:bg-surface-2" onClick={() => onStep(step - 1)}>
                Back
              </button>
            ) : null}
            <button type="button" className="min-h-11 rounded-sm bg-fg px-4 py-1.5 font-mono text-ui font-medium text-bg hover:bg-chip" onClick={next}>
              {step >= PIT_STEPS.length - 1 ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
