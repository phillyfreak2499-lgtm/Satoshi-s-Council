/**
 * Public Council structure copy.
 *
 * Presentation only. The regression test pins these public numbers against
 * SEAT_IDS and the Chair's non-voter set so About/FAQ cannot drift from the
 * engine's actual roster.
 */
export const COUNCIL_TOTAL_SEATS = 21;
export const COUNCIL_VOTING_SEATS = 18;
export const COUNCIL_PIT_CREW_SEATS = 3;
export const COUNCIL_PIT_CREW = ["WARDEN", "ORBIT", "WIRE"] as const;

export const COUNCIL_STRUCTURE_SHORT =
  "21 Council seats · 18 voting specialists · 3 non-voting pit crew";

export const COUNCIL_STRUCTURE_SENTENCE =
  "The Council has 21 seats: 18 voting specialists and 3 non-voting pit-crew seats — WARDEN, ORBIT and WIRE.";
