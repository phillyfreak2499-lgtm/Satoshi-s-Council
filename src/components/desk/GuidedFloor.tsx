import { useState } from "react";
import type { ChairResult, CallLogRow, Snapshot } from "@/lib/desk/types";
import { bookState } from "@/lib/desk/book-floor";
import { useCountdownText } from "@/lib/desk/hooks";
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
    const blocked = chair.gates.find((g) => g.hard && !g.pass);
    const note =
      blocked?.id === "early" || blocked?.id === "late"
        ? "Timing check"
        : blocked?.id === "quote"
          ? "Fresh market price needed"
          : blocked?.id === "edge"
            ? "Price leaves too little room"
            : blocked?.id === "top3"
              ? "Leading specialists disagree"
              : blocked?.id === "law"
                ? "Safety pause after misses"
                : "Waiting for a stronger read";
    const why =
      blocked?.id === "early"
        ? "It is early in this 15-minute window. The Council lets more evidence arrive before making a paper call."
        : blocked?.id === "late"
          ? "This window is nearly over. The Council waits for the next one instead of rushing a paper call."
          : blocked?.id === "quote"
            ? "The market quote is old. The Council waits for a fresh price."
            : blocked?.id === "edge"
              ? "The current market price leaves too little room after costs. The Council waits for a better opportunity."
              : blocked?.id === "top3"
                ? "The leading specialists disagree. The Council waits for a clearer read."
                : "The evidence does not clear the Council's bar yet. Waiting is a real decision here.";
    return { label: "WAIT", why, note, tone: "text-wait" };
  }
  const side = chair.lean;
  return {
    label: `Council read: ${side}`,
    why: `${side} means the Council currently leans toward Bitcoin finishing ${side === "UP" ? "above" : "below"} the target line. This is a live paper read; check the Pro Floor for whether a call has actually been recorded.`,
    note: "Current read · paper only",
    tone: side === "UP" ? "text-up" : "text-down",
  };
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
}: {
  snap: Snapshot;
  chair: ChairResult;
  callLog: CallLogRow[];
  demo: boolean;
  onPro: () => void;
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
            onClick={onPro}
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
