import { createServerFn } from "@tanstack/react-start";
import { readScalp, scalpAvg } from "./scalp";
import { SEAT_IDS, type SeatId, type SkillCard, type Snapshot, type Vote } from "./types";
import type { PublicSkillScoreAudit } from "./skill-score-audit.server";

export type PublicSeatSnapshot = {
  snap: Snapshot | null;
  vote: Vote | null;
  n: number;
  hits: number;
  recent: number[];
  avg_cents: number | null;
  calls: number;
  skills: SkillCard[];
  score_audit?: PublicSkillScoreAudit | null;
};

/** Read-only persisted evidence for one public seat page. */
export const publicSeatSnapshot = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<PublicSeatSnapshot | null> => {
    const id = data.id.trim().toUpperCase();
    if (!(SEAT_IDS as readonly string[]).includes(id)) return null;
    const seat = id as SeatId;
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const learner = frame.learner;
    const scoreAudit = seat === "DRIFT" || seat === "PULSE"
      ? await (await import("./skill-score-audit.server")).skillScoreAuditSnapshot() : null;

    return {
      snap: frame.snap,
      vote: frame.votes.find((row) => row.seat === seat) ?? null,
      n: learner.seat_n[seat] ?? 0,
      hits: learner.seat_hits[seat] ?? 0,
      recent: [...(learner.seat_recent?.[seat] ?? [])],
      avg_cents: scalpAvg(readScalp(learner, seat).legs),
      calls: learner.seat_calls?.[seat] ?? 0,
      skills: Object.values(learner.skills).filter((skill) => skill.owner === seat),
      score_audit: scoreAudit,
    };
  });
