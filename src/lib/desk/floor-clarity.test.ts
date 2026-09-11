import assert from "node:assert/strict";
import test from "node:test";
import {
  AGE_UNKNOWN_SENTINEL,
  chairConfidenceLabel,
  CONFIDENCE_GLOSS,
  DISPLAY_KINDS,
  displayedPriceFacts,
  FEED_GATE_IDS,
  floorLine,
  fmtContracts,
  freshness,
  invalidateCondition,
  invalidateLine,
  priceFacts,
  realAge,
  recordCard,
  realCents,
  sameEvent,
  whyFacts,
} from "./floor-clarity.ts";
import { CHAIR_MIN_ASK_CENTS, FLOOR_SHADOW_CENTS, type BookState } from "./book-floor.ts";
import type { ChairResult, Gate, Snapshot } from "./types";

const T0 = Date.parse("2026-09-11T17:05:00Z");

/** Only the fields the helper reads. Anything it touches beyond these is a bug. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    as_of: T0,
    yes_ask: 65,
    no_ask: 37,
    yes_bid: 63,
    no_bid: 35,
    fair_yes: 52,
    quote_age_s: 4,
    health: { kalshi: "LIVE" },
    obs: { last_ok_ts: T0 - 2_000, gap: "ok" },
    ...over,
  } as unknown as Snapshot;
}

function chair(over: Partial<ChairResult> = {}): ChairResult {
  return {
    lean: "UP",
    confidence: 76,
    score: 3,
    bar: 2,
    gates: [],
    hypothesis: "spot is holding above the strike",
    evidence: ["TAPE: buyers lifting", "CHAIN: funding flat"],
    counter: "the move is thin on volume",
    invalidate_if: "spot loses the strike with under four minutes left",
    wait_note: "",
    quorum: { up: 9, down: 3, wait: 9 },
    ...over,
  } as unknown as ChairResult;
}

const booked: BookState = { kind: "booked", lean: "UP", cents: 82, ask: 88 };
const waiting: BookState = { kind: "wait" };
const floored: BookState = { kind: "floor", lean: "UP", ask: 65 };
const filling: BookState = { kind: "filling", lean: "UP", ask: 88 };

const by = (facts: ReturnType<typeof priceFacts>, k: string) => facts.find((f) => f.kind === k)!;

// ---------------------------------------------------------------------------
// Rule 1 — a missing number is null, never zero; a legitimate zero survives.
// ---------------------------------------------------------------------------

test("realCents rejects the prices that are not prices, and keeps the ones that are", () => {
  for (const bad of [0, 100, -1, 101, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "65"]) {
    assert.equal(realCents(bad), false, `${String(bad)} is not a tradeable price`);
  }
  for (const good of [0.5, 1, 50, 65.5, 99.9]) {
    assert.equal(realCents(good), true, `${good} is a tradeable price`);
  }
});

test("realAge treats 999 as the unknown sentinel it is, not as 999 seconds", () => {
  // server-feeds.ts:283 and live.ts:47,68 all use 999 to mean "no quote clock".
  assert.equal(realAge(AGE_UNKNOWN_SENTINEL), null);
  assert.equal(realAge(1000), null, "anything at or past the sentinel is unknown");
  // A real measured age survives, INCLUDING zero: a book that just moved is 0s old.
  assert.equal(realAge(0), 0, "a legitimate zero is preserved");
  assert.equal(realAge(4), 4);
  assert.equal(realAge(998), 998);
  assert.equal(realAge(-1), null);
  assert.equal(realAge(Number.NaN), null);
});

test("an unavailable price is null with a stated reason, never rendered as 0", () => {
  const facts = priceFacts(snap({ fair_yes: 0 }), chair({ lean: "WAIT" }), waiting);
  const fair = by(facts, "fair");
  assert.equal(fair.cents, null, "a 0 fair value is not a fair value");
  assert.ok(fair.unavailable_why.length > 0, "and it must say why");
  const entry = by(facts, "entry");
  assert.equal(entry.cents, null);
  assert.match(entry.unavailable_why, /waiting/);
  // Every fact is still present — a row that vanished would be indistinguishable
  // from a row that does not apply.
  assert.equal(facts.length, 4);
  for (const f of facts) assert.ok(f.note.length > 0, `${f.kind} must always say what it is`);
});

// ---------------------------------------------------------------------------
// Rule 2 — a later quote never stands in for a historical fact.
// ---------------------------------------------------------------------------

test("the locked paper entry keeps its own price and time, never the current ask", () => {
  const fill = { t: T0 - 240_000, cents: 82 };
  const facts = priceFacts(snap(), chair(), booked, fill);
  const entry = by(facts, "entry");
  const market = by(facts, "market");

  assert.equal(entry.cents, 82, "the recorded fill price");
  assert.equal(entry.at, T0 - 240_000, "and the moment it was recorded");
  assert.equal(market.cents, 88, "the ask has since moved to 88");
  assert.notEqual(entry.cents, market.cents, "they must not be reconciled to match");
  assert.notEqual(entry.at, market.at, "the entry is four minutes older than the quote");
});

test("a locked paper entry is NOT a decision snapshot, even though it is frozen", () => {
  // noteCall (server-engine.ts) returns early when !bookable(cents): "the read stands on
  // screen, the fill waits ... a later tick at the floor can still fill this window". So
  // the recorded instant is the FILL's and can be minutes after the read. Frozen is not
  // the same as being the decision, and nothing on the frame records decision-time market
  // state — so that label stays unavailable while the entry is shown as the entry.
  const fill = { t: T0 - 240_000, cents: 82 };
  const facts = priceFacts(snap(), chair(), booked, fill);
  const decision = by(facts, "decision");
  const entry = by(facts, "entry");

  assert.equal(decision.cents, null, "no decision price is recorded anywhere");
  assert.equal(decision.at, null, "and no decision instant either");
  assert.match(decision.unavailable_why, /the price the book PAID/);
  assert.match(decision.unavailable_why, /minutes apart/);

  // The entry keeps its own frozen facts, shown as the entry.
  assert.equal(entry.cents, 82);
  assert.equal(entry.at, T0 - 240_000);
  // And the two are never presented as one event.
  assert.equal(sameEvent(decision, entry), false);
});

test("an unbooked window has NO decision snapshot, and says so rather than showing a quote", () => {
  // The rule: if no frozen decision price exists for a state, show unavailable — never
  // a current quote under a historical label. Nothing in the frame freezes a decision
  // price for a window the book did not take (callLog holds fills only; every snap.*
  // price is live), so all three unbooked states must be unavailable.
  for (const book of [filling, floored, waiting]) {
    const facts = priceFacts(snap(), chair(book === waiting ? { lean: "WAIT" } : {}), book);
    const decision = by(facts, "decision");
    const market = by(facts, "market");
    assert.equal(decision.cents, null, `${book.kind}: no frozen price exists`);
    assert.equal(decision.at, null, "and no frozen instant either");
    assert.match(decision.unavailable_why, /not recorded/);
    // Critically: it must NOT have borrowed the live ask.
    if (market.cents != null) {
      assert.notEqual(decision.cents, market.cents, "a live quote must not stand in");
    }
    assert.equal(sameEvent(decision, market), false);
  }
});

test("the decision snapshot is unavailable in EVERY state, with the same reason", () => {
  // There is no state in which the desk records decision-time market data, so there is
  // no state in which this label carries a number.
  const fill = { t: T0 - 300_000, cents: 82 };
  for (const [book, f] of [
    [booked, fill],
    [filling, null],
    [floored, null],
    [waiting, null],
  ] as const) {
    const d = by(priceFacts(snap(), chair(book === waiting ? { lean: "WAIT" } : {}), book, f), "decision");
    assert.equal(d.cents, null, `${book.kind}: no decision price`);
    assert.equal(d.at, null, `${book.kind}: no decision instant`);
    assert.match(d.unavailable_why, /not recorded/);
  }
});

test("a booked window with an unusable recorded price shows no entry, and no ask in its place", () => {
  const odd = { kind: "booked", lean: "UP", cents: 0, ask: 88 } as typeof booked;
  const entry = by(priceFacts(snap(), chair(), odd, { t: T0 - 1, cents: 0 }), "entry");
  assert.equal(entry.cents, null, "0c is not a recorded price");
  assert.match(entry.unavailable_why, /no usable price/);
  assert.notEqual(entry.cents, 88, "the live ask must not stand in for the entry");
});

test("a booked window prices the HELD side even after the read moves", () => {
  // One position per window: the book does not re-side when the Chair changes its
  // mind, so the market row must follow the position, not the new lean.
  const facts = priceFacts(snap(), chair({ lean: "DOWN" }), booked, { t: T0 - 1, cents: 82 });
  assert.match(by(facts, "market").note, /YES/, "still pricing the side actually held");
  assert.equal(by(facts, "entry").cents, 82);
});

test("fair value is labelled DERIVED every time, because it is not a quote", () => {
  for (const book of [booked, waiting, floored, filling]) {
    const fair = by(priceFacts(snap(), chair(), book), "fair");
    assert.match(fair.note, /DERIVED/, "it shares a unit with a price but is not one");
  }
});

test("the 52-beside-65 failure cannot happen: both numbers carry their kind", () => {
  // The brief's explicit failure condition. fair 52 and ask 65 are both present;
  // each says what it is, and they are never presented as the same kind of thing.
  const facts = priceFacts(snap({ fair_yes: 52, yes_ask: 65 }), chair(), floored);
  const fair = by(facts, "fair");
  const market = by(facts, "market");
  assert.equal(fair.cents, 52);
  assert.equal(market.cents, 65);
  assert.notEqual(fair.label, market.label);
  assert.notEqual(fair.note, market.note);
  assert.equal(sameEvent(fair, market), false, "different numbers, so not one event");
});

test("the floor blocks a fill without hiding that the read still stands", () => {
  const facts = priceFacts(snap(), chair(), floored);
  assert.equal(by(facts, "market").cents, 65, "the ask is real and shown");
  const entry = by(facts, "entry");
  assert.equal(entry.cents, null, "but nothing is locked");
  assert.match(entry.unavailable_why, new RegExp(`${CHAIR_MIN_ASK_CENTS}¢ floor`));
});

// ---------------------------------------------------------------------------
// Rule 3 — receipt time is not source time, and source time is unavailable.
// ---------------------------------------------------------------------------

test("freshness reports a RECEIPT age and refuses to call it the quote's own time", () => {
  const f = freshness(snap({ obs: { last_ok_ts: T0 - 3_000, gap: "ok" } } as Partial<Snapshot>));
  assert.equal(f.receipt_age_s, 3);
  assert.equal(f.source_time_available, false);
  assert.match(f.note, /receipt, not the exchange's own stamp/);
  assert.match(f.note, /not available from this feed/);
});

test("source time is unavailable because provider_ts is misnamed — stated, not implied", () => {
  // live.ts:194 assigns obs.provider_ts = quote_ts, the last-CHANGE clock. So even a
  // populated provider_ts must not be read as the exchange's stamp.
  const f = freshness(
    snap({ obs: { last_ok_ts: T0 - 1_000, gap: "ok", provider_ts: T0 - 500 } } as Partial<Snapshot>),
  );
  assert.equal(f.source_time_available, false, "a populated provider_ts changes nothing");
});

test("time-since-last-change is reported as movement, never as staleness", () => {
  const quiet = freshness(snap({ quote_age_s: 140 }));
  assert.equal(quiet.last_change_age_s, 140);
  assert.match(quiet.note, /the book last moved 140s ago/);
  // A quiet market is not a broken feed: the feed verdict is independent.
  assert.equal(quiet.feed, "LIVE");
});

test("an unknown quote clock reads as unknown, not as 999 seconds old", () => {
  const f = freshness(snap({ quote_age_s: AGE_UNKNOWN_SENTINEL }));
  assert.equal(f.last_change_age_s, null);
  assert.match(f.note, /unknown/);
  assert.doesNotMatch(f.note, /999/, "the sentinel must never reach a reader");
});

test("a missing receipt clock says so rather than reading as zero age", () => {
  const f = freshness(snap({ obs: { last_ok_ts: 0, gap: "ok" } } as Partial<Snapshot>));
  assert.equal(f.receipt_age_s, null);
  assert.match(f.note, /no receipt time recorded/);
});

test("the feed's own verdict and the continuity flag are passed through", () => {
  assert.equal(freshness(snap({ health: { kalshi: "STALE" } } as Partial<Snapshot>)).feed, "STALE");
  assert.equal(freshness(snap({ health: { kalshi: "DOWN" } } as Partial<Snapshot>)).feed, "DOWN");
  assert.equal(
    freshness(snap({ obs: { last_ok_ts: T0 - 1, gap: "reconnect" } } as Partial<Snapshot>)).gap,
    "reconnect",
  );
  // An unreadable health value fails closed, not open.
  assert.equal(freshness(snap({ health: {} } as Partial<Snapshot>)).feed, "DOWN");
});

// ---------------------------------------------------------------------------
// WHY — recorded fields only, and no over-claiming.
// ---------------------------------------------------------------------------

const hardFail: Gate = { id: "feeds", label: "feeds live", pass: false, hard: true, value: "STALE" };
const hardFail2: Gate = { id: "quorum", label: "quorum", pass: false, hard: true, value: "8/21" };
const softFail: Gate = { id: "spread", label: "spread", pass: false, hard: false, value: "4¢" };

test("whyFacts passes recorded fields through and invents nothing", () => {
  const c = chair();
  const w = whyFacts(c, "Spot is holding over the strike and the seats agree.");
  assert.equal(w.hypothesis, c.hypothesis);
  assert.deepEqual(w.evidence, c.evidence);
  assert.equal(w.counter, c.counter);
  assert.equal(w.invalidate_if, c.invalidate_if);
  assert.deepEqual(w.quorum, c.quorum);
  assert.equal(w.plain, "Spot is holding over the strike and the seats agree.");
});

test("wait_note appears only while waiting", () => {
  const note = "two seats are gagged on a frozen tape";
  assert.equal(whyFacts(chair({ lean: "WAIT", wait_note: note }), "").wait_note, note);
  assert.equal(whyFacts(chair({ lean: "UP", wait_note: note }), "").wait_note, "", "not while calling");
});

test("the WAIT reason distinguishes a failed gate from a thin score", () => {
  // A hard gate is the binding constraint wherever one fails.
  assert.equal(
    whyFacts(chair({ lean: "WAIT", gates: [hardFail], score: 3, bar: 2 }), "").wait_reason,
    "hard-gate",
  );
  // No gate fails and the score is short: a different answer, and a different remedy.
  assert.equal(
    whyFacts(chair({ lean: "WAIT", gates: [softFail], score: 1, bar: 2 }), "").wait_reason,
    "under-bar",
  );
  // Nothing failing and the bar cleared, yet still no call: legitimate abstention.
  assert.equal(
    whyFacts(chair({ lean: "WAIT", gates: [], score: 3, bar: 2 }), "").wait_reason,
    "no-edge",
  );
  // Calling: no wait reason at all.
  assert.equal(whyFacts(chair({ lean: "UP" }), "").wait_reason, "");
});

test("it never implies that clearing one gate produces a call", () => {
  // Two hard gates failing: naming one would be incomplete.
  const two = whyFacts(chair({ lean: "WAIT", gates: [hardFail, hardFail2], score: 3, bar: 2 }), "");
  assert.equal(two.more_than_one_thing_missing, true);
  // One gate failing AND the score short: also more than one thing.
  const gateAndBar = whyFacts(chair({ lean: "WAIT", gates: [hardFail], score: 1, bar: 2 }), "");
  assert.equal(gateAndBar.more_than_one_thing_missing, true);
  // Exactly one gate, score otherwise clear: the only case where one thing is missing.
  const one = whyFacts(chair({ lean: "WAIT", gates: [hardFail], score: 3, bar: 2 }), "");
  assert.equal(one.more_than_one_thing_missing, false);
  assert.equal(one.failed_hard.length, 1);
});

test("soft gates are not counted as blocking", () => {
  const w = whyFacts(chair({ lean: "WAIT", gates: [softFail], score: 1, bar: 2 }), "");
  assert.equal(w.failed_hard.length, 0, "a soft gate does not block a call");
  assert.equal(w.gates.length, 1, "but it is still available for the disclosure");
});

test("invalidate_if is only ever phrased as an exit, never as an entry trigger", () => {
  const w = whyFacts(chair(), "");
  const line = invalidateLine(w);
  assert.match(line, /^The read is off if /, "it says what ENDS the read");
  assert.doesNotMatch(line, /enter|buy|trigger|fill|call if/i, "and never what would start one");
  assert.equal(invalidateLine(whyFacts(chair({ invalidate_if: "" }), "")), "", "absent when unrecorded");
});

test("the sentence never doubles the word 'if' — the stored value already starts with it", () => {
  // This shipped to the live Floor as "The read is off if if Quiet-vol floor ... stays
  // failed" and was caught by a rendered capture, NOT by a test: the old fixture used a
  // condition without the leading word, so it never exercised the real shape. These are
  // the ACTUAL return values of chair.ts's invalidatePrint, every one of which begins
  // with "if".
  const real = [
    "if combined ask prints below 98¢ (stale leftover)",
    "if both sides have no edge vs ask after fee",
    "if book goes chalk (YES or NO ≥ 99¢)",
    "if quote age > 25s",
    "if clock prints ≤ 2.2m left",
    "if spot reprints through strike",
    "if YES mid rips +8¢ in 60s",
    "if Quiet-vol floor stays failed",
    "if top-3 stay in conflict",
    "if |score|×agg drops under the bar",
  ];
  for (const v of real) {
    const line = invalidateLine(whyFacts(chair({ invalidate_if: v }), ""));
    assert.doesNotMatch(line, /\bif\s+if\b/i, `doubled "if" for: ${v}`);
    assert.equal(line.toLowerCase().split(/\bif\b/).length - 1, 1, `exactly one "if" for: ${v}`);
    assert.match(line, /^The read is off if \S/, `reads naturally for: ${v}`);
    // The condition itself survives intact, minus only the joining word.
    assert.ok(line.endsWith(v.replace(/^if\s+/i, "")), `condition altered for: ${v}`);
  }
});

test("a condition that does NOT start with 'if' still reads as one sentence", () => {
  // Stripping the prefix instead of the leading word would produce "The read is off
  // spot loses the strike". Normalising both shapes is the only version safe either way.
  const line = invalidateLine(whyFacts(chair({ invalidate_if: "spot loses the strike" }), ""));
  assert.equal(line, "The read is off if spot loses the strike");
});

test("casing and stray whitespace in the stored condition cannot reintroduce the double", () => {
  for (const v of ["If quote age > 25s", "IF quote age > 25s", "  if   quote age > 25s  "]) {
    const line = invalidateLine(whyFacts(chair({ invalidate_if: v }), ""));
    assert.doesNotMatch(line, /\bif\s+if\b/i, `doubled for: ${JSON.stringify(v)}`);
    assert.match(line, /^The read is off if quote age > 25s$/, `normalised: ${JSON.stringify(v)}`);
  }
  // A bare "if" with nothing after it has no condition to state.
  assert.equal(invalidateLine(whyFacts(chair({ invalidate_if: "if" }), "")), "");
  assert.equal(invalidateLine(whyFacts(chair({ invalidate_if: "   " }), "")), "");
});

test("an 'if' later in the condition is left exactly where it is", () => {
  const line = invalidateLine(whyFacts(chair({ invalidate_if: "if spot stalls, even if volume lifts" }), ""));
  assert.equal(line, "The read is off if spot stalls, even if volume lifts");
});

// ---------------------------------------------------------------------------
// CONFIDENCE — four quantities, four names.
// ---------------------------------------------------------------------------

test("the Chair's confidence is labelled a gate number, never a probability", () => {
  const c = chairConfidenceLabel(chair({ confidence: 76 }));
  assert.equal(c.value, "76");
  assert.equal(c.kind, "gate-confidence");
  // The failure mode, excluded explicitly: "76 conf" must not read as "76% chance".
  assert.doesNotMatch(c.value, /%/, "no percent sign on a number that is not a percentage");
  assert.match(c.gloss, /not a chance of winning/);
});

test("an unreadable confidence is a dash, not a zero", () => {
  assert.equal(chairConfidenceLabel(chair({ confidence: Number.NaN })).value, "—");
});

test("the four confidence kinds have four distinct glosses", () => {
  const kinds = Object.keys(CONFIDENCE_GLOSS);
  assert.equal(kinds.length, 4);
  assert.equal(new Set(Object.values(CONFIDENCE_GLOSS)).size, 4, "no two may read alike");
  // Only the calibrated one may be described as a chance.
  for (const [k, gloss] of Object.entries(CONFIDENCE_GLOSS)) {
    if (k === "calibrated-probability") assert.match(gloss, /chance/);
    else assert.doesNotMatch(gloss, /^a modelled chance/);
  }
});

// ---------------------------------------------------------------------------
// The floor sentence comes from the constants, so it cannot drift.
// ---------------------------------------------------------------------------

test("the floor line states the live floor and names the shadow as research", () => {
  const line = floorLine();
  assert.match(line, new RegExp(`fills at ${CHAIR_MIN_ASK_CENTS}¢ or better`));
  assert.match(line, new RegExp(`${FLOOR_SHADOW_CENTS}¢ floor is counted alongside as research`));
  assert.match(line, /never gates a fill/);
  // It must not present the shadow as a second place a fill can happen.
  assert.doesNotMatch(line, new RegExp(`fills? at ${FLOOR_SHADOW_CENTS}¢`));
});

// ---------------------------------------------------------------------------
// COMPACT RECORD — one identified population, eras never combined.
// ---------------------------------------------------------------------------

const ERA = "2026-09-10T23:00:00.000Z";
const row = (t: string, entry: number | null, ev: number | null, settle: number | null = 100) => ({
  t,
  entry,
  ev,
  settle,
});

test("the record counts only settled fills in the current floor era", () => {
  const c = recordCard(
    [
      // Before the era boundary: the 70¢ floor booked these. Must NOT be counted.
      row("2026-09-09T12:00:00Z", 72, 26),
      row("2026-09-10T20:00:00Z", 75, -77),
      // Current era.
      row("2026-09-11T12:00:00Z", 82, 16),
      row("2026-09-11T13:00:00Z", 85, -87),
      row("2026-09-11T14:00:00Z", 81, 17),
      // A WAIT window: a legitimate decision, but not a fill.
      row("2026-09-11T15:00:00Z", null, null, null),
      // A fill that has not settled yet.
      { t: "2026-09-11T16:00:00Z", entry: 83, ev: null, settle: null },
    ],
    ERA,
  );
  assert.equal(c.n, 3, "three settled fills in the current era");
  assert.equal(c.net_cents, 16 - 87 + 17);
  assert.equal(c.win_pct, 67, "two of three");
  assert.equal(c.from, "2026-09-11T12:00:00.000Z");
  assert.equal(c.to, "2026-09-11T14:00:00.000Z");
  // The population is named, and names its own bound.
  assert.match(c.population, new RegExp(`${CHAIR_MIN_ASK_CENTS}¢ floor era`));
  assert.match(c.population, /last 40 graded windows/);
  assert.match(c.n_means, /settled/);
});

test("a pre-era fill can never leak into the current-era net", () => {
  // The same rows, with and without the old era present, must give the same net.
  const current = [row("2026-09-11T12:00:00Z", 82, 16), row("2026-09-11T13:00:00Z", 85, -87)];
  const withOld = [row("2026-09-09T12:00:00Z", 72, 500), ...current];
  assert.equal(recordCard(current, ERA).net_cents, recordCard(withOld, ERA).net_cents);
  assert.equal(recordCard(withOld, ERA).n, 2);
});

test("no fills is reported as zero with a reason, not as a net of 0¢", () => {
  const c = recordCard([row("2026-09-11T12:00:00Z", null, null, null)], ERA);
  assert.equal(c.n, 0, "zero is a real count");
  assert.equal(c.net_cents, null, "but there is no net to report");
  assert.equal(c.win_pct, null);
  assert.equal(c.breakeven_pct, null);
  assert.ok(c.unavailable_why.length > 0);
  // The population is still stated, so the empty card still says what it looked at.
  assert.match(c.population, /floor era/);
});

test("WAIT windows are excluded from the economics population and that is stated", () => {
  const c = recordCard(
    [row("2026-09-11T12:00:00Z", 82, 16), row("2026-09-11T13:00:00Z", null, null, null)],
    ERA,
  );
  assert.equal(c.n, 1, "a WAIT is not a fill");
  assert.match(c.n_means, /fills/, "and N says so");
});

test("breakeven is computed from the same fills as the win rate", () => {
  // One population: both figures come from the identical row set, so comparing them
  // is meaningful. At ~82¢ plus fee a held contract needs well over 80%.
  const c = recordCard(
    [
      row("2026-09-11T12:00:00Z", 82, 16),
      row("2026-09-11T13:00:00Z", 82, -84),
      row("2026-09-11T14:00:00Z", 82, 16),
    ],
    ERA,
  );
  assert.equal(c.n, 3);
  assert.equal(c.win_pct, 67);
  assert.ok(c.breakeven_pct != null && c.breakeven_pct > 80, `breakeven was ${c.breakeven_pct}`);
  assert.ok(
    c.win_pct! < c.breakeven_pct!,
    "this sample lost money, and the card must show that rather than flatter it",
  );
  assert.ok(c.net_cents! < 0, "the net agrees with the verdict");
});

test("an unusable entry price is not counted as a fill", () => {
  for (const bad of [0, 100, -5]) {
    assert.equal(recordCard([row("2026-09-11T12:00:00Z", bad, 10)], ERA).n, 0, `${bad}¢ is not a price`);
  }
});

test("the brief limit is named in the population so the card is not read as a lifetime total", () => {
  assert.match(recordCard([], ERA, 40).population, /last 40 graded windows/);
  assert.match(recordCard([], ERA, 12).population, /last 12 graded windows/);
});

// ---------------------------------------------------------------------------
// No duplication: fair and ask already live in the Chair card's economics box.
// ---------------------------------------------------------------------------

test("the Floor section renders only the prices the economics box does not carry", () => {
  // A rendered capture of the live Floor confirmed "what this call costs" already shows
  // FAIR and ASK together. Drawing them again would make two sources for one number.
  assert.deepEqual([...DISPLAY_KINDS], ["decision", "entry"]);
  const shown = displayedPriceFacts(priceFacts(snap(), chair(), booked, { t: T0, cents: 82 }));
  assert.deepEqual(shown.map((f) => f.kind), ["decision", "entry"]);
  for (const k of ["fair", "market"]) {
    assert.equal(shown.some((f) => f.kind === k), false, `${k} belongs to the existing box`);
  }
});

test("the full set is still available to a caller even though two are not drawn", () => {
  // The helper must not lose facts just because this one section does not show them.
  const all = priceFacts(snap(), chair(), floored);
  assert.equal(all.length, 4);
  assert.ok(all.find((f) => f.kind === "fair")?.note.includes("DERIVED"));
});

// ---------------------------------------------------------------------------
// Four WAIT categories, because they have four different remedies.
// ---------------------------------------------------------------------------

const feedGate: Gate = { id: "warden", label: "stale warden", pass: false, hard: true, value: "FROZEN" };
const chalkGate: Gate = { id: "chalk", label: "phantom print", pass: false, hard: true, value: "CHALK" };
const barGate: Gate = { id: "bar", label: "score vs bar", pass: false, hard: true, value: "1.2/2.0" };

test("a data-trust gate is reported as a feed condition, not as a read on the market", () => {
  const w = whyFacts(chair({ lean: "WAIT", gates: [feedGate], score: 3, bar: 2 }), "");
  assert.equal(w.wait_reason, "feed-condition");
  assert.deepEqual(w.feed_gates.map((g) => g.id), ["warden"]);
});

test("a feed condition outranks every other reason, because bad inputs void the vote", () => {
  // Warden failing AND the score short AND another hard gate failing: the data problem
  // is the answer, because nothing downstream of bad inputs means anything.
  const w = whyFacts(chair({ lean: "WAIT", gates: [feedGate, barGate], score: 1, bar: 2 }), "");
  assert.equal(w.wait_reason, "feed-condition");
  assert.equal(w.failed_hard.length, 2, "both are still reported");
});

test("all four WAIT reasons are reachable and distinct", () => {
  const reasons = [
    whyFacts(chair({ lean: "WAIT", gates: [chalkGate], score: 3, bar: 2 }), "").wait_reason,
    whyFacts(chair({ lean: "WAIT", gates: [barGate], score: 3, bar: 2 }), "").wait_reason,
    whyFacts(chair({ lean: "WAIT", gates: [], score: 1, bar: 2 }), "").wait_reason,
    whyFacts(chair({ lean: "WAIT", gates: [], score: 3, bar: 2 }), "").wait_reason,
  ];
  assert.deepEqual(reasons, ["feed-condition", "hard-gate", "under-bar", "no-edge"]);
  assert.equal(new Set(reasons).size, 4, "four answers, four remedies");
});

test("a non-feed hard gate is not miscategorised as a feed condition", () => {
  const w = whyFacts(chair({ lean: "WAIT", gates: [barGate], score: 3, bar: 2 }), "");
  assert.equal(w.wait_reason, "hard-gate");
  assert.deepEqual(w.feed_gates, []);
});

test("the feed-gate set is the data-trust gates only, from chair.ts's own ids", () => {
  assert.deepEqual([...FEED_GATE_IDS], ["warden", "chalk", "quote"]);
  // bar/edge/leftover/law/early/late are about the TRADE, not about the inputs.
  for (const id of ["bar", "edge", "leftover", "law", "early", "late"]) {
    assert.equal(FEED_GATE_IDS.includes(id), false, `${id} is not a data-trust gate`);
  }
});

test("a calling chair has no wait reason and no feed gates", () => {
  const w = whyFacts(chair({ lean: "UP", gates: [feedGate] }), "");
  assert.equal(w.wait_reason, "", "not waiting");
  // feed_gates still reports the failure for the disclosure, but it is not the reason.
  assert.equal(w.feed_gates.length, 1);
});

// ---------------------------------------------------------------------------
// Both surfaces that prepend a word to `invalidate_if` use ONE rule.
// ---------------------------------------------------------------------------

test("neither the evidence line nor the diagnostics label can render a doubled 'if'", () => {
  // Two surfaces put their own word before this value: the Floor's evidence line
  // ("The read is off if ...") and the Diagnostics field whose LABEL is the words
  // "invalidate if". Both had the same bug, so both use the same rule.
  const real = [
    "if combined ask prints below 98¢ (stale leftover)",
    "if both sides have no edge vs ask after fee",
    "if book goes chalk (YES or NO ≥ 99¢)",
    "if quote age > 25s",
    "if clock prints ≤ 2.2m left",
    "if spot reprints through strike",
    "if YES mid rips +8¢ in 60s",
    "if Quiet-vol floor stays failed",
    "if top-3 stay in conflict",
    "if |score|×agg drops under the bar",
  ];
  for (const v of real) {
    // Surface 1: the sentence.
    const line = invalidateLine(whyFacts(chair({ invalidate_if: v }), ""));
    assert.doesNotMatch(line, /\bif\s+if\b/i, `sentence doubled for: ${v}`);

    // Surface 2: the diagnostics label + value, composed the way Field renders it.
    const asField = `invalidate if ${invalidateCondition(v)}`;
    assert.doesNotMatch(asField, /\bif\s+if\b/i, `diagnostics doubled for: ${v}`);
    assert.equal(
      asField.toLowerCase().split(/\bif\b/).length - 1,
      1,
      `diagnostics must read "if" exactly once for: ${v}`,
    );
    // And the condition itself is intact on both.
    const cond = v.replace(/^if\s+/i, "");
    assert.ok(line.endsWith(cond), `sentence altered the condition: ${v}`);
    assert.ok(asField.endsWith(cond), `diagnostics altered the condition: ${v}`);
  }
});

test("invalidateCondition strips only the joining word, and never mutates the input", () => {
  assert.equal(invalidateCondition("if quote age > 25s"), "quote age > 25s");
  assert.equal(invalidateCondition("If quote age > 25s"), "quote age > 25s");
  assert.equal(invalidateCondition("  if   quote age > 25s  "), "quote age > 25s");
  // Not the joining word: left exactly alone.
  assert.equal(invalidateCondition("iffy volume holds"), "iffy volume holds");
  assert.equal(invalidateCondition("spot loses the strike"), "spot loses the strike");
  // An "if" later in the clause stays put.
  assert.equal(
    invalidateCondition("if spot stalls, even if volume lifts"),
    "spot stalls, even if volume lifts",
  );
  // Nothing to state.
  for (const empty of ["if", "IF", "  ", "", null, undefined]) {
    assert.equal(invalidateCondition(empty), "", `${JSON.stringify(empty)} has no condition`);
  }
});

// ---------------------------------------------------------------------------
// TOUCH is a CONTRACT COUNT from a fractional-precision book.
// ---------------------------------------------------------------------------

test("a fractional book size never renders as raw floating point", () => {
  // The exact value seen on screen during visual QA. Kalshi's book carries
  // `count_fp`, so sizes arrive fractional and `String(...)` printed all of it.
  const raw = 146.24058733173328;
  const out = fmtContracts(raw);
  assert.equal(out, "146");
  // The guard that matters: no long decimal tail, whatever the rounding rule.
  assert.doesNotMatch(out, /\./, "a size must not render a decimal point");
  assert.ok(out.length <= 8, `a size cell must stay narrow, got ${out.length} chars: ${out}`);
  assert.ok(String(raw).length > 8, "fixture must actually be a long raw value");

  // Whole contracts, matching how the research record and the fingerprint already
  // round this same field (server-engine.ts:571-573, server-feeds.ts:280).
  assert.equal(fmtContracts(146.6), "147");
  assert.equal(fmtContracts(1.4), "1");
  assert.equal(fmtContracts(220), "220");
  // Grouped once past a thousand, so a deep book is still readable.
  assert.equal(fmtContracts(12345.678), "12,346");
});

test("a size resting below one contract is small, never nothing", () => {
  // economics.ts only says "nothing resting at the touch" when touch <= 0, so a
  // rounded-to-zero cell beside "the book pays this" would contradict itself.
  assert.equal(fmtContracts(0.4), "<1");
  assert.equal(fmtContracts(0.0001), "<1");
  assert.equal(fmtContracts(0.9999), "<1");
  // A true zero is a true zero.
  assert.equal(fmtContracts(0), "0");
  // Nothing measured at all. A missing size must NOT read as "nothing resting":
  // `Number(null)` is 0, so coercing the input would turn "not reported" into the
  // confident claim that the touch is empty. Rule 1 of this module.
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, "x", "", "146.2"]) {
    assert.equal(fmtContracts(bad), "—", `${JSON.stringify(bad)} is not a size`);
  }
  // A negative size is not a size the desk claims it could take.
  assert.equal(fmtContracts(-5), "0");
});

test("formatting a size is read-side only and decides nothing", () => {
  // The caveat and the colour in the economics box read the EXACT number
  // (`touch <= 0`, economics.ts:100) — the formatter must never be what decides.
  // It takes a value and returns a STRING, so it cannot feed that predicate, and
  // `economicsOf` carrying the exact size is asserted in economics.test.ts.
  for (const v of [146.24058733173328, 0.4, 0, -5]) {
    assert.equal(typeof fmtContracts(v), "string", "the formatter only ever yields text");
  }
  // A positive size and a zero size are never formatted to the same string, because
  // that is the distinction the caveat turns on.
  assert.notEqual(fmtContracts(0.4), fmtContracts(0));
});
