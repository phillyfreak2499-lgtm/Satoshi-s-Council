import type { SeatId, Snapshot, Vote } from "@/lib/desk/types";
import { SEAT_BY_ID } from "@/lib/desk/seats";
import { HealthDot, LeanChip, Field } from "./bits";
import { Eyes } from "./Eyes";
import { Tip } from "./Tip";
import { cn } from "@/lib/utils";

export function BotCard({
  seat,
  snap,
  vote,
  focused,
}: {
  seat: SeatId;
  snap: Snapshot;
  vote: Vote;
  focused?: boolean;
}) {
  const meta = SEAT_BY_ID[seat];
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
          </div>
        </div>
        <Eyes seat={seat} snap={snap} vote={vote} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          <LeanChip lean={vote.lean} />
          <span className="font-mono text-data tabular text-fg">{vote.confidence}</span>
          <span className="font-mono text-micro text-wait">
            {vote.skill_used} ·{" "}
            <Tip k={vote.skill_used === "SIT" ? "skill.SIT" : `skill.${vote.skill_status}`} mark={false}>
              {vote.skill_status}
            </Tip>
          </span>
        </div>
        <Field k="phase" v={`${vote.phase.toLowerCase()} · ${snap.mins_left.toFixed(1)}m left`} />
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
        <Field k="decision" v={`${vote.lean} · confidence ${vote.confidence} · ${vote.reasoning}`} />
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
                      `${p.status === "SHADOW" ? "shadow" : p.status.toLowerCase()} ${p.id} ${p.lean} ${p.confidence}`,
                  )
                  .join(" · ")
              : vote.shadow
                ? `shadow ${vote.shadow.id} would have said ${vote.shadow.lean} ${vote.shadow.confidence}`
                : "none"
          }
        />
      </div>
    </article>
  );
}
