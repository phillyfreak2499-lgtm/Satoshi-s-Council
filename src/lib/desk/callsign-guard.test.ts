/**
 * Callsign guard. Every fixture below is assembled from character codes so
 * that no blocked term appears in this file, in a snapshot, or in a log.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALLSIGN_PUBLIC_LABEL,
  CALLSIGN_REJECT,
  callsignVerdict,
  cleanCallsign,
  compact,
  isBlocked,
  isReserved,
  normalize,
  publicLabel,
} from "./callsign-guard.ts";

const word = (...codes: number[]) => String.fromCharCode(...codes);
/** The term the live board printed, as codes, then its leetspeak, separated, cased, repeated and embedded spellings. */
const TERM = word(110, 105, 103, 103, 101, 114);
const TERM_LEET = word(110, 49, 103, 103, 101, 114);
const TERM_DASHED = TERM.split("").join("-");
const TERM_DOTTED = TERM.split("").join(".");
const TERM_SPACED = TERM.split("").join(" ");
const TERM_UNDERSCORED = TERM.split("").join("_");
const TERM_UPPER = TERM.toUpperCase();
const TERM_MIXED = TERM[0]!.toUpperCase() + TERM.slice(1, 3) + TERM.slice(3).toUpperCase();
const TERM_REPEATED = TERM[0]! + TERM[1]! + TERM[1]! + TERM[1]! + TERM.slice(2);
const TERM_EMBEDDED = `xx${TERM}xx`;
const SECOND = word(107, 105, 107, 101);
const WHOLE_ONLY = word(99, 111, 111, 110);

test("normalize trims, collapses whitespace and lowercases; compact folds leetspeak and strips separators", () => {
  assert.equal(normalize("  Dewy   Two "), "dewy two");
  assert.equal(compact("D.e-w_y 7wo"), "dewytwo");
  assert.equal(compact("iloq"), "iloq");
  assert.equal(compact(""), "");
  assert.equal(compact(null), "");
});

test("the term that reached the live board is blocked in every spelling the guard folds", () => {
  for (const v of [TERM, TERM_LEET, TERM_DASHED, TERM_DOTTED, TERM_SPACED, TERM_UNDERSCORED, TERM_UPPER, TERM_MIXED, TERM_REPEATED, TERM_EMBEDDED]) {
    assert.equal(isBlocked(v), true, `blocked: ${v.length} chars`);
  }
  assert.equal(isBlocked(SECOND), true);
  assert.equal(isBlocked(SECOND.toUpperCase()), true);
});

test("a whole-string term is blocked alone and not when it is merely inside an ordinary word", () => {
  assert.equal(isBlocked(WHOLE_ONLY), true);
  assert.equal(isBlocked(`rac${WHOLE_ONLY}`), false, "an ordinary word that contains it stays legal");
});

test("reserved desk names are blocked, whole-string and case-insensitive", () => {
  for (const v of ["Satoshi", "SATOSHI", "satoshi", "the chair", "The  Chair", "chair", "WARDEN", "wick", "Tape", "desk", "Arena", "admin", "Official"]) {
    assert.equal(isReserved(v), true, v);
    assert.equal(isBlocked(v), true, v);
  }
  assert.equal(isReserved("satoshifan"), false, "reserved names match whole, not as a prefix");
});

test("the callsigns on the live board stay legal, and the 2 and 16 character edges hold", () => {
  for (const v of ["iloq", "dewy", "Up", "Down", "ab", "a_b-c.d 12345678", "NoFear", "2026"]) {
    assert.equal(isBlocked(v), false, v);
    assert.ok(cleanCallsign(v), v);
  }
  assert.equal(cleanCallsign("a"), null, "one character is too short");
  assert.equal(cleanCallsign("a".repeat(17)), null, "seventeen characters is too long");
  assert.equal(cleanCallsign("bad!name"), null, "the charset is unchanged");
});

test("the write-path verdict refuses a blocked name with the neutral line and passes the rest through", () => {
  const blocked = callsignVerdict(TERM_LEET);
  assert.deepEqual(blocked, { ok: false, error: CALLSIGN_REJECT, status: 400 });
  assert.equal(CALLSIGN_REJECT, "that callsign is not allowed — pick another");
  assert.doesNotMatch(JSON.stringify(blocked), new RegExp(TERM), "the rejected name is never echoed");
  assert.deepEqual(callsignVerdict("iloq"), { ok: true, name: "iloq" });
  assert.deepEqual(callsignVerdict("   "), { ok: true, name: null }, "no name given is not a refusal");
  assert.deepEqual(callsignVerdict("bad!name"), { ok: true, name: null }, "a charset miss is the caller's copy, not the neutral line");
  assert.deepEqual(callsignVerdict("Satoshi"), { ok: false, error: CALLSIGN_REJECT, status: 400 });
});

test("a public label never prints a blocked or hidden name", () => {
  assert.equal(publicLabel("dewy"), "dewy");
  assert.equal(publicLabel(TERM), CALLSIGN_PUBLIC_LABEL);
  assert.equal(publicLabel(TERM_EMBEDDED), CALLSIGN_PUBLIC_LABEL);
  assert.equal(publicLabel("dewy", { hidden: true }), CALLSIGN_PUBLIC_LABEL);
  assert.equal(publicLabel("", {}), CALLSIGN_PUBLIC_LABEL);
  assert.equal(CALLSIGN_PUBLIC_LABEL, "paper");
});
