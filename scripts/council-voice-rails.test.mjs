import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const shared = read("src/lib/desk/council-voice.ts");
const server = read("src/lib/desk/council-voice.server.ts");
const route = read("server/routes/council-voice.get.ts");
const button = read("src/components/desk/CouncilVoiceButton.tsx");
const chamber = read("src/components/desk/ChamberRoom.tsx");
const strip = read("src/components/desk/ChamberSpeech.tsx");
const streamer = read("src/components/atelier/streamer.tsx");
const training = read("src/components/desk/TrainingHome.tsx");

test("Council voice has a closed fictional speaker roster", () => {
  for (const speaker of ["SATOSHI", "WICK", "DRIFT", "TAPE", "WARDEN", "ALCHEMIST", "SWEEP"]) {
    assert.match(shared, new RegExp(`"${speaker}"`));
    assert.match(server, new RegExp(`\\b${speaker}\\b`));
  }
  assert.match(shared, /"intro" \| "live" \| "chamber"/);
});

test("public voice route cannot accept arbitrary speech text", () => {
  assert.match(route, /searchParams\.get\("source"\)/);
  assert.match(route, /searchParams\.get\("speaker"\)/);
  assert.match(route, /searchParams\.get\("event"\)/);
  assert.doesNotMatch(route, /searchParams\.get\(["'](?:text|input|prompt|instructions)["']\)/i);
  assert.doesNotMatch(server, /request\.(?:text|input|prompt|instructions)/i);
  assert.match(server, /const INTROS/);
  assert.match(server, /textFromLive/);
  assert.match(server, /textFromChamber/);
});

test("Council voice uses OpenAI speech with server secret, cache, and no model tools", () => {
  assert.match(server, /process\.env\.OPENAI_API_KEY/);
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/audio\/speech/);
  assert.match(server, /gpt-4o-mini-tts/);
  assert.match(server, /response_format:\s*"mp3"/);
  assert.match(server, /voice-cache/);
  assert.match(server, /createHash\("sha256"\)/);
  assert.doesNotMatch(server, /web_search|tools:\s*\[|function_call/i);
  assert.doesNotMatch(route, /OPENAI_API_KEY|authorization|Bearer/);
});

test("audio stays downstream of every decision path", () => {
  for (const path of [
    "src/lib/desk/server-engine.ts",
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/learner.ts",
  ]) {
    assert.ok(!read(path).includes("council-voice"), `${path} imports council voice`);
  }
  for (const forbidden of [
    "noteCall(",
    "applyDeskOp",
    "decideChair(",
    "runChair(",
    "selectiveBlock",
    "promoteToLive",
    "setKnob",
    "reviewSeats",
  ]) {
    assert.ok(!server.includes(forbidden), `voice server reaches ${forbidden}`);
  }
});

test("voice playback is explicit, optional, and never autoplayed", () => {
  assert.match(button, /onClick/);
  assert.match(button, /new Audio/);
  assert.match(button, /audio\.play\(\)/);
  assert.doesNotMatch(button, /autoplay|autoPlay/);
  assert.match(button, /AI-generated character voice/);
  assert.match(chamber, /AI-generated fictional character voices/);
  assert.match(streamer, /AI-generated character voices · optional/);
  assert.match(training, /AI-generated fictional character voices/);
});

test("Streamer exposes the four first-pass microphones without changing the call", () => {
  for (const speaker of ["SATOSHI", "WICK", "DRIFT", "TAPE"]) {
    assert.match(streamer, new RegExp(`speaker=(?:\\{seat\\}|"${speaker}")|Hear ${speaker}`));
  }
  assert.match(streamer, /Third mic · order book/);
  assert.match(streamer, /source="live"/);
  assert.doesNotMatch(streamer, /fetch\([^)]*openai/i);
});

test("Chamber voices only already-recorded statement keys", () => {
  assert.match(chamber, /source="chamber"/);
  assert.match(chamber, /eventKey=\{statement\.event_key\}/);
  assert.match(strip, /eventKey=\{speech\.event_key\}/);
  assert.match(server, /listPublicChamberEvents\(5\)/);
  assert.match(server, /row\.event_key === eventKey/);
  assert.match(server, /statementFromEvent/);
});

test("training home has cached intro previews for the three open character coaches", () => {
  assert.match(training, /source="intro" speaker="WICK"/);
  assert.match(training, /coach\.name === "TAPE" \|\| coach\.name === "DRIFT"/);
  assert.match(training, /Hear WICK/);
});
