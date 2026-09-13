import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPublicBoardWho,
  isReservedBoardIdentity,
  isSystemCharacter,
  PIT_CREW_MEMBERS,
  RESERVED_BOARD_IDENTITIES,
  sanitizeEventPayload,
  SYSTEM_CHARACTERS,
  validateSystemEvent,
} from "./system-events.ts";

const ok = {
  event_key: "desk-update:2026-09-12-phase-1a",
  event_type: "DESK_UPDATE",
  character: "DESK",
  occurred_at: "2026-09-12T19:00:00.000Z",
  source_type: "desk_update",
  source_id: "2026-09-12-phase-1a",
  payload: { slug: "2026-09-12-phase-1a" },
  public: true,
};

test("a valid DESK_UPDATE event validates", () => {
  const ev = validateSystemEvent(ok);
  assert.equal(ev.event_key, ok.event_key);
  assert.equal(ev.character, "DESK");
  assert.equal(ev.public, true);
  assert.equal(ev.payload.slug, "2026-09-12-phase-1a");
});

test("duplicate identity is the event_key — validation accepts the same key twice", () => {
  const a = validateSystemEvent(ok);
  const b = validateSystemEvent(ok);
  assert.equal(a.event_key, b.event_key);
});

test("invalid event_type is rejected", () => {
  assert.throws(() => validateSystemEvent({ ...ok, event_type: "CHAIR_VIBES" }), /event_type/);
});

test("invalid character is rejected", () => {
  assert.throws(() => validateSystemEvent({ ...ok, character: "PIT_CREW" }), /character/);
  assert.throws(() => validateSystemEvent({ ...ok, character: "LEDGER" }), /character/);
});

test("PIT_CREW is not a canonical event author; the four members are", () => {
  assert.equal(isSystemCharacter("PIT_CREW"), false);
  for (const id of PIT_CREW_MEMBERS) assert.equal(isSystemCharacter(id), true);
  assert.deepEqual([...SYSTEM_CHARACTERS], ["SATOSHI", "ALCHEMIST", "WARDEN", "WRENCH", "SWEEP", "COACH", "DESK"]);
});

test("private vs public is a flag, not a type", () => {
  assert.equal(validateSystemEvent({ ...ok, public: false }).public, false);
  assert.equal(validateSystemEvent({ ...ok, public: true }).public, true);
});

test("payload prototype tricks and non-objects are rejected", () => {
  assert.throws(() => sanitizeEventPayload(JSON.parse('{"constructor":{"prototype":{"x":1}}}' )), /rejected/);
  assert.throws(() => sanitizeEventPayload(JSON.parse('{"__proto__":{"polluted":true}}' )), /rejected/);
  assert.throws(() => sanitizeEventPayload(["nope"]), /JSON object/);
  assert.throws(() => sanitizeEventPayload("<script>alert(1)</script>"), /JSON object/);
  const clean = sanitizeEventPayload({ note: "<b>ok</b>", n: 1 });
  assert.equal(clean.note, "<b>ok</b>");
  assert.equal(clean.n, 1);
});

test("payload size is capped", () => {
  assert.throws(() => sanitizeEventPayload({ blob: "x".repeat(9000) }), /too large/);
});

test("required identifiers must be present", () => {
  assert.throws(() => validateSystemEvent({ ...ok, event_key: "" }), /event_key/);
  assert.throws(() => validateSystemEvent({ ...ok, source_id: "" }), /source_id/);
  assert.throws(() => validateSystemEvent({ ...ok, source_type: "mystery" }), /source_type/);
});

test("public Board cannot impersonate reserved identities", () => {
  const reserved = [
    "SATOSHI",
    "satoshi",
    "Alchemist",
    "The Alchemist",
    "WARDEN",
    "Wrench",
    "SWEEP",
    "coach",
    "DESK",
    "PIT CREW",
    "PIT_CREW",
    "pit crew",
  ];
  for (const who of reserved) {
    assert.equal(isReservedBoardIdentity(who), true, who);
    assert.throws(() => assertPublicBoardWho(who), /reserved/, who);
  }
});

test("ordinary human Board identity still works", () => {
  for (const who of ["Zach", "anon", "TEAS2PLEASE", "SatoshiFan", "pit-boss"]) {
    assert.equal(isReservedBoardIdentity(who), false, who);
    assertPublicBoardWho(who);
  }
});

test("admin/system DESK update path is allowed to wear DESK", () => {
  assertPublicBoardWho("DESK", true);
  assertPublicBoardWho("SATOSHI", true);
});

test("reserved list includes the group label even though it is not an author", () => {
  assert.ok((RESERVED_BOARD_IDENTITIES as readonly string[]).includes("PIT CREW"));
  assert.ok((RESERVED_BOARD_IDENTITIES as readonly string[]).includes("PIT_CREW"));
});
