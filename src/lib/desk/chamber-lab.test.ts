import assert from "node:assert/strict";
import { test } from "node:test";
import { labExperimentEvents, type LabExperimentEvidence } from "./chamber-lab.ts";
import { statementFromEvent } from "./chamber-reactions.ts";
import { validateSystemEvent, type PublicSystemEvent } from "./system-events.ts";

const BASE: LabExperimentEvidence = {
  candidate_id: "PROVE120_V1",
  label: "PROVE-120",
  control: false,
  frozen_at: "2026-09-11T13:15:00.000Z",
  why: "require confirmation before holding",
  n: 1,
  paired_n: 1,
  paired_delta: -2.5,
  observed_at: "2026-09-13T15:00:00.000Z",
  control_id: "HOLD_V1",
};

function publicEvent(input: ReturnType<typeof labExperimentEvents>[number]): PublicSystemEvent {
  const ev = validateSystemEvent(input);
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

test("control or empty evidence stays silent", () => {
  assert.deepEqual(labExperimentEvents({ ...BASE, control: true }), []);
  assert.deepEqual(labExperimentEvents({ ...BASE, n: 0 }), []);
  assert.deepEqual(labExperimentEvents({ ...BASE, candidate_id: "" }), []);
});

test("one observation produces only a stable EXPERIMENT_STARTED event", () => {
  const events = labExperimentEvents(BASE);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event_key, "EXPERIMENT_STARTED:PROVE120_V1");
  assert.equal(events[0]?.event_type, "EXPERIMENT_STARTED");
  assert.equal(events[0]?.character, "ALCHEMIST");
  assert.equal(events[0]?.source_type, "experiment");
  assert.equal(events[0]?.source_id, "PROVE120_V1");
  assert.equal(events[0]?.public, true);
  validateSystemEvent(events[0]!);
});

test("nine observations do not manufacture an evidence milestone", () => {
  const events = labExperimentEvents({ ...BASE, n: 9, paired_n: 9 });
  assert.deepEqual(events.map((e) => e.event_type), ["EXPERIMENT_STARTED"]);
});

test("ten observations add the frozen 10-count milestone", () => {
  const events = labExperimentEvents({ ...BASE, n: 10, paired_n: 10 });
  assert.deepEqual(events.map((e) => e.event_key), [
    "EXPERIMENT_STARTED:PROVE120_V1",
    "EXPERIMENT_EVIDENCE_MILESTONE:PROVE120_V1:10",
  ]);
  assert.equal(events[1]?.event_type, "EXPERIMENT_EVIDENCE_MILESTONE");
  assert.match(String((events[1]?.payload as { text?: unknown }).text), /Sample milestone only/);
});

test("25 observations retain stable 10 and 25 milestone identities", () => {
  const events = labExperimentEvents({ ...BASE, n: 25, paired_n: 25 });
  assert.deepEqual(events.map((e) => e.event_key), [
    "EXPERIMENT_STARTED:PROVE120_V1",
    "EXPERIMENT_EVIDENCE_MILESTONE:PROVE120_V1:10",
    "EXPERIMENT_EVIDENCE_MILESTONE:PROVE120_V1:25",
  ]);
});

test("Lab narration never emits a promotion/rejection verdict", () => {
  const events = labExperimentEvents({ ...BASE, n: 999, paired_n: 999, paired_delta: 99 });
  const types = new Set(events.map((e) => e.event_type));
  assert.equal(types.has("EXPERIMENT_REVIEW_READY"), false);
  assert.equal(types.has("EXPERIMENT_REJECTED"), false);
  assert.equal(types.has("EXPERIMENT_INCONCLUSIVE"), false);
});

test("payload states paper-only and no authority", () => {
  const event = labExperimentEvents({ ...BASE, n: 10 })[1]!;
  const payload = event.payload as Record<string, unknown>;
  assert.equal(payload.paper_only, true);
  assert.equal(payload.authority, "none");
  assert.equal(payload.control_id, "HOLD_V1");
  assert.equal(payload.sample_n, 10);
  assert.equal(payload.milestone, 10);
});

test("ALCHEMIST reaction is deterministic and evidence-exact", () => {
  const input = labExperimentEvents({ ...BASE, n: 10, paired_n: 8, paired_delta: -3.25 })[1]!;
  const statement = statementFromEvent(publicEvent(input));
  assert.ok(statement);
  assert.equal(statement!.speaker, "ALCHEMIST");
  assert.equal(statement!.evidence.kind, "experiment");
  assert.equal(statement!.evidence.candidate_id, "PROVE120_V1");
  assert.equal(statement!.evidence.sample_n, 10);
  assert.equal(statement!.evidence.paired_n, 8);
  assert.equal(statement!.evidence.paired_delta, -3.25);
  assert.equal(statement!.evidence.milestone, 10);
  assert.equal(statement!.evidence.control_id, "HOLD_V1");
});

test("ALCHEMIST mapper accepts only implemented experiment lifecycle types", () => {
  const started = publicEvent(labExperimentEvents(BASE)[0]!);
  assert.ok(statementFromEvent(started));
  assert.equal(statementFromEvent({ ...started, event_type: "EXPERIMENT_REVIEW_READY" }), null);
  assert.equal(statementFromEvent({ ...started, event_type: "EXPERIMENT_REJECTED" }), null);
  assert.equal(statementFromEvent({ ...started, event_type: "EXPERIMENT_INCONCLUSIVE" }), null);
});
