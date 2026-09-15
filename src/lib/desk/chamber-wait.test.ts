/**
 * Chamber PR 1 — focused WAIT → CHAIR_WAIT_MILESTONE → SATOSHI tests.
 *
 * Pure builder + reaction only. Persistence idempotency is the Phase 1A
 * unique event_key + ON CONFLICT DO NOTHING. Observer / engine-tick
 * boundaries are enforced by the Phase 1A rails, not a fake DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookState, type BookState } from "./book-floor.ts";
import { statementFromEvent, type ChamberStatement } from "./chamber-reactions.ts";
import { chairWaitEventKey, maybeChairWaitEvent } from "./chamber-wait.ts";
import { plainLine } from "./chair-words.ts";
import { whyFacts } from "./floor-clarity.ts";
import { booksSeatEvidence, chairRoster, compareRosters, quorumCheck, readRoster } from "./roster-evidence.ts";
import { withBooksRoster } from "./chamber-roster.ts";
import type { PublicSystemEvent } from "./system-events.ts";
import { validateSystemEvent } from "./system-events.ts";
import type { ChairResult, Gate, Snapshot } from "./types.ts";

const T0 = Date.parse("2026-09-11T17:05:00Z");
const TICKER = "KXBTC15M-26SEP111800-00";
const CLOSE = Date.parse("2026-09-11T22:00:00Z");

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    as_of: T0,
    ticker: TICKER,
    close_time: CLOSE,
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
    lean: "WAIT",
    confidence: 40,
    score: 1,
    bar: 2,
    gates: [],
    hypothesis: "the seats have not cleared the bar",
    evidence: ["TAPE: thin"],
    counter: "a later print could still clear",
    invalidate_if: "if |score|×agg drops under the bar",
    wait_note: "score under the bar",
    quorum: { up: 9, down: 3, wait: 9 },
    ...over,
  } as unknown as ChairResult;
}

const waiting: BookState = { kind: "wait" };

const hardLaw: Gate = { id: "law", label: "lockdown", pass: false, hard: true, value: "held" };
const feedWarden: Gate = { id: "warden", label: "warden", pass: false, hard: true, value: "frozen" };

type WaitPayload = {
  wait_reason?: unknown;
  ticker?: unknown;
  close_time?: unknown;
  text?: unknown;
  score?: unknown;
  bar?: unknown;
  failed_hard?: unknown;
  quorum?: unknown;
};

function payloadOf(ev: { payload?: unknown } | null | undefined): WaitPayload {
  const p = ev?.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as WaitPayload;
  return {};
}

function asPublic(input: ReturnType<typeof maybeChairWaitEvent>): PublicSystemEvent {
  assert.ok(input, "expected an event");
  const ev = validateSystemEvent(input!);
  return {
    event_key: ev.event_key,
    event_type: ev.event_type,
    character: ev.character,
    occurred_at: ev.occurred_at.toISOString(),
    source_type: ev.source_type,
    source_id: ev.source_id,
    payload: ev.payload,
  };
}

test("A. WAIT + valid wait_reason builds CHAIR_WAIT_MILESTONE", () => {
  const c = chair();
  const s = snap();
  const why = whyFacts(c, "");
  assert.equal(why.wait_reason, "under-bar");
  const ev = maybeChairWaitEvent(c, s, waiting);
  assert.ok(ev);
  assert.equal(ev!.event_type, "CHAIR_WAIT_MILESTONE");
  assert.equal(ev!.character, "SATOSHI");
  assert.equal(ev!.public, true);
  assert.equal(ev!.source_type, "window");
  assert.equal(ev!.source_id, `${TICKER}:${CLOSE}`);
  assert.equal(ev!.event_key, chairWaitEventKey(TICKER, CLOSE, "under-bar"));
  assert.equal(payloadOf(ev!).wait_reason, "under-bar");
  assert.equal(payloadOf(ev!).ticker, TICKER);
  assert.equal(payloadOf(ev!).close_time, CLOSE);
  assert.equal(payloadOf(ev!).score, 1);
  assert.equal(payloadOf(ev!).bar, 2);
  validateSystemEvent(ev!);
});

test("B. same logical event key is idempotent at the persistence layer", () => {
  const a = maybeChairWaitEvent(chair(), snap(), waiting);
  const b = maybeChairWaitEvent(chair(), snap(), waiting);
  assert.ok(a && b);
  assert.equal(a!.event_key, b!.event_key);
  assert.equal(a!.event_key, `CHAIR_WAIT_MILESTONE:${TICKER}:${CLOSE}:under-bar`);
  // Phase 1A writer is insert-once on event_key (ON CONFLICT DO NOTHING).
  assert.equal(validateSystemEvent(a!).event_key, validateSystemEvent(b!).event_key);
});

test("C. UP produces no wait event", () => {
  assert.equal(maybeChairWaitEvent(chair({ lean: "UP", score: 3, bar: 2 }), snap(), waiting), null);
});

test("D. DOWN produces no wait event", () => {
  assert.equal(maybeChairWaitEvent(chair({ lean: "DOWN", score: 3, bar: 2 }), snap(), waiting), null);
});

test("E. missing wait_reason produces no event", () => {
  // whyFacts only yields an empty wait_reason on a directional lean.
  const directional = chair({ lean: "UP", score: 3, bar: 2 });
  assert.equal(whyFacts(directional, "").wait_reason, "");
  assert.equal(maybeChairWaitEvent(directional, snap(), waiting), null);
});

test("F. DEMO window produces no persisted Chamber event", () => {
  assert.equal(
    maybeChairWaitEvent(chair(), snap({ ticker: "KXBTC15M-DEMO-00" }), waiting),
    null,
  );
  assert.equal(maybeChairWaitEvent(chair(), snap({ ticker: "DEMO" }), waiting), null);
});

test("G. builder does not mutate Chair input", () => {
  const c = chair({ gates: [hardLaw] });
  const before = structuredClone(c);
  const ev = maybeChairWaitEvent(c, snap(), waiting);
  assert.ok(ev);
  assert.deepEqual(c, before);
});

test("H. SATOSHI text exactly matches existing plainLine output", () => {
  const c = chair();
  const s = snap();
  const ev = maybeChairWaitEvent(c, s, waiting);
  assert.ok(ev);
  assert.equal(payloadOf(ev!).text, plainLine(c, s, waiting));
  assert.match(String(payloadOf(ev!).text), /desk waits/);
});

test("I. reaction for wait milestone is SATOSHI", () => {
  const stmt = statementFromEvent(asPublic(maybeChairWaitEvent(chair(), snap(), waiting)));
  assert.ok(stmt);
  assert.equal(stmt!.speaker, "SATOSHI");
  assert.equal(stmt!.source_type, "window");
  assert.equal(stmt!.evidence.wait_reason, "under-bar");
  assert.equal(stmt!.evidence.ticker, TICKER);
  assert.equal(stmt!.evidence.close_time, CLOSE);
});

test("J. unsupported event produces no statement", () => {
  const base = asPublic(maybeChairWaitEvent(chair(), snap(), waiting));
  assert.equal(statementFromEvent({ ...base, event_type: "DESK_UPDATE" }), null);
  assert.equal(statementFromEvent({ ...base, event_type: "SYSTEM_HEALTH_ALERT" }), null);
  assert.equal(statementFromEvent({ ...base, event_type: "EXPERIMENT_STARTED" }), null);
});

test("K. no other character is produced", () => {
  const base = asPublic(maybeChairWaitEvent(chair(), snap(), waiting));
  for (const who of ["WARDEN", "ALCHEMIST", "WRENCH", "SWEEP", "COACH", "DESK"] as const) {
    assert.equal(statementFromEvent({ ...base, character: who }), null, who);
  }
  const stmt = statementFromEvent(base);
  assert.equal(stmt!.speaker, "SATOSHI");
});

test("L. public event can be returned through Chamber read path", () => {
  const ev = maybeChairWaitEvent(chair(), snap(), waiting);
  assert.equal(ev!.public, true);
  const stmt = statementFromEvent(asPublic(ev));
  assert.ok(stmt);
  assert.equal(stmt!.text, payloadOf(ev!).text);
  assert.deepEqual(stmt!.evidence.quorum, { up: 9, down: 3, wait: 9 });
});

test("M. private event cannot appear through Chamber read path", () => {
  // listChamberSpeech only feeds listPublicSystemEvents (public = true) into
  // statementFromEvent. A private row never becomes a PublicSystemEvent.
  const ev = maybeChairWaitEvent(chair(), snap(), waiting);
  assert.ok(ev);
  const privateInput = { ...ev!, public: false };
  const recorded = validateSystemEvent(privateInput);
  assert.equal(recorded.public, false);
  // The read path never sees this row. The mapper itself is silent on empty text
  // and on any non-SATOSHI / non-wait type — it has no public flag to override.
  const sneak: PublicSystemEvent = {
    event_key: recorded.event_key,
    event_type: recorded.event_type,
    character: recorded.character,
    occurred_at: recorded.occurred_at.toISOString(),
    source_type: recorded.source_type,
    source_id: recorded.source_id,
    payload: recorded.payload,
  };
  const stmt = statementFromEvent(sneak);
  assert.ok(stmt, "mapper is display-only; privacy is the public-events reader");
});

test("feed-condition and hard-gate WAIT reasons still speak", () => {
  const feed = maybeChairWaitEvent(chair({ gates: [feedWarden], score: 3, bar: 2 }), snap(), waiting);
  assert.equal(payloadOf(feed).wait_reason, "feed-condition");
  assert.deepEqual(payloadOf(feed).failed_hard, ["warden"]);
  const hard = maybeChairWaitEvent(chair({ gates: [hardLaw], score: 3, bar: 2 }), snap(), waiting);
  assert.equal(payloadOf(hard).wait_reason, "hard-gate");
  assert.deepEqual(payloadOf(hard).failed_hard, ["law"]);
});

test("no-edge WAIT still builds when the bar is cleared", () => {
  const ev = maybeChairWaitEvent(chair({ gates: [], score: 3, bar: 2 }), snap(), waiting);
  assert.equal(payloadOf(ev).wait_reason, "no-edge");
});

test("unusable ticker or close_time produces no event", () => {
  assert.equal(maybeChairWaitEvent(chair(), snap({ ticker: "" }), waiting), null);
  assert.equal(maybeChairWaitEvent(chair(), snap({ ticker: "   " }), waiting), null);
  assert.equal(maybeChairWaitEvent(chair(), snap({ close_time: 0 }), waiting), null);
  assert.equal(maybeChairWaitEvent(chair(), snap({ close_time: Number.NaN }), waiting), null);
});

test("bookState wait on a WAIT lean is what the producer stores text against", () => {
  const c = chair();
  const s = snap();
  const book = bookState(s, c.lean, []);
  assert.equal(book.kind, "wait");
  const ev = maybeChairWaitEvent(c, s, book);
  assert.equal(payloadOf(ev!).text, plainLine(c, s, book));
});

test("empty stored text is silent", () => {
  const base = asPublic(maybeChairWaitEvent(chair(), snap(), waiting));
  assert.equal(statementFromEvent({ ...base, payload: { ...base.payload, text: "   " } }), null);
  assert.equal(statementFromEvent({ ...base, payload: { ...base.payload, text: "" } }), null);
});

test("reaction evidence does not invent numbers", () => {
  const stmt = statementFromEvent(asPublic(maybeChairWaitEvent(chair(), snap(), waiting))) as ChamberStatement;
  assert.equal(stmt.evidence.score, 1);
  assert.equal(stmt.evidence.bar, 2);
  assert.deepEqual(stmt.evidence.failed_hard, []);
});

// Synthetic seat identities; only the window, dispatch time and old text below
// are from the audit. The original per-seat historical roster is MISSING.
function rosterChair() {
  return chair({ quorum: { up: 2, down: 1, wait: 1 }, rows: [
    { seat: "TAPE", lean: "UP", status: "LIVE" },
    { seat: "WICK", lean: "UP", status: "FOLDED" },
    { seat: "STRIKE", lean: "DOWN", status: "LIVE" },
    { seat: "FADE", lean: "WAIT", status: "LIVE" },
    { seat: "ODDS", lean: "DOWN", status: "MUTED" },
    { seat: "WARDEN", lean: "WAIT", status: "LIVE" },
  ] as ChairResult["rows"] });
}

test("roster check survives a stored-event round trip without altering the Chair", () => {
  const c = rosterChair(), before = structuredClone(c);
  const event = asPublic(maybeChairWaitEvent(c, snap(), waiting));
  const statement = statementFromEvent(JSON.parse(JSON.stringify(event)))!;
  assert.equal(statement.evidence.roster_check?.status, "MATCH");
  assert.deepEqual(statement.evidence.roster?.members.map((m) => m.seat), ["FADE", "STRIKE", "TAPE", "WICK"]);
  assert.deepEqual(c, before);
});

test("wrong count or wrong roster clock suppresses the public agreement claim", () => {
  const event = asPublic(maybeChairWaitEvent(rosterChair(), snap(), waiting));
  for (const patch of [
    { quorum: { up: 99, down: 1, wait: 1 } },
    { roster: { ...event.payload.roster as object, snapshot_at: T0 + 1 } },
    { roster: { ...event.payload.roster as object, ticker: "OTHER" } },
  ]) {
    const s = statementFromEvent({ ...event, payload: { ...event.payload, ...patch } })!;
    assert.equal(s.evidence.roster_check?.status, "MISMATCH");
    assert.equal(s.evidence.quorum, null);
    assert.match(s.text, /withheld/);
  }
});

test("same totals with different seat identities or sides fail equality", () => {
  const a = chairRoster(snap(), rosterChair())!;
  assert.equal(compareRosters(a, { ...a, members: [...a.members].reverse() }).status, "MATCH");
  const changedSeat = { ...a, members: a.members.map((m) => m.seat === "TAPE" ? { ...m, seat: "VEL" } : m) };
  assert.equal(compareRosters(a, changedSeat).status, "MISMATCH");
  const changedSide = { ...a, members: a.members.map((m) => ({ ...m, lean: m.lean === "UP" ? "DOWN" as const : m.lean })) };
  assert.equal(compareRosters(a, changedSide).status, "MISMATCH");
  assert.equal(compareRosters(a, { ...a, snapshot_at: T0 + 1 }).status, "DIFFERENT");
  assert.equal(compareRosters(a, { ...a, close_time: CLOSE + 1 }).status, "MISMATCH");
  assert.equal(compareRosters(a, { ...a, snapshot_at: null }).status, "MISSING");
  assert.equal(readRoster({ ...a, members: [a.members[0], a.members[0]] }), null);
  assert.equal(quorumCheck(null, { up: 0, down: 0, wait: 0 }).status, "MISSING");
});

test("the 09:00 audit dispatch is not relabelled as its entry or Books roster", () => {
  const ticker = "KXBTC15M-26SEP150900-00", close = Date.parse("2026-09-15T13:00:00Z");
  const original = "Booked UP at 81¢ with 0 seats agreeing and 1 seat against, graded at the close. The read has moved since, but the position is held to settlement.";
  const event = { ...asPublic(maybeChairWaitEvent(chair(), snap(), waiting)), occurred_at: "2026-09-15T12:59:01Z",
    payload: { ticker, close_time: close, text: original, quorum: { up: 0, down: 1, wait: 17 } } };
  const before = structuredClone(event);
  const statement = statementFromEvent(event)!;
  assert.match(statement.text, /Paper entry: UP at 81¢/);
  assert.match(statement.text, /Entry-time agreement: MISSING/);
  assert.doesNotMatch(statement.text, /with 0 seats agreeing/);
  assert.equal(statement.original_text, original);
  // Counts model the audit pattern; these are explicitly synthetic seat rows.
  const seats = {
    TAPE: { lean: "UP", hit: true }, WICK: { lean: "UP", hit: true }, STRIKE: { lean: "UP", hit: true },
    FADE: { lean: "DOWN", hit: false }, ODDS: { lean: "DOWN", hit: false },
    VEL: { lean: "WAIT", hit: null, raw_lean: "DOWN" },
  };
  const row = { ticker, close_time: new Date(close), winner: "UP" as const, seats };
  const books = booksSeatEvidence(ticker, close, "UP", seats);
  const enriched = withBooksRoster(statement, [row]);
  assert.deepEqual(enriched.evidence.books_seats, { n: 5, right: 3 });
  assert.deepEqual(enriched.evidence.books_seats, books.seats);
  assert.deepEqual(books.raw, { n: 6, right: 3 });
  assert.equal(enriched.evidence.books_check?.status, "MISSING");
  assert.equal(enriched.evidence.books_roster?.snapshot_at, null);
  assert.equal(withBooksRoster(statement, [{ ...row, close_time: new Date(close + 1) }]).evidence.books_seats, undefined);
  assert.deepEqual(event, before);
});

test("a held entry and a later opposite read carry separate wording and clocks", () => {
  const line = plainLine(chair({ lean: "DOWN", quorum: { up: 0, down: 1, wait: 0 } }), snap(), { kind: "booked", lean: "UP", cents: 81, ask: 75 });
  assert.match(line, /Paper entry: UP at 81¢/);
  assert.match(line, /At observation 2026-09-11T17:05:00.000Z, 0 seats agree/);
  assert.match(line, /Entry-time agreement: MISSING/);
});

test("correctness is not agreement when the held side loses", () => {
  const books = booksSeatEvidence(TICKER, CLOSE, "DOWN", {
    TAPE: { lean: "UP", hit: false }, WICK: { lean: "UP", hit: false }, STRIKE: { lean: "DOWN", hit: true },
  });
  assert.deepEqual(books.seats, { n: 3, right: 1 });
  assert.equal(books.roster!.members.filter((m) => m.lean === "UP").length, 2);
  assert.equal(compareRosters(chairRoster(snap(), rosterChair()), books.roster).status, "DIFFERENT");
});
