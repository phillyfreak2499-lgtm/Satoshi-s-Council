/**
 * Does a seat add anything the others were not already saying?
 *
 * Twenty seats read the same fifteen-minute window off largely the same tape. Two
 * that fire together on the same setups are not two pieces of evidence — they are
 * one piece counted twice, and a chair that weighs them separately is
 * double-counting. That is the most likely way a council of twenty is worse than
 * a council of six, and nothing in the desk measured it.
 *
 * WHAT "THE COUNCIL'S ANSWER" MEANS HERE, AND WHAT IT DOES NOT. The chair is not
 * a majority vote. It weighs confidences, applies gates, and compares a score to
 * a bar. Simulating that faithfully for a counterfactual ("what if this seat had
 * been absent") would mean re-running the whole chair, and the knobs it ran under
 * at the time are not stored. So the tally below is a SIMPLE MAJORITY of the
 * directions spoken — a proxy for the chair, not the chair. A seat that swings
 * the proxy may not swing the chair, and the reverse. That is a real limitation
 * and it is stated in the report rather than left for a reader to discover.
 *
 * The tally counts only seats the chair can actually hear. A seat that is
 * non-voting, shadow, or still under its promotion gate contributes nothing to
 * the real decision, so removing it from a tally it was never in would produce a
 * number about a council that does not exist. Those seats still get a row — how
 * often they spoke, how often they were right, how often alone — with no swing or
 * lift figure at all.
 *
 * Three questions, each answerable from the vote matrix the ledger already keeps:
 *
 *   OVERLAP    when two seats both speak, how often do they say the same thing?
 *              A pair near 100% is one seat wearing two badges.
 *   SWING      drop a seat from the tally. On how many windows does the council's
 *              answer change at all? A seat that never changes the answer costs
 *              nothing and adds nothing.
 *   LIFT       on the windows where dropping it DOES change the answer, is the
 *              council more right with it or without it? This is the only one of
 *              the three that is about being correct rather than being different.
 *
 * WHY THE ANSWER HERE CANNOT REMOVE A SEAT. Every number below is computed on the
 * windows that already happened, by re-running the tally as if one seat had been
 * absent. That is textbook in-sample: with twenty seats there are twenty chances
 * for one to look removable by luck, and the seat that looks worst on this sample
 * is partly just the unluckiest. A seat may be muted only after it has been shown
 * redundant PROSPECTIVELY — the desk already has the mechanism for that, which is
 * to run it gagged in shadow and check the council did not get worse. The report
 * states the count of chances taken so the table cannot be read without it.
 *
 * Pure module.
 */

/** One graded window's votes, plus who won. */
export type VoteRow = {
  winner: "UP" | "DOWN";
  /** Seat id to the direction it spoke. Seats that sat are absent. */
  spoke: Record<string, "UP" | "DOWN">;
};

/** The council's answer from a set of directional votes. Ties are WAIT. */
export function tally(votes: readonly ("UP" | "DOWN")[]): "UP" | "DOWN" | "WAIT" {
  let up = 0;
  let down = 0;
  for (const v of votes) {
    if (v === "UP") up += 1;
    else down += 1;
  }
  if (up === down) return "WAIT";
  return up > down ? "UP" : "DOWN";
}

export type Overlap = {
  a: string;
  b: string;
  /** Windows where both spoke a direction. */
  both: number;
  /** Of those, how often they agreed, 0-100. */
  agree: number;
};

/**
 * Pairwise agreement, over windows where BOTH spoke. Conditioning on both
 * speaking is the point: two seats that are quiet at the same times look
 * agreeable to a naive count without ever having agreed about anything.
 */
export function overlaps(rows: readonly VoteRow[], seats: readonly string[], minBoth = 20): Overlap[] {
  const out: Overlap[] = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i]!;
      const b = seats[j]!;
      let both = 0;
      let same = 0;
      for (const r of rows) {
        const va = r.spoke[a];
        const vb = r.spoke[b];
        if (!va || !vb) continue;
        both += 1;
        if (va === vb) same += 1;
      }
      if (both < minBoth) continue;
      out.push({ a, b, both, agree: r1((same / both) * 100) });
    }
  }
  return out.sort((x, y) => y.agree - x.agree);
}

export type SeatLift = {
  seat: string;
  /** This seat's direction reaches the tally. False for non-voting, shadow and gated seats. */
  in_tally: boolean;
  /** Windows where it spoke a direction. */
  spoke: number;
  /** Of those, how often it was right, 0-100. */
  alone_right: number | null;
  /** Windows where removing it changes the tally. Null for a seat not in the tally. */
  swings: number | null;
  /** Of the swings, how often the tally WITH it was right. */
  right_with: number | null;
  /** Of the same swings, how often the tally WITHOUT it was right. */
  right_without: number | null;
  /** right_with − right_without. Positive means it earns its seat on this sample. */
  lift: number | null;
  /** Windows it was the only voice. A seat that only ever speaks alone is not redundant. */
  solo: number;
  /** Of those, how often it was right. */
  solo_right: number | null;
  /** Too few swings to read anything into the lift. */
  thin: boolean;
};

/** Below this many swings, a lift is noise. */
export const MIN_SWINGS = 10;

export function seatLift(rows: readonly VoteRow[], seat: string, tallySeats: ReadonlySet<string>): SeatLift {
  const inTally = tallySeats.has(seat);
  let spoke = 0;
  let rightAlone = 0;
  let swings = 0;
  let rightWith = 0;
  let rightWithout = 0;
  let solo = 0;
  let soloRight = 0;
  for (const r of rows) {
    const mine = r.spoke[seat];
    // The tally is over heard seats only; a seat outside it cannot move anything.
    const heard = Object.entries(r.spoke).filter(([k]) => tallySeats.has(k));
    const all = heard.map(([, v]) => v);
    const others = heard.filter(([k]) => k !== seat).map(([, v]) => v);
    if (mine) {
      spoke += 1;
      if (mine === r.winner) rightAlone += 1;
      // "Alone" means no OTHER seat spoke at all, heard or not — a lone read is a
      // lone read whether or not the others were eligible to be counted.
      if (Object.keys(r.spoke).length === 1) {
        solo += 1;
        if (mine === r.winner) soloRight += 1;
      }
    }
    if (!inTally) continue;
    const withIt = tally(all);
    const withoutIt = tally(others);
    if (withIt === withoutIt) continue;
    swings += 1;
    // A WAIT is neither right nor wrong. Counting it as wrong would punish a seat
    // for breaking a tie the council should not have broken.
    if (withIt === r.winner) rightWith += 1;
    if (withoutIt === r.winner) rightWithout += 1;
  }
  return {
    seat,
    in_tally: inTally,
    spoke,
    alone_right: spoke ? r1((rightAlone / spoke) * 100) : null,
    swings: inTally ? swings : null,
    right_with: inTally ? rightWith : null,
    right_without: inTally ? rightWithout : null,
    lift: inTally ? rightWith - rightWithout : null,
    solo,
    solo_right: solo ? r1((soloRight / solo) * 100) : null,
    // A seat outside the tally is not "thin"; it is unmeasurable by this method.
    thin: !inTally || swings < MIN_SWINGS,
  };
}

export type RedundancyReport = {
  windows: number;
  seats: SeatLift[];
  /** The most agreeable pairs — the candidates for being one seat twice. */
  pairs: Overlap[];
  /** Seats that never changed the council's answer at all. */
  silent: string[];
  /** How many seats were examined, and what that does to the worst-looking one. */
  caveat: string;
};

/** A pair at or above this agreement is worth looking at as a duplicate. */
export const DUPLICATE_PCT = 90;

export function redundancyReport(
  rows: readonly VoteRow[],
  seats: readonly string[],
  tallySeats: readonly string[],
): RedundancyReport {
  const heard = new Set(tallySeats);
  const lifts = seats
    .map((s) => seatLift(rows, s, heard))
    .sort((a, b) => (a.lift ?? Infinity) - (b.lift ?? Infinity));
  const pairs = overlaps(rows, seats);
  const silent = lifts.filter((l) => l.in_tally && l.swings === 0).map((l) => l.seat);
  const dup = pairs.filter((p) => p.agree >= DUPLICATE_PCT);
  const readable = lifts.filter((l) => !l.thin).length;
  const worst = lifts.find((l) => !l.thin);
  const parts = [
    `${seats.length} seats examined on ${rows.length} graded windows, ${readable} with enough swings to read.`,
    `"The council's answer" here is a simple majority of the ${heard.size} seats the chair can hear — a PROXY ` +
      `for the chair, which actually weighs confidences against a bar. A seat that swings the proxy may not ` +
      `swing the chair.`,
  ];
  if (worst && worst.lift != null && worst.lift < 0) {
    parts.push(
      `The worst on this sample is ${worst.seat} at ${worst.lift} over ${worst.swings} swings — and with ` +
        `${readable} seats tested, one of them looking that bad is close to expected even if every seat were ` +
        `identical. It is a candidate to run gagged in shadow, not a seat to mute.`,
    );
  } else {
    parts.push(`No seat is negative on the windows it actually changed. Nothing here argues for muting anything.`);
  }
  if (dup.length) {
    parts.push(
      `${dup.length} pair${dup.length === 1 ? "" : "s"} agree ${DUPLICATE_PCT}% of the time or more when both ` +
        `speak; those are the places the chair is most likely counting one read twice.`,
    );
  }
  if (silent.length) {
    parts.push(
      `${silent.length} seat${silent.length === 1 ? "" : "s"} never changed the council's answer on any window: ` +
        `${silent.join(", ")}. That is a cost with no effect, not evidence they are wrong.`,
    );
  }
  parts.push(`Every number here is measured on windows that already happened. A seat earns a change in shadow, prospectively, or not at all.`);
  return { windows: rows.length, seats: lifts, pairs: pairs.slice(0, 15), silent, caveat: parts.join(" ") };
}

function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
