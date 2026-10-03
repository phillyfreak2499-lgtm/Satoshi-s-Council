/**
 * Council Room V1 — narration adapter tests against the actual modules.
 * FIXTURES ARE SYNTHETIC: see council-room.fixtures.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChamberStatement } from "./chamber-reactions.ts";
import { maybeChairDirectionalEvent } from "./chamber-directional.ts";
import { chairOnlyCalls } from "./recovery-pilot.ts";
import { adaptStatement, COUNCIL_ROOM_SCHEMA_VERSION, type NarrationEvent } from "./council-room-narration.ts";
import { CLOSE, RECEIVED, SYNTHETIC, T0, TICKER, call, snap } from "./council-room.fixtures.ts";
import type { CallLogRow } from "./types.ts";

function ok(s: ChamberStatement, received: number = RECEIVED): NarrationEvent {
  const r = adaptStatement(s, received);
  assert.ok(r.ok, r.ok ? "" : `${r.refusal.reason}: ${r.refusal.detail}`);
  return r.event;
}

function refused(s: unknown, reason: string, received: number = RECEIVED) {
  const r = adaptStatement(s as ChamberStatement, received);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.refusal.reason, reason, r.refusal.detail);
}

test("every supported producer traces to its stored source, time and template", () => {
  const all = [SYNTHETIC.book(), SYNTHETIC.wait(), SYNTHETIC.alert(), ...SYNTHETIC.lab(), SYNTHETIC.sweep()];
  assert.ok(all.length >= 6);
  for (const s of all) {
    const ev = ok(s);
    assert.equal(ev.schema_version, COUNCIL_ROOM_SCHEMA_VERSION);
    assert.equal(ev.event_id, s.event_key);
    assert.deepEqual(ev.source, { table: "desk_system_events", event_key: s.event_key, source_type: s.source_type, source_id: s.source_id });
    assert.equal(ev.recorded_at, new Date(s.occurred_at).toISOString());
    assert.equal(ev.received_at, new Date(RECEIVED).toISOString());
    assert.equal(ev.build, null, "no build identity is invented");
    assert.equal(ev.archival_text, s.original_text ?? s.text, "stored wording kept as evidence");
    assert.match(ev.template_key, /^[a-z]+\.[a-z_.]+$/);
    assert.doesNotMatch(ev.text, /\bI\b|I’m|I'm|["“”]/, "neutral third person, no quotations");
    for (const v of Object.values(ev.fields)) assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v));
  }
});

test("every rendered line needs a real receipt time; none is invented", () => {
  const s = SYNTHETIC.book();
  for (const bad of [null, Number.NaN, 0, -1]) refused(s, "missing-receipt-time", bad as unknown as number);
  const server = Date.parse(s.occurred_at) + 5_000;
  assert.equal(ok(s, server).received_at, new Date(server).toISOString());
});

test("a page-load row recorded beyond the future skew of the server receipt is refused", () => {
  const s = SYNTHETIC.sweep();
  refused(s, "future-recorded-time", Date.parse(s.occurred_at) - 10 * 60_000);
});

test("narration is deterministic and never echoes stored prose as the headline", () => {
  const s = SYNTHETIC.alert();
  assert.deepEqual(ok(s), ok(structuredClone(s)));
  const reworded = { ...s, text: "I am certain the desk will win big." };
  const ev = ok(reworded);
  assert.equal(ev.text, ok(s).text);
  assert.equal(ev.archival_text, "I am certain the desk will win big.");
  assert.doesNotMatch(ev.text, /certain|win big/);
});

test("research, Chair decision and paper book stay separate layers", () => {
  assert.equal(ok(SYNTHETIC.book()).layer, "book");
  assert.equal(ok(SYNTHETIC.wait()).layer, "chair");
  for (const s of SYNTHETIC.lab()) assert.equal(ok(s).layer, "research");
  assert.equal(ok(SYNTHETIC.alert()).layer, "integrity");
  assert.equal(ok(SYNTHETIC.sweep()).layer, "conditions");
  const book = ok(SYNTHETIC.book());
  assert.equal(book.fields.call_id, call.id);
  assert.match(book.text, /paper book logged a canonical Chair UP call/);
  assert.match(book.text, /Paper only\.$/);
  for (const s of SYNTHETIC.lab()) assert.match(ok(s).text, /no (production )?authority/);
});

test("a paper call without its canonical book identity is not labelled a position", () => {
  const s = SYNTHETIC.book();
  refused({ ...s, evidence: { ...s.evidence, call_id: "" } }, "book-identity");
  refused({ ...s, evidence: { ...s.evidence, call_id: `${CLOSE}-DOWN-${T0}` } }, "book-identity");
  refused({ ...s, evidence: { ...s.evidence, call_id: `${CLOSE + 900_000}-UP-${T0}` } }, "book-identity");
  refused({ ...s, evidence: { ...s.evidence, entry_cents: 120 } }, "missing-fields");
});

test("non-Chair pilot calls never reach the directional producer", () => {
  const pilot: CallLogRow = { ...call, source: "RECOVERY_FAV85_V1" };
  assert.equal(maybeChairDirectionalEvent(snap(), chairOnlyCalls([pilot])), null);
});

test("an unbooked Chair lean produces no book event", () => {
  assert.equal(maybeChairDirectionalEvent(snap(), []), null);
});

test("invalid or future recorded times are refused", () => {
  const s = SYNTHETIC.wait();
  refused({ ...s, occurred_at: "not a date" }, "invalid-recorded-time");
  refused({ ...s, occurred_at: new Date(RECEIVED + 10 * 60_000).toISOString() }, "future-recorded-time");
});

test("malformed identity is refused", () => {
  const s = SYNTHETIC.wait();
  refused({ ...s, event_key: "" }, "malformed-identity");
  refused({ ...s, event_key: "has spaces in it" }, "malformed-identity");
  refused({ ...s, source_id: "" }, "malformed-identity");
  refused({ ...s, source_type: "chair_internal" }, "malformed-identity");
  refused(null, "malformed-identity");
  refused({ ...s, evidence: undefined }, "malformed-identity");
});

test("window rollover and identity disagreements are refused", () => {
  const s = SYNTHETIC.wait();
  // Ticker says 19:00 ET (23:00 UTC) while the window says 23:15 UTC.
  const staleTicker = "KXBTC15M-26OCT021900-00";
  const rolled = {
    ...s,
    event_key: s.event_key.replace(TICKER, staleTicker),
    source_id: `${staleTicker}:${CLOSE}`,
    evidence: { ...s.evidence, ticker: staleTicker },
  };
  refused(rolled, "rollover-mismatch");
  refused({ ...s, occurred_at: new Date(CLOSE + 5 * 60_000).toISOString() }, "rollover-mismatch", CLOSE + 6 * 60_000);
  refused({ ...s, occurred_at: new Date(CLOSE - 40 * 60_000).toISOString() }, "rollover-mismatch");
  refused({ ...s, evidence: { ...s.evidence, close_time: CLOSE + 1 } }, "window-identity");
  refused({ ...s, source_id: `${TICKER}:${CLOSE + 900_000}` }, "window-identity");
  refused({ ...s, evidence: { ...s.evidence, ticker: "" } }, "window-identity");
});

test("an unverifiable ticker is withheld even when key, source and close agree", () => {
  const s = SYNTHETIC.wait();
  const junk = "JUNK-TICKER";
  const selfConsistent = {
    ...s,
    event_key: s.event_key.replace(TICKER, junk),
    source_id: `${junk}:${CLOSE}`,
    evidence: { ...s.evidence, ticker: junk },
  };
  assert.ok(selfConsistent.event_key.includes(`:${junk}:${CLOSE}`));
  refused(selfConsistent, "window-identity");
  const b = SYNTHETIC.book();
  refused({ ...b, event_key: b.event_key.replace(TICKER, junk), source_id: `${junk}:${CLOSE}`, evidence: { ...b.evidence, ticker: junk } }, "window-identity");
});

test("unknown or mismatched record kinds are refused, not guessed", () => {
  const s = SYNTHETIC.alert();
  refused({ ...s, speaker: "SATOSHI" }, "unknown-record");
  refused({ ...s, event_type: "EXPERIMENT_REJECTED" }, "unknown-record");
  refused({ ...s, evidence: { ...s.evidence, kind: "chair-wait" } }, "unknown-record");
  const w = SYNTHETIC.wait();
  refused({ ...w, evidence: { ...w.evidence, wait_reason: "vibes" } }, "missing-fields");
});

test("a WAIT whose saved counts disagree with its roster withholds the agreement claim", () => {
  const s = SYNTHETIC.wait();
  const ev = ok({ ...s, evidence: { ...s.evidence, roster_check: { status: "MISMATCH", note: "SYNTHETIC" } } } as ChamberStatement);
  assert.equal(ev.template_key, "chair.wait.agreement_withheld");
  assert.match(ev.text, /no agreement claim is shown/);
});
