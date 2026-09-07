import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { beacon } from "@/lib/desk/beacon";
import { createPortal } from "react-dom";
import { glossOf } from "@/lib/desk/glossary";
import { cn } from "@/lib/utils";

type Closer = () => void;
let active: Closer | null = null;

export function closeAllTips() {
  active?.();
  active = null;
}

function claim(fn: Closer) {
  if (active && active !== fn) active();
  active = fn;
}
function release(fn: Closer) {
  if (active === fn) active = null;
}

export function Tip({
  k,
  children,
  mark = true,
  hoverOnly = false,
  className,
}: {
  k: string;
  children: ReactNode;
  mark?: boolean;
  hoverOnly?: boolean;
  className?: string;
}) {
  const g = glossOf(k);
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hoverT = useRef<number>(0);
  const byHover = useRef(false);

  const close = () => {
    setOpen(false);
    byHover.current = false;
    release(close);
  };

  const place = () => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pop = document.getElementById(id);
    const width = pop?.offsetWidth || 288;
    const height = pop?.offsetHeight || 120;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    let top = r.bottom + 8;
    if (top + height > window.innerHeight - 8) top = r.top - height - 8;
    if (top < 8) top = 8;
    setPos({ top, left });
  };

  const show = (hover: boolean) => {
    byHover.current = hover;
    claim(close);
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(place);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => place();
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (trigger.current?.contains(t)) return;
      const pop = document.getElementById(id);
      if (pop?.contains(t)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onDoc);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onDoc);
    };
  }, [open, id]);

  if (!g) return <>{children}</>;

  return (
    <>
      <span
        ref={trigger}
        tabIndex={hoverOnly ? undefined : 0}
        aria-label={hoverOnly ? undefined : g.title}
        className={cn(
          "cursor-help",
          mark && "border-b border-dotted border-subtle/70",
          className,
        )}
        onPointerEnter={(e) => {
          if (e.pointerType === "touch") return;
          window.clearTimeout(hoverT.current);
          hoverT.current = window.setTimeout(() => show(true), 160);
        }}
        onPointerLeave={() => {
          window.clearTimeout(hoverT.current);
          if (byHover.current) close();
        }}
        onClick={(e) => {
          if (hoverOnly) return;
          e.stopPropagation();
          e.preventDefault();
          if (open && !byHover.current) close();
          else {
            show(false);
            beacon("gloss_open");
          }
        }}
        onKeyDown={(e) => {
          if (hoverOnly) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (open) close();
            else {
              show(false);
              beacon("gloss_open");
            }
          }
        }}
      >
        {children}
      </span>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
            }}
            className="tip-pop pointer-events-none fixed z-50 w-72 origin-top rounded-md border border-border bg-surface-2 px-2.5 py-2"
          >
            <div className="font-mono text-micro uppercase tracking-wider text-subtle">{g.title}</div>
            <div className="mt-1 font-sans text-ui leading-snug text-fg">{g.body}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
