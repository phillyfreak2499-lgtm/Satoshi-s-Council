/**
 * Regressions for the Lab front door's summary layer.
 *
 * The live page announced "The study register could not be read this request,
 * so this summary is unavailable" while the detailed Lab underneath rendered
 * current research, including ASK_LEAD. The cause is one-sided:
 * `labRegistrySnapshot` is a cache-only reader that throws while its background
 * scan is warming, and `lab-public` turns that into `registry: null` — but every
 * OTHER study snapshot in the same request queries directly and succeeds.
 *
 * So a null registry means the COUNTS are missing, not the bench. These tests
 * pin down that the summary still lists the bench from the frozen register,
 * withholds every number rather than inventing one, and keeps the live path
 * exactly as it was.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  authorityLabel,
  declaredBench,
  FRONT_DOOR_COPY,
  labFrontDoor,
  PENDING_STATUS,
  statusLabel,
  whyItMatters,
  type FrontDoorRow,
} from "./lab-front-door.ts";
import { LAB_RESEARCH_REGISTRY } from "./lab-registry.ts";
import { RESEARCH_QUIET_NOTICE, researchQuietNoticeHiddenOn } from "./research-quiet-notice.ts";

const row = (over: Partial<FrontDoorRow> = {}): FrontDoorRow => ({
  id: "chair-v2",
  label: "Chair v2",
  type: "decider",
  authority: "none",
  purpose: "Same-time shadow probability sample.",
  cadence: "once per 15m window",
  health: "collecting",
  sample_n: 120,
  last_evidence_at: new Date().toISOString(),
  ...over,
});

test("a populated register still groups into running, learning and not ready", () => {
  const door = labFrontDoor([
    row({ id: "a", label: "A", health: "collecting", sample_n: 120 }),
    row({ id: "b", label: "B", health: "event-driven", sample_n: 4 }),
    row({ id: "c", label: "C", health: "no-sample", sample_n: 0 }),
    row({ id: "d", label: "D", health: "stale", sample_n: 9 }),
  ]);
  assert.deepEqual(door.running.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(door.not_ready.map((c) => c.id), ["c", "d"]);
  assert.deepEqual(door.counts, { running: 2, not_ready: 2, total: 4, with_evidence: 3 });
  assert.ok(door.learning.length > 0, "the learning section reports on the register");
  assert.ok(door.learning.some((t) => t.includes("2 of 4 studies are measuring right now")));
});

test("the learning sentences count the register and never report a finding", () => {
  const door = labFrontDoor([row({ id: "a", sample_n: 500, label: "A" }), row({ id: "b", sample_n: 0, health: "no-sample" })]);
  const text = door.learning.join(" ");
  for (const banned of [/\bwinner\b/i, /\bproven\b/i, /\bbeats\b/i, /outperform/i, /promotion[- ]ready/i]) {
    assert.doesNotMatch(text, banned);
  }
  assert.match(text, /authority: none/);
});

test("ASK_LEAD appears in the running summary once it is collecting", () => {
  const spec = LAB_RESEARCH_REGISTRY.find((s) => s.id === "ask-lead-swap");
  assert.ok(spec, "the ASK_LEAD study is still on the register");
  const door = labFrontDoor([{ ...spec, health: "collecting", sample_n: 12, last_evidence_at: new Date().toISOString() }]);
  assert.deepEqual(door.running.map((c) => c.id), ["ask-lead-swap"]);
  assert.equal(door.running[0].authority, "MEASUREMENT ONLY");
  assert.equal(door.running[0].sample, 12);
});

test("a zero sample prints no number at all rather than a zero", () => {
  const door = labFrontDoor([row({ sample_n: 0, health: "no-sample" })]);
  assert.equal(door.not_ready[0].sample, null);
  assert.equal(door.not_ready[0].status, "no sample yet");
});

test("the declared bench lists every study on the frozen register", () => {
  const cards = declaredBench(LAB_RESEARCH_REGISTRY);
  assert.equal(cards.length, LAB_RESEARCH_REGISTRY.length);
  assert.deepEqual(cards.map((c) => c.id), LAB_RESEARCH_REGISTRY.map((s) => s.id));
});

test("ASK_LEAD is still named when the register is warming", () => {
  const cards = declaredBench(LAB_RESEARCH_REGISTRY);
  const ask = cards.find((c) => c.id === "ask-lead-swap");
  assert.ok(ask, "ASK_LEAD must not vanish from the summary just because counts are late");
  assert.equal(ask.label, "Higher-ask swaps");
  assert.equal(ask.authority, "MEASUREMENT ONLY");
});

test("no sample count is invented while the register is warming", () => {
  for (const c of declaredBench(LAB_RESEARCH_REGISTRY)) {
    assert.equal(c.sample, null, `${c.id} must not carry a count`);
    assert.equal(c.status, PENDING_STATUS);
    assert.doesNotMatch(c.status, /\d/, "the status line carries no number");
  }
});

test("the warming copy says the counts are missing, not the research", () => {
  assert.match(FRONT_DOOR_COPY.pending, /still warming for this request/);
  assert.match(FRONT_DOOR_COPY.pending, /detailed research further down the page is unaffected/);
  assert.match(FRONT_DOOR_COPY.declared, /is the part that is unavailable/);
  assert.doesNotMatch(FRONT_DOOR_COPY.pending, /could not be read/);
});

test("the warming bench still states authority on every card", () => {
  for (const c of declaredBench(LAB_RESEARCH_REGISTRY)) {
    assert.ok(
      ["SHADOW ONLY", "MEASUREMENT ONLY", "AUTHORITY: NONE"].includes(c.authority),
      `${c.id} carries a recorded authority badge`,
    );
  }
});

test("an absent or empty register is still handled without throwing", () => {
  assert.deepEqual(declaredBench(null), []);
  assert.deepEqual(declaredBench(undefined), []);
  assert.deepEqual(declaredBench([]), []);
  const door = labFrontDoor(null);
  assert.deepEqual(door.counts, { running: 0, not_ready: 0, total: 0, with_evidence: 0 });
  assert.deepEqual(door.learning, []);
});

test("authority badges come only from the recorded study type", () => {
  assert.equal(authorityLabel({ type: "decider" }), "SHADOW ONLY");
  assert.equal(authorityLabel({ type: "measurement" }), "MEASUREMENT ONLY");
  assert.equal(authorityLabel({ type: "manual" }), "MEASUREMENT ONLY");
});

test("status wording comes only from the recorded health", () => {
  assert.equal(statusLabel({ health: "collecting" }), "collecting");
  assert.equal(statusLabel({ health: "event-driven" }), "runs on events");
  assert.equal(statusLabel({ health: "stale" }), "no recent evidence");
  assert.equal(statusLabel({ health: "no-sample" }), "no sample yet");
  assert.equal(statusLabel({ health: "manual" }), "run by hand");
});

test("the same purpose wording is produced from a live row and from a frozen spec", () => {
  const spec = LAB_RESEARCH_REGISTRY.find((s) => s.id === "ask-lead-swap");
  assert.ok(spec);
  const live = labFrontDoor([{ ...spec, health: "collecting", sample_n: 3, last_evidence_at: null }]).running[0];
  const declared = declaredBench([spec])[0];
  assert.equal(live.purpose, declared.purpose, "one source of truth for what a study is for");
  assert.equal(live.authority, declared.authority);
  assert.equal(whyItMatters(spec), whyItMatters({ purpose: spec.purpose, cadence: spec.cadence }));
});

test("quiet-floor notice is measurement copy and stays off Lab/Training", () => {
  assert.match(RESEARCH_QUIET_NOTICE.body, /WAIT/);
  assert.match(RESEARCH_QUIET_NOTICE.body, /Paper only/);
  assert.equal(researchQuietNoticeHiddenOn("/lab"), true);
  assert.equal(researchQuietNoticeHiddenOn("/training"), true);
  assert.equal(researchQuietNoticeHiddenOn("/"), false);
});
