import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("window path research is pure and has no decision consumer", () => {
  const pure = read("src/lib/desk/window-path.ts");
  const code = pure
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
  assert.doesNotMatch(code, /^import\s/m, "the calculator remains a pure leaf");
  assert.doesNotMatch(code, /Chair|Vote|Learner|SeatId|fetch\(|getSql|process\.env/);

  for (const rel of [
    "bots.ts",
    "chair.ts",
    "chair-v2.ts",
    "dsl.ts",
    "features.ts",
    "learner.ts",
    "skills.ts",
    "thresholds.ts",
    "book-floor.ts",
  ]) {
    assert.ok(
      !read(`src/lib/desk/${rel}`).includes("window-path"),
      `${rel} must not import measurement-only window paths`,
    );
  }
});

test("path statistics are created only at replay finalization", () => {
  const replay = read("src/lib/desk/replay.server.ts");
  const noteStart = replay.indexOf("export function noteReplay(");
  const recordStart = replay.indexOf("export async function recordReplay(");
  const pruneStart = replay.indexOf("export async function pruneReplays(");
  assert.ok(noteStart >= 0 && recordStart > noteStart && pruneStart > recordStart);
  assert.doesNotMatch(
    replay.slice(noteStart, recordStart),
    /measureWindowPath\(/,
    "the live tick recorder cannot calculate path statistics",
  );
  assert.match(
    replay.slice(recordStart, pruneStart),
    /const pathStats = measureWindowPath\(/,
    "only the graded replay writer calculates the summary",
  );
  assert.match(replay.slice(recordStart, pruneStart), /path_stats/);
});

test("the path migration creates storage only and never backfills history", () => {
  const sql = read("migrations/0037_desk_window_path.sql");
  const code = sql.replace(/--.*$/gm, " ");
  assert.match(code, /alter table desk_replay/i);
  assert.match(code, /add column if not exists path_stats jsonb/i);
  assert.doesNotMatch(code, /\bupdate\b|\binsert\b|\bselect\b|\bdelete\b/i);
});
