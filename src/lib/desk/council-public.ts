/**
 * Public Council structure copy.
 *
 * Presentation only. The regression test pins these public numbers against
 * SEAT_IDS, the Chair's non-voter set, and RETIRED_SEAT_IDS so About/FAQ
 * cannot drift from the engine's actual roster.
 */
export const COUNCIL_TOTAL_SEATS = 21;
/** Specialist seats in the voting roster. 21 − 3 pit crew − 3 retired. */
export const COUNCIL_VOTING_SEATS = 15;
export const COUNCIL_RETIRED_SEATS = 3;
export const COUNCIL_PIT_CREW_SEATS = 3;
export const COUNCIL_PIT_CREW = ["WARDEN", "ORBIT", "WIRE"] as const;
export const COUNCIL_RETIRED = ["ODDS", "CHEAP", "FADE"] as const;

/** One line: a retired seat still has a record; its vote is not counted. */
export const COUNCIL_RETIRED_MEANS =
  "Retired means the seat still has a public graded record, but its vote is not counted in the Chair.";

export const COUNCIL_STRUCTURE_SHORT =
  "21 research roles · 15-role voting roster, not 15 available voters · 3 retired · 3 pit crew";

export const COUNCIL_STRUCTURE_SENTENCE =
  "The Council has 21 research roles. Its 15-role voting roster is not 15 available voters: only seats with eligible LIVE cards can influence a call. Others remain in research quarantine. ODDS, CHEAP and FADE are already retired from votes; WARDEN, ORBIT and WIRE are non-voting pit crew.";

/** Counts verified on the current frame, never inferred from the nominal roster. */
export function availabilityLine(rows: readonly { selectable_live_cards?: number; authority_ready_cards?: number }[]): string {
  if (!rows.length || rows.some((r) => r.selectable_live_cards == null || r.authority_ready_cards == null))
    return "LIVE source availability unverified on this frame. The roster size is not the active count.";
  const selectable = rows.filter((r) => (r.selectable_live_cards ?? 0) > 0).length;
  const ready = rows.filter((r) => (r.authority_ready_cards ?? 0) > 0).length;
  return `${selectable} sources with selectable LIVE cards · ${ready} with seat authority available now. Confidence and entry gates still apply.`;
}

export type SeatAvailability = { seat?: string; selectable_live_cards?: number; authority_ready_cards?: number; authority_hold_reason?: string };
/** Shared visible and accessible status on roster cards and research instruments. */
export function seatAvailabilityLabel(row: SeatAvailability | undefined): string {
  if (row?.seat && (COUNCIL_PIT_CREW as readonly string[]).includes(row.seat)) return "Pit crew — non-voter";
  if (row?.seat && (COUNCIL_RETIRED as readonly string[]).includes(row.seat)) return "Retired — research only";
  if (row?.selectable_live_cards == null || row.authority_ready_cards == null) return "Authority unverified";
  if (row.selectable_live_cards === 0) return "Research quarantine — no selectable LIVE card";
  if (row.authority_ready_cards === 0) return `Held — ${row.authority_hold_reason || "no authority in this regime"}`;
  return "LIVE authority available";
}
