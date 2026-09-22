/**
 * Public Council structure copy.
 *
 * Presentation only. The regression test pins these public numbers against
 * SEAT_IDS, the Chair's non-voter set, and RETIRED_SEAT_IDS so About/FAQ
 * cannot drift from the engine's actual roster.
 */
export const COUNCIL_TOTAL_SEATS = 21;
/** Seats the Chair currently aggregates. 21 − 3 pit crew − 3 retired. */
export const COUNCIL_VOTING_SEATS = 15;
export const COUNCIL_RETIRED_SEATS = 3;
export const COUNCIL_PIT_CREW_SEATS = 3;
export const COUNCIL_PIT_CREW = ["WARDEN", "ORBIT", "WIRE"] as const;
export const COUNCIL_RETIRED = ["ODDS", "CHEAP", "FADE"] as const;

/** One line: a retired seat still has a record; its vote is not counted. */
export const COUNCIL_RETIRED_MEANS =
  "Retired means the seat still has a public graded record, but its vote is not counted in the Chair.";

export const COUNCIL_STRUCTURE_SHORT =
  "21 seats · 15 currently voting · 3 retired from votes · 3 non-voting pit crew";

export const COUNCIL_STRUCTURE_SENTENCE =
  "The Council has 21 seats: 15 currently voting, 3 retired from votes (ODDS, CHEAP and FADE), and 3 non-voting pit-crew seats — WARDEN, ORBIT and WIRE.";
