import { useState } from "react";
import type { SeatId, Snapshot, Vote } from "@/lib/desk/types";
import { SEAT_BY_ID } from "@/lib/desk/seats";
import { readScalp, scalpAvg, askCents } from "@/lib/desk/scalp";
import { FULL_N, calibNOf, seatCalib } from "@/lib/desk/math";
import { useDesk } from "@/lib/desk/store";
import { HealthDot, LeanChip, Field, MinsLeft } from "./bits";
import { SeatLeanMeter, SeatLeanMini } from "./SeatLeanMeter";
import { seatFactFor } from "@/lib/desk/pro-floor";
import { leanKey, seatDirectionalLean } from "@/lib/desk/seat-lean";
import { Eyes } from "./Eyes";
import { Tip } from "./Tip";
import { cn } from "@/lib/utils";

export function BotCard({
  seat,
  snap,
  vote,
  focused,
  compact = false,
}: {
  seat: SeatId;
  snap: Snapshot;
  vote: Vote;
  focused?: boolean;
  /** A sitting seat folds to one row until tapped; speaking seats always show the full card. */
  compact?: boolean;
}) {
  const meta = SEAT_BY_ID[seat];
  const frame = useDesk();
  const learner = frame.learner;
  const [open, setOpen] = useState(false);
  // Presentation only: the seat's own read as the frame retains it, beside what the Chair heard.
  const row = frame.chair?.rows.find((r) => r.seat === seat);
  const lean = seatDirectionalLean(seatFactFor(seat, vote, row, learner.knobs, snap.as_of), { ticker: snap.ticker, close_time: snap.close_time, as_of: snap.as_of });
  const whisper = vote.forced_sit && vote.raw_lean && vote.raw_lean !== "WAIT" ? `${vote.raw_lean} ${vote.raw_conf ?? ""}`.trim() : null;
  if (compact && !open && !focused) {
    return (
      <article id={`seat-${seat}`} data-tour={seat === "WICK" ? "tour-wick" : undefined} className="min-w-0 rounded-md border border-border bg-surface">
        <button
          type="button"
          aria-expanded="false"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2/60"
        >
          <span className="shrink-0 font-mono text-ui text-fg">
            {seat} <span className="text-subtle">{meta.callsign}</span>
          </span>
          <LeanChip lean={vote.lean} />
          <SeatLeanMini key={leanKey(lean)} lean={lean} className="shrink-0" />
          {whisper ? <span className="shrink-0 font-mono text-micro text-subtle">whispered {whisper}</span> : null}
          <span className="min-w-0 flex-1 truncate font-mono text-micro text-muted">{vote.hypothesis || vote.reasoning}</span>
          <HealthDot h={vote.health} />
          <span aria-hidden="true" className="font-mono text-micro text-subtle">
            ▸
          </span>
        </button>
        {seat === "WICK" || seat === "TAPE" || seat === "DRIFT" ? <a href={`/training/${seat.toLowerCase()}`} className="flex min-h-11 items-center border-t border-border px-3 font-mono text-micro text-wait hover:text-fg">Train with {seat} ↗</a> : null}
      </article>
    );
  }
  const st = readScalp(learner, seat);
  const avg = scalpAvg(st.legs);
  const ask = askCents(snap, vote.lean);
  const calibN = calibNOf(learner.seat_n[seat] ?? 0, learner.seat_calib_debt?.[seat] ?? 0);
  const calib = seatCalib(calibN);
  const calls = learner.seat_calls?.[seat] ?? 0;
  return (
    <article
      id={`seat-${seat}`}
      data-tour={seat === "WICK" ? "tour-wick" : undefined}
      className={cn(
        "grid min-w-0 overflow-hidden rounded-md border bg-surface md:grid-cols-2",
        focused ? "border-wait" : "border-border",
      )}
    >
      <div className="min-w-0 border-b border-border md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <div>
            <div className="font-mono text-ui text-fg">
              <Tip k={`seat.${seat}`}>{seat}</Tip>{" "}
              <span className="text-subtle">{meta.callsign}</span>
            </div>
            <div className="font-mono text-micro text-subtle">{meta.eyes}</div>
          </div>
          <div className="flex items-center gap-2">
            <HealthDot h={vote.health} />
            <span className="font-mono text-micro text-muted">{vote.feed_age_s.toFixed(1)}s</span>
            {compact && !focused ? (
              <button
                type="button"
                aria-expanded="true"
                onClick={() => setOpen(false)}
                className="btn btn-secondary btn-sm"
              >
                fold
              </button>
            ) : null}
          </div>
        </div>
        <Eyes seat={seat} snap={snap} vote={vote} />
        <div className="border-t border-border px-3 py-2">
          <SeatLeanMeter key={leanKey(lean)} lean={lean} mode="pro" feedAgeS={vote.feed_age_s} showDisclaimer />
        </div>
        {seat === "WICK" || seat === "TAPE" ? <a href={`/training/${seat.toLowerCase()}`} className="flex min-h-11 items-center border-t border-border px-3 font-mono text-micro text-wait hover:text-fg">Train with {seat} ↗</a> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          <LeanChip lean={vote.lean} cents={ask} />
          <span className="font-mono text-micro tabular text-muted">{vote.confidence} conf</span>
          <Tip k="field.avg ¢">
            <span
              className={cn(
                "font-mono text-data tabular",
                avg == null ? "text-subtle" : avg >= 0 ? "text-up" : "text-down",
              )}
            >
              {avg == null ? "avg —" : `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}¢`}
              {st.legs.length ? ` · ${st.legs.length}` : ""}
            </span>
          </Tip>
          <Tip k="field.calls">
            <span className="font-mono text-data tabular text-fg">{calls} calls</span>
          </Tip>
          <Tip k="col.calib">
            <span className="font-mono text-micro tabular text-muted">
              {Math.round(calib * 100)}% · {calibN}/{FULL_N}
            </span>
          </Tip>
          <span className="font-mono text-micro text-wait">
            {vote.skill_used} ·{" "}
            <Tip k={vote.skill_used === "SIT" ? "skill.SIT" : `skill.${vote.skill_status}`} mark={false}>
              {vote.skill_status}
            </Tip>
          </span>
        </div>
        <Field
          k="phase"
          v={
            <>
              {vote.phase.toLowerCase()} · <MinsLeft closeTime={snap.close_time} /> left
            </>
          }
        />
        <Field k="hypothesis" v={vote.hypothesis || vote.reasoning} />
        <Field
          k="evidence"
          v={
            <ul className="space-y-0.5">
              {vote.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          }
        />
        <Field k="counter" v={vote.counter} />
        <Field
          k="decision"
          v={`${vote.lean}${ask != null ? ` ${ask.toFixed(0)}¢` : ""} · ${vote.confidence} conf · ${vote.reasoning}`}
        />
        <Field k="invalidate if" v={vote.invalidate_if} />
        <Field
          k="skill used"
          v={
            vote.skill_used === "SIT"
              ? "SIT"
              : `${vote.skill_used} · ${vote.skill_status} · n=${vote.skill_n} hits=${vote.skill_hits} W=${Math.round(vote.skill_wilson * 100)}%`
          }
        />
        <Field
          k="thresh"
          v={
            vote.thresh_used?.length
              ? vote.thresh_used
                  .map((u) => `${u.id} x=${u.x.toFixed(3)} vs t=${u.t.toFixed(3)}`)
                  .join(" · ")
              : "—"
          }
        />
        <Field
          k="shadow / paper"
          v={
            vote.paper?.length
              ? vote.paper
                  .map(
                    (p) =>
                      `${p.status === "SHADOW" ? "shadow" : p.status.toLowerCase()} ${p.id} ${p.lean}${askCents(snap, p.lean) != null ? ` ${askCents(snap, p.lean)!.toFixed(0)}¢` : ""}`,
                  )
                  .join(" · ")
              : vote.shadow
                ? `shadow ${vote.shadow.id} would have said ${vote.shadow.lean}${askCents(snap, vote.shadow.lean) != null ? ` ${askCents(snap, vote.shadow.lean)!.toFixed(0)}¢` : ""}`
                : "none"
          }
        />
      </div>
    </article>
  );
}
