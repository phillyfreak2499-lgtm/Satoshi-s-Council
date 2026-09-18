import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_UPDATE_MAX, DESK_UPDATES } from "./updates.ts";

test("every desk note fits the Board whole, so none can be clipped mid-word on the way in", () => {
  assert.ok(DESK_UPDATES.length > 0);
  for (const u of DESK_UPDATES) {
    const body = u.body.replace(/\s+/g, " ").trim();
    assert.ok(body.length > 0, `${u.slug}: empty note`);
    assert.ok(body.length <= BOARD_UPDATE_MAX, `${u.slug}: ${body.length} chars; the Board takes ${BOARD_UPDATE_MAX}`);
  }
});

test("every note has its own slug", () => {
  const seen = new Set<string>();
  for (const u of DESK_UPDATES) {
    assert.ok(u.slug.length > 0, "empty slug");
    assert.ok(!seen.has(u.slug), `${u.slug}: posted twice`);
    seen.add(u.slug);
  }
});

test("the Board is seeded with the desk's own house notes, dated as DESK posts, one slug each", () => {
  const seeds = DESK_UPDATES.filter((u) => u.slug.startsWith("2026-09-18-"));
  assert.ok(seeds.length >= 3, `at least three DESK seeds, found ${seeds.length}`);
  const bodies = seeds.map((u) => u.body);
  assert.ok(bodies.some((b) => b.startsWith("The Board is open.")));
  assert.ok(bodies.some((b) => b.startsWith("WAIT is a decision.")));
  assert.ok(bodies.some((b) => b.startsWith("The Arena is paper.")));
  for (const b of bodies) assert.doesNotMatch(b, /\bbuy\b|signal|lock this/i, "paper talk only");
});
