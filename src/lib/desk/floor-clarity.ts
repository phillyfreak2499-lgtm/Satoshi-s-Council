/**
 * What the Floor is allowed to SAY about a price, a clock and a reason.
 *
 * WHY THIS EXISTS. The Floor showed four different kinds of number — the price the
 * decision was taken at, the price you could trade at now, a model's fair value, and
 * the price a paper position is locked at — in three different places, with no stated
 * relationship between them. A reader seeing "fair 52¢" in the header strip and
 * "YES 65¢" in the call block has no way to know those measure different things. The
 * brief's failure condition is exactly that: an unexplained 52¢ beside a 65¢.
 *
 * So this module turns recorded fields into LABELLED facts, and refuses to produce a
 * label it cannot ground. It is the whole of the Stage 1 truthfulness work, in one
 * place, with tests.
 *
 * PRESENTATION ONLY, AND STRUCTURALLY SO. It has no clock of its own (every "now"
 * arrives as `snap.as_of`), reads no database, imports nothing that decides anything,
 * and returns plain data. It cannot generate a decision because it is never asked for
 * one: the Chair's answer arrives already made, and nothing here recomputes it.
 *
 * THE FOUR RULES IT ENFORCES
 *
 *   1. A missing number is null, never 0. A price of 0 is not a tradeable price, and
 *      `quote_age_s` uses 999 as an UNKNOWN SENTINEL (server-feeds.ts:283 and
 *      live.ts:47,68) — rendering either as a real value would turn "we don't know"
 *      into a confident reading. A legitimate zero is preserved where zero is a real
 *      value (an edge of exactly 0¢ is a real edge).
 *
 *   2. A later quote never stands in for a historical fact. The locked paper entry
 *      and the moment it was taken come from the recorded fill; the current ask comes
 *      from the current book; they are returned as separate facts and never
 *      reconciled to make them agree.
 *
 *   3. Receipt time is not source time. See `freshness` — the distinction is real
 *      here, and today the answer is that source time is NOT AVAILABLE.
 *
 *   4. A number is labelled by WHAT IT IS. Gate confidence, directional strength,
 *      calibrated probability and settled hit rate are four different quantities;
 *      `confidenceKind` refuses to let one be read as another.
 */
import { CHAIR_MIN_ASK_CENTS, FLOOR_SHADOW_CENTS } from "./book-floor.ts";
import { breakevenPct } from "./books-math.ts";
import { takerFeeCents as takerFee } from "./clock.ts";
import type { BookState } from "./book-floor.ts";
import type { ChairResult, Gate, Snapshot } from "./types";

/** `quote_age_s` at or above this is the unknown sentinel, not an age. */
export const AGE_UNKNOWN_SENTINEL = 999;

/** A real, quotable price in cents. 0 and 100 are not prices a position trades at. */
export function realCents(c: unknown): c is number {
  return typeof c === "number" && Number.isFinite(c) && c > 0 && c < 100;
}

/** An age the feed actually measured, or null when the sentinel means "unknown". */
export function realAge(s: unknown): number | null {
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return null;
  return s >= AGE_UNKNOWN_SENTINEL ? null : s;
}

// ---------------------------------------------------------------------------
// PRICES — four kinds, never conflated.
// ---------------------------------------------------------------------------

export type PriceKind =
  /** The price the Chair's live read is being evaluated against, at `at`. */
  | "decision"
  /** What the held or intended side could be traded at right now. */
  | "market"
  /** A model's derived value. Not a price anyone quoted. */
  | "fair"
  /** The price a paper position is locked at, from the recorded fill. */
  | "entry";

export type PriceFact = {
  kind: PriceKind;
  /** Short heading, e.g. "decision snapshot". */
  label: string;
  /** Cents, or null when there is no such number. NEVER 0 standing in for missing. */
  cents: number | null;
  /** The instant this price belongs to, or null when there isn't one. */
  at: number | null;
  /** What the number IS, in one clause. Always present, even when unavailable. */
  note: string;
  /** Why there is no number, when `cents` is null. Empty otherwise. */
  unavailable_why: string;
};

/**
 * The four price facts for the current Floor state, always in the same order, always
 * all four present — an unavailable one says so rather than vanishing, because a
 * silently absent row is indistinguishable from a row that does not apply.
 *
 * ALL FOUR ARE RETURNED, BUT NOT ALL FOUR ARE NEW ON SCREEN. A rendered capture of the
 * live Floor confirmed that the Chair card's existing "what this call costs" box
 * already shows FAIR and ASK side by side, and the market strip shows FAIR/EDGE/FEE —
 * so an earlier reading of mine, that fair value was stranded in the header, was
 * WRONG. The display therefore renders only the two facts that box does not carry
 * (`decision` and `entry`) and points at the existing box for the other two, rather
 * than drawing a second fair-and-ask. `DISPLAY_KINDS` below is that split; the helper
 * still returns all four so a caller can ask about any of them.
 *
 * `decision` and `entry` DELIBERATELY carry the same number on a booked window: the
 * book fills at the decision, so they are one event seen twice. The notes say so.
 * Showing them as two independent-looking prices would invent a distinction.
 */
export function priceFacts(
  snap: Snapshot,
  chair: ChairResult,
  book: BookState,
  /** The recorded open fill, so the locked entry carries its own timestamp. */
  openFill: { t: number; cents: number } | null = null,
): PriceFact[] {
  const lean = chair.lean;
  const sideWord = lean === "UP" ? "YES" : lean === "DOWN" ? "NO" : "";
  const booked = book.kind === "booked";

  // MARKET — the executable price for the side that is held, or that a fill would
  // take. On a booked window that is the held side, which is not necessarily the
  // Chair's current read: one position per window means the book does not re-side.
  const marketSide = booked ? book.lean : lean;
  const marketWord = marketSide === "UP" ? "YES" : marketSide === "DOWN" ? "NO" : sideWord;
  const marketCents = booked ? book.ask : book.kind === "wait" ? null : book.ask;

  const entry: PriceFact = booked
    ? {
        kind: "entry",
        label: "paper entry",
        cents: realCents(book.cents) ? book.cents : null,
        // From the RECORDED fill, never from the current tick. A locked entry with no
        // timestamp is indistinguishable from a live quote, which is the confusion
        // this whole module exists to prevent.
        at: openFill && openFill.t > 0 ? openFill.t : null,
        note: `locked when the book filled ${book.lean} — paper only, held to settlement`,
        unavailable_why: realCents(book.cents) ? "" : "the recorded fill carries no usable price",
      }
    : {
        kind: "entry",
        label: "paper entry",
        cents: null,
        at: null,
        note: "the price a paper position would be locked at",
        unavailable_why:
          book.kind === "wait"
            ? "no position: the Chair is waiting"
            : book.kind === "floor"
              ? `no position: ${marketWord} is under the ${CHAIR_MIN_ASK_CENTS}¢ floor`
              : "no position yet on this window",
      };

  return [
    {
      kind: "decision",
      // ALWAYS UNAVAILABLE, IN EVERY STATE — and that is the honest answer, not a gap
      // in this module.
      //
      // The desk does not record the market at the moment the Chair DECIDED. It records
      // the price the book PAID. Those are different events and can be minutes apart:
      // server-engine.ts noteCall returns early when `!bookable(cents)`, with the
      // comment "the read stands on screen, the fill waits ... a later tick at the floor
      // can still fill this window". So a read that appears at 65c and fills at 80c
      // twelve minutes later produces ONE record, stamped at the fill. `noteEntryState`
      // is likewise described as "the state the desk was in when the book actually
      // paid", and it lands in the ledger, not on this frame.
      //
      // An earlier version of this function labelled the fill's own price and instant
      // "decision snapshot" because they were frozen. Frozen is not the same as being
      // the decision: relabelling the entry would have asserted an evaluation time the
      // desk never captured. The entry is shown as the entry, below, and this stays
      // unavailable until something genuinely records decision-time market state.
      label: "decision snapshot",
      cents: null,
      at: null,
      note: "the market at the moment the Chair decided",
      unavailable_why:
        "not recorded: the desk stamps the price the book PAID, not the market when the " +
        "read was taken, and a read under the floor waits for the ask — so the two can be " +
        "minutes apart. The locked entry is shown separately; the live ask is above.",
    },
    {
      kind: "market",
      label: "current market",
      cents: realCents(marketCents) ? marketCents : null,
      at: snap.as_of > 0 ? snap.as_of : null,
      note: marketWord
        ? `what ${marketWord} could be bought at now — the executable ask`
        : "the executable ask for the side a fill would take",
      unavailable_why: realCents(marketCents)
        ? ""
        : lean === "WAIT" && !booked
          ? "no side is being priced while the Chair is waiting"
          : "the book is not showing a quotable ask",
    },
    {
      kind: "fair",
      label: "fair value",
      cents: realCents(snap.fair_yes) ? snap.fair_yes : null,
      at: snap.as_of > 0 ? snap.as_of : null,
      // Named as derived every time. This is the number most likely to be mistaken
      // for a quote, because it is expressed in the same unit as one.
      note: "DERIVED by the desk's model, not a price anyone quoted",
      unavailable_why: realCents(snap.fair_yes) ? "" : "the model has no usable value for this window",
    },
    entry,
  ];
}

/**
 * The kinds the new Floor section renders itself.
 *
 * `fair` and `market` are deliberately absent: the Chair card's existing economics box
 * already shows them together and labelled, and duplicating them would be a second
 * source of the same number — exactly what a clarity pass must not create.
 */
export const DISPLAY_KINDS: readonly PriceKind[] = Object.freeze(["decision", "entry"]);

/** The facts this section renders, in order, from the full set. */
export function displayedPriceFacts(facts: readonly PriceFact[]): PriceFact[] {
  return DISPLAY_KINDS.map((k) => facts.find((f) => f.kind === k)!).filter(Boolean);
}

/**
 * Whether two price facts genuinely describe the same event, so the display can say
 * so instead of leaving a reader to guess why two rows match.
 */
export function sameEvent(a: PriceFact, b: PriceFact): boolean {
  return a.cents != null && a.cents === b.cents && a.at != null && a.at === b.at;
}

// ---------------------------------------------------------------------------
// FRESHNESS — and the honest admission that source time is not available.
// ---------------------------------------------------------------------------

export type Freshness = {
  /** The feed's own verdict, derived from how long since a successful fetch. */
  feed: "LIVE" | "STALE" | "DOWN";
  /**
   * Seconds since the last SUCCESSFUL FETCH. This is a RECEIPT age: it says the feed
   * answered us, not that the quote it carried is current. Null when unmeasurable.
   */
  receipt_age_s: number | null;
  /**
   * Seconds since the book last CHANGED. This is what `quote_age_s` measures — the
   * fingerprint clock in server-feeds.ts `quoteUpdateTs`. A large value is NOT
   * staleness: a quiet market legitimately leaves the book untouched for minutes.
   * Null when the 999 sentinel means unknown.
   */
  last_change_age_s: number | null;
  /**
   * FALSE, today, always — and this is the honest part. `ObsStamp.provider_ts` is
   * misnamed: live.ts:194 assigns it `quote_ts`, which is the last-CHANGE clock
   * (`max(trade_ts, changedAt)`), not a provider timestamp for the current reading.
   * So the desk cannot say when the exchange stamped the quote it is showing, and
   * this field exists to stop the UI implying otherwise.
   */
  source_time_available: boolean;
  /** One clause stating what is and is not known about the clock. */
  note: string;
  /** The feed's own sequence/continuity verdict: ok, gap, reconnect or held. */
  gap: string;
};

export function freshness(snap: Snapshot): Freshness {
  const lastOk = snap.obs?.last_ok_ts ?? 0;
  const receipt =
    lastOk > 0 && snap.as_of > 0 ? Math.max(0, Math.round((snap.as_of - lastOk) / 1000)) : null;
  const change = realAge(snap.quote_age_s);
  const feed = snap.health?.kalshi === "LIVE" || snap.health?.kalshi === "STALE" || snap.health?.kalshi === "DOWN"
    ? snap.health.kalshi
    : "DOWN";

  const parts: string[] = [];
  parts.push(
    receipt == null
      ? "no receipt time recorded"
      : `the feed answered ${receipt}s ago (receipt, not the exchange's own stamp)`,
  );
  parts.push(
    change == null
      ? "time since the book last moved is unknown"
      : `the book last moved ${change}s ago`,
  );
  // Stated on every render, because its absence is the whole point.
  parts.push("the exchange's own quote timestamp is not available from this feed");

  return {
    feed,
    receipt_age_s: receipt,
    last_change_age_s: change,
    source_time_available: false,
    note: parts.join("; "),
    gap: snap.obs?.gap ?? "ok",
  };
}

// ---------------------------------------------------------------------------
// WHY — from recorded fields only.
// ---------------------------------------------------------------------------

export type WhyFacts = {
  /** The one-line plain reading, passed through from the caller. */
  plain: string;
  hypothesis: string;
  evidence: string[];
  counter: string;
  /** What would END the read. NEVER an entry trigger — see the note below. */
  invalidate_if: string;
  /** Present only while waiting. */
  wait_note: string;
  quorum: { up: number; down: number; wait: number };
  /** Hard gates that are failing. A call cannot happen while any of these fail. */
  failed_hard: Gate[];
  /** Every gate, for the disclosure. */
  gates: Gate[];
  /**
   * Why the Chair is not calling, in the order the desk actually applies. Empty when
   * calling. Four distinct answers, because they have four different remedies:
   *
   *   "feed-condition"  the DATA cannot be trusted — a data-trust gate is failing
   *                     (warden on a frozen tape, chalk/phantom, quote age). Listed
   *                     first because if the inputs are bad nothing downstream means
   *                     anything, whatever the vote said.
   *   "hard-gate"       some other hard gate blocks: timing, economics, the law.
   *   "under-bar"       no gate fails; the seats simply do not agree hard enough for
   *                     the weighted vote to clear its own bar.
   *   "no-edge"         gates pass AND the vote clears, and the desk still sees
   *                     nothing worth paying the ask for. Legitimate abstention.
   */
  wait_reason: "" | "feed-condition" | "hard-gate" | "under-bar" | "no-edge";
  /** The data-trust gates among the failures, when `wait_reason` is "feed-condition". */
  feed_gates: Gate[];
  /**
   * True when at least one hard gate fails AND the score would otherwise clear. Used
   * only to AVOID the false claim that clearing that gate produces a call: other
   * gates and the bar still apply, and the brief forbids implying otherwise.
   */
  more_than_one_thing_missing: boolean;
};

/**
 * The gates that say the DATA is untrustworthy, as opposed to the ones that say the
 * trade is not worth taking. Taken from chair.ts's own gate ids: `warden` silences
 * seats on a frozen tape, `chalk` is a phantom/bad-print condition, `quote` is quote
 * age. Everything else hard — bar, edge, leftover, law, early, late — is about the
 * trade, not about whether the inputs can be believed.
 */
export const FEED_GATE_IDS: readonly string[] = Object.freeze(["warden", "chalk", "quote"]);

export function whyFacts(chair: ChairResult, plain: string): WhyFacts {
  const failed_hard = chair.gates.filter((g) => g.hard && !g.pass);
  const feed_gates = failed_hard.filter((g) => FEED_GATE_IDS.includes(g.id));
  const clears = Math.abs(chair.score) >= chair.bar;
  const waiting = chair.lean === "WAIT";
  const wait_reason: WhyFacts["wait_reason"] = !waiting
    ? ""
    : feed_gates.length > 0
      ? "feed-condition"
      : failed_hard.length > 0
        ? "hard-gate"
        : clears
          ? "no-edge"
          : "under-bar";
  return {
    plain,
    hypothesis: chair.hypothesis ?? "",
    evidence: Array.isArray(chair.evidence) ? chair.evidence : [],
    counter: chair.counter ?? "",
    invalidate_if: chair.invalidate_if ?? "",
    wait_note: waiting ? (chair.wait_note ?? "") : "",
    quorum: chair.quorum ?? { up: 0, down: 0, wait: 0 },
    failed_hard,
    feed_gates,
    gates: Array.isArray(chair.gates) ? chair.gates : [],
    wait_reason,
    // More than one thing is missing whenever a gate fails and the score is ALSO
    // short: saying "it needs X" would then be incomplete.
    more_than_one_thing_missing: failed_hard.length > 1 || (failed_hard.length >= 1 && !clears),
  };
}

/**
 * How an `invalidate_if` condition may be described. It is the condition that would
 * END the read, and the brief explicitly forbids reinterpreting it as an entry
 * trigger — so the only wording offered is the one that cannot be read backwards.
 */
export function invalidateLine(w: WhyFacts): string {
  return w.invalidate_if ? `The read is off if ${w.invalidate_if}` : "";
}

// ---------------------------------------------------------------------------
// CONFIDENCE — four different quantities, never one word.
// ---------------------------------------------------------------------------

export type ConfidenceKind =
  /** How far the weighted vote cleared its own bar. NOT a probability. */
  | "gate-confidence"
  /** How strongly the seats lean one way. NOT a probability. */
  | "directional-strength"
  /** A modelled chance, fitted and scored against outcomes. */
  | "calibrated-probability"
  /** The share of settled windows that won. A historical frequency. */
  | "settled-hit-rate";

/** The honest one-line gloss for each kind, so no caller has to invent one. */
export const CONFIDENCE_GLOSS: Readonly<Record<ConfidenceKind, string>> = Object.freeze({
  "gate-confidence":
    "how far the weighted vote cleared its own bar — not a chance of winning",
  "directional-strength": "how hard the seats lean — not a chance of winning",
  "calibrated-probability": "a modelled chance, scored against what actually settled",
  "settled-hit-rate": "the share of settled windows that won",
});

/**
 * The Chair's `confidence` is a GATE number, not a probability.
 *
 * It comes from the score-against-bar calculation in the Chair, so "76 conf" means
 * the vote cleared its bar by a margin, NOT a 76% chance of winning. The unit is
 * deliberately omitted from the suffix: writing "76%" is what creates the false
 * reading in the first place.
 */
export function chairConfidenceLabel(chair: ChairResult): { value: string; kind: ConfidenceKind; gloss: string } {
  const v = Number.isFinite(chair.confidence) ? Math.round(chair.confidence) : null;
  return {
    value: v == null ? "—" : String(v),
    kind: "gate-confidence",
    gloss: CONFIDENCE_GLOSS["gate-confidence"],
  };
}

// ---------------------------------------------------------------------------
// The floor statement, from the constants rather than from prose.
// ---------------------------------------------------------------------------

/**
 * What the book will and will not pay, derived from the live constant so the sentence
 * cannot drift from the behaviour. The shadow floor is named as research, never as a
 * second place a fill could happen.
 */
export function floorLine(): string {
  return (
    `The paper book fills at ${CHAIR_MIN_ASK_CENTS}¢ or better. ` +
    `A read under the floor still stands and still grades every seat; it simply does not fill. ` +
    `The old ${FLOOR_SHADOW_CENTS}¢ floor is counted alongside as research and never gates a fill.`
  );
}

// ---------------------------------------------------------------------------
// COMPACT RECORD — one clearly identified population, or nothing.
// ---------------------------------------------------------------------------

/**
 * The record card, computed from the GAVEL rows the Floor ALREADY fetches.
 *
 * ONE POPULATION, NAMED. `/brief` returns at most 40 recently graded windows. Those
 * rows straddle the 70¢ -> 80¢ floor change at FLOOR_LIVE_SINCE, and combining the two
 * would merge incompatible strategy eras — so this counts only fills from the CURRENT
 * floor era and says so. Every number on the card comes from that one set; none is
 * borrowed from a wider or narrower one.
 *
 * WHY IT IS NOT "THE DESK'S RECORD". It is a recent-window view, bounded by the brief's
 * own limit. BOOKS is the full record with its own era splits, and the difference
 * between the two figures is therefore EXPECTED and explainable rather than a
 * discrepancy to reconcile. `population` states the bound so the card cannot be read
 * as a lifetime total.
 *
 * Unavailable is a first-class answer: a field with nothing behind it is null, and the
 * display is expected to print "unavailable" rather than a zero.
 */
export type RecordCard = {
  /** Exactly what was counted, in one phrase. Always present. */
  population: string;
  /** Fills counted. Zero is a real answer and is reported as zero, not as missing. */
  n: number;
  /** What N counts, spelled out — never left to the reader. */
  n_means: string;
  /** The sizing the cents assume. */
  unit: string;
  /** Net cents after Kalshi's fee across the counted fills, or null with no fills. */
  net_cents: number | null;
  /** Share of counted fills that settled in the money, 0-100, or null. */
  win_pct: number | null;
  /** The win rate those same fills needed to break even, 0-100, or null. */
  breakeven_pct: number | null;
  /** ISO bounds of the counted fills, or null. */
  from: string | null;
  to: string | null;
  /** Why a figure is missing, when it is. Empty when the card is complete. */
  unavailable_why: string;
};

/** The shape this needs from a GAVEL row. Structural, so the caller can pass its own. */
export type RecordRow = {
  t: string;
  entry: number | null;
  settle: number | null;
  ev: number | null;
};

/**
 * Count only fills, only in the current floor era, and report what was counted.
 *
 * `sinceIso` is the era boundary — FLOOR_LIVE_SINCE at the call site. A row with no
 * entry is a WAIT window: a legitimate decision, but not a fill, so it is excluded
 * from an economics population and that exclusion is stated rather than implied.
 */
export function recordCard(rows: readonly RecordRow[], sinceIso: string, briefLimit = 40): RecordCard {
  const since = Date.parse(sinceIso);
  const base = `fills in the current ${CHAIR_MIN_ASK_CENTS}¢ floor era, from the last ${briefLimit} graded windows`;
  const fills = rows.filter((r) => {
    if (r.entry == null || !realCents(r.entry)) return false;
    const t = Date.parse(r.t);
    if (!Number.isFinite(t) || (Number.isFinite(since) && t < since)) return false;
    // A graded fill needs an outcome to contribute economics.
    return r.settle != null && Number.isFinite(r.settle) && r.ev != null && Number.isFinite(r.ev);
  });

  const empty: RecordCard = {
    population: base,
    n: 0,
    n_means: "paper fills that have settled",
    unit: "one contract, paper only",
    net_cents: null,
    win_pct: null,
    breakeven_pct: null,
    from: null,
    to: null,
    unavailable_why: `no settled fills yet in the ${CHAIR_MIN_ASK_CENTS}¢ era within these windows`,
  };
  if (!fills.length) return empty;

  const net = fills.reduce((a, r) => a + (r.ev as number), 0);
  // A held binary pays 100 or 0, so "settled in the money" and "ev > 0" are the same
  // event — there is no ambiguity between an economic win and a directional one here.
  const wins = fills.filter((r) => (r.ev as number) > 0);
  const losses = fills.filter((r) => (r.ev as number) <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const winAvg = mean(wins.map((r) => r.ev as number));
  const lossAvg = mean(losses.map((r) => -(r.ev as number)));
  const costAvg = mean(fills.map((r) => (r.entry as number) + takerFee(r.entry as number)));
  const times = fills.map((r) => Date.parse(r.t)).filter((t) => Number.isFinite(t));

  const be = breakevenPct(winAvg, lossAvg, costAvg);
  return {
    population: base,
    n: fills.length,
    n_means: "paper fills that have settled",
    unit: "one contract, paper only",
    net_cents: Math.round(net * 10) / 10,
    win_pct: Math.round((100 * wins.length) / fills.length),
    breakeven_pct: be == null ? null : Math.round(be),
    from: times.length ? new Date(Math.min(...times)).toISOString() : null,
    to: times.length ? new Date(Math.max(...times)).toISOString() : null,
    unavailable_why: be == null ? "breakeven needs at least one settled fill to work from" : "",
  };
}
