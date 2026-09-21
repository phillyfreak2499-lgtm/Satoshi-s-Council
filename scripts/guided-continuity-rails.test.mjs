/**
 * Continuity, the Lab front door, sharing and the funnel — the boundaries.
 *
 * Everything this PR adds is presentation over state the desk already records.
 * That is easy to say and easy to erode: a "what would change?" card is one
 * edit away from inventing a condition, a "what happened?" card is one edit
 * away from re-grading a window, and a Lab summary is one adjective away from
 * calling something proven. These rails pin the boundary rather than the
 * wording, so a future change has to cross a line on purpose.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) =>
  read(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CONT = "src/lib/desk/guided-continuity.ts";
const DOOR = "src/lib/desk/lab-front-door.ts";
const GUIDED = "src/components/desk/GuidedFloor.tsx";
const APP = "src/components/desk/DeskApp.tsx";
const BEACON = "src/lib/desk/beacon.ts";

// ---------------------------------------------------------------------------
// 1. The two floors stay two floors
// ---------------------------------------------------------------------------

test("Guided and Pro remain separate render paths, and nothing new merges them", () => {
  const app = codeOf(APP);
  assert.match(app, /floorMode === "guided" && \(\s*\n\s*<GuidedFloor/);
  assert.match(app, /floorMode === "pro" && \(\s*\n\s*<SatoshiTab/);
  assert.equal(app.split("<GuidedFloor").length - 1, 1);
  assert.equal(app.split("<SatoshiTab").length - 1, 1);
  assert.match(read("src/components/desk/prefs.ts"), /export type FloorMode = "pro" \| "guided";/);
  // The new cards live in Guided only; the Pro Floor does not grow a copy.
  for (const tag of ["<WhatWouldChange", "<WhatHappened"]) {
    assert.ok(codeOf(GUIDED).includes(tag), `${tag} renders on the Guided Floor`);
    assert.ok(!codeOf("src/components/desk/SatoshiTab.tsx").includes(tag), `${tag} must not appear on the Pro Floor`);
  }
});

// ---------------------------------------------------------------------------
// 2-3. "What would change?" reads Chair state, and can never write it
// ---------------------------------------------------------------------------

test("what-would-change reads the Chair's own gate state and sets no thresholds of its own", () => {
  const src = codeOf(CONT);
  // It delegates to the Chair's published reasoning rather than recomputing it.
  assert.match(src, /whyFacts\(chair, plain\)/, "the Chair's own why-facts are the source");
  assert.match(src, /w\.failed_hard\.map\(conditionFor\)/, "conditions come from the failing hard gates");
  assert.match(src, /w\.more_than_one_thing_missing/, "the multi-blocker flag is the Chair's, not ours");
  assert.match(src, /invalidateCondition\(w\.invalidate_if\)/, "the end condition is the recorded one");
  // No new threshold: the only comparisons are on counts and lengths, never on
  // a score, a bar, a confidence or a price.
  for (const banned of [
    /chair\.score\s*[<>]/,
    /chair\.bar\s*[<>]/,
    /Math\.abs\(chair\.score\)/,
    /confidence\s*[<>]/,
    /SPEAK_CONF/,
    /\bsit_mass\b/,
  ]) {
    assert.doesNotMatch(src, banned, `guided-continuity must not introduce ${banned}`);
  }
});

test("the card cannot write Chair, seat, learner or booking state", () => {
  for (const rel of [CONT, DOOR, GUIDED, "src/components/desk/LabFrontDoor.tsx"]) {
    const src = codeOf(rel);
    for (const banned of [
      "runChair",
      "runBots",
      "setKnob",
      "noteCall",
      "applyDeskOp",
      "promoteToLive",
      "getSql",
      "insert into",
      "update desk",
      "createServerFn",
      "learner.",
      "bookFloor(",
    ]) {
      assert.ok(!src.includes(banned), `${rel} must not reference ${banned}`);
    }
  }
  // The pure modules import nothing that could write.
  const imports = [...read(CONT).matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.slice().sort(), ["./floor-clarity.ts", "./record.ts"], "two pure dependencies");
});

test("it never promises a call, a probability, or a certainty", () => {
  const src = read(CONT);
  assert.match(
    src,
    /Clearing any one of these would not by itself produce a call/,
    "the closing line refuses the tempting wrong reading",
  );
  assert.match(src, /not a prediction/, "a directional read is not sold as a forecast");
  const claims = codeOf(CONT);
  for (const banned of [/\bwill happen\b/i, /\bguarantee/i, /\bchance of winning\b/i, /win probability/i, /\d+% chance/i]) {
    assert.doesNotMatch(claims, banned, `the card must not say ${banned}`);
  }
  // Gate confidence never becomes a percentage here.
  assert.doesNotMatch(codeOf(CONT), /confidence/i, "confidence is not restated in beginner copy at all");
});

// ---------------------------------------------------------------------------
// 4-5. The result card reads the record, and grades nothing
// ---------------------------------------------------------------------------

test("what-happened reads recorded result fields only", () => {
  const src = codeOf(CONT);
  assert.match(src, /last\.winner !== "UP" && last\.winner !== "DOWN"/, "the official side is read, never derived");
  assert.match(src, /last\.call/, "the paper position is the recorded call");
  assert.match(src, /call\.ev/, "the paper result is the recorded after-fee value");
  // It refuses to describe a window it cannot describe.
  assert.match(src, /return null;/, "no graded window means no card");
  // And it never asserts a Council read that this shape does not record.
  assert.match(read(CONT), /Printing "WAIT" there would be a guess/, "the missing-lean case is reasoned about, not filled in");
});

test("no settlement, grading or pricing logic exists in the new UI", () => {
  for (const rel of [CONT, DOOR, GUIDED, "src/components/desk/LabFrontDoor.tsx", "src/routes/window.$ticker.tsx"]) {
    const src = codeOf(rel);
    for (const banned of [
      "settleCents",
      "officialValue",
      "isSettled",
      "expiration_value",
      "takerFee",
      "takerFeeCents",
      "gradeWindow",
      "outcomeForStrike",
      "brier(",
    ]) {
      assert.ok(!src.includes(banned), `${rel} must not compute settlement or grading (${banned})`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6-7. The Lab front door is read-only and truthful about authority
// ---------------------------------------------------------------------------

test("the Lab summary is read-only and adds no study", () => {
  const src = codeOf(DOOR);
  assert.doesNotMatch(src, /insert into|update desk|delete from|createServerFn|getSql/i, "it reads, it never writes");
  // It only groups rows it is handed; it does not fetch or build a registry.
  assert.match(src, /export function labFrontDoor\(rows: readonly FrontDoorRow\[\]/);
  assert.doesNotMatch(src, /fetch\(/);
  // The existing bench is still rendered underneath.
  const room = codeOf("src/components/desk/LabRoom.tsx");
  assert.match(room, /<LabFrontDoor registry=\{data\.registry\} \/>/);
  assert.match(room, /<ResearchRegistry data=\{data\.registry\} \/>/, "the detailed registry stays");
  for (const study of ["CallQualityStudy", "ForcedV4Study", "OpenAIShadowStudy", "AstraDirectorStudy", "AskLeadStudy"]) {
    if (read("src/components/desk/LabRoom.tsx").includes(study)) {
      assert.ok(room.includes(study), `${study} must still render below the front door`);
    }
  }
});

test("no study is called a winner, proven, or promotion ready", () => {
  const src = codeOf(DOOR) + codeOf("src/components/desk/LabFrontDoor.tsx");
  for (const banned of [/\bwinner\b/i, /best bot/i, /promotion[- ]ready/i, /\bproven\b/i, /\boutperform/i, /\bbeats\b/i]) {
    assert.doesNotMatch(src, banned, `the front door must not print ${banned}`);
  }
  // Authority is stated on every card, and only from the recorded type.
  assert.match(codeOf(DOOR), /export function authorityLabel\(/);
  for (const label of ["SHADOW ONLY", "MEASUREMENT ONLY", "AUTHORITY: NONE"]) {
    assert.ok(read(DOOR).includes(label), `${label} is an available authority badge`);
  }
  assert.match(read(DOOR), /authority: "none"/, "the row type pins authority to none");
  // "What we're learning" lists questions, not answers.
  assert.match(read(DOOR), /open questions under measurement, not answers/);
});

// ---------------------------------------------------------------------------
// 8. Sharing prints recorded fields only
// ---------------------------------------------------------------------------

test("the share text is built from recorded window fields and makes no claim", () => {
  const src = codeOf(CONT);
  assert.match(src, /export function shareWindowText\(/);
  assert.match(src, /Paper only\. No live orders\./, "the footer survives every share");
  assert.match(src, /input\.winner \?\? "not settled yet"/, "an unsettled window says so");
  assert.match(src, /if \(input\.read\) lines\.push/, "a read is printed only when one was recorded");
  for (const banned of [/\bstreak\b/i, /win rate/i, /\bprofit\b/i, /we called it/i, /\baccuracy\b/i]) {
    assert.doesNotMatch(codeOf(CONT), banned, `the share text must not advertise ${banned}`);
  }
  // The window page fills it from the replay it already loaded, and invents no reason.
  const page = codeOf("src/routes/window.$ticker.tsx");
  assert.match(page, /shareWindowText\(\{/);
  assert.match(page, /why: null/, "no reason string is recorded on the replay, so none is composed");
  assert.match(page, /replay\.cols\.lean/, "the read comes from the recorded lean");
});

// ---------------------------------------------------------------------------
// 9-10. Analytics carry navigation only, and no order path exists
// ---------------------------------------------------------------------------

test("the funnel events are navigation only and carry no trading action", () => {
  const src = read(BEACON);
  const union = src.slice(src.indexOf("export type BeaconEvent"), src.indexOf("export function beacon"));
  for (const e of [
    "home_guided_click",
    "home_pro_click",
    "floor_guided_open",
    "floor_pro_open",
    "guided_to_pro",
    "guided_to_wick",
    "window_replay_open",
    "results_open",
    "window_copy",
    "record_copy",
  ]) {
    assert.ok(union.includes(`"${e}"`), `${e} is declared`);
    assert.doesNotMatch(e, /buy|sell|order|trade|wallet|size|stake|bet/i, `${e} must not name a trading action`);
  }
  // The payload is still the event name and nothing else — no new stack, no profile.
  assert.match(src, /const body = JSON\.stringify\(\{ event \}\);/, "the beacon still sends only the name");
  assert.doesNotMatch(src, /userId|user_id|email|wallet|fingerprint|localStorage\.getItem\("id/i);
  assert.doesNotMatch(src, /amplitude|segment|mixpanel|posthog|gtag\(/i, "no second analytics stack");
});

test("no order, wallet or broker path exists anywhere in the new surfaces", () => {
  for (const rel of [
    CONT,
    DOOR,
    GUIDED,
    "src/components/desk/LabFrontDoor.tsx",
    "src/routes/window.$ticker.tsx",
    "src/routes/desk.tsx",
    BEACON,
  ]) {
    const src = codeOf(rel);
    for (const banned of [
      "portfolio/orders",
      "createOrder",
      "placeOrder",
      "submitOrder",
      "wallet",
      "withdraw",
      "deposit",
      "KALSHI_API_KEY",
      "PRIVATE_KEY",
      "signRequest",
    ]) {
      assert.ok(!src.toLowerCase().includes(banned.toLowerCase()), `${rel} must not reference ${banned}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 11-12. Nothing upstream depends on this, and no experiment was created
// ---------------------------------------------------------------------------

test("no decision module imports the new UI helpers", () => {
  for (const rel of [
    "src/lib/desk/chair.ts",
    "src/lib/desk/chair-v2.ts",
    "src/lib/desk/seats.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/books.server.ts",
    "src/lib/desk/floor-policy.ts",
    "src/lib/desk/promotion-gates.ts",
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/telemetry.ts",
    "src/lib/desk/telemetry.server.ts",
    "src/lib/desk/hour-research.ts",
  ]) {
    const src = read(rel);
    for (const helper of ["guided-continuity", "lab-front-door", "LabFrontDoor", "whatWouldChange", "whatHappened"]) {
      assert.ok(!src.includes(helper), `${rel} must not import ${helper}`);
    }
  }
});

test("no new research experiment, model, seat, room or bot was created", () => {
  const src = codeOf(CONT) + codeOf(DOOR);
  // No storage of its own.
  assert.doesNotMatch(src, /create table|desk_[a-z_]+_windows|desk_[a-z_]+_swaps/i, "no new table");
  // No new seat or bot registration.
  for (const banned of ["SEAT_IDS.push", "registerSeat", "registerBot", "LAB_RESEARCH_REGISTRY.push", "new Seat("]) {
    assert.ok(!src.includes(banned), `must not ${banned}`);
  }
  // The registry itself is untouched by this work: the front door only reads it.
  assert.doesNotMatch(codeOf(DOOR), /LAB_RESEARCH_REGISTRY/, "the front door does not edit the registry");
  // And no third floor appeared.
  assert.doesNotMatch(codeOf(APP), /ExpertFloor|TraderFloor|QuantFloor|AdvancedFloor|UnifiedFloor/);
});
