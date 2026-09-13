import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("SWEEP Chamber speech is sourced from persisted crew-log transitions", () => {
  const observer = read("src/lib/desk/chamber-sweep.server.ts");
  const builder = read("src/lib/desk/chamber-sweep.ts");
  assert.match(observer, /from desk_crew_log/);
  assert.match(observer, /who = 'SWEEP'/);
  assert.match(observer, /action in \('flag', 'clear'\)/);
  assert.match(builder, /event_type: "DESK_UPDATE"/);
  assert.match(builder, /character: "SWEEP"/);
  assert.match(builder, /authority: "none"/);
});

test("SWEEP speech cannot mutate Chair, learner, seats, or paper book", () => {
  const files = [
    read("src/lib/desk/chamber-sweep.ts"),
    read("src/lib/desk/chamber-sweep.server.ts"),
  ].join("\n");
  assert.doesNotMatch(files, /from ["']\.\/chair["']/);
  assert.doesNotMatch(files, /from ["']\.\/learner["']/);
  assert.doesNotMatch(files, /noteCall|markSide|paperBookEdgeOk|coachDecide|sweepFlags/);
  assert.doesNotMatch(files, /update desk_|delete from desk_|insert into desk_crew/);
});

test("daily SWEEP owns the fact; Chamber mirror is non-blocking", () => {
  const crew = read("src/lib/desk/crew.server.ts");
  assert.match(crew, /await log\("SWEEP"/);
  assert.match(crew, /void import\("\.\/chamber-sweep\.server"\)/);
  assert.match(crew, /\.catch\(\(\) => \{\}\)/);
});

test("public mapper and room expose SWEEP evidence without a write path", () => {
  const reactions = read("src/lib/desk/chamber-reactions.ts");
  const room = read("src/components/desk/ChamberRoom.tsx");
  assert.match(reactions, /speaker: "SWEEP"/);
  assert.match(reactions, /kind: "seat-audit"/);
  assert.match(room, /daily evidence sweep flags or clears a seat condition/);
  assert.match(room, /ask economics/);
  assert.doesNotMatch(room, /recordSystemEvent|system-events\.server|method:\s*["']POST["']/);
});
