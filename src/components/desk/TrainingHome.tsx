import { TRAINING_COACHES } from "@/lib/desk/training";
import { PaperDisclaimer } from "./PaperDisclaimer";
export function TrainingHome() {
  const wick = TRAINING_COACHES[0];
  return <>
    <main id="training-main" className="gutter mx-auto w-full max-w-6xl py-8 sm:py-12">
      <p className="font-mono text-micro uppercase tracking-widest text-wait">The apprentice desk</p>
      <h1 className="mt-3 font-sans text-display font-medium tracking-tight text-fg">Choose your coach.</h1>
      <p className="mt-3 max-w-2xl font-sans text-body leading-relaxed text-muted">Pull up a seat with a Council specialist. Explore the evidence, ask questions, and practice explaining a decision—one observation at a time.</p>
      <section aria-labelledby="wick-coach" className="mt-8 grid overflow-hidden rounded-lg border border-wait/30 bg-surface lg:grid-cols-2">
        <div className="p-6 sm:p-8"><span className="rounded-sm border border-up/30 bg-up/10 px-2 py-1 font-mono text-micro text-up">AVAILABLE NOW · GUIDED COACH</span><h2 id="wick-coach" className="mt-5 font-sans text-display font-medium">{wick.name}</h2><p className="mt-1 font-mono text-ui text-wait">{wick.specialty}</p><p className="mt-4 max-w-lg font-sans text-body leading-relaxed text-muted">{wick.lesson} Your own six-screen workstation, connected to WICK’s recorded read.</p><div className="mt-5 flex flex-wrap gap-2 font-mono text-micro text-muted"><span className="rounded border border-border px-2 py-1">Live observations</span><span className="rounded border border-border px-2 py-1">Guided questions</span><span className="rounded border border-border px-2 py-1">Illustrated practice</span></div><a href="/training/wick" className="btn btn-primary mt-6">Enter WICK’s station ↗</a><p className="mt-3 font-mono text-micro text-subtle">Paper only. Text coaching, with optional voice.</p></div>
        <div className="flex flex-col justify-center border-t border-border bg-bg p-5 sm:p-8 lg:border-l lg:border-t-0" aria-label="WICK’s six screens">
          <div className="grid grid-cols-3 gap-2">{["What do you see?", "Let me try", "Ask WICK", "The chart", "WICK’s notes", "Practice"].map((label, i) => <div key={label} className="flex min-h-24 flex-col justify-between rounded border border-border-strong bg-surface-2 p-3 shadow-lg sm:min-h-32"><span className="font-mono text-micro text-subtle">0{i + 1}</span><span className="font-sans text-ui text-fg">{label}</span><span aria-hidden="true" className="mt-3 block h-1 w-8 bg-wait/40" /></div>)}</div><p className="mt-5 text-center font-mono text-micro text-subtle">Six screens. One coach. Your pace.</p>
        </div>
      </section>
      <section aria-labelledby="next-coaches" className="mt-10"><h2 id="next-coaches" className="font-sans text-title font-medium">More seats to learn from</h2><p className="mt-2 font-sans text-body text-muted">Future stations will use the same desk, with lessons specific to each specialist.</p><div className="mt-5 grid gap-4 md:grid-cols-3">{TRAINING_COACHES.filter((coach) => !coach.available).map((coach) => <article key={coach.id} className="rounded-md border border-border bg-surface p-5"><p className="font-mono text-micro text-subtle">PLANNED · NOT OPEN YET</p><h3 className="mt-3 font-sans text-title text-fg">{coach.name}</h3><p className="mt-1 font-mono text-micro text-wait">{coach.specialty}</p><p className="mt-3 font-sans text-ui leading-relaxed text-muted">{coach.lesson}</p></article>)}</div></section>
      <p className="mt-8 max-w-3xl font-mono text-micro leading-relaxed text-subtle">WICK currently uses recorded desk evidence and a guided teaching library. Open-ended AI conversation is not connected. Practice examples are clearly labeled, and live lessons pause when the feed is stale or unavailable.</p>
    </main><PaperDisclaimer />
  </>;
}
