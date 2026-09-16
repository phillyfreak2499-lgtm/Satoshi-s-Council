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

test("GAVEL pairs a booked side with the booked score frame and a skipped read with its first directional frame", () => {
  const brief = read("src/lib/desk/brief.server.ts");
  const gavel = read("src/lib/desk/gavel.ts");
  assert.match(brief, /entry_lean/);
  assert.match(brief, /entry_conf/);
  assert.match(brief, /entry_score/);
  assert.match(brief, /entry_bar/);
  assert.match(brief, /snapshot_kind = 'FIRST_DIRECTIONAL'/);
  assert.match(brief, /toGavelRow/);

  const source = compact(gavel);
  assert.match(source, /constbooked=paper==="FILLED"/);
  assert.match(source, /booked\?r\.entry_conf\?\?r\.chair_conf:skipped\?r\.first_directional_conf\?\?r\.chair_conf:r\.chair_conf/);
  assert.match(source, /booked\?r\.entry_score\?\?r\.score:skipped\?r\.first_directional_score\?\?r\.score:r\.score/);
  assert.match(source, /booked\?r\.entry_bar\?\?r\.bar:skipped\?r\.first_directional_bar\?\?r\.bar:r\.bar/);
});

test("GAVEL never gives a skipped read paper settlement or EV", () => {
  const gavel = compact(read("src/lib/desk/gavel.ts"));
  assert.match(gavel, /settle:booked&&r\.settle_cents!=null\?Number\(r\.settle_cents\):null/);
  assert.match(gavel, /ev:booked&&r\.ev_cents!=null\?Math\.round\(Number\(r\.ev_cents\)\*10\)\/10:null/);
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

test("GAVEL labels Chair evidence separately from paper action", () => {
  const tab = read("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /<th>chair<\/th>/);
  assert.match(tab, /<th>paper<\/th>/);
  assert.match(tab, /g\.paper === "SKIPPED"/);
  assert.match(tab, /skipped reads never enter paper P&L/);
  assert.ok(
    !tab.includes(">gate conf<"),
    "the historical column must not imply every row is a close-frame gate",
  );
});
