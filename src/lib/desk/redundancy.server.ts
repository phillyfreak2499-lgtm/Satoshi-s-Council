/**
 * The redundancy study's data (server only). Read-only on desk_ledger's vote
 * matrix. Nothing here mutes, gags, weights or benches a seat — see
 * redundancy.ts for why an in-sample answer cannot.
 */
import { getSql } from "@/lib/db";
import { redundancyReport, type RedundancyReport, type VoteRow } from "./redundancy.ts";
import { SEAT_IDS } from "./types";

const TTL_MS = 300_000;

/** WARDEN vetoes; it does not read the market, so it has no direction to overlap. */
const STUDIED = SEAT_IDS.filter((s) => s !== "WARDEN");

/**
 * Seats whose direction never reaches the chair, and why. Removing one of these
 * from the tally would describe a council that does not exist, so they are
 * reported without a swing or lift figure rather than ranked beside the rest.
 *
 * This list is deliberately hard-coded from the desk's standing rules rather
 * than read from live skill state: the study covers windows graded over days, and
 * today's gate does not tell you what was eligible last Tuesday. A seat that
 * genuinely starts voting has to be moved here by hand, which is the right amount
 * of friction for a change that alters what every number below means.
 */
const NOT_HEARD: Record<string, string> = {
  ORBIT: "non-voting",
  WIRE: "non-voting, a regime tag",
  CHEAP: "retired to shadow",
  INDEX: "under its 24-in-regime gate",
};
const TALLY = STUDIED.filter((s) => !(s in NOT_HEARD));

export type RedundancyStudy = RedundancyReport & {
  at: string;
  /** Seats with no direction on any window — a seat gagged or dark for the whole sample. */
  never_spoke: string[];
  /** Seats excluded from the tally, and the standing rule that excludes each. */
  not_heard: Record<string, string>;
  authority: { votes: false; mutes_nothing: true; note: string };
};

let cache: { at: number; study: RedundancyStudy } | null = null;

type Row = { winner: string | null; seats: Record<string, { lean?: string }> | null };

export async function redundancyStudy(): Promise<RedundancyStudy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.study;
  const db = await getSql();
  const raw = await db<Row>`
    select winner, seats from desk_ledger_research
    where winner in ('UP','DOWN') and seats is not null
    order by close_time
  `;
  const rows: VoteRow[] = [];
  for (const r of raw) {
    const winner = r.winner === "UP" || r.winner === "DOWN" ? r.winner : null;
    if (!winner) continue;
    const spoke: Record<string, "UP" | "DOWN"> = {};
    for (const id of STUDIED) {
      const lean = r.seats?.[id]?.lean;
      // Only a spoken direction counts. A whisper under the gag did not reach the
      // tally, so folding it in here would measure a council that never sat.
      if (lean === "UP" || lean === "DOWN") spoke[id] = lean;
    }
    rows.push({ winner, spoke });
  }
  const neverSpoke = STUDIED.filter((id) => !rows.some((r) => r.spoke[id]));
  const study: RedundancyStudy = {
    ...redundancyReport(rows, STUDIED, TALLY),
    at: new Date().toISOString(),
    never_spoke: neverSpoke,
    not_heard: NOT_HEARD,
    authority: {
      votes: false,
      mutes_nothing: true,
      note:
        "In-sample by construction: every figure re-runs a past tally with one seat removed. Read `caveat` " +
        "before any row. A seat is muted, gagged or reweighted only after running it gagged in SHADOW and " +
        "confirming prospectively that the council did not get worse — this table cannot establish that about " +
        "itself, and nothing reads it back into the chair.",
    },
  };
  cache = { at: Date.now(), study };
  return study;
}
