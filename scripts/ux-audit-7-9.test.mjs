/**
 * Audit items 7–9: live-floor seat tally, Chamber floor, Lab checkpoint walls.
 * Presentation only. Does not change Chair, book, or policy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("Pro Floor aggregates 15 voting seats and skips pit/retired in WAIT tallies", () => {
  const src = read("src/lib/desk/pro-floor.ts");
  assert.match(src, /aggregated: row != null && !NON_VOTERS.has\(seat\) && !RETIRED.has\(seat\)/);
  assert.match(src, /const voting = seats.filter\(\(s\) => s.aggregated\)/);
  assert.match(src, /wait: voting.length - up - down/);
  assert.doesNotMatch(src, /one of the 18 the Chair aggregates/);
  const families = read("src/components/desk/ProFloor/EvidenceFamilies.tsx");
  assert.match(families, /currently voting/);
  assert.match(families, /COUNCIL_STRUCTURE_SHORT/);
});

test("Chamber collapses repeated WAIT and shows a roster on a quiet floor", () => {
  const room = read("src/components/desk/ChamberRoom.tsx");
  assert.match(room, /quietRangeLine/);
  assert.match(room, /sitStreakLine/);
  assert.match(room, /ChamberRoster/);
  assert.match(room, /Meet the Council/);
  assert.match(room, /COUNCIL_STRUCTURE_SHORT/);
  assert.match(room, /waitFingerprint\(previous\) != null/);
  assert.match(room, /Full evidence · \{count\} WAIT windows/);
  const digest = read("src/lib/desk/chamber-sit-digest.ts");
  assert.match(digest, /Quiet · \$\{count\} windows/);
});

test("quietRangeLine names the window count and UTC span", () => {
  const js = ts.transpileModule(read("src/lib/desk/chamber-sit-digest.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Intl, Date, Number, Math });
  assert.equal(
    exports.quietRangeLine(4, "2026-09-22T12:15:00.000Z", "2026-09-22T13:00:00.000Z"),
    "Quiet · 4 windows · 12:15–13:00 UTC",
  );
  assert.match(exports.sitStreakLine(4), /4 consecutive windows/);
});

test("Lab call-quality uses one checkpoint selector instead of three walls", () => {
  const study = read("src/components/desk/CallQualityStudy.tsx");
  assert.match(study, /Checkpoint selector/);
  assert.match(study, /show all 21/);
  assert.match(study, /SEAT_IDS\.map/);
  assert.match(study, /g\.horizon === checkpoint/);
  assert.match(study, /No observations/);
  assert.equal((study.match(/Why entries were blocked/g) || []).length, 1);
  assert.equal((study.match(/Seat accuracy at this checkpoint/g) || []).length, 1);
});
