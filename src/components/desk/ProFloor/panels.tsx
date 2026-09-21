/**
 * Shared shells for the Pro Floor cockpit. Presentation only: these draw boxes
 * and labels and know nothing about the desk.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { CentsFact, CentsKind } from "@/lib/desk/pro-floor";

export function Panel({
  id,
  title,
  note,
  right,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-3 sm:p-4" aria-labelledby={`pro-${id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`pro-${id}`} className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">
          {title}
        </h2>
        {right}
      </div>
      {note ? <p className="mt-1 max-w-[80ch] font-sans text-ui leading-snug text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

/** One labelled figure. `sub` carries the clause that says what the number is. */
export function Stat({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("truncate font-mono text-data tabular", tone ?? "text-fg")}>{value}</div>
      {sub ? <div className="mt-0.5 font-mono text-micro leading-snug text-subtle">{sub}</div> : null}
    </div>
  );
}

/** A boxed figure, for grids where each cell needs its own edge. */
export function StatBox({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 rounded-sm border border-border bg-bg/40 px-2.5 py-2" title={title}>
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("truncate font-mono text-data tabular", tone ?? "text-fg")}>{value}</div>
      {sub ? <div className="mt-0.5 font-mono text-micro leading-snug text-subtle">{sub}</div> : null}
    </div>
  );
}

const KIND_WORD: Record<CentsKind, string> = {
  executable: "quoted price",
  derived: "model value",
  fee: "cost",
  difference: "difference",
};

/**
 * The tag that stops a derived value being read as a quote. Small, always
 * present next to a cents figure whose kind could be mistaken.
 */
export function KindTag({ kind }: { kind: CentsKind }) {
  return (
    <span
      className={cn(
        "ml-1 rounded-sm border px-1 py-px align-middle font-mono text-micro uppercase tracking-wide",
        kind === "executable" ? "border-border text-muted" : "border-gold/40 text-gold-dim",
      )}
    >
      {KIND_WORD[kind]}
    </span>
  );
}

/** A cents figure with its kind, or an honest dash plus the reason it is missing. */
export function CentsCell({ f, signed = false }: { f: CentsFact; signed?: boolean }) {
  if (f.cents == null) {
    return (
      <span className="font-mono tabular text-subtle" title={f.unavailable_why || f.note}>
        — <span className="text-micro">unavailable</span>
      </span>
    );
  }
  const text = signed ? `${f.cents >= 0 ? "+" : ""}${f.cents.toFixed(1)}¢` : `${f.cents.toFixed(1)}¢`;
  return (
    <span className="font-mono tabular text-fg" title={f.note}>
      {text}
    </span>
  );
}

export function Chip({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "up" | "down" | "wait" | "neutral" | "gold";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-micro uppercase tracking-wide",
        tone === "up" && "border-up/40 bg-up/10 text-up",
        tone === "down" && "border-down/40 bg-down/10 text-down",
        tone === "wait" && "border-wait/40 bg-wait/10 text-wait",
        tone === "gold" && "border-gold/40 text-gold",
        tone === "neutral" && "border-border text-subtle",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A pass/fail dot that is never the only signal: the state word sits beside it.
 * `●` filled means failing, `○` hollow means clear, so the shape carries it too.
 */
export function GateDot({ pass, hard }: { pass: boolean; hard: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("font-mono text-micro", pass ? "text-subtle" : hard ? "text-down" : "text-wait")}
    >
      {pass ? "○" : "●"}
    </span>
  );
}
