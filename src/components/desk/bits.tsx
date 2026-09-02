import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FeedHealth, Lean, SeatStatus } from "@/lib/desk/types";

export function LeanChip({ lean, className }: { lean: Lean; className?: string }) {
  const map = {
    UP: "bg-up/15 text-up border-up/40",
    DOWN: "bg-down/15 text-down border-down/40",
    WAIT: "bg-wait/15 text-wait border-wait/40",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-micro font-medium tracking-wide",
        map[lean],
        className,
      )}
    >
      {lean}
    </span>
  );
}

export function HealthDot({ h }: { h: FeedHealth }) {
  const c = h === "LIVE" ? "bg-up" : h === "STALE" ? "bg-wait" : "bg-down";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-micro text-muted">
      <span className={cn("inline-block size-1.5 rounded-full", c)} />
      {h}
    </span>
  );
}

export function StatusChip({ s }: { s: SeatStatus }) {
  const tone =
    s === "LIVE"
      ? "text-muted border-border"
      : s === "UNCALIBRATED"
        ? "text-wait border-wait/40"
        : s === "DOWN" || s === "VETO"
          ? "text-down border-down/40"
          : "text-muted border-border-strong";
  return (
    <span className={cn("rounded-sm border px-1 font-mono text-micro", tone)}>{s}</span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular text-data", className)}>{children}</span>;
}

export function Pane({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-surface p-3", className)}>
      <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">{title}</h3>
      {children}
    </section>
  );
}

export function Field({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 text-ui leading-snug">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{k}</div>
      <div className="min-w-0 text-fg">{v}</div>
    </div>
  );
}
