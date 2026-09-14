import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const compact = (source) => source.replace(/\s+/g, "");

test("the booked decision receipt is captured at entry and persisted at grade", () => {
  const engine = read("src/lib/desk/server-engine.ts");
  assert.match(engine, /sanitizeBookedDecisionState\(raw\.entry_state\)/);
  assert.match(engine, /lean:\s*chair\.lean/);
  assert.match(engine, /build_sha:\s*runningBuildSha\(\)/);
  assert.match(
    compact(engine),
    /bookedDecisionAtGrade\(e\.callLog,snap\.ticker,snap\.close_time,entry,?\)/,
  );
  assert.match(engine, /entry_lean, entry_build_sha/);
  assert.match(engine, /booked\?\.lean \?\? null/);
  assert.match(engine, /booked\?\.build_sha \?\? null/);
});

test("GAVEL pairs a booked side with the booked score frame", () => {
  const brief = read("src/lib/desk/brief.server.ts");
  assert.match(brief, /entry_lean/);
  assert.match(brief, /entry_conf/);
  assert.match(brief, /entry_score/);
  assert.match(brief, /entry_bar/);
  assert.match(brief, /const booked = r\.entry_cents != null/);
  const source = compact(brief);
  assert.match(
    source,
    /booked\?\(?r\.entry_conf\?\?r\.chair_conf\)?:r\.chair_conf/,
  );
  assert.match(source, /booked\?\(?r\.entry_score\?\?r\.score\)?:r\.score/);
  assert.match(source, /booked\?\(?r\.entry_bar\?\?r\.bar\)?:r\.bar/);
});

test("the mirror is prospective, quality-filtered, and disconnected from decisions", () => {
  const migration = read("migrations/0031_desk_booked_decision_mirror.sql");
  assert.match(migration, /create view desk_booked_chair_mirror/);
  assert.match(migration, /from desk_ledger/);
  assert.match(migration, /research_quality = 'valid'/);
  assert.match(migration, /entry_lean = winner/);
  assert.ok(
    !/\binsert\b|\bupdate\b|\bdelete from\b/i.test(
      migration.replace(/^--.*$/gm, ""),
    ),
    "migration must not backfill or rewrite evidence",
  );
  for (const path of [
    "src/lib/desk/chair.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/thresholds.ts",
  ]) {
    assert.ok(
      !read(path).includes("desk_booked_chair_mirror"),
      `${path} reads the mirror`,
    );
  }
});

test("GAVEL labels historical values as decision-frame evidence", () => {
  const tab = read("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /decision conf/);
  assert.match(tab, /decision score \/ bar/);
  assert.ok(
    !tab.includes(">gate conf<"),
    "the historical column must not imply every row is a close-frame gate",
  );
});
