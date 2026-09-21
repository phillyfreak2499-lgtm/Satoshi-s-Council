/**
 * The Lab's front door. Pure, read-only, and deliberately not a rewrite.
 *
 * The Lab already publishes every study in full underneath. What it lacked was
 * a way to answer, in ten seconds, "what is being measured right now, what has
 * evidence on it yet, and what is not ready" — so a reader had to scroll the
 * whole bench to find out that most of it is still collecting.
 *
 * WHAT THIS FILE IS ALLOWED TO SAY. It groups the registry rows the Lab server
 * already computes and repeats their own recorded `purpose`, `sample_n`,
 * `health` and `authority`. That is the entire vocabulary.
 *
 * WHAT IT MUST NEVER SAY. No study is a "winner", a "best bot", "promotion
 * ready" or "proven", and no research conclusion is drawn here from any
 * number. Those words are not omitted by taste: every study in this registry
 * carries `authority: "none"`, so any of them would be a claim the desk has
 * not earned and cannot support, printed at the top of the page where it would
 * be believed. `WHAT WE'RE LEARNING` therefore reports on the REGISTER — how
 * many studies are measuring, where evidence has piled up, how many have
 * produced nothing — and never on what any study found.
 *
 * Nothing here writes, promotes, grades or decides anything.
 */
import type { LabStudyHealth, LabStudySpec, LabStudyType } from "./lab-registry.ts";

/** The shape the Lab registry server publishes. Structural, so this stays pure. */
export type FrontDoorRow = {
  id: string;
  label: string;
  type: LabStudyType;
  authority: "none";
  purpose: string;
  cadence: string;
  health: LabStudyHealth;
  sample_n: number;
  last_evidence_at: string | null;
};

/**
 * The authority badge, from the study's own recorded type.
 *
 * Every row in the registry is `authority: "none"`, so the badge can only ever
 * describe HOW a study is powerless, never whether it is. A shadow decider
 * produces a read nobody acts on; a measurement study produces a number nobody
 * acts on. Both are none.
 */
export function authorityLabel(row: Pick<FrontDoorRow, "type">): string {
  switch (row.type) {
    case "decider":
      return "SHADOW ONLY";
    case "measurement":
      return "MEASUREMENT ONLY";
    case "manual":
      return "MEASUREMENT ONLY";
    default:
      return "AUTHORITY: NONE";
  }
}

/** The plain status line, from the registry's own health value. */
export function statusLabel(row: Pick<FrontDoorRow, "health">): string {
  switch (row.health) {
    case "collecting":
      return "collecting";
    case "event-driven":
      return "runs on events";
    case "stale":
      return "no recent evidence";
    case "no-sample":
      return "no sample yet";
    case "manual":
      return "run by hand";
    default:
      return "unknown";
  }
}

/**
 * Why a reader should care, in one line, built only from recorded fields.
 *
 * It restates the study's own `purpose` and its cadence. It never adds a
 * finding, a direction or an expectation.
 */
export function whyItMatters(row: Pick<FrontDoorRow, "purpose" | "cadence">): string {
  const purpose = String(row.purpose ?? "").trim();
  return purpose ? `${purpose} Measured ${row.cadence}, with no authority over any live call.` : `Measured ${row.cadence}, with no authority over any live call.`;
}

export type FrontDoorCard = {
  id: string;
  label: string;
  purpose: string;
  status: string;
  /** Printed only when the study has actually recorded something. */
  sample: number | null;
  authority: string;
  why: string;
};

export type LabFrontDoor = {
  /** Studies actively measuring right now. */
  running: FrontDoorCard[];
  /**
   * Observations about the BENCH, each one arithmetic over the registry.
   *
   * This section used to repeat the running cards, which made the summary
   * longer without making it clearer. It is now the handful of things that can
   * be said truthfully without reading any study's results: how much of the
   * bench is measuring, where the evidence has actually accumulated, and how
   * much of it has produced nothing yet. Never a finding, never a ranking of
   * quality — `sample_n` says how MUCH was recorded, never how well anything did.
   */
  learning: string[];
  /** Collecting nothing yet, gone quiet, or run by hand. */
  not_ready: FrontDoorCard[];
  /** Totals, so the page can say how much of the bench is in each state. */
  counts: { running: number; not_ready: number; total: number; with_evidence: number };
};

function card(row: FrontDoorRow): FrontDoorCard {
  return {
    id: row.id,
    label: row.label,
    purpose: String(row.purpose ?? "").trim(),
    status: statusLabel(row),
    // A zero sample is "no sample yet", which the status already says; printing
    // "0" as though it were a measurement would be worse than printing nothing.
    sample: Number.isFinite(row.sample_n) && row.sample_n > 0 ? Math.floor(row.sample_n) : null,
    authority: authorityLabel(row),
    why: whyItMatters(row),
  };
}

/** The status a card carries when the live register has not answered yet. */
export const PENDING_STATUS = "evidence count not available this request";

/**
 * The bench as the frozen register itself declares it, for a request that
 * arrived before the live lifecycle scan was warm.
 *
 * WHY THIS EXISTS. `labRegistrySnapshot` is deliberately a cache-only reader:
 * it refuses to run the heavy lifecycle scan on the request path, and throws
 * while the background observer is still warming or after that scan has failed.
 * `lab-public` turns that into `registry: null`. The studies are not missing
 * when that happens — every other snapshot in the SAME request still queried
 * successfully and the detailed research below renders in full — so a summary
 * that announced the whole register as unreadable was describing a much larger
 * outage than the one that occurred.
 *
 * WHAT IT IS ALLOWED TO SAY. Only what the frozen spec already states: the
 * study's label, its recorded purpose and its authority. `sample` is null and
 * the status says plainly that the count is not available, because a number
 * invented here would be indistinguishable on the page from a measured one.
 * Nothing is fetched, nothing is counted, and no health is guessed at.
 *
 * The specs are passed in rather than imported, so this module stays a pure
 * mapper over rows it is handed and never reaches for the register itself.
 */
export function declaredBench(specs: readonly LabStudySpec[] | null | undefined): FrontDoorCard[] {
  const all = Array.isArray(specs) ? specs : [];
  return all.map((spec) => ({
    id: spec.id,
    label: spec.label,
    purpose: String(spec.purpose ?? "").trim(),
    status: PENDING_STATUS,
    sample: null,
    authority: authorityLabel(spec),
    why: whyItMatters(spec),
  }));
}

const ACTIVE: readonly LabStudyHealth[] = Object.freeze(["collecting", "event-driven"]);

/**
 * Group the registry into the three answers a first-time reader wants.
 *
 * The buckets come from the registry's own `health`, not from any judgement of
 * this module: `collecting`/`event-driven` are running, everything else is not
 * ready. `learning` is counting sentences over those same rows — statements
 * about evidence EXISTING, never about what any of it shows.
 */
export function labFrontDoor(rows: readonly FrontDoorRow[] | null | undefined): LabFrontDoor {
  const all = Array.isArray(rows) ? rows : [];
  const running = all.filter((r) => ACTIVE.includes(r.health));
  const notReady = all.filter((r) => !ACTIVE.includes(r.health));
  const withEvidence = all.filter((r) => Number.isFinite(r.sample_n) && r.sample_n > 0);
  const n = (v: number) => v.toLocaleString("en-US");

  // Counting sentences, in the order a reader would ask them. Each is a fact
  // about the register itself; none reports what any study found.
  const learning: string[] = [];
  if (all.length) {
    learning.push(
      `${n(running.length)} of ${n(all.length)} studies are measuring right now; the rest are listed below as not ready.`,
    );
  }
  if (withEvidence.length) {
    const deepest = withEvidence.reduce((a, b) => (b.sample_n > a.sample_n ? b : a));
    learning.push(
      `${n(withEvidence.length)} ${withEvidence.length === 1 ? "study has" : "studies have"} recorded evidence so far — most of it on ${deepest.label}, at ${n(Math.floor(deepest.sample_n))} observations.`,
    );
  }
  const empty = all.filter((r) => !Number.isFinite(r.sample_n) || r.sample_n <= 0);
  if (empty.length) {
    learning.push(
      `${n(empty.length)} ${empty.length === 1 ? "study has" : "studies have"} produced nothing yet, so there is nothing to read from ${empty.length === 1 ? "it" : "them"}.`,
    );
  }
  if (all.length) {
    learning.push(
      "Every study carries authority: none, so none of this has moved a live call — what is accumulating is evidence, not a verdict.",
    );
  }

  return {
    running: running.map(card),
    learning,
    not_ready: notReady.map(card),
    counts: {
      running: running.length,
      not_ready: notReady.length,
      total: all.length,
      with_evidence: withEvidence.length,
    },
  };
}

/** The words the front door prints above each list. Fixed copy, no claims. */
export const FRONT_DOOR_COPY = Object.freeze({
  running:
    "Studies measuring right now. Each one records what it sees and changes nothing about the live Council.",
  learning:
    "What can be said from the register itself. These are open questions under measurement, not answers — no study here has authority over any call.",
  not_ready:
    "Started but not yet producing evidence, gone quiet, or run by hand. Listed so the bench is never quietly shorter than it looks.",
  footer:
    "Every study below carries authority: none. The full evidence for each one is unchanged underneath.",
  pending:
    "The live count of what each study has recorded is still warming for this request, so no numbers are shown here. The bench itself is listed in full below, and the detailed research further down the page is unaffected.",
  declared:
    "Every study the desk is running, as the register itself declares them. Whether each one is currently collecting, and how much it has recorded, is the part that is unavailable this request — it is not being guessed at here.",
});
