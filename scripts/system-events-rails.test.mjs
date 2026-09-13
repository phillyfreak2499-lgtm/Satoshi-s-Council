/**
 * Phase 1A rails: the event writer stays off the decision path,
 * and no decision module grows a call to it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const BANNED_DECISION = [
  "runChair",
  "stickLean",
  "holdScore",
  "noteCall",
  "paperBookEdgeOk",
  "reviewSeats",
  "promoteToLive",
  "evaluateComponentGates",
];

test("the system-event writer does not import or call decision logic", () => {
  const src = codeOf("src/lib/desk/system-events.server.ts");
  const pure = codeOf("src/lib/desk/system-events.ts");
  for (const token of BANNED_DECISION) {
    assert.doesNotMatch(src, new RegExp(`\\b${token}\\b`), `writer mentions ${token}`);
    assert.doesNotMatch(pure, new RegExp(`\\b${token}\\b`), `types mention ${token}`);
  }
  assert.doesNotMatch(src, /from "\.\/chair/);
  assert.doesNotMatch(src, /from "\.\/stick/);
  assert.doesNotMatch(src, /from "\.\/learner/);
  assert.doesNotMatch(src, /from "\.\/engine/);
  assert.doesNotMatch(src, /from "\.\/server-engine/);
  assert.doesNotMatch(src, /from "\.\/book-floor/);
  assert.doesNotMatch(src, /from "\.\/promotion-gates/);
});

test("no decision-path module imports the system-event writer in Phase 1A", () => {
  const desk = join(ROOT, "src/lib/desk");
  const files = readdirSync(desk).filter((n) => n.endsWith(".ts") || n.endsWith(".tsx"));
  const allowed = new Set([
    "system-events.ts",
    "system-events.server.ts",
    "system-events.test.ts",
    "board.ts",
    "chamber-wait.server.ts",
    "chamber-sweep.server.ts",
    "chamber-speech.ts",
  ]);
  for (const name of files) {
    if (allowed.has(name)) continue;
    const src = read(join("src/lib/desk", name));
    assert.doesNotMatch(
      src,
      /system-events\.server/,
      `${name} must not import the system-event writer in Phase 1A`,
    );
    assert.doesNotMatch(src, /recordSystemEvent/, `${name} must not call recordSystemEvent in Phase 1A`);
  }
});

test("PIT_CREW is not a persisted character; reserved Board names cover the group", () => {
  const types = read("src/lib/desk/system-events.ts");
  assert.match(types, /SYSTEM_CHARACTERS/);
  assert.match(types, /"WRENCH"/);
  assert.match(types, /"SWEEP"/);
  assert.match(types, /"COACH"/);
  assert.match(types, /PIT CREW/);
});

test("board.ts rejects reserved public identities and still posts ideas", () => {
  const src = read("src/lib/desk/board.ts");
  assert.match(src, /assertPublicBoardWho/);
  assert.match(src, /systemUpdate/);
  assert.match(src, /from "\.\/system-events"/);
});

test("admin Board update is DESK-only — not a general reserved-name bypass", () => {
  const src = codeOf("src/lib/desk/system-events.ts");
  const fn = src.indexOf("export function assertPublicBoardWho");
  assert.ok(fn >= 0, "assertPublicBoardWho missing");
  const body = src.slice(fn, src.indexOf("export function", fn + 10) === -1 ? src.indexOf("function asOccurredAt", fn) : src.indexOf("export function", fn + 10));
  assert.match(body, /normalizeBoardWho\(who\) === "DESK"/);
  assert.doesNotMatch(body, /if \(adminDeskUpdate\) return/);
  assert.doesNotMatch(body, /if \(systemUpdate\) return/);
});

test("8 existing direct DESK automation is unaffected", () => {
  const engine = read("src/lib/desk/server-engine.ts");
  const recap = read("src/lib/desk/recap.server.ts");
  assert.match(engine, /values \('DESK', \$\{body\}, 'update'/);
  assert.match(recap, /values \('DESK', \$\{body\}, 'update'/);
  assert.doesNotMatch(engine, /recordSystemEvent/);
  assert.doesNotMatch(recap, /recordSystemEvent/);
  assert.doesNotMatch(engine, /assertPublicBoardWho/);
  assert.doesNotMatch(recap, /assertPublicBoardWho/);
});

test("Chair Chamber observer remains an authorized contained producer", () => {
  const producer = read("src/lib/desk/chamber-wait.server.ts");
  const producerCode = producer.slice(producer.indexOf("async function safeRecord"));
  assert.match(producer, /from "\.\/system-events\.server"/);
  assert.match(producerCode, /recordSystemEvent/);
  assert.match(producerCode, /export async function observeChairWaitMilestone/);
  assert.doesNotMatch(producerCode, /method:\s*"POST"/);
  assert.doesNotMatch(producerCode, /createServerFn/);
  assert.doesNotMatch(producerCode, /listPublicSystemEvents/);
  assert.match(producerCode, /try/);
  assert.match(producerCode, /return await recordSystemEvent\(input\)/);
  assert.match(codeOf("src/lib/desk/chamber-wait.ts"), /if \(!why\.wait_reason\) return null/);
});

test("ALCHEMIST Lab reader has evidence access but no event-writer or promotion authority", () => {
  const server = read("src/lib/desk/chamber-lab.server.ts");
  const pure = read("src/lib/desk/chamber-lab.ts");
  assert.match(server, /labStanding/);
  assert.match(server, /EXIT_CANDIDATES/);
  assert.doesNotMatch(server, /system-events\.server/);
  assert.doesNotMatch(server, /recordSystemEvent/);
  assert.doesNotMatch(server, /evaluateComponentGates/);
  assert.doesNotMatch(server, /promoteToLive/);
  assert.doesNotMatch(pure, /getSql/);
  assert.doesNotMatch(pure, /promotion-gates/);
  assert.doesNotMatch(pure, /from "\.\/chair/);
  assert.doesNotMatch(pure, /from "\.\/learner/);
  assert.doesNotMatch(pure, /book-floor/);
  assert.match(pure, /paper_only:\s*true/);
  assert.match(pure, /authority:\s*"none"/);
});

test("ALCHEMIST polling is detached and sparse", () => {
  const producer = read("src/lib/desk/chamber-wait.server.ts");
  assert.match(producer, /LAB_POLL_MS = 60_000/);
  assert.match(
    producer,
    /void observeLabMilestones\(Number\(snap\.as_of\) \|\| Date\.now\(\)\)\.catch\(\(\) => \{\}\);/,
  );
  assert.doesNotMatch(producer, /await observeLabMilestones/);
  assert.match(producer, /seenLabEventKeys/);
});

test("Chamber history cannot be monopolized by one noisy speaker", () => {
  const reader = codeOf("src/lib/desk/system-events.server.ts");
  assert.match(reader, /export async function listPublicChamberEvents/);
  assert.match(reader, /row_number\(\) over \(partition by character/);
  assert.match(reader, /character in \('SATOSHI', 'WARDEN', 'ALCHEMIST', 'SWEEP'\)/);
  assert.match(reader, /speaker_rank <=/);
});

test("Chamber speech remains a read-only GET surface", () => {
  const speech = read("src/lib/desk/chamber-speech.ts");
  const speechCode = codeOf("src/lib/desk/chamber-speech.ts");
  assert.match(speech, /createServerFn\(\{\s*method:\s*"GET"\s*\}\)/);
  assert.match(speechCode, /listPublicChamberEvents\(5\)/);
  assert.doesNotMatch(speechCode, /method:\s*"POST"/);
  assert.doesNotMatch(speechCode, /recordSystemEvent/);
  assert.doesNotMatch(speechCode, /observeChairWaitMilestone/);
});

test("Chair and chair-v2 cannot import Chamber writers", () => {
  for (const rel of ["src/lib/desk/chair.ts", "src/lib/desk/chair-v2.ts"]) {
    const src = read(rel);
    assert.doesNotMatch(src, /recordSystemEvent/);
    assert.doesNotMatch(src, /chamber-wait/);
    assert.doesNotMatch(src, /chamber-health/);
    assert.doesNotMatch(src, /chamber-lab/);
    assert.doesNotMatch(src, /chamber-sweep/);
    assert.doesNotMatch(src, /chamber-reactions/);
    assert.doesNotMatch(src, /observeChairWaitMilestone/);
  }
});

test("server-engine may observe but cannot import recordSystemEvent", () => {
  const src = read("src/lib/desk/server-engine.ts");
  assert.doesNotMatch(src, /recordSystemEvent/);
  assert.doesNotMatch(src, /from "\.\/system-events\.server"/);
  assert.doesNotMatch(src, /from "\.\/chamber-reactions"/);
  assert.doesNotMatch(src, /chamber-lab/);
  assert.doesNotMatch(src, /chamber-sweep/);
  assert.doesNotMatch(src, /listChamberSpeech/);
  assert.match(src, /from "\.\/chamber-wait\.server"/);
  const iFn = src.indexOf("function noteDecisionSnapshot");
  const iTick = src.indexOf("async function tick(", iFn);
  assert.ok(iFn >= 0 && iTick > iFn, "noteDecisionSnapshot exists before tick");
  const nds = src.slice(iFn, iTick);
  const iGuard = nds.indexOf("tickerAgrees(snap.ticker, snap.close_time) === false");
  const iReturn = nds.indexOf("return;", iGuard);
  const iObs = nds.indexOf("observeChairWaitMilestone");
  const iRecord = nds.indexOf("recordDecisionSnapshot(row)");
  assert.ok(iGuard >= 0 && iReturn > iGuard, "identity reject+return present");
  assert.ok(iObs > iReturn, "observer is after tickerAgrees false return");
  assert.ok(iRecord > iObs, "decision snapshot persistence still follows observer");
  assert.match(nds, /void observeChairWaitMilestone\(snap, chair, e\.callLog\)\.catch\(/);
  assert.doesNotMatch(nds, /await observeChairWaitMilestone/);
});

test("paper-book modules cannot import Chamber reaction or producer code", () => {
  for (const rel of [
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/paper-book-edge.test.ts",
    "src/lib/desk/books.ts",
    "src/lib/desk/books.server.ts",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /chamber-wait/);
    assert.doesNotMatch(src, /chamber-health/);
    assert.doesNotMatch(src, /chamber-lab/);
    assert.doesNotMatch(src, /chamber-sweep/);
    assert.doesNotMatch(src, /chamber-reactions/);
    assert.doesNotMatch(src, /recordSystemEvent/);
  }
});

test("Chamber UI is read-only — no system-event write", () => {
  for (const rel of ["src/components/desk/Chamber.tsx", "src/components/desk/ChamberSpeech.tsx", "src/components/desk/ChamberRoom.tsx"]) {
    const src = read(rel);
    const code = codeOf(rel);
    assert.doesNotMatch(src, /recordSystemEvent/);
    assert.doesNotMatch(src, /observeChairWaitMilestone/);
    assert.doesNotMatch(code, /method:\s*"POST"/);
    assert.doesNotMatch(code, /createServerFn/);
  }
  assert.match(read("src/components/desk/Chamber.tsx"), /ChamberSpeech/);
  assert.match(read("src/components/desk/ChamberSpeech.tsx"), /from "@\/lib\/desk\/chamber-speech"/);
  assert.doesNotMatch(read("src/components/desk/ChamberSpeech.tsx"), /chamber-wait\.server/);
  assert.match(codeOf("src/lib/desk/chamber-speech.ts"), /listPublicChamberEvents\(5\)/);
});

test("Chamber speakers are evidence-backed SATOSHI + WARDEN + ALCHEMIST + SWEEP only", () => {
  const code = codeOf("src/lib/desk/chamber-reactions.ts");
  assert.match(code, /speaker:\s*"SATOSHI"/);
  assert.match(code, /speaker:\s*"WARDEN"/);
  assert.match(code, /speaker:\s*"ALCHEMIST"/);
  assert.match(code, /speaker:\s*"SWEEP"/);
  assert.match(code, /ev\.event_type === "CHAIR_WAIT_MILESTONE"/);
  assert.match(code, /ev\.event_type === "SYSTEM_HEALTH_ALERT"/);
  assert.match(code, /ev\.event_type === "SYSTEM_HEALTH_RECOVERED"/);
  assert.match(code, /ev\.event_type === "EXPERIMENT_STARTED"/);
  assert.match(code, /ev\.event_type === "EXPERIMENT_EVIDENCE_MILESTONE"/);
  assert.match(code, /ev\.event_type === "DESK_UPDATE" && ev\.character === "SWEEP" && ev\.payload\.kind === "sweep-seat-audit"/);
  assert.doesNotMatch(code, /ev\.event_type === "EXPERIMENT_REVIEW_READY"/);
  assert.doesNotMatch(code, /ev\.event_type === "EXPERIMENT_REJECTED"/);
  for (const who of ["WRENCH", "COACH", "DESK"]) {
    assert.doesNotMatch(code, new RegExp(`speaker:\\s*"${who}"`), `${who} must not speak`);
  }
  const wait = codeOf("src/lib/desk/chamber-wait.ts");
  const health = codeOf("src/lib/desk/chamber-health.ts");
  const lab = codeOf("src/lib/desk/chamber-lab.ts");
  const sweep = codeOf("src/lib/desk/chamber-sweep.ts");
  assert.match(wait, /character:\s*"SATOSHI"/);
  assert.match(health, /character:\s*"WARDEN"/);
  assert.match(lab, /character:\s*"ALCHEMIST"/);
  assert.match(sweep, /character:\s*"SWEEP"/);
  assert.match(sweep, /authority:\s*"none"/);
  assert.doesNotMatch(health, /recordSystemEvent/);
  assert.doesNotMatch(lab, /recordSystemEvent/);
  assert.doesNotMatch(sweep, /recordSystemEvent/);
  assert.doesNotMatch(health, /from "\.\/chair/);
  assert.doesNotMatch(health, /from "\.\/learner/);
  assert.doesNotMatch(sweep, /from "\.\/chair/);
  assert.doesNotMatch(sweep, /from "\.\/learner/);
});
