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
