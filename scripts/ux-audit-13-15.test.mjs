/**
 * Audit 13–15: SSR training stations, WICK/Alchemist framing, private contact path.
 * Presentation only. Does not change Chair, book, or policy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

function load(rel) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports });
  return exports;
}

test("training station renders lesson text and guided questions without the iframe", () => {
  const station = read("src/components/desk/TrainingStation.tsx");
  assert.match(station, /stationCopy/);
  assert.match(station, /Guided questions/);
  assert.match(station, /LESSON_ONE/);
  assert.match(station, /Open-ended AI conversation is not connected/);
  assert.match(station, /training-desk/);
  const { stationCopy, plainSeatNote, WICK_ROLE_LINE } = load("src/lib/desk/training.ts");
  const wick = stationCopy("wick");
  assert.equal(wick.coach.name, "WICK");
  assert.ok(wick.questions.length >= 3);
  assert.match(wick.questions[0].q, /waiting/i);
  assert.match(WICK_ROLE_LINE, /reads candles on the floor/);
  assert.match(WICK_ROLE_LINE, /teaches the same read in training/);
  const note = plainSeatNote({ pattern: "HAR UL", location: "MID", pending: true });
  assert.match(note, /Bull harami/);
  assert.match(note, /HAR UL/);
  assert.match(note, /middle of the recent range \(MID\)/);
  assert.match(note, /next candle to close/);
  assert.doesNotMatch(note, /HAR UL at MID — waiting confirm close/);
  const raw = plainSeatNote({ reasoning: "HAR UL at MID — waiting confirm close" });
  assert.match(raw, /bull harami \(HAR UL\)/);
  assert.match(raw, /middle of the recent range \(MID\)/);
});

test("WICK station invites guided questions, not an open AI line", () => {
  const html = read("public/training-desk/wick/index.html");
  const home = read("src/components/desk/TrainingHome.tsx");
  assert.match(html, /Guided questions/);
  assert.doesNotMatch(html, /screen-title">Ask WICK/);
  assert.match(html, /Pick a guided question/);
  assert.match(html, /Open-ended AI conversation is not connected/);
  assert.match(home, /Guided questions/);
  assert.match(home, /WICK_ROLE_LINE/);
  const js = read("public/training-desk/wick/plain-seat-note.js") + read("public/training-desk/wick/main.js");
  assert.match(js, /plainSeatNote/);
  assert.match(js, /HAR UL/);
  assert.match(js, /next candle to close/);
});

test("Alchemist is framed as Lab and linked there; WICK dual-role is explicit", () => {
  const guided = read("src/components/desk/GuidedFloorView.tsx");
  const { WICK_ROLE_LINE, ALCHEMIST_ROLE_LINE } = load("src/lib/desk/training.ts");
  assert.match(guided, /WICK_ROLE_LINE/);
  assert.match(guided, /ALCHEMIST_ROLE_LINE/);
  assert.match(guided, /href="\/lab"/);
  assert.match(ALCHEMIST_ROLE_LINE, /Lab/);
  assert.doesNotMatch(WICK_ROLE_LINE, /Alchemist/);
});

test("legal contact markers are hidden before they can enter the public Board", () => {
  const legal = read("src/routes/legal.tsx");
  const board = read("src/lib/desk/board.ts");
  const feedback = read("src/components/desk/Feedback.tsx");
  const { privateBoardContactKind } = load("src/lib/desk/public-room-view.ts");
  assert.equal(privateBoardContactKind("LEGAL\nA legal note"), "LEGAL");
  assert.equal(privateBoardContactKind("TRADEMARK\nA mark note"), "TRADEMARK");
  assert.equal(privateBoardContactKind("SECURITY\nA security note"), "SECURITY");
  assert.equal(privateBoardContactKind("security\nnot exact"), null);
  assert.match(legal, /hidden from the public Board on submission/);
  assert.match(board, /privateBoardContactKind\(body\)/);
  assert.match(board, /hidden, moderation_reason/);
  assert.match(board, /board_moderation_log/);
  assert.match(feedback, /Sent privately to desk moderation/);
  assert.doesNotMatch(legal, /The desk has no mailbox/);
  const smoke = read("scripts/live-public-smoke.mjs");
  assert.match(smoke, /LEGAL, TRADEMARK or SECURITY/);
});
