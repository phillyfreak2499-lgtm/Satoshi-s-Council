import { useState } from "react";
import type { ChairResult, CallLogRow, Snapshot } from "@/lib/desk/types";
import type { BooksWindow } from "@/lib/desk/books";
import { bookState } from "@/lib/desk/book-floor";
import { plainLine } from "@/lib/desk/chair-words";
import { whatHappened, whatWouldChange, MULTI_BLOCKER_LINE } from "@/lib/desk/guided-continuity";
import { useCountdownText } from "@/lib/desk/hooks";
import { beacon } from "@/lib/desk/beacon";
import { cn } from "@/lib/utils";

const portraits = {
  satoshi: "/floor/guides/satoshi.png",
  warden: "/floor/guides/warden.png",
  wick: "/floor/guides/wick.png",
  alchemist: "/floor/guides/alchemist.png",
};

/** These sentences describe recorded Chair state; they never make a call. */
export function guidedRead(chair: ChairResult, snap: Snapshot, callLog: CallLogRow[]) {
  const book = bookState(snap, chair.lean, callLog);
  const feedBad = snap.health.spot !== "LIVE" || snap.health.kalshi !== "LIVE";
  if (book.kind === "booked") {
    return {
      label: `Paper call: ${book.lean}`,
      why: `The Council recorded a ${book.lean} paper call at ${book.cents.toFixed(0)}¢ for this window. It stays on the books until the official result. The current read can change while that call is held.`,
      note: "Already recorded · awaiting the official result",
      tone: book.lean === "UP" ? "text-up" : "text-down",
    };
  }
  if (feedBad) {
    return {
      label: "WAIT",
      why: "A live price or market quote needs a fresh check. The Council waits when it cannot trust the inputs.",
      note: "Feed check needed",
      tone: "text-wait",
    };
  }
  if (chair.lean === "WAIT") {
    const failed = chair.gates.filter((g) => g.hard && !g.pass);
    const priority = [
      "warden",
      "semantic",
      "seq",
      "derivs",
      "quote",
      "leftover",
      "chalk",
      "edge",
      "spread",
      "law",
      "early",
      "late",
      "quiet",
      "top3",
    ];
    const id = priority.find((key) => failed.some((g) => g.id === key)) ?? failed[0]?.id;
    const reason = (() => {
      switch (id) {
        case "warden":
        case "semantic":
        case "seq":
        case "derivs":
          return {
            note: "Feed check needed",
            why: "One of the desk's data sources needs a fresh check. The Council waits rather than trusting a doubtful input.",
          };
        case "quote":
          return {
            note: "Fresh market price needed",
            why: "The market quote is old. The Council waits for a fresh price.",
          };
        case "leftover":
          return {
            note: "Market prices do not add up",
            why: "The two sides of the market are not adding up cleanly. The Council waits rather than trusting that price.",
          };
        case "chalk":
          return {
            note: "Almost no gain left to buy",
            why: `One side already costs ${Math.max(snap.yes_ask, snap.no_ask).toFixed(0)}¢. There is almost no room left after the price and fee, so the Council waits.`,
          };
        case "edge":
          return {
            note: "Price leaves too little room",
            why: "The current market price leaves too little room after costs. The Council waits for a better opportunity.",
          };
        case "spread":
          return {
            note: "Price gap is too wide",
            why: "The gap between buying and selling prices is too wide to pay. The Council waits.",
          };
        case "law":
          return {
            note: "Safety pause after misses",
            why: "The desk is in a temporary safety pause after misses. It waits for the pause to end.",
          };
        case "early":
          return {
            note: "Early in the window",
            why: "It is early in this 15-minute window. The Council lets more evidence arrive before making a paper call.",
          };
        case "late":
          return {
            note: "Window almost over",
            why: "This window is nearly over. The Council waits for the next one instead of rushing a paper call.",
          };
        case "quiet":
          return {
            note: "Waiting for more movement",
            why: "The market is too quiet for a clear read. The Council waits for more movement.",
          };
        case "top3":
          return {
            note: "Leading specialists disagree",
            why: "The leading specialists disagree. The Council waits for a clearer read.",
          };
        default:
          return {
            note: "Waiting for a stronger read",
            why: "The evidence does not clear the Council's bar yet. Waiting is a real decision here.",
          };
      }
    })();
    return { label: "WAIT", ...reason, tone: "text-wait" };
  }
  const side = chair.lean;
  return {
    label: `Council read: ${side}`,
    why: `${side} means the Council currently leans toward Bitcoin finishing ${side === "UP" ? "above" : "below"} the target line. This is a live paper read; check the Pro Floor for whether a call has actually been recorded.`,
    note: "Current read · paper only",
    tone: side === "UP" ? "text-up" : "text-down",
  };
}

/**
 * "What would change the decision?" — the question a beginner asks next.
 *
 * Every line comes from `whatWouldChange`, which reads the Chair's own gate
 * state. This component chooses no conditions and sets no thresholds; it only
 * lays out what it is handed.
 */
function WhatWouldChange({ chair, snap, callLog }: { chair: ChairResult; snap: Snapshot; callLog: CallLogRow[] }) {
  const plain = plainLine(chair, snap, bookState(snap, chair.lean, callLog));
  const w = whatWouldChange(chair, plain);
  const waiting = w.stance === "WAIT";
  return (
    <section
      aria-labelledby="guided-change"
      className="rounded-md border border-border bg-surface p-5 sm:p-6"
    >
      <p className="font-mono text-micro uppercase tracking-widest text-subtle">The next question</p>
      <h2 id="guided-change" className="mt-2 font-sans text-title font-medium text-fg">
        What would change the decision?
      </h2>

      {w.supports.length ? (
        <>
          <p className="mt-4 font-mono text-micro uppercase tracking-wider text-muted">
            What supports this read
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {w.supports.map((t) => (
              <li key={t} className="flex gap-2 font-sans text-body leading-relaxed text-fg">
                <span aria-hidden="true" className="text-up">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {w.conditions.length ? (
        <>
          <p className="mt-4 font-mono text-micro uppercase tracking-wider text-muted">
            {waiting ? "What still needs to improve" : "What is still not met"}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {w.conditions.map((t) => (
              <li key={t} className="flex gap-2 font-sans text-body leading-relaxed text-fg">
                <span aria-hidden="true" className="text-wait">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {w.multiple ? (
        <p className="mt-3 max-w-[62ch] font-sans text-body leading-relaxed text-wait">
          {MULTI_BLOCKER_LINE}
        </p>
      ) : null}

      {w.invalidate ? (
        <>
          <p className="mt-4 font-mono text-micro uppercase tracking-wider text-muted">
            What would end this read
          </p>
          <p className="mt-2 max-w-[60ch] font-sans text-body leading-relaxed text-fg">{w.invalidate}</p>
        </>
      ) : null}

      <p className="mt-4 max-w-[62ch] font-sans text-ui leading-relaxed text-muted">{w.closing}</p>
    </section>
  );
}

/**
 * "What happened?" — the settled window just before this one.
 *
 * This is the handoff that makes the site continuous: live window, result,
 * lesson, next window. Everything is read off the graded record; nothing is
 * re-graded here and no hindsight is added.
 */
function WhatHappened({ last }: { last: BooksWindow | null | undefined }) {
  const h = whatHappened(last);
  if (!h) return null;
  return (
    <section
      aria-labelledby="guided-happened"
      className="rounded-md border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">
            The window before this one
          </p>
          <h2 id="guided-happened" className="mt-2 font-sans text-title font-medium text-fg">
            What happened?
          </h2>
        </div>
        <p className="font-mono text-micro text-subtle">{h.when}</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <dt className="font-mono text-micro text-muted">Paper position</dt>
          <dd className="mt-1 font-mono text-ui text-fg">{h.position}</dd>
        </div>
        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <dt className="font-mono text-micro text-muted">Official result</dt>
          <dd className={cn("mt-1 font-mono text-ui", h.official === "UP" ? "text-up" : "text-down")}>
            {h.official}
          </dd>
        </div>
        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <dt className="font-mono text-micro text-muted">Paper result</dt>
          <dd className="mt-1 font-mono text-ui text-fg">
            {h.net ?? (h.booked ? "not graded yet" : "no position")}
          </dd>
        </div>
      </dl>

      <p className="mt-4 max-w-[68ch] font-sans text-body leading-relaxed text-fg">{h.lesson}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={h.href}
          onClick={() => beacon("window_replay_open")}
          className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 font-mono text-ui text-fg hover:bg-surface-2"
        >
          See this window step by step →
        </a>
        <span className="font-mono text-micro text-subtle">The next window is already running above</span>
      </div>
    </section>
  );
}

function Portrait({
  name,
  src,
  className = "",
}: {
  name: string;
  src: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={`${name}, a Council guide`}
      width={512}
      height={512}
      loading="lazy"
      decoding="async"
      className={cn("h-full w-full object-contain", className)}
    />
  );
}

export function GuidedFloor({
  snap,
  chair,
  callLog,
  demo,
  onPro,
  last,
}: {
  snap: Snapshot;
  chair: ChairResult;
  callLog: CallLogRow[];
  demo: boolean;
  onPro: () => void;
  /** The last graded window, for the end-of-window handoff. Absent is a missing card. */
  last?: BooksWindow | null;
}) {
  const [step, setStep] = useState(0);
  const read = guidedRead(chair, snap, callLog);
  const countdown = useCountdownText(snap.close_time, "mins");
  const priceFresh = snap.health.spot === "LIVE" && Number.isFinite(snap.spot);
  const marketFresh = snap.health.kalshi === "LIVE" && Number.isFinite(snap.strike);
  const steps = [
    {
      title: "1 · The current price",
      body: "Bitcoin's live price can move every second. It is one clue, not the final result.",
    },
    {
      title: "2 · The target line",
      body: "This 15-minute market asks whether the official Bitcoin value finishes above the target line. The current price is not the settlement value.",
    },
    {
      title: "3 · The Council's choice",
      body: "The Council compares evidence, market prices, fees, and feed health. WAIT means its rules are not satisfied for a new paper call.",
    },
  ];
  return (
    <div className="gutter mx-auto flex w-full max-w-[var(--max)] flex-col gap-4 py-4">
      <section className="relative overflow-hidden rounded-md border border-border bg-surface p-5 sm:p-7">
        <div className="pointer-events-none absolute right-0 top-0 h-44 w-44 opacity-25 sm:h-56 sm:w-56">
          <Portrait name="Satoshi" src={portraits.satoshi} />
        </div>
        <div className="relative max-w-[65ch]">
          <p className="font-mono text-micro uppercase tracking-widest text-wait">
            Guided Floor · {demo ? "Demo data" : "Live paper desk"}
          </p>
          <h1 className="mt-3 font-sans text-hero font-medium tracking-tight text-fg">
            Welcome to the Council.
          </h1>
          <p className="mt-2 font-sans text-body leading-relaxed text-muted">
            Follow one real 15-minute Bitcoin window. See what the Council knows, why it waits, and
            how it decides. No money changes hands here.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="rounded-sm border border-wait/40 bg-wait/10 px-3 py-2 font-mono text-ui text-wait">
              {countdown} left in this window
            </span>
            <span className="font-mono text-micro text-subtle">Paper only · Bitcoin only</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="guided-call"
          className="rounded-md border border-border bg-surface p-5 sm:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-micro uppercase tracking-widest text-subtle">
                Satoshi · the current read
              </p>
              <h2
                id="guided-call"
                aria-live="polite"
                className={cn("mt-2 font-sans text-title font-medium", read.tone)}
              >
                {read.label}
              </h2>
            </div>
            <div className="h-24 w-24 shrink-0 sm:h-32 sm:w-32">
              <Portrait name="Satoshi" src={portraits.satoshi} />
            </div>
          </div>
          <p className="mt-3 max-w-[60ch] font-sans text-body leading-relaxed text-fg">
            {read.why}
          </p>
          <p className="mt-4 font-mono text-micro text-muted">{read.note}</p>
          <button
            type="button"
            onClick={() => {
              beacon("guided_to_pro");
              onPro();
            }}
            className="mt-5 min-h-11 rounded-sm border border-border-strong px-4 font-mono text-ui text-fg hover:bg-surface-2"
          >
            See the full Pro Floor →
          </button>
        </section>

        <section
          aria-labelledby="guided-price"
          className="rounded-md border border-border bg-surface p-5 sm:p-6"
        >
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">
            One thing to watch
          </p>
          <h2 id="guided-price" className="mt-2 font-sans text-title font-medium text-fg">
            Bitcoin vs. the target
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-sm border border-border bg-surface-2 p-3">
              <p className="font-mono text-micro text-muted">Bitcoin now</p>
              <p className="mt-2 font-mono text-ui text-fg">
                {priceFresh
                  ? `$${snap.spot.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "Awaiting fresh price"}
              </p>
            </div>
            <div className="rounded-sm border border-border bg-surface-2 p-3">
              <p className="font-mono text-micro text-muted">Target line</p>
              <p className="mt-2 font-mono text-ui text-fg">
                {marketFresh
                  ? `$${snap.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "Awaiting market quote"}
              </p>
            </div>
          </div>
          <p className="mt-4 font-sans text-ui leading-relaxed text-muted">
            The official result uses the market's settlement rule at the end of the window. A price
            you see right now does not settle it.
          </p>
          <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
            <div className="h-24 w-24 shrink-0">
              <Portrait name="Warden" src={portraits.warden} />
            </div>
            <p className="font-sans text-ui text-muted">
              Warden checks that the live feeds are fresh before the Council trusts a read.
            </p>
          </div>
        </section>
      </div>

      <WhatWouldChange chair={chair} snap={snap} callLog={callLog} />

      <WhatHappened last={last} />

      <section
        aria-labelledby="guided-lesson"
        className="rounded-md border border-border bg-surface p-5 sm:p-6"
      >
        <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
          <div className="h-36 w-36">
            <Portrait name="WICK" src={portraits.wick} />
          </div>
          <div>
            <p className="font-mono text-micro uppercase tracking-widest text-wait">
              A tiny floor guide
            </p>
            <h2 id="guided-lesson" className="mt-1 font-sans text-title font-medium text-fg">
              {steps[step].title}
            </h2>
            <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">
              {steps[step].body}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep((step + 1) % steps.length)}
                className="min-h-11 rounded-sm border border-wait/50 bg-wait/10 px-4 font-mono text-ui text-wait hover:bg-wait/20"
              >
                {step === steps.length - 1 ? "Start again" : "Next clue →"}
              </button>
              <a
                href="/training/wick"
                onClick={() => beacon("guided_to_wick")}
                className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 font-mono text-ui text-fg hover:bg-surface-2"
              >
                Learn with WICK →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <div className="h-24 w-24 shrink-0">
            <Portrait name="Alchemist" src={portraits.alchemist} />
          </div>
          <div>
            <p className="font-mono text-micro uppercase tracking-widest text-subtle">
              Meet the research bench
            </p>
            <p className="font-sans text-ui leading-relaxed text-muted">
              Alchemist explores ideas in the lab. The live Council still decides by its recorded
              rules.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
