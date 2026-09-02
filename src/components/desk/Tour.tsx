import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { markTourSeen, TOUR_STEPS } from "@/lib/desk/glossary";
import { closeAllTips } from "./Tip";
import type { TabId } from "@/lib/desk/types";

export function Tour({
  open,
  step,
  tab,
  onTab,
  onStep,
  onClose,
}: {
  open: boolean;
  step: number;
  tab: TabId;
  onTab: (t: TabId) => void;
  onStep: (n: number) => void;
  onClose: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [narrow, setNarrow] = useState(false);
  const s = TOUR_STEPS[step];

  useEffect(() => {
    if (!open || !s) return;
    closeAllTips();
    if (tab !== s.tab) onTab(s.tab);
  }, [open, step, s, tab, onTab]);

  useEffect(() => {
    if (!open || !s) return;
    const measure = () => {
      setNarrow(window.innerWidth < 640);
      const el = document.querySelector(`[data-tour="${s.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
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
  }, [open, step, s, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markTourSeen();
        onClose();
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (step >= TOUR_STEPS.length - 1) {
          markTourSeen();
          onClose();
        } else onStep(step + 1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (step > 0) onStep(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, onClose, onStep]);

  if (!open || !s || typeof document === "undefined") return null;

  const finish = () => {
    markTourSeen();
    onClose();
  };

  const next = () => {
    if (step >= TOUR_STEPS.length - 1) finish();
    else onStep(step + 1);
  };

  const pad = 6;
  const highlight = rect
    ? {
        top: Math.max(4, rect.top - pad),
        left: Math.max(4, rect.left - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  let cardStyle: CSSProperties;
  if (s.target === "tour-footer" && highlight) {
    cardStyle = {
      left: 12,
      bottom: Math.max(12, window.innerHeight - highlight.top + 12),
      width: 300,
    };
  } else if (narrow) {
    cardStyle = { left: 12, right: 12, bottom: 12 };
  } else {
    cardStyle = { left: 12, bottom: 12, width: 300 };
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Floor tour">
      <button
        type="button"
        className="absolute inset-0 bg-bg/70"
        aria-label="Skip tour"
        onClick={finish}
      />
      {highlight && (
        <div
          className="pointer-events-none absolute rounded-md ring-1 ring-fg/80"
          style={highlight}
        />
      )}
      <div
        className="absolute rounded-md border border-border bg-surface p-3"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">
          {step + 1} / {TOUR_STEPS.length}
        </div>
        <div className="mt-1 font-sans text-title font-medium text-fg">{s.title}</div>
        <p className="mt-1.5 font-sans text-ui leading-snug text-muted">{s.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-sm px-2 py-1.5 font-mono text-ui text-muted hover:text-fg"
            onClick={finish}
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-1.5 font-mono text-ui text-fg hover:bg-surface-2"
                onClick={() => onStep(step - 1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="rounded-sm bg-surface-3 px-3 py-1.5 font-mono text-ui text-fg hover:bg-border-strong"
              onClick={next}
            >
              {step >= TOUR_STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
