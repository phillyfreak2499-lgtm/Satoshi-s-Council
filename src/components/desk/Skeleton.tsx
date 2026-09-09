import { useEffect, useState } from "react";
import { patchSettings } from "@/lib/desk/engine";
import { cn } from "@/lib/utils";
import { Crest } from "./Crest";

export function Bone({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-surface-3", className)} />;
}

/** The strip's shape while the first frame is on its way. */
export function StripSkeleton() {
  return (
    <div className="border-b border-border bg-surface px-3 py-2" aria-busy="true" aria-label="Loading the window">
      <div className="flex flex-wrap items-center gap-2">
        <Bone className="h-5 w-12" />
        <Bone className="h-5 w-24" />
        <Bone className="h-5 w-16" />
        <Bone className="ml-auto h-5 w-14" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <Bone className="h-2.5 w-16" />
            <Bone className="mt-1.5 h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The floor's shape plus what is coming and what to do if it does not.
 *  After fifteen seconds the copy explains the market's hours and offers
 *  the demo tape, which is this browser's own sandbox. */
export function FloorSkeleton({ demo }: { demo: boolean }) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLong(true), 15_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="grid gap-3 p-3" aria-busy="true" aria-live="polite">
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-center gap-2 font-mono text-micro uppercase tracking-widest text-subtle">
          <Crest size={16} className="opacity-80" /> Opening the window
        </div>
        <p className="mt-1 font-sans text-body text-muted">
          The desk polls the tape every few seconds; the first frame usually lands within ten seconds. What appears here: the chair&apos;s
          call, the clock, and the voting seats.
        </p>
        {long ? (
          <div className="mt-3 rounded-sm border border-wait/40 bg-wait/10 p-3">
            <p className="font-sans text-body text-fg">Still waiting.</p>
            <p className="mt-1 font-sans text-ui text-muted">
              The feeds may be resting: Kalshi&apos;s 15-minute Bitcoin market runs on a schedule, and the strip says when the next window
              opens once the frame arrives. The demo tape shows the floor with sample data in this browser only; nothing about the shared desk changes.
            </p>
            {!demo ? (
              <button
                type="button"
                onClick={() => patchSettings({ source: "demo" })}
                className="btn btn-secondary mt-2"
              >
                Open the demo tape
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Bone className="h-3 w-20" />
            <Bone className="mt-2 h-10 w-40" />
            <Bone className="mt-2 h-3 w-32" />
          </div>
          <div className="flex gap-6">
            <Bone className="h-8 w-14" />
            <Bone className="h-8 w-10" />
            <Bone className="h-8 w-16" />
          </div>
        </div>
        <Bone className="mt-4 h-3 w-full" />
      </section>
      <section className="rounded-md border border-border bg-surface p-4">
        <Bone className="h-3 w-24" />
        <div className="mt-3 grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Bone key={i} className="h-5 w-full" />
          ))}
        </div>
      </section>
    </div>
  );
}
