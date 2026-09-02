import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FeedHealth, Lean, SeatStatus } from "@/lib/desk/types";
import { fmtLocal, type MarketRead } from "@/lib/desk/market-hours";
import { Tip } from "./Tip";

export function LeanChip({ lean, className }: { lean: Lean; className?: string }) {
  const map = {
    UP: "bg-up/15 text-up border-up/40",
    DOWN: "bg-down/15 text-down border-down/40",
    WAIT: "bg-wait/15 text-wait border-wait/40",
  } as const;
  return (
    <Tip k={`lean.${lean}`} mark={false}>
      <span
        className={cn(
          "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-micro font-medium tracking-wide",
          map[lean],
          className,
        )}
      >
        {lean}
      </span>
    </Tip>
  );
}

export function HealthDot({ h }: { h: FeedHealth }) {
  const c = h === "LIVE" ? "bg-up" : h === "STALE" ? "bg-wait" : "bg-down";
  return (
    <Tip k={`feed.${h}`} mark={false}>
      <span className="inline-flex items-center gap-1 font-mono text-micro text-muted">
        <span className={cn("inline-block size-1.5 rounded-full", c)} />
        {h}
      </span>
    </Tip>
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
    <Tip k={`status.${s}`} mark={false}>
      <span className={cn("rounded-sm border px-1 font-mono text-micro", tone)}>{s}</span>
    </Tip>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular text-data", className)}>{children}</span>;
}

export function MarketChip({
  m,
  tz,
  compact,
}: {
  m: MarketRead;
  tz: string;
  compact?: boolean;
}) {
  return (
    <Tip k="pane.market" mark={false}>
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-mono text-micro text-fg">
        <span>
          {m.emoji} {m.label}
        </span>
        {!compact && (
          <span className="text-muted">
            to {fmtLocal(m.until, tz)}
          </span>
        )}
        <span className="text-subtle">
          next {m.next_emoji} {m.next_label} {fmtLocal(m.next_at, tz)}
        </span>
        {m.event ? <span className="text-wait">{m.event}</span> : null}
        {m.micro ? <span className="text-wait">⏱ turn</span> : null}
      </span>
    </Tip>
  );
}

export function Pane({
  title,
  children,
  className,
  tour,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  tour?: string;
}) {
  return (
    <section
      data-tour={tour}
      className={cn("min-w-0 rounded-md border border-border bg-surface p-3", className)}
    >
      <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">{title}</h3>
      {children}
    </section>
  );
}

export function Field({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 text-ui leading-snug">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">
        <Tip k={`field.${k}`}>{k}</Tip>
      </div>
      <div className="min-w-0 text-fg">{v}</div>
    </div>
  );
}
