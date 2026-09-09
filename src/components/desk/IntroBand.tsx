import type { MouseEvent } from "react";
import type { ChairResult, Snapshot } from "@/lib/desk/types";
import { useCountdownText } from "@/lib/desk/hooks";
import { askCents } from "@/lib/desk/scalp";
import { cn } from "@/lib/utils";

function Clock({ closeTime }: { closeTime: number }) {
  return <>{useCountdownText(closeTime)}</>;
}

/**
 * The band above the Floor: what this is, in one breath, with the chair's real
 * state beside it. It never renders the chamber — "Enter the floor" only scrolls
 * to the chair stage below. Under 200px tall on a desk, under 150px on a phone.
 */
export function IntroBand({
  snap,
  chair,
  demo,
  nudge,
  onTour,
  onDismissNudge,
}: {
  snap: Snapshot | null;
  chair: ChairResult | null;
  demo: boolean;
  /** First visit after the welcome: the tour button says so until it is taken or dismissed. */
  nudge: boolean;
  onTour: () => void;
  onDismissNudge: () => void;
}) {
  const lean = chair?.lean ?? "WAIT";
  const tone = lean === "UP" ? "text-up" : lean === "DOWN" ? "text-down" : "text-wait";
  const ask = snap && chair ? askCents(snap, lean) : null;
  const call = !snap || !chair ? "—" : lean === "WAIT" ? "WAIT" : `${lean}${ask != null ? ` ${ask.toFixed(0)}¢` : ""}`;
  const conf = chair ? String(chair.confidence) : "—";
  const jump = (e: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById("chair-stage");
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };
  return (
    <section aria-labelledby="intro-title" data-intro-band className="border-b border-border bg-bg">
      <div className="gutter mx-auto grid w-full max-w-[var(--max)] items-center gap-x-8 gap-y-2 py-3 sm:py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-micro uppercase tracking-widest text-subtle">
            <span aria-hidden="true" className={cn("inline-block size-1.5 rounded-full", demo ? "bg-wait" : "bg-up")} />
            The Council is in session{demo ? " · demo tape" : ""}
          </p>
          <h1 id="intro-title" className="mt-1 max-w-[24ch] font-sans text-body font-medium leading-tight tracking-tight text-fg sm:text-call">
            Twenty-one seats read Bitcoin. One chair makes the call.
          </h1>
          <p className="mt-1 hidden max-w-[70ch] font-sans text-ui text-muted sm:block">
            A paper-only research desk on the Kalshi 15-minute window: seats vote, the chair weighs them, every call is graded in public.
          </p>
          <p className="mt-1 font-mono text-micro text-muted lg:hidden">
            chair <span className={cn("tabular", tone)}>{call}</span>
            {" · "}closes in <span className="tabular text-fg">{snap ? <Clock closeTime={snap.close_time} /> : "—"}</span>
            {" · "}
            <span className="tabular text-fg">{conf}</span> conf
          </p>
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
        <dl aria-label="Live now" className="hidden grid-cols-3 gap-x-6 rounded-md border border-border bg-surface px-4 py-2.5 font-mono lg:grid lg:min-w-[22rem]">
          <div className="min-w-0">
            <dt className="text-micro uppercase tracking-widest text-subtle">Chair</dt>
            <dd className={cn("truncate text-title tabular", tone)} aria-live="polite">
              {call}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-micro uppercase tracking-widest text-subtle">Closes in</dt>
            <dd className="text-title tabular text-fg">{snap ? <Clock closeTime={snap.close_time} /> : "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-micro uppercase tracking-widest text-subtle">Conf</dt>
            <dd className="text-title tabular text-fg">{conf}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
