import assert from "node:assert/strict";
import test from "node:test";
import { diffStatuses, skillStatusSnapshot, transitionEvent } from "./status-transitions.ts";
import { validateSystemEvent } from "./system-events.ts";
import type { Learner, SkillCard } from "./types";

const learner = (statuses: Record<string, SkillCard["status"]>): Pick<Learner, "skills"> => ({ skills: Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { id, owner: id.split(".")[0], status } as unknown as SkillCard])) });

test("a diff names every transition once with a deterministic key; identical snapshots produce nothing", () => {
  const before = skillStatusSnapshot(learner({ "STRIKE.itm_time": "LIVE", "STREAK.continue_young": "SHADOW" }));
  const after = skillStatusSnapshot(learner({ "STRIKE.itm_time": "BENCH", "STREAK.continue_young": "SHADOW", "STRIKE.rethink_x": "SHADOW" }));
  const t = diffStatuses(before, after, 1_790_000_000_000, "reviewSeats");
  assert.deepEqual(t.map((x) => `${x.card}:${x.from}->${x.to}`), ["STRIKE.itm_time:LIVE->BENCH", "STRIKE.rethink_x:NEW->SHADOW"]);
  assert.deepEqual(diffStatuses(after, after, 1, "x"), []);
  const ev = transitionEvent(t[0]!);
  assert.equal(ev.event_key, "SKILL_STATUS:STRIKE.itm_time:LIVE_to_BENCH:1790000000000");
  assert.equal(transitionEvent(t[0]!).event_key, ev.event_key, "the same transition always yields the same key: insert-once makes it idempotent");
  assert.equal(ev.public, false);
  const validated = validateSystemEvent(ev);
  assert.equal(validated.character, "COACH");
  assert.equal(validated.event_type, "DESK_UPDATE");
  assert.equal((validated.payload as { authority: string }).authority, "none");
});

test("the engine-side queue is bounded, drops count instead of throwing, and drains oldest first", async () => {
  const { queueStatusTransitions, drainStatusTransitions, statusTransitionBufferStats, STATUS_TRANSITION_BUFFER_MAX } = await import("./status-transitions.ts");
  drainStatusTransitions();
  assert.equal(queueStatusTransitions({ "A.x": "LIVE" }, { "A.x": "BENCH" }, "reviewSeats", 7), 1);
  assert.equal(queueStatusTransitions({ "A.x": "BENCH" }, { "A.x": "BENCH" }, "runHuddle", 8), 0);
  for (let i = 0; i < STATUS_TRANSITION_BUFFER_MAX + 2; i += 1) queueStatusTransitions({ "B.y": "LIVE" }, { "B.y": "SHADOW" }, "runHuddle", 100 + i);
  const stats = statusTransitionBufferStats();
  assert.equal(stats.pending, STATUS_TRANSITION_BUFFER_MAX);
  assert.equal(stats.dropped, 3, "the first (A.x) and two B.y entries were dropped, oldest first");
  const first = drainStatusTransitions(1)[0]!;
  assert.deepEqual({ card: first.card, at_ms: first.at_ms }, { card: "B.y", at_ms: 102 });
  assert.equal(statusTransitionBufferStats().pending, STATUS_TRANSITION_BUFFER_MAX - 1);
  drainStatusTransitions();
});
