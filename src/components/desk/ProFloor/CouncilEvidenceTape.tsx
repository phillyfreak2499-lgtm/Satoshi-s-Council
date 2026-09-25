/**
 * SECTION 6 — the Council evidence tape (FULL density only).
 *
 * Every seat on one line: what it read, what the Chair heard, and why the two
 * differ when they do.
 *
 * THE CONFIDENCE COLUMNS ARE TWO COLUMNS ON PURPOSE. On a forced sit the vote
 * pipeline rewrites the final confidence to `max(70, raw)`, so that number is a
 * transform, not a reading. Printing one "conf" column would present a 70 the
 * seat never produced. RAW is the seat's own number; FINAL is what was recorded,
 * and a transformed one is marked.
 *
 * On a phone the table becomes stacked cards, so no critical number needs
 * sideways scrolling.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SUPPRESSION_LABEL, VOICE_LABEL, type ProFloorFacts, type SeatFact } from "@/lib/desk/pro-floor";
import type { SeatId } from "@/lib/desk/types";
import { Panel } from "./panels";
import { SeatLeanMini } from "../SeatLeanMeter";
import { DIRECTIONAL_LEAN_DISCLAIMER, DIRECTIONAL_LEAN_LABEL, DIRECTION_WORD, leanAnnouncement, leanKey, seatDirectionalLean, type LeanWindow, type SeatLean } from "@/lib/desk/seat-lean";

function voiceTone(s: SeatFact): string {
  switch (s.voice) {
    case "speaking":
      return s.final_lean === "UP" ? "text-up" : s.final_lean === "DOWN" ? "text-down" : "text-wait";
    case "suppressed":
      return "text-wait";
    case "unhealthy":
    case "muted":
    case "vetoed":
      return "text-down";
    default:
      return "text-subtle";
  }
}

function rawText(s: SeatFact): string {
  if (s.raw_lean == null) return "—";
  if (s.raw_lean === "WAIT") return "WAIT";
  return `${s.raw_lean} ${s.raw_conf ?? "—"}`;
}

function statusText(s: SeatFact): string {
  if (s.voice === "suppressed") {
    return s.suppression ? SUPPRESSION_LABEL[s.suppression] : "suppressed";
  }
  if (s.voice === "speaking") {
    // A STALE feed does not silence a seat; it only scales its confidence. Such
    // a seat really is speaking, and the warning rides along with the vote
    // rather than replacing it.
    const stale = s.health_warning ? " · STALE feed" : "";
    return `speaking${stale}${s.status && s.status !== "LIVE" ? ` · ${s.status.toLowerCase()}` : ""}`;
  }
  if (s.suppression) return SUPPRESSION_LABEL[s.suppression];
  return VOICE_LABEL[s.voice];
}

/** The number lives in the mini form; the word beside it says what the number means. Never a probability. */
function LeanWord({ lean }: { lean: SeatLean }) {
  const word = lean.score == null ? "NO READ" : DIRECTION_WORD[lean.direction];
  return <span className="seat-lean__value font-mono text-micro" data-direction={lean.direction} aria-hidden="true">{word}</span>;
}

function Cells({ s, lean }: { s: SeatFact; lean: ReactNode }) {
  return (
    <>
      <span className="font-mono text-micro tabular text-muted">{rawText(s)}</span>
      {lean}
      <span className={cn("font-mono text-micro tabular", voiceTone(s))}>{s.final_lean}</span>
      <span className="font-mono text-micro tabular text-muted">
        {s.final_conf ?? "—"}
        {s.final_conf_transformed ? (
          <span className="text-wait" title="A forced sit rewrites the recorded confidence to at least 70. This is not the seat's own reading — the RAW column is.">
            *
          </span>
        ) : null}
      </span>
      <span className="truncate font-mono text-micro text-subtle">{statusText(s)}</span>
    </>
  );
}

export function CouncilEvidenceTape({ facts, onJump, window }: { facts: ProFloorFacts; onJump: (seat: SeatId) => void; window: LeanWindow }) {
  const leanOf = (s: SeatFact) => seatDirectionalLean(s, window);
  return (
    <Panel
      id="tape"
      title="Council evidence tape"
      note={`Every seat, raw read beside final voice. RAW is what the specialist saw; FINAL VOICE is what the Chair heard. An asterisk marks a recorded confidence the pipeline rewrote on a forced sit. DIRECTIONAL LEAN is the raw read on one 0–100 scale: 0 strongly bearish, 50 neutral, 100 strongly bullish. ${DIRECTIONAL_LEAN_DISCLAIMER}`}
      right={<span className="font-mono text-micro text-subtle">{facts.seats.length} seats</span>}
    >
      {/* Desktop: a real table. */}
      <div className="mt-3 hidden sm:block">
        <div className="grid grid-cols-[6rem_5.5rem_11rem_5.5rem_3.5rem_1fr] gap-2 border-b border-border px-1 pb-1 font-mono text-micro uppercase tracking-wider text-subtle">
          <span>seat</span>
          <span>raw read</span>
          <span>{DIRECTIONAL_LEAN_LABEL}</span>
          <span>final voice</span>
          <span>conf</span>
          <span>status / why</span>
        </div>
        <ul>
          {facts.seats.map((s) => {
            const lean = leanOf(s);
            return (
            <li key={leanKey(lean)}>
              <button
                type="button"
                onClick={() => onJump(s.seat)}
                className="grid min-h-11 w-full grid-cols-[6rem_5.5rem_11rem_5.5rem_3.5rem_1fr] items-center gap-2 border-b border-border px-1 text-left hover:bg-surface-2/60"
                aria-label={`${s.seat}, raw ${rawText(s)}, ${leanAnnouncement(lean)} Final ${s.final_lean}, ${statusText(s)}. Open its desk.`}
              >
                <span className="truncate font-mono text-micro text-fg">
                  {s.seat} <span className="text-subtle">{s.callsign}</span>
                </span>
                <Cells s={s} lean={<span className="flex min-w-0 items-center gap-2"><SeatLeanMini lean={lean} decorative /><LeanWord lean={lean} /></span>} />
              </button>
            </li>
            );
          })}
        </ul>
      </div>

      {/* Phone: stacked rows, nothing clipped. */}
      <ul className="mt-3 sm:hidden">
        {facts.seats.map((s) => {
          const lean = leanOf(s);
          return (
          <li key={leanKey(lean)} className="border-b border-border">
            <button
              type="button"
              onClick={() => onJump(s.seat)}
              className="w-full py-2 text-left"
              aria-label={`${s.seat}, raw ${rawText(s)}, ${leanAnnouncement(lean)} Final ${s.final_lean}, ${statusText(s)}. Open its desk.`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-micro text-fg">
                  {s.seat} <span className="text-subtle">{s.callsign}</span>
                </span>
                <span className={cn("font-mono text-micro tabular", voiceTone(s))}>
                  {s.final_lean}
                  {s.final_conf == null ? "" : ` ${s.final_conf}`}
                  {s.final_conf_transformed ? <span className="text-wait">*</span> : null}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-micro text-subtle">
                <span>raw {rawText(s)}</span>
                <span className="truncate">{statusText(s)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-micro text-subtle">
                <span className="uppercase tracking-wider">{DIRECTIONAL_LEAN_LABEL}</span>
                <SeatLeanMini lean={lean} decorative />
                <LeanWord lean={lean} />
              </div>
            </button>
          </li>
          );
        })}
      </ul>

      <p className="mt-2 max-w-[80ch] font-mono text-micro leading-relaxed text-subtle">
        A RAW read that never became a FINAL voice did not reach the Chair and is not part of the house conclusion. Where
        the frame cannot prove why a read was held back, the status reads simply &ldquo;suppressed&rdquo;.
      </p>
    </Panel>
  );
}
