import { TRAINING_COACHES, screenNumber } from "@/lib/desk/training";
import { PaperDisclaimer } from "./PaperDisclaimer";

/** Open stations only. WICK leads; TAPE is second. Seats that are not open yet get one quiet line, not a card. */
export function TrainingHome() {
  const wick = TRAINING_COACHES.find((coach) => coach.id === "wick" && coach.available);
  const others = TRAINING_COACHES.filter((coach) => coach.available && coach.id !== "wick");
  return <>
    <main id="training-main" className="gutter mx-auto w-full max-w-6xl py-8 sm:py-12">
      <p className="font-mono text-micro uppercase tracking-widest text-wait">The apprentice desk</p>
      <h1 className="mt-3 font-sans text-display font-medium tracking-tight text-fg">Start with WICK.</h1>
      <p className="mt-3 max-w-2xl font-sans text-body leading-relaxed text-muted">Learn to read a closed candle and decide when to wait. Paper only. No live orders.</p>

      {wick ? <section aria-labelledby="wick-coach" className="mt-8 grid overflow-hidden rounded-lg border border-wait/30 bg-surface lg:grid-cols-2">
        <div className="p-6 sm:p-8"><span className="rounded-sm border border-up/30 bg-up/10 px-2 py-1 font-mono text-micro text-up">AVAILABLE NOW · GUIDED COACH</span><h2 id="wick-coach" className="mt-5 font-sans text-display font-medium">{wick.name}</h2><p className="mt-1 font-mono text-ui text-wait">{wick.specialty}</p><p className="mt-4 max-w-lg font-sans text-body leading-relaxed text-muted">{wick.lesson} The first lesson is one closed candle: close first, then a read. You do not need to know the live market to take it.</p><div className="mt-5 flex flex-wrap gap-2 font-mono text-micro text-muted"><span className="rounded border border-border px-2 py-1">Lesson 01 · Close first. Then a read.</span><span className="rounded border border-border px-2 py-1">Illustrated practice</span><span className="rounded border border-border px-2 py-1">Guided questions</span></div><a href="/training/wick" className="btn btn-primary mt-6">Enter WICK’s station ↗</a><p className="mt-3 font-mono text-micro text-subtle">Paper only. Text coaching, with optional voice.</p></div>
        <div className="flex flex-col justify-center border-t border-border bg-bg p-5 sm:p-8 lg:border-l lg:border-t-0" aria-label="WICK’s six screens">
          <div className="grid grid-cols-3 gap-2">{["What do you see?", "Let me try", "Ask WICK", "The chart", "WICK’s notes", "Practice"].map((label, i) => <div key={label} className="flex min-h-24 flex-col justify-between rounded border border-border-strong bg-surface-2 p-3 shadow-lg sm:min-h-32"><span className="font-mono text-micro text-subtle">{screenNumber(i)}</span><span className="font-sans text-ui text-fg">{label}</span><span aria-hidden="true" className="mt-3 block h-1 w-8 bg-wait/40" /></div>)}</div><p className="mt-5 text-center font-mono text-micro text-subtle">Six screens. One coach. Your pace.</p>
        </div>
      </section> : null}

      {others.length ? <section aria-labelledby="second-coach" className="mt-6">
        <h2 id="second-coach" className="font-mono text-micro uppercase tracking-widest text-subtle">Also open</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">{others.map((coach) => <article key={coach.id} className="rounded-md border border-border bg-surface p-5"><span className="rounded-sm border border-up/30 bg-up/10 px-2 py-1 font-mono text-micro text-up">AVAILABLE · GUIDED COACH</span><h3 className="mt-4 font-sans text-title text-fg">{coach.name}</h3><p className="mt-1 font-mono text-micro text-wait">{coach.specialty}</p><p className="mt-3 font-sans text-ui leading-relaxed text-muted">{coach.lesson}</p><a href={`/training/${coach.id}`} className="mt-4 inline-block font-mono text-micro text-fg underline underline-offset-4">{`Enter ${coach.name}’s station ↗`}</a></article>)}</div>
      </section> : null}

      <p className="mt-10 font-mono text-micro text-subtle">More seats will teach from the same desk later.</p>

      <p className="mt-8 max-w-3xl font-mono text-micro leading-relaxed text-subtle">These stations use recorded desk evidence and a guided teaching library. Open-ended AI conversation is not connected. Practice examples are clearly labeled, and live lessons pause when the feed is stale or unavailable.</p>
    </main><PaperDisclaimer />
  </>;
}
