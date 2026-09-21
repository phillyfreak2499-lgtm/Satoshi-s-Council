/**
 * SECTION 5 — what the desk sees.
 *
 * Five cards, one per existing Council family. Each summarizes what its
 * specialists read WITHOUT building a second opinion: the counts are counts, a
 * raw read is drawn differently from a final vote, and a directional read that
 * never reached the Chair is shown as exactly that.
 *
 * Tapping a family jumps to its existing specialist desk.
 */
import { cn } from "@/lib/utils";
import { SUPPRESSION_LABEL, VOICE_LABEL, type FamilyFacts, type ProFloorFacts, type SeatFact } from "@/lib/desk/pro-floor";
import type { SeatId, SeatTab } from "@/lib/desk/types";
import { Chip, Panel } from "./panels";

/** Speaking seats first, then suppressed directional reads, then the quiet ones. */
function order(a: SeatFact, b: SeatFact): number {
  const rank = (s: SeatFact) =>
    s.voice === "speaking" ? 0 : s.voice === "suppressed" ? 1 : s.voice === "unhealthy" ? 2 : 3;
  const d = rank(a) - rank(b);
  if (d) return d;
  return (b.raw_conf ?? 0) - (a.raw_conf ?? 0);
}

function SeatLine({ s, onJump }: { s: SeatFact; onJump: (seat: SeatId) => void }) {
  const speaking = s.voice === "speaking";
  const suppressed = s.voice === "suppressed";
  const tone = !speaking
    ? "text-subtle"
    : s.final_lean === "UP"
      ? "text-up"
      : s.final_lean === "DOWN"
        ? "text-down"
        : "text-wait";
  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(s.seat)}
        className="flex min-h-11 w-full items-center gap-2 rounded-sm px-1 text-left hover:bg-surface-2/60"
        aria-label={`${s.seat}: ${VOICE_LABEL[s.voice]}${speaking ? `, ${s.final_lean}` : ""}. Open the ${s.family} desk.`}
      >
        <span className="w-[4.5rem] shrink-0 font-mono text-micro text-fg">{s.seat}</span>
        {/* Wide enough for "(DOWN 44)" on one line: a raw read that wraps reads
            as two facts when it is one. */}
        <span className={cn("w-[5.25rem] shrink-0 whitespace-nowrap font-mono text-micro tabular", tone)}>
          {speaking ? `${s.final_lean} ${s.final_conf ?? "—"}` : suppressed ? `(${s.raw_lean} ${s.raw_conf ?? "—"})` : "WAIT"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-subtle">
          {suppressed
            ? `raw read · ${s.suppression ? SUPPRESSION_LABEL[s.suppression] : "suppressed"}`
            : speaking
              ? `${s.health_warning ? "STALE feed · " : ""}${s.why || "speaking"}`
              : VOICE_LABEL[s.voice]}
        </span>
      </button>
    </li>
  );
}

function FamilyCard({ f, onJump }: { f: FamilyFacts; onJump: (tab: SeatTab, seat: SeatId) => void }) {
  const suppressed = f.suppressed_up + f.suppressed_down;
  // One list, so a family with only STALE speakers still gets its note. The
  // earlier version gated the whole line on suppressed/unhealthy counts, which
  // silently dropped the STALE-speaker warning.
  const notes = [
    suppressed > 0 ? `${suppressed} suppressed directional (${f.suppressed_up} UP · ${f.suppressed_down} DOWN)` : null,
    f.unhealthy > 0 ? `${f.unhealthy} silenced by their feed` : null,
    f.stale_speakers > 0 ? `${f.stale_speakers} speaking on a STALE feed` : null,
  ].filter((n): n is string => n != null);
  return (
    <article className="flex min-w-0 flex-col rounded-sm border border-border bg-bg/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="font-mono text-micro uppercase tracking-widest text-fg">{f.label}</h3>
        {f.split ? <Chip tone="wait">split</Chip> : null}
      </div>
      <p className="mt-0.5 font-mono text-micro text-subtle">{f.eyes}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-data tabular">
        <span className="text-up">{f.up} UP</span>
        <span className="text-down">{f.down} DOWN</span>
        <span className="text-wait">{f.wait} WAIT</span>
      </div>
      {notes.length ? (
        <div className="mt-1 font-mono text-micro text-subtle">{notes.join(" · ")}</div>
      ) : null}

      <ul className="mt-2 border-t border-border pt-1">
        {[...f.seats].sort(order).map((s) => (
          <SeatLine key={s.seat} s={s} onJump={(seat) => onJump(f.family, seat)} />
        ))}
      </ul>
    </article>
  );
}

export function EvidenceFamilies({
  facts,
  onJump,
}: {
  facts: ProFloorFacts;
  onJump: (seat: SeatId) => void;
}) {
  const b = facts.balance;
  return (
    <Panel
      id="families"
      title="What the desk sees"
      note="Five specialist families. A number in brackets is a RAW read the Chair never heard; a plain number is a vote it did."
      right={
        <span className="font-mono text-micro text-subtle">
          {b.aggregated} of {facts.seats.length} seats aggregated
        </span>
      }
    >
      <div className="mt-3 rounded-sm border border-border bg-bg/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-micro uppercase tracking-widest text-subtle">{b.label}</span>
          <span className="font-mono text-data tabular">
            <span className="text-subtle">speaking </span>
            <span className="text-up">{b.speaking.up} UP</span>
            <span className="text-subtle"> · </span>
            <span className="text-down">{b.speaking.down} DOWN</span>
            <span className="text-subtle"> · </span>
            <span className="text-wait">{b.speaking.wait} WAIT</span>
          </span>
          <span className="font-mono text-data tabular text-subtle">
            suppressed directional {b.suppressed.up} UP · {b.suppressed.down} DOWN
          </span>
        </div>
        <p className="mt-1 max-w-[80ch] font-mono text-micro leading-relaxed text-subtle">{b.disclaimer}</p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {facts.families.map((f) => (
          <FamilyCard key={f.family} f={f} onJump={(_, seat) => onJump(seat)} />
        ))}
      </div>
    </Panel>
  );
}
