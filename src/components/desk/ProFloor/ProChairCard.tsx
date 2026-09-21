/**
 * SECTION 2 — the house conclusion, and immediately after it the reason.
 *
 * A WAIT is not a blank screen here: it names which of the four situations it
 * is, what is blocking, and what would end the read if one were standing.
 *
 * The verdict is stated at heading size rather than display size because the
 * chair stage above already carries it at full scale. Saying it again in words
 * is deliberate — a screen reader and a reader who scrolled past the stage both
 * need the conclusion attached to its reason.
 */
import { cn } from "@/lib/utils";
import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { Chip, Panel } from "./panels";
import { leanTone } from "./tones";

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 border-t border-border py-1.5 first:border-t-0">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{k}</div>
      <div className="min-w-0 font-sans text-ui leading-snug text-muted">{v}</div>
    </div>
  );
}

export function ProChairCard({ facts, plain }: { facts: ProFloorFacts; plain: string }) {
  const { conclusion, wait, invalidation, paper } = facts;
  const lean = conclusion.lean;
  const tone = leanTone(lean);

  return (
    <Panel
      id="conclusion"
      title="The house conclusion, and why"
      right={
        <Chip tone="neutral" title={conclusion.confidence.gloss}>
          gate confidence {conclusion.confidence.value}
        </Chip>
      }
    >
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("font-sans text-title font-medium tracking-tight", tone)} aria-live="polite" aria-atomic="true">
          <span className="sr-only">SATOSHI says: </span>
          SATOSHI: {lean}
        </span>
        {wait.waiting && wait.headline ? (
          <Chip tone="wait" title={wait.explanation}>
            {wait.headline}
          </Chip>
        ) : null}
      </div>

      <p className="mt-2 max-w-[70ch] font-sans text-ui leading-snug text-fg">{plain}</p>

      <p className="mt-1 font-mono text-micro text-subtle">
        {conclusion.confidence.gloss}.
      </p>

      {wait.waiting ? (
        <div className="mt-4 rounded-sm border border-wait/30 bg-wait/5 p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-wait">Why WAIT?</div>
          <p className="mt-1 max-w-[76ch] font-sans text-ui leading-relaxed text-fg">{wait.explanation}</p>
          {wait.blocking.length ? (
            <ul className="mt-2 space-y-1">
              {wait.blocking.map((g) => (
                <li key={g.id} className="font-mono text-micro text-muted">
                  <span className="text-down">blocking</span> · {g.label}
                  {g.value ? <span className="text-subtle"> — {g.value}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {wait.note ? <p className="mt-2 max-w-[76ch] font-mono text-micro leading-relaxed text-subtle">{wait.note}</p> : null}
          {wait.more_than_one_thing_missing ? (
            <p className="mt-2 max-w-[76ch] font-mono text-micro leading-relaxed text-wait">
              More than one condition is missing. Clearing any single one of them would still not produce a call.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <Line k="hypothesis" v={conclusion.hypothesis || "—"} />
        <Line
          k="supporting"
          v={
            conclusion.evidence.length ? (
              <ul className="space-y-0.5">
                {conclusion.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              "the Chair recorded no supporting lines on this frame"
            )
          }
        />
        <Line k="counter" v={conclusion.counter || "the Chair recorded no counterevidence on this frame"} />
        <Line
          k="what breaks it"
          v={
            invalidation.available ? (
              invalidation.line
            ) : (
              <span className="text-subtle">
                no invalidation condition is recorded for this frame — a condition that would END a read, never one to act on
              </span>
            )
          }
        />
        <Line
          k="paper book"
          v={
            paper.held ? (
              <>
                a paper position is held: {paper.entry_side} locked at {paper.entry_cents?.toFixed(1) ?? "—"}¢. The
                read above is the desk&apos;s opinion now; the position is what the book already did.
              </>
            ) : (
              paper.no_position_why
            )
          }
        />
      </div>
    </Panel>
  );
}
