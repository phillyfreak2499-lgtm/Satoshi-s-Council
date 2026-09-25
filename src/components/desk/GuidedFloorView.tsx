import { useMemo, useState } from "react";
import type { ChairResult, CallLogRow, SeatKnobs, Snapshot, Vote } from "@/lib/desk/types";
import { seatFacts } from "@/lib/desk/pro-floor";
import { seatDirectionalLeans } from "@/lib/desk/seat-lean";
import { SpecialistLeans } from "./SpecialistLeans";
import type { BooksWindow } from "@/lib/desk/books";
import { bookState } from "@/lib/desk/book-floor";
import { plainLine } from "@/lib/desk/chair-words";
import { whatHappened, whatWouldChange, MULTI_BLOCKER_LINE } from "@/lib/desk/guided-continuity";
import { guidedRead } from "@/lib/desk/guided-read";
import { useCountdownText } from "@/lib/desk/hooks";
import { beacon } from "@/lib/desk/beacon";
import { cn } from "@/lib/utils";
import { ALCHEMIST_ROLE_LINE, WICK_ROLE_LINE } from "@/lib/desk/training";
import { Tip } from "./Tip";
import { LastCallPanel } from "./LastCallPanel";

const portraits = {
  satoshi: "/floor/guides/satoshi.png",
  warden: "/floor/guides/warden.png",
  wick: "/floor/guides/wick.png",
  alchemist: "/floor/guides/alchemist.png",
};

function WhatWouldChange({ chair, snap, callLog }: { chair: ChairResult; snap: Snapshot; callLog: CallLogRow[] }) {
  const plain = plainLine(chair, snap, bookState(snap, chair.lean, callLog));
  const w = whatWouldChange(chair, plain);
  const waiting = w.stance === "WAIT";
  return (
    <section aria-labelledby="guided-change" className="rounded-md border border-border bg-surface p-5 sm:p-6">
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">The next question</p>
      <h2 id="guided-change" className="mt-2 font-sans text-title font-medium text-fg">What would change the decision?</h2>
      {w.supports.length ? (
        <>
          <p className="mt-4 font-mono text-micro uppercase tracking-wider text-muted">What supports this read</p>
          <ul className="mt-2 flex flex-col gap-2">
            {w.supports.map((t) => (
              <li key={t} className="flex gap-2 font-sans text-body leading-relaxed text-fg">
                <span aria-hidden="true" className="text-up">·</span><span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {w.conditions.length ? (
        <>
          <p className="mt-4 font-mono text-micro uppercase tracking-wider text-muted">{waiting ? "What still needs to improve" : "What is still not met"}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {w.conditions.map((t) => (
              <li key={t} className="flex gap-2 font-sans text-body leading-relaxed text-fg">
                <span aria-hidden="true" className="text-wait">·</span><span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {w.multiple ? <p className="mt-3 max-w-[62ch] font-sans text-body leading-relaxed text-wait">{MULTI_BLOCKER_LINE}</p> : null}
      {w.invalidate ? (
        <>
          <p className="mt-4 font-mono text-micro uppercase tracking-wider text-muted">What would end this read</p>
          <p className="mt-2 max-w-[60ch] font-sans text-body leading-relaxed text-fg">{w.invalidate}</p>
        </>
      ) : null}
      <p className="mt-4 max-w-[62ch] font-sans text-ui leading-relaxed text-muted">{w.closing}</p>
    </section>
  );
}

function WhatHappened({ last }: { last: BooksWindow | null | undefined }) {
  const h = whatHappened(last);
  if (!h) return null;
  return (
    <section aria-labelledby="guided-happened" className="rounded-md border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">The window before this one</p>
          <h2 id="guided-happened" className="mt-2 font-sans text-title font-medium text-fg">What happened?</h2>
        </div>
        <p className="font-mono text-micro text-subtle">{h.when}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <dt className="font-mono text-micro text-muted"><Tip k="term.paper-fill">Paper position</Tip></dt>
          <dd className="mt-1 font-mono text-ui text-fg">{h.position}</dd>
        </div>
        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <dt className="font-mono text-micro text-muted">Official result</dt>
          <dd className={cn("mt-1 font-mono text-ui", h.official === "UP" ? "text-up" : "text-down")}>{h.official}</dd>
        </div>
        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <dt className="font-mono text-micro text-muted">Paper result</dt>
          <dd className="mt-1 font-mono text-ui text-fg">{h.net ?? (h.booked ? "not graded yet" : "no position")}</dd>
        </div>
      </dl>
      <p className="mt-4 max-w-[68ch] font-sans text-body leading-relaxed text-fg">{h.lesson}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={h.href} onClick={() => beacon("window_replay_open")} className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 font-mono text-ui text-fg hover:bg-surface-2">See this window step by step →</a>
        <span className="font-mono text-micro text-subtle">The next window is already running above</span>
      </div>
    </section>
  );
}

function Portrait({ name, src, className = "" }: { name: string; src: string; className?: string }) {
  return (
    <img src={src} alt={`${name}, a Council guide`} width={512} height={512} loading="lazy" decoding="async" className={cn("h-full w-full object-contain", className)} />
  );
}

export function GuidedFloor({
  snap, chair, callLog, demo, onPro, last, votes = [], knobs,
}: {
  snap: Snapshot; chair: ChairResult; callLog: CallLogRow[]; demo: boolean; onPro: () => void; last?: BooksWindow | null;
  /** The raw seat reads, for the per-seat Directional Lean. Presentation only. */
  votes?: Vote[];
  knobs?: Record<string, SeatKnobs>;
}) {
  const [step, setStep] = useState(0);
  // The same read model the Pro Floor uses, filtered to the seats the Chair aggregates.
  const leans = useMemo(
    () => seatDirectionalLeans(seatFacts(chair, votes, knobs, snap.as_of).filter((f) => f.aggregated), { ticker: snap.ticker, close_time: snap.close_time, as_of: snap.as_of }),
    [chair, votes, knobs, snap.as_of, snap.ticker, snap.close_time],
  );
  const read = guidedRead(chair, snap, callLog);
  const countdown = useCountdownText(snap.close_time, "mins");
  const priceFresh = snap.health.spot === "LIVE" && Number.isFinite(snap.spot);
  const marketFresh = snap.health.kalshi === "LIVE" && Number.isFinite(snap.strike);
  const steps = [
    { title: "1 · The current price", body: "Bitcoin's live price can move every second. It is one clue, not the final result." },
    { title: "2 · The target line", body: "This 15-minute market asks whether the official Bitcoin value finishes above the target line. The current price is not the settlement value." },
    { title: "3 · The Council's choice", body: "The Council compares evidence, market prices, fees, and feed health. WAIT means its rules are not satisfied for a new paper call." },
  ];
  return (
    <div className="gutter mx-auto flex w-full max-w-[var(--max)] flex-col gap-4 py-4">
      <section className="relative overflow-hidden rounded-md border border-border bg-surface p-5 sm:p-7">
        <div className="pointer-events-none absolute right-0 top-0 h-44 w-44 opacity-25 sm:h-56 sm:w-56">
          <Portrait name="Satoshi" src={portraits.satoshi} />
        </div>
        <div className="relative max-w-[65ch]">
          <p className="font-mono text-micro uppercase tracking-widest text-wait">Guided Floor · {demo ? "Demo data" : "Live paper desk"}</p>
          <h1 className="mt-3 font-sans text-hero font-medium tracking-tight text-fg">Welcome to the Council.</h1>
          <p className="mt-2 font-sans text-body leading-relaxed text-muted">
            Follow one real <Tip k="term.window">15-minute window</Tip>. See what the{" "}
            <Tip k="term.chair">Council</Tip> knows, why it{" "}
            <Tip k="term.wait">waits</Tip>, and how it decides. No money changes hands here.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="rounded-sm border border-wait/40 bg-wait/10 px-3 py-2 font-mono text-ui text-wait">{countdown} left in this window</span>
            <span className="font-mono text-micro text-subtle">Paper only · Bitcoin only</span>
          </div>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="guided-call" className="rounded-md border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-micro uppercase tracking-widest text-subtle">Satoshi · the current read</p>
              <h2 id="guided-call" aria-live="polite" className={cn("mt-2 font-sans text-title font-medium", read.tone)}>
                {read.label === "WAIT" ? <Tip k="term.wait">WAIT</Tip> : read.label}
              </h2>
            </div>
            <div className="h-24 w-24 shrink-0 sm:h-32 sm:w-32"><Portrait name="Satoshi" src={portraits.satoshi} /></div>
          </div>
          <p className="mt-3 max-w-[60ch] font-sans text-body leading-relaxed text-fg">{read.why}</p>
          <p className="mt-4 font-mono text-micro text-muted">{read.note}</p>
          <button type="button" onClick={() => { beacon("guided_to_pro"); onPro(); }} className="mt-5 min-h-11 rounded-sm border border-border-strong px-4 font-mono text-ui text-fg hover:bg-surface-2">See the full Pro Floor →</button>
        </section>
        <section aria-labelledby="guided-price" className="rounded-md border border-border bg-surface p-5 sm:p-6">
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">One thing to watch</p>
          <h2 id="guided-price" className="mt-2 font-sans text-title font-medium text-fg">Bitcoin vs. the target</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-sm border border-border bg-surface-2 p-3">
              <p className="font-mono text-micro text-muted">Bitcoin now</p>
              <p className="mt-2 font-mono text-ui text-fg">{priceFresh ? `$${snap.spot.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "Awaiting fresh price"}</p>
            </div>
            <div className="rounded-sm border border-border bg-surface-2 p-3">
              <p className="font-mono text-micro text-muted">Target line</p>
              <p className="mt-2 font-mono text-ui text-fg">{marketFresh ? `$${snap.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "Awaiting market quote"}</p>
            </div>
          </div>
          <p className="mt-4 font-sans text-ui leading-relaxed text-muted">The official result uses the market's settlement rule at the end of the window. A price you see right now does not settle it.</p>
          <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
            <div className="h-24 w-24 shrink-0"><Portrait name="Warden" src={portraits.warden} /></div>
            <p className="font-sans text-ui text-muted">Warden checks that the live feeds are fresh before the{" "}<Tip k="term.chair">Council</Tip> trusts a{" "}<Tip k="term.directional-read">read</Tip>.</p>
          </div>
        </section>
      </div>
      {/* Directly under the SATOSHI verdict, never above it: during a WAIT stretch the specialist reads are the next thing to see. */}
      <SpecialistLeans leans={leans} waiting={read.label === "WAIT"} />
      <LastCallPanel last={last} />
      <WhatWouldChange chair={chair} snap={snap} callLog={callLog} />
      <WhatHappened last={last} />
      <section aria-labelledby="guided-lesson" className="rounded-md border border-border bg-surface p-5 sm:p-6">
        <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
          <div className="h-36 w-36"><Portrait name="WICK" src={portraits.wick} /></div>
          <div>
            <p className="font-mono text-micro uppercase tracking-widest text-wait">A tiny floor guide</p>
            <h2 id="guided-lesson" className="mt-1 font-sans text-title font-medium text-fg">{steps[step].title}</h2>
            <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">{steps[step].body}</p>
            <p className="mt-2 max-w-[70ch] font-sans text-ui leading-relaxed text-subtle">{WICK_ROLE_LINE}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => setStep((step + 1) % steps.length)} className="min-h-11 rounded-sm border border-wait/50 bg-wait/10 px-4 font-mono text-ui text-wait hover:bg-wait/20">{step === steps.length - 1 ? "Start again" : "Next clue →"}</button>
              <a href="/training/wick" onClick={() => beacon("guided_to_wick")} className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 font-mono text-ui text-fg hover:bg-surface-2">Learn with WICK →</a>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-md border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <div className="h-24 w-24 shrink-0"><Portrait name="Alchemist" src={portraits.alchemist} /></div>
          <div>
            <p className="font-mono text-micro uppercase tracking-widest text-subtle">Meet the research bench</p>
            <p className="font-sans text-ui leading-relaxed text-muted">{ALCHEMIST_ROLE_LINE}</p>
            <a href="/lab" className="mt-2 inline-flex font-mono text-micro text-fg underline underline-offset-4">Open the Lab →</a>
          </div>
        </div>
      </section>
    </div>
  );
}
