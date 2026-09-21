/**
 * The Pro Floor read model — what the desk knows, as presentation facts.
 *
 * WHY THIS EXISTS. The Pro Floor used to be readable only when SATOSHI called.
 * On a WAIT window the screen said "WAIT", "no paper fill", and hid every number
 * that would let a reader understand the market behind a `<details>` toggle. Yet
 * the frame already carries the whole picture: where Bitcoin sits against the
 * strike, the executable asks, the desk's own fair value, which specialists lean
 * which way, which ones had a directional read that never reached the Chair, how
 * far the weighted evidence is from its own standard, and exactly which gate is
 * blocking. This module turns that frame into labelled facts so the page can
 * show all of it.
 *
 * IT OBSERVES THE MACHINE; IT DOES NOT STEER IT. Structurally so:
 *
 *   - It DECIDES NOTHING. The Chair's answer arrives already made. Nothing here
 *     re-runs, re-weights, or second-guesses it, and there is deliberately no
 *     "desk lean" — no alternative aggregation that could read as a second house
 *     call. Balances are COUNTS, labelled as counts.
 *   - It COMPUTES NOTHING THE DESK ALREADY COMPUTED. Fee, edge, fair value, the
 *     floor test, the score-versus-bar comparison, the WAIT taxonomy, freshness
 *     and the record all come from the existing helpers. A second implementation
 *     of any of them would be a second answer.
 *   - It has NO clock (every "now" is `snap.as_of`), no database, no network, no
 *     writes, and it mutates none of its inputs.
 *
 * FOUR RULES IT INHERITS FROM `floor-clarity.ts` AND KEEPS:
 *   1. A missing number is null, never 0.
 *   2. A number is labelled by WHAT IT IS. Gate confidence is not a probability;
 *      a derived fair value is not a quote; an executable ask is a price.
 *   3. A RAW seat read and a FINAL seat vote are different facts and never merge.
 *   4. Where the frame cannot prove a reason, the fact says "suppressed" rather
 *      than inventing one.
 */
import { CHAIR_NON_VOTER_IDS, RETIRED_SEAT_IDS, SEAT_BY_ID, TAB_SEATS } from "./seats.ts";
import { SPEAK_CONF } from "./math.ts";
import { chairSignalOf } from "./chair-signal.ts";
import { economicsOf, type Economics } from "./economics.ts";
import { bookState, openRow, CHAIR_MIN_ASK_CENTS, type BookState } from "./book-floor.ts";
import {
  chairConfidenceLabel,
  freshness,
  invalidateCondition,
  invalidateLine,
  realAge,
  realCents,
  whyFacts,
  type ConfidenceKind,
  type Freshness,
  type WhyFacts,
} from "./floor-clarity.ts";
import type {
  CallLogRow,
  ChairResult,
  FeedHealth,
  Gate,
  Lean,
  SeatId,
  SeatKnobs,
  SeatRow,
  SeatStatus,
  SeatTab,
  Snapshot,
  Vote,
} from "./types";

const NON_VOTERS = new Set<SeatId>(CHAIR_NON_VOTER_IDS);
const RETIRED = new Set<SeatId>(RETIRED_SEAT_IDS);

/** A number the frame actually carried, or null. Never coerces a missing value to 0. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// 1 — WHERE IS THE MARKET?
// ---------------------------------------------------------------------------

export type MarketPosition = {
  /** Bitcoin spot as the frame last saw it. */
  spot: number | null;
  spot_source: string;
  spot_age_s: number | null;
  /** The contract's line. */
  strike: number | null;
  /** spot − strike, in dollars. Null when either side is unknown. */
  distance: number | null;
  /** Which side of the line spot sits on. "AT LINE" only on an exact match. */
  relation: "ABOVE" | "BELOW" | "AT LINE" | "UNKNOWN";
  /**
   * A VENUE index, not the settlement index.
   *
   * `snap.index_px` on this repo comes from OKX/Binance perpetual
   * infrastructure (`server-feeds.ts` → `deriv.index` / `binancePerp().index`).
   * The contract settles on the CF Benchmarks value, which is a different
   * number from a different feed. Calling this "the settlement index" on screen
   * would be false, so it is named for what it is and the page says so.
   */
  venue_index: number | null;
  /**
   * PERPETUAL-vs-spot basis in basis points, as `snap.basis_bps` carries it.
   * Not settlement-index-vs-spot basis.
   */
  venue_basis_bps: number | null;
  ticker: string;
  close_time: number;
  secs_left: number | null;
  phase: string;
};

export function marketPosition(snap: Snapshot): MarketPosition {
  // Validated first, then measured: a spot of 0 is "we do not know where
  // Bitcoin is", and measuring a distance from it would print a confident
  // eighty-six-thousand-dollar gap below the line.
  const rawSpot = num(snap.spot);
  const rawStrike = num(snap.strike);
  const spot = rawSpot != null && rawSpot > 0 ? rawSpot : null;
  const strike = rawStrike != null && rawStrike > 0 ? rawStrike : null;
  const distance = spot != null && strike != null ? spot - strike : null;
  const venue = num(snap.index_px);
  return {
    spot,
    spot_source: snap.spot_source ?? "",
    spot_age_s: realAge(snap.spot_age_s),
    strike,
    distance,
    relation: distance == null ? "UNKNOWN" : distance > 0 ? "ABOVE" : distance < 0 ? "BELOW" : "AT LINE",
    venue_index: venue != null && venue > 0 ? venue : null,
    venue_basis_bps: num(snap.basis_bps),
    ticker: snap.ticker ?? "",
    close_time: snap.close_time,
    secs_left: num(snap.secs_left),
    phase: snap.phase ?? "",
  };
}

// ---------------------------------------------------------------------------
// 2 — THE MARKET, AND THE MODEL. Two different kinds of number.
// ---------------------------------------------------------------------------

/**
 * How a cents figure may be read. The whole point of carrying this next to the
 * number is that a reader must never have to guess which kind they are looking at.
 */
export type CentsKind =
  /** A price someone is quoting right now. You could trade at it. */
  | "executable"
  /** A value the desk's own model derived. Nobody quoted it. */
  | "derived"
  /** A cost, not a price. */
  | "fee"
  /** A difference between two of the above. */
  | "difference";

export type CentsFact = {
  label: string;
  cents: number | null;
  kind: CentsKind;
  /** What the number is, in one clause. Present even when unavailable. */
  note: string;
  /** Why there is no number. Empty when there is one. */
  unavailable_why: string;
};

export type QuoteFacts = {
  yes_ask: CentsFact;
  no_ask: CentsFact;
  yes_bid: CentsFact;
  no_bid: CentsFact;
  spread: CentsFact;
  /** 100 − (yes ask + no ask): what the two legs leave on the table. */
  leftover: CentsFact;
  /** Resting size on each side, in contracts. Null when unreported — never 0. */
  yes_size: number | null;
  no_size: number | null;
};

/**
 * A cents figure, with the same missing-number rule `floor-clarity` enforces.
 *
 * A PRICE-LIKE number — an executable quote or a derived value in the same unit
 * — must pass `realCents`: 0¢ and 100¢ are not values a position trades at, and
 * rendering either would turn "the model has nothing" into a confident reading.
 * A DIFFERENCE is not price-like: an edge of exactly 0¢ is a real edge, and a
 * negative leftover is a real leftover, so only `null` is missing there.
 */
const cents = (label: string, v: unknown, kind: CentsKind, note: string, why: string): CentsFact => {
  const c = num(v);
  const priceLike = kind === "executable" || kind === "derived";
  const ok = priceLike ? realCents(c) : c != null;
  return { label, cents: ok ? c : null, kind, note, unavailable_why: ok ? "" : why };
};

export function quoteFacts(snap: Snapshot): QuoteFacts {
  return {
    yes_ask: cents("YES ask", snap.yes_ask, "executable", "what YES costs to buy right now", "the book is not showing a quotable YES ask"),
    no_ask: cents("NO ask", snap.no_ask, "executable", "what NO costs to buy right now", "the book is not showing a quotable NO ask"),
    yes_bid: cents("YES bid", snap.yes_bid, "executable", "what YES could be sold at right now", "no quotable YES bid"),
    no_bid: cents("NO bid", snap.no_bid, "executable", "what NO could be sold at right now", "no quotable NO bid"),
    spread: cents("spread", snap.spread_cents, "difference", "distance between the two sides of the book", "the spread is not measurable from this book"),
    leftover: cents("leftover", snap.leftover_cents, "difference", "100¢ minus the two asks — what the pair leaves on the table", "not measurable without both asks"),
    yes_size: num(snap.yes_bid_size),
    no_size: num(snap.no_bid_size),
  };
}

export type ModelFacts = {
  /** The desk's derived YES value. NOT a calibrated probability, and labelled so. */
  fair_yes: CentsFact;
  /**
   * The lab's settlement-rule value for YES, when the lab is lit. A second
   * derived value, carried with its own age so a stale one is visibly stale.
   */
  lab_fair_yes: CentsFact;
  lab_age_s: number | null;
  /** Final-minute settlement prints already locked into the average, 0–60. */
  lab_locked: number | null;
  /** The side being priced, from the Chair's read. Null while it is not leaning. */
  side: "UP" | "DOWN" | null;
  /**
   * The ask the economics are actually measured against.
   *
   * The desk's own `markSide` falls back to the mid when a side carries no
   * quoted ask, so this is not always the quoted ask — and a page that showed
   * "YES ask unavailable" beside a confident edge computed from a mid would be
   * lying by omission. `priced_ask_is_fallback` says which one it is.
   */
  priced_ask: CentsFact;
  priced_ask_is_fallback: boolean;
  /**
   * True only when a REAL quoted ask exists on the side being read.
   *
   * Everything below that describes market economics — the edge, the breakeven
   * rate, the book's floor verdict — is presented only when this holds. An edge
   * measured against the desk's own midpoint is not an edge anyone could take,
   * and printing "fair less the real ask less the fee" beside "ask unavailable"
   * says two contradictory things at once.
   */
  executable: boolean;
  /**
   * The model-versus-mid difference, kept when the quoted ask is missing.
   *
   * Explicitly a DERIVED diagnostic, never actionable economics: it says where
   * the model sits relative to the desk's own midpoint, which is a modelling
   * observation, not a price anyone is offering.
   */
  diagnostic_edge: CentsFact;
  fee: CentsFact;
  /** fair − ask − fee on the side being priced. */
  edge: CentsFact;
  /** (ask + fee) as a percentage: the win rate this price needs to stand still. Null unless executable. */
  breakeven_pct: number | null;
  /**
   * The book's own floor test on that side. NULL when there is no quoted ask:
   * a floor verdict about a midpoint is a verdict about nothing.
   */
  bookable: boolean | null;
  floor_cents: number;
  blocked_why: string | null;
  /** The raw economics box, carried whole so nothing is recomputed downstream. */
  economics: Economics;
};

export function modelFacts(snap: Snapshot, chair: ChairResult): ModelFacts {
  const eco = economicsOf(snap, chair.lean);
  const side = eco.side;
  const labAge = realAge(snap.lab_age_s);
  const labFair = side == null ? null : num(snap.lab_fair_yes);
  const quoted = side == null ? null : num(side === "UP" ? snap.yes_ask : snap.no_ask);
  const fallback =
    side != null && realCents(eco.ask) && !(realCents(quoted) && Math.abs(quoted - eco.ask) < 0.05);
  // Market economics require a market price. Without a quoted ask on the side
  // being read there is nothing executable to describe, whatever the desk's
  // midpoint fallback happens to be worth.
  const executable = side != null && realCents(quoted) && !fallback;
  return {
    fair_yes: cents(
      "model fair YES",
      snap.fair_yes,
      "derived",
      "DERIVED by the desk's model — a value, not a price anyone quoted, and not a calibrated chance of winning",
      "the model has no usable value for this window",
    ),
    lab_fair_yes: {
      label: "lab fair YES",
      cents: labAge == null || labFair == null ? null : labFair,
      kind: "derived",
      note: "DERIVED from the settlement rule against the index — a second model value, not a quote",
      unavailable_why: labFair == null ? "the lab is dark for this window" : labAge == null ? "the lab value carries no usable age" : "",
    },
    lab_age_s: labAge,
    lab_locked: num(snap.lab_locked),
    side,
    priced_ask: {
      label: "priced against",
      cents: side == null || !realCents(eco.ask) ? null : eco.ask,
      kind: fallback ? "derived" : "executable",
      note: fallback
        ? "the desk's mid, because that side carries no quoted ask — the edge below is measured against this, not against a price anyone is offering"
        : "the quoted ask on the side being priced",
      unavailable_why: side == null ? "no side is being priced while the Chair is waiting" : realCents(eco.ask) ? "" : "no usable price on that side",
    },
    priced_ask_is_fallback: fallback,
    executable,
    diagnostic_edge: {
      label: "model vs mid",
      cents: executable || side == null || !realCents(eco.ask) ? null : eco.edge,
      kind: "derived",
      note: "where the model sits against the desk's own midpoint — a modelling observation, not an edge anyone could take",
      unavailable_why: executable ? "a real ask exists, so the edge above is the market one" : side == null ? "no side is being priced" : "no usable value on that side",
    },
    fee: {
      label: "fee",
      cents: side == null ? null : eco.fee,
      kind: "fee",
      note: "the exchange's taker fee at that price, as the desk already worked it out",
      unavailable_why: side == null ? "no side is being priced while the Chair is waiting" : "",
    },
    edge: {
      label: "edge after fee",
      cents: executable ? eco.edge : null,
      kind: "difference",
      note: "model fair minus the real quoted ask minus the fee, on the side the Chair is reading",
      unavailable_why: !executable
        ? side == null
          ? "an edge needs a side; the Chair is waiting"
          : "no real ask on that side, so there is nothing executable to measure an edge against"
        : "",
    },
    breakeven_pct: executable ? eco.breakeven : null,
    // A floor verdict about a midpoint is a verdict about nothing.
    bookable: executable ? eco.bookable : null,
    floor_cents: eco.floor,
    blocked_why: eco.why,
    economics: eco,
  };
}

// ---------------------------------------------------------------------------
// 3 — THE HOUSE CONCLUSION, AND 4 — THE STANDARD IT IS MEASURED AGAINST
// ---------------------------------------------------------------------------

export type ConclusionFacts = {
  lean: Lean;
  /** The Chair's confidence, with its kind and gloss. NEVER formatted as a percentage. */
  confidence: { value: string; kind: ConfidenceKind; gloss: string };
  hypothesis: string;
  /** The Chair's own strongest supporting lines. */
  evidence: string[];
  /** The Chair's own counterevidence. */
  counter: string;
  decision: string;
  size: number;
  size_note: string;
};

export function conclusionFacts(chair: ChairResult): ConclusionFacts {
  return {
    lean: chair.lean,
    confidence: chairConfidenceLabel(chair),
    hypothesis: chair.hypothesis ?? "",
    evidence: Array.isArray(chair.evidence) ? chair.evidence.filter(Boolean) : [],
    counter: chair.counter ?? "",
    decision: chair.decision ?? "",
    size: chair.size,
    size_note: chair.size_note ?? "",
  };
}

/**
 * The distance to the decision standard, taken from the quantity the Chair
 * ACTUALLY compares.
 *
 * chair.ts builds a gate whose id is `bar`, whose label is
 * `|score| × aggressiveness ≥ confluence bar`, and whose pass flag is set by
 * `vsBar >= bar` — with `vsBar = |rawScore| × agg` published on the result as
 * `vs_bar`. So `evidence` here is `chair.vs_bar`, `required` is `chair.bar`, and
 * `met` is read off that gate's own recorded verdict rather than recomputed.
 *
 * `chairSignalOf` is the existing presentation helper for the same comparison and
 * is carried alongside for the marker geometry; `signal_agrees` states whether the
 * two agree on this frame, so a display never has to pick silently.
 */
export type StandardFacts = {
  /** |score| × aggressiveness — the quantity the Chair compares. */
  evidence: number | null;
  /** The confluence bar it must reach. */
  required: number | null;
  /** evidence − required. Positive means cleared. */
  margin: number | null;
  /** The Chair's own recorded verdict on its `bar` gate. */
  met: boolean | null;
  /** The gate's own value string, e.g. "|0.412| × 1.00 = 0.412 vs bar 0.57 (sit 0.35)". */
  gate_value: string;
  /** Raw signed score, for direction. Not the comparison quantity. */
  score: number | null;
  aggressiveness: number | null;
  /**
   * True when a hard gate is ALSO failing, or more than one gate is. While this
   * is true the display must not claim that closing the margin produces a call.
   */
  more_than_one_thing_missing: boolean;
  /** Marker geometry from the existing signal helper, or null when unavailable. */
  signal: ReturnType<typeof chairSignalOf>;
  /** Whether the signal helper and the Chair's own gate agree on this frame. */
  signal_agrees: boolean;
};

export function standardFacts(chair: ChairResult, why: WhyFacts): StandardFacts {
  const gate = chair.gates?.find((g) => g.id === "bar") ?? null;
  const evidence = num(chair.vs_bar);
  const required = num(chair.bar);
  const signal = chairSignalOf({
    score: chair.score,
    bar: chair.bar,
    aggressiveness: chair.aggressiveness,
    lean: chair.lean,
  });
  const met = gate ? gate.pass : null;
  return {
    evidence,
    required,
    margin: evidence != null && required != null ? evidence - required : null,
    met,
    gate_value: gate?.value ?? "",
    score: num(chair.score),
    aggressiveness: num(chair.aggressiveness),
    more_than_one_thing_missing: why.more_than_one_thing_missing,
    signal,
    signal_agrees: signal == null || met == null ? false : signal.met === met,
  };
}

// ---------------------------------------------------------------------------
// 5 — WHY WAIT? Four situations, four remedies, never one grey word.
// ---------------------------------------------------------------------------

export type WaitKind = WhyFacts["wait_reason"];

export type WaitFacts = {
  waiting: boolean;
  /** Exactly what `whyFacts` concluded. Carried unchanged. */
  kind: WaitKind;
  /**
   * The situation the page names, which can differ from `kind` in ONE case.
   *
   * chair.ts publishes the score comparison as a HARD gate with id `bar`, so a
   * purely low-confluence WAIT always has a failing hard gate and `whyFacts`
   * classifies it "hard-gate" — its "under-bar" branch is unreachable in
   * production. Calling that a HARD BLOCK would tell a reader some safety gate
   * tripped when in fact the specialists simply did not agree hard enough.
   *
   * So when the only failing hard gate IS the bar gate, the page says low
   * confluence. That is a naming refinement grounded in the gate's own identity;
   * `kind` above is left exactly as the existing helper computed it, and no
   * decision anywhere is affected.
   */
  display: WaitKind;
  /** A short state name for the headline. Empty when not waiting. */
  headline: string;
  /** One sentence naming the situation, with no remedy implied. */
  explanation: string;
  /** Hard gates that are failing right now. */
  blocking: Gate[];
  /** The data-trust gates among them. */
  feed_gates: Gate[];
  /** The Chair's own WAIT note, when it wrote one. */
  note: string;
  /**
   * True when closing any single gap would still not produce a call. The display
   * must say so rather than implying a single remedy.
   */
  more_than_one_thing_missing: boolean;
};

const WAIT_HEADLINE: Record<Exclude<WaitKind, "">, string> = {
  "feed-condition": "FEED CONDITION",
  "hard-gate": "HARD BLOCK",
  "under-bar": "LOW CONFLUENCE",
  "no-edge": "NO EDGE",
};

const WAIT_EXPLANATION: Record<Exclude<WaitKind, "">, string> = {
  "feed-condition": "The desk does not trust its own inputs on this frame, so nothing downstream of them is acted on.",
  "hard-gate": "A required gate is failing. The evidence is not the thing standing in the way.",
  "under-bar": "The specialists do not agree hard enough for the weighted evidence to clear its own standard.",
  "no-edge": "The gates pass and the evidence clears, and the price still does not pay for the read.",
};

export function waitFacts(chair: ChairResult, why: WhyFacts): WaitFacts {
  const waiting = chair.lean === "WAIT";
  const kind = why.wait_reason;
  const barOnly = why.failed_hard.length > 0 && why.failed_hard.every((g) => g.id === "bar");
  const display: WaitKind = kind === "hard-gate" && barOnly ? "under-bar" : kind;
  return {
    waiting,
    kind,
    display,
    headline: display === "" ? "" : WAIT_HEADLINE[display],
    explanation: display === "" ? "" : WAIT_EXPLANATION[display],
    blocking: why.failed_hard,
    feed_gates: why.feed_gates,
    note: why.wait_note,
    more_than_one_thing_missing: why.more_than_one_thing_missing,
  };
}

// ---------------------------------------------------------------------------
// 6 — WHAT THE DESK SEES. Raw reads and final votes, never conflated.
// ---------------------------------------------------------------------------

/**
 * How a seat's voice reached (or failed to reach) the Chair on this frame.
 * Determined by the same precedence the vote pipeline applies, using only fields
 * the frame carries.
 */
export type SeatVoice =
  /** A directional vote the Chair aggregated. */
  | "speaking"
  /** The seat read a direction and the Chair never heard it. */
  | "suppressed"
  /** The seat itself had no directional read. A real decision, not a gap. */
  | "waiting"
  /** The feed under this seat is stale or down, so it was silenced. */
  | "unhealthy"
  /** Pit crew: WARDEN, ORBIT and WIRE are never aggregated as votes. */
  | "non-voter"
  /** Retired from paper-call votes. */
  | "retired"
  /** Benched by COACH until a future instant. */
  | "benched"
  /** Muted or vetoed on this frame. */
  | "muted";

/** Why a directional read did not reach the Chair. Null when the frame cannot prove one. */
export type SuppressionReason =
  | "below-speak-bar"
  | "retired"
  | "benched"
  | "feed"
  | "muted"
  | "non-voter";

export type SeatFact = {
  seat: SeatId;
  callsign: string;
  family: SeatTab;
  eyes: string;
  /**
   * The seat's OWN read, before the whisper filter. This is what it saw.
   * `conf` here is the untransformed confidence.
   */
  raw_lean: Lean | null;
  raw_conf: number | null;
  /** The vote the Chair actually heard. */
  final_lean: Lean;
  /**
   * The final confidence as recorded. On a forced sit the pipeline rewrites this
   * to `max(70, raw)`, so it is NOT the seat's own reading — `final_conf_transformed`
   * says when that has happened and the display must not present it as a read.
   */
  final_conf: number | null;
  final_conf_transformed: boolean;
  voice: SeatVoice;
  suppression: SuppressionReason | null;
  /**
   * The feed under this seat is STALE, but it spoke anyway.
   *
   * `applyHealth` only silences a DOWN feed. A STALE one keeps its direction and
   * has its confidence multiplied by 0.6, so it can still clear the speaking bar
   * and reach the Chair. Such a seat IS a speaker and must be counted as one —
   * with its warning shown, not with its vote quietly removed.
   */
  health_warning: boolean;
  /** The per-seat speaking bar (52 plus COACH's offset), when the frame carries the knob. */
  speak_bar: number | null;
  /** True when this seat is one of the 18 the Chair aggregates. */
  aggregated: boolean;
  health: FeedHealth;
  status: SeatStatus | null;
  /** Effective weight presented to the Chair, and its signed contribution. */
  weight: number | null;
  contribution: number | null;
  /** The seat's own one-line reasoning. */
  why: string;
  skill_used: string;
  skill_status: string;
};

/**
 * One seat's presentation facts.
 *
 * THE PRECEDENCE IS THE PIPELINE'S, NOT A NEW ONE. `sitUnlessSure` in bots.ts
 * returns early for WARDEN, then handles retired seats, then a COACH bench, then
 * the confidence bar — and `applyHealth` silences a DOWN feed before any of it.
 * Reading those branches in the same order is how "below-speak-bar" is proven by
 * exhaustion: when a seat is force-sat and is not retired, benched, unhealthy or
 * muted, the confidence bar is the only branch left. Where even that cannot be
 * established the reason stays null and the display says "suppressed".
 */
function seatFact(seat: SeatId, vote: Vote | undefined, row: SeatRow | undefined, knobs: Record<string, SeatKnobs> | undefined, asOf: number): SeatFact {
  const meta = SEAT_BY_ID[seat];
  const family = meta.tab;
  const knob = knobs?.[seat];
  const speakBar = knob ? SPEAK_CONF + (num(knob.speak_offset) ?? 0) : SPEAK_CONF;
  const finalLean: Lean = vote?.lean ?? row?.lean ?? "WAIT";
  const finalConf = num(row?.conf ?? vote?.confidence);
  const forced = vote?.forced_sit === true || row?.forced_sit === true;
  /**
   * The seat's own read.
   *
   * The pipeline's own convention is `raw_lean ?? lean` — chair-v2, the openai
   * shadow and council-authority all read it that way — because an ordinary
   * speaker's final vote IS its raw read. Reading only the explicit field left
   * every unsuppressed speaker showing "—" for RAW READ, as though it had never
   * seen anything.
   *
   * The fallback applies ONLY when the vote was not transformed. On a forced sit
   * `lean` was rewritten to WAIT and `confidence` to `max(70, raw)`, so falling
   * back to those would report the transform as the seat's own reading — the
   * exact conflation this column exists to prevent.
   */
  const rawLean = vote?.raw_lean ?? (forced ? null : finalLean);
  const rawConf = num(vote?.raw_conf) ?? (forced ? null : finalConf);
  const health: FeedHealth = vote?.health ?? row?.health ?? "DOWN";
  const status = row?.status ?? null;
  const rawDirectional = rawLean === "UP" || rawLean === "DOWN";
  const benched = knob != null && num(knob.benched_until) != null && knob.benched_until > asOf;

  const speaksNow = finalLean === "UP" || finalLean === "DOWN";

  let voice: SeatVoice;
  let suppression: SuppressionReason | null = null;
  if (NON_VOTERS.has(seat)) {
    voice = "non-voter";
    suppression = rawDirectional ? "non-voter" : null;
  } else if (RETIRED.has(seat)) {
    voice = "retired";
    suppression = rawDirectional ? "retired" : null;
  } else if (speaksNow) {
    // THE FINAL VOTE DECIDES FIRST. A STALE feed does not silence a seat — it
    // only scales its confidence — so a STALE seat that still speaks reached the
    // Chair and is a speaker. Classifying it "unhealthy" here removed a real
    // vote from the family counts while the Chair was still hearing it.
    voice = "speaking";
  } else if (health === "DOWN" || health === "STALE") {
    voice = "unhealthy";
    suppression = rawDirectional ? "feed" : null;
  } else if (status === "MUTED" || status === "VETO") {
    voice = "muted";
    suppression = rawDirectional && finalLean === "WAIT" ? "muted" : null;
  } else if (forced && benched) {
    voice = "benched";
    suppression = "benched";
  } else if (forced && rawDirectional) {
    voice = "suppressed";
    // Every earlier branch of the filter is excluded above, so the confidence bar
    // is the only one left — but only claim it when the numbers actually show it.
    suppression = rawConf != null && rawConf < speakBar ? "below-speak-bar" : null;
  } else {
    voice = "waiting";
  }

  return {
    seat,
    callsign: meta.callsign,
    family,
    eyes: meta.eyes,
    raw_lean: rawLean,
    raw_conf: rawConf,
    final_lean: finalLean,
    final_conf: finalConf,
    final_conf_transformed: forced,
    voice,
    suppression,
    health_warning: health === "STALE",
    speak_bar: knob || vote ? speakBar : null,
    aggregated: row != null,
    health,
    status,
    weight: num(row?.weight),
    contribution: num(row?.contribution),
    why: vote?.reasoning ?? row?.why ?? "",
    skill_used: vote?.skill_used ?? row?.skill_used ?? "",
    skill_status: String(vote?.skill_status ?? ""),
  };
}

/** Every seat on the Council, in the repo's own family order. All 21. */
export function seatFacts(chair: ChairResult, votes: readonly Vote[], knobs: Record<string, SeatKnobs> | undefined, asOf: number): SeatFact[] {
  const voteBy = new Map<SeatId, Vote>(votes.map((v) => [v.seat, v]));
  const rowBy = new Map<SeatId, SeatRow>((chair.rows ?? []).map((r) => [r.seat, r]));
  const out: SeatFact[] = [];
  for (const family of Object.keys(TAB_SEATS) as SeatTab[]) {
    for (const seat of TAB_SEATS[family]) out.push(seatFact(seat, voteBy.get(seat), rowBy.get(seat), knobs, asOf));
  }
  return out;
}

export type FamilyFacts = {
  family: SeatTab;
  label: string;
  /** What this family looks at, in a few words. */
  eyes: string;
  seats: SeatFact[];
  /** Final votes the Chair heard from this family. */
  up: number;
  down: number;
  wait: number;
  /** Directional raw reads from this family that never reached the Chair. */
  suppressed_up: number;
  suppressed_down: number;
  /** Seats their own feed actually silenced. */
  unhealthy: number;
  /** Seats that spoke anyway on a STALE feed — counted as speakers, flagged as warnings. */
  stale_speakers: number;
  /** True when this family has speakers on both sides at once. */
  split: boolean;
};

const FAMILY_LABEL: Record<SeatTab, string> = {
  structure: "STRUCTURE",
  tape: "TAPE",
  derivs: "DERIVS",
  book: "BOOK",
  context: "CONTEXT",
};

const FAMILY_EYES: Record<SeatTab, string> = {
  structure: "candles and swings",
  tape: "order flow and the book",
  derivs: "funding, open interest, liquidations",
  book: "the odds themselves",
  context: "clock, regime and feed health",
};

export function familyFacts(facts: readonly SeatFact[]): FamilyFacts[] {
  return (Object.keys(TAB_SEATS) as SeatTab[]).map((family) => {
    const seats = facts.filter((f) => f.family === family);
    const up = seats.filter((s) => s.voice === "speaking" && s.final_lean === "UP").length;
    const down = seats.filter((s) => s.voice === "speaking" && s.final_lean === "DOWN").length;
    return {
      family,
      label: FAMILY_LABEL[family],
      eyes: FAMILY_EYES[family],
      seats,
      up,
      down,
      wait: seats.length - up - down,
      suppressed_up: seats.filter((s) => s.voice !== "speaking" && s.raw_lean === "UP").length,
      suppressed_down: seats.filter((s) => s.voice !== "speaking" && s.raw_lean === "DOWN").length,
      unhealthy: seats.filter((s) => s.voice === "unhealthy").length,
      stale_speakers: seats.filter((s) => s.voice === "speaking" && s.health_warning).length,
      split: up > 0 && down > 0,
    };
  });
}

/**
 * Factual balances. NOT a call, and deliberately not weighted.
 *
 * There is no second aggregation here on purpose: applying any weighting of our
 * own would produce an undocumented house opinion competing with the Chair's. The
 * speaking counts are the Chair's OWN quorum; the suppressed counts are a plain
 * tally of directional raw reads that never reached it.
 */
export type BalanceFacts = {
  /** The Chair's own quorum over the seats it aggregates. */
  speaking: { up: number; down: number; wait: number };
  /** Directional raw reads that did not become votes, tallied by direction. */
  suppressed: { up: number; down: number };
  /** Families with speakers on both sides at once. */
  split_families: number;
  /** Seats silenced by their own feed. */
  unhealthy: number;
  /** How many of the 21 the Chair aggregates on this frame. */
  aggregated: number;
  /** Always the same words: this is a count, never a recommendation. */
  label: "Evidence balance";
  disclaimer: string;
};

export function balanceFacts(chair: ChairResult, facts: readonly SeatFact[], families: readonly FamilyFacts[]): BalanceFacts {
  return {
    speaking: chair.quorum ?? { up: 0, down: 0, wait: 0 },
    suppressed: {
      up: facts.filter((f) => f.voice !== "speaking" && f.raw_lean === "UP").length,
      down: facts.filter((f) => f.voice !== "speaking" && f.raw_lean === "DOWN").length,
    },
    split_families: families.filter((f) => f.split).length,
    unhealthy: facts.filter((f) => f.voice === "unhealthy").length,
    aggregated: facts.filter((f) => f.aggregated).length,
    label: "Evidence balance",
    disclaimer:
      "A count of what the specialists read, not a second opinion. SATOSHI is the only conclusion this desk draws.",
  };
}

// ---------------------------------------------------------------------------
// 7 — GATES, 8 — INVALIDATION, 9 — DATA HEALTH, 10 — THE PAPER BOOK
// ---------------------------------------------------------------------------

export type GateFacts = {
  /** Hard gates failing now: a call cannot happen while any of these fail. */
  blocking: Gate[];
  /** Soft gates failing now: they tax the bar, they do not block. */
  soft_failing: Gate[];
  /** Gates that pass, so the summary can show what is clear as well as what is not. */
  passing: Gate[];
  all: Gate[];
  /** The `bar` gate specifically, because it carries the score comparison. */
  bar_gate: Gate | null;
};

export function gateFacts(chair: ChairResult): GateFacts {
  const all = Array.isArray(chair.gates) ? chair.gates : [];
  return {
    blocking: all.filter((g) => g.hard && !g.pass),
    soft_failing: all.filter((g) => !g.hard && !g.pass),
    passing: all.filter((g) => g.pass),
    all,
    bar_gate: all.find((g) => g.id === "bar") ?? null,
  };
}

/**
 * What would END the current read.
 *
 * This is never reversed into an entry trigger. `invalidate_if` says when a read
 * stops being valid; reading it backwards ("so enter when the opposite holds")
 * would turn an exit condition into a recommendation, which this desk does not make.
 */
export type InvalidationFacts = {
  condition: string;
  line: string;
  available: boolean;
};

export function invalidationFacts(why: WhyFacts): InvalidationFacts {
  const condition = invalidateCondition(why.invalidate_if);
  return { condition, line: invalidateLine(why), available: condition.length > 0 };
}

export type HealthFacts = {
  /** The existing freshness read, carried whole. */
  fresh: Freshness;
  spot: FeedHealth;
  kalshi: FeedHealth;
  derivs: FeedHealth;
  derivs_source: string;
  spot_divergent: boolean;
  basis_wide: boolean;
  /** Seconds since the spot feed last answered, or null when unmeasurable. */
  spot_age_s: number | null;
  /** Operational tags from the pit crew, as the Chair published them. */
  pit_tags: string[];
  /**
   * True only when EVERY condition this card displays is clear.
   *
   * It used to check spot, Kalshi and the sequence while the same card showed
   * derivatives as a desk feed and the index-vs-spot warnings underneath — so it
   * could read ALL CLEAR with DERIVS DOWN and the basis flagged wide. A badge
   * that contradicts the rows beneath it is worse than no badge.
   */
  all_clear: boolean;
  /**
   * Exactly what is not clear, in the card's own words. Empty when `all_clear`.
   * The badge is never vague: if it is not clear, this says why.
   */
  blockers: string[];
};

export function healthFacts(snap: Snapshot, chair: ChairResult): HealthFacts {
  const fresh = freshness(snap);
  const h = snap.health;
  // One list, built from the same conditions the card renders, so the badge and
  // the rows can never disagree.
  const blockers: string[] = [];
  const feed = (label: string, state: FeedHealth | undefined) => {
    if (state !== "LIVE") blockers.push(`${label} ${state ?? "DOWN"}`);
  };
  feed("spot", h?.spot);
  feed("kalshi", h?.kalshi);
  feed("derivs", h?.derivs);
  if (fresh.gap !== "ok") blockers.push(`sequence ${fresh.gap}`);
  if (h?.spot_divergent === true) blockers.push("spot sources diverge");
  if (h?.basis_wide === true) blockers.push("basis wide");
  return {
    fresh,
    spot: h?.spot ?? "DOWN",
    kalshi: h?.kalshi ?? "DOWN",
    derivs: h?.derivs ?? "DOWN",
    derivs_source: h?.derivs_source ?? "",
    spot_divergent: h?.spot_divergent === true,
    basis_wide: h?.basis_wide === true,
    spot_age_s: realAge(snap.spot_age_s),
    pit_tags: Array.isArray(chair.pit_tags) ? chair.pit_tags : [],
    all_clear: blockers.length === 0,
    blockers,
  };
}

/**
 * The paper book, kept visibly separate from the live opinion.
 *
 * A reader must never conclude "SATOSHI says UP" means "the book is long". The
 * book has its own floor and its own timing, and this states which of the two is
 * true right now without reconciling them.
 */
export type PaperFacts = {
  state: BookState;
  /** Whether a paper position is actually held on this window. */
  held: boolean;
  /** The price it was locked at, from the recorded fill. Null when nothing is held. */
  entry_cents: number | null;
  /** When it was locked. Null when unrecorded. */
  entry_at: number | null;
  /** The side held, which need not be the Chair's current read. */
  entry_side: "UP" | "DOWN" | null;
  /** That side's ask right now. */
  ask_now: number | null;
  /** Why there is no position, when there is none. */
  no_position_why: string;
  floor_cents: number;
};

export function paperFacts(snap: Snapshot, chair: ChairResult, callLog: readonly CallLogRow[]): PaperFacts {
  const log = [...callLog];
  const state = bookState(snap, chair.lean, log);
  const open = openRow(snap, log);
  const held = state.kind === "booked";
  return {
    state,
    held,
    entry_cents: held && realCents(state.cents) ? state.cents : null,
    entry_at: open && open.t > 0 ? open.t : null,
    entry_side: held ? state.lean : null,
    ask_now: state.kind === "wait" ? null : realCents(state.ask) ? state.ask : null,
    no_position_why: held
      ? ""
      : state.kind === "wait"
        ? "no position: the Chair is waiting"
        : state.kind === "floor"
          ? `no position: that side is under the ${CHAIR_MIN_ASK_CENTS}¢ paper floor`
          : "the read stands at or above the floor; the book has not recorded a position yet",
    floor_cents: CHAIR_MIN_ASK_CENTS,
  };
}

// ---------------------------------------------------------------------------
// The whole board, in one pure call.
// ---------------------------------------------------------------------------

export type ProFloorFacts = {
  market: MarketPosition;
  quotes: QuoteFacts;
  model: ModelFacts;
  conclusion: ConclusionFacts;
  standard: StandardFacts;
  wait: WaitFacts;
  seats: SeatFact[];
  families: FamilyFacts[];
  balance: BalanceFacts;
  gates: GateFacts;
  invalidation: InvalidationFacts;
  health: HealthFacts;
  paper: PaperFacts;
  /** The frame instant these facts describe. Not a clock — the snapshot's own stamp. */
  as_of: number;
};

/**
 * Build every Pro Floor fact from one frame.
 *
 * `plain` is the Chair's plain-language line, passed in by the caller so this
 * module never imports the phrasing layer. `knobs` is the learner's per-seat knob
 * map, read only to name the speaking bar and a COACH bench.
 */
export function proFloorFacts(input: {
  snap: Snapshot;
  chair: ChairResult;
  votes: readonly Vote[];
  callLog: readonly CallLogRow[];
  knobs?: Record<string, SeatKnobs>;
  plain?: string;
}): ProFloorFacts {
  const { snap, chair, votes, callLog } = input;
  const why = whyFacts(chair, input.plain ?? "");
  const seats = seatFacts(chair, votes, input.knobs, snap.as_of);
  const families = familyFacts(seats);
  return {
    market: marketPosition(snap),
    quotes: quoteFacts(snap),
    model: modelFacts(snap, chair),
    conclusion: conclusionFacts(chair),
    standard: standardFacts(chair, why),
    wait: waitFacts(chair, why),
    seats,
    families,
    balance: balanceFacts(chair, seats, families),
    gates: gateFacts(chair),
    invalidation: invalidationFacts(why),
    health: healthFacts(snap, chair),
    paper: paperFacts(snap, chair, callLog),
    as_of: snap.as_of,
  };
}

// ---------------------------------------------------------------------------
// Formatters — one implementation each, so two surfaces cannot disagree.
// ---------------------------------------------------------------------------

/** Cents, or an em dash. Never "0¢" for a missing number. */
export function fmtCentsFact(f: CentsFact): string {
  return f.cents == null ? "—" : `${f.cents.toFixed(1)}¢`;
}

/** A signed difference in cents, or an em dash. */
export function fmtSigned(f: CentsFact): string {
  return f.cents == null ? "—" : `${f.cents >= 0 ? "+" : ""}${f.cents.toFixed(1)}¢`;
}

/** Whole dollars with separators, or an em dash. */
export function fmtUsd(n: number | null): string {
  return n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
}

/** A signed dollar distance, using a true minus sign. */
export function fmtDistance(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

/** A score-scale number at the Chair's own precision, or an em dash. */
export function fmtScore(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}

/** The words for a seat's voice, for a screen reader and for a reader without colour. */
export const VOICE_LABEL: Readonly<Record<SeatVoice, string>> = Object.freeze({
  speaking: "speaking",
  suppressed: "suppressed",
  waiting: "no directional read",
  unhealthy: "feed unhealthy",
  "non-voter": "pit crew · non-voter",
  retired: "retired from votes",
  benched: "benched",
  muted: "muted",
});

/** The words for why a directional read did not reach the Chair. */
export const SUPPRESSION_LABEL: Readonly<Record<SuppressionReason, string>> = Object.freeze({
  "below-speak-bar": "below its speaking bar",
  retired: "seat retired from paper-call votes",
  benched: "benched by COACH",
  feed: "its feed is not healthy",
  muted: "muted on this frame",
  "non-voter": "pit crew — never aggregated as a vote",
});
