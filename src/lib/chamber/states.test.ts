import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_STATE,
  WORLD,
  alchemistAccent,
  normalizeState,
  satoshiAccent,
  stateWord,
  stationFor,
  wardenAccent,
} from "./states.ts";
import { DEFAULT_FIXTURE, FIXTURES, FIXTURE_IDS, fixtureFromSearch, isFixtureId } from "./fixtures.ts";
import { STALE_TICK_S, fromServerFrame } from "./adapter.ts";

// Chamber Phase 0 — the pure vocabulary behind the 3D room. The room itself (three /
// R3F) is not loadable by this runner; what it can say is fully determined here.

test("world colour: WAIT and observing are dim neutral, never gold", () => {
  assert.equal(satoshiAccent("WAIT", null).hex, WORLD.dim);
  assert.equal(satoshiAccent("OBSERVING", null).hex, WORLD.dim);
  assert.notEqual(satoshiAccent("WAIT", null).hex, WORLD.amber, "the world's WAIT must not be the HUD's gold");
  assert.equal(alchemistAccent("IDLE").hex, WORLD.dim);
});

test("world colour: DIRECTIONAL carries the side; a side without DIRECTIONAL is no claim", () => {
  assert.equal(satoshiAccent("DIRECTIONAL", "UP").hex, WORLD.green);
  assert.equal(satoshiAccent("DIRECTIONAL", "DOWN").hex, WORLD.red);
  assert.equal(satoshiAccent("DIRECTIONAL", null).hex, WORLD.dim);
  assert.equal(satoshiAccent("CONSIDERING", "UP").hex, WORLD.amber, "considering is amber even if a stale side is passed");
});

test("world colour: research is amber; integrity is green / amber / red", () => {
  assert.equal(alchemistAccent("ACTIVE").hex, WORLD.amber);
  assert.equal(alchemistAccent("INSPECTING").hex, WORLD.amber);
  assert.ok(alchemistAccent("ACTIVE").intensity > alchemistAccent("INSPECTING").intensity);
  assert.equal(wardenAccent("ALL_CLEAR").hex, WORLD.green);
  assert.equal(wardenAccent("INVESTIGATING").hex, WORLD.amber);
  assert.equal(wardenAccent("ALERT").hex, WORLD.red);
});

test("normalizeState fails safe to the quiet defaults and drops a side unless DIRECTIONAL", () => {
  assert.deepEqual(normalizeState(null), DEFAULT_STATE);
  assert.deepEqual(normalizeState({ satoshi: "NOPE" as never, warden: "PANIC" as never }), DEFAULT_STATE);
  assert.equal(normalizeState({ satoshi: "WAIT", direction: "UP" }).direction, null);
  assert.equal(normalizeState({ satoshi: "DIRECTIONAL", direction: "DOWN" }).direction, "DOWN");
});

test("stations and words", () => {
  assert.equal(stationFor("SATOSHI"), "DAIS");
  assert.equal(stationFor("ALCHEMIST"), "LAB");
  assert.equal(stationFor("WARDEN"), "OPS");
  assert.equal(stateWord("SATOSHI", { ...DEFAULT_STATE, satoshi: "DIRECTIONAL", direction: "UP" }), "DIRECTIONAL · UP");
  assert.equal(stateWord("WARDEN", DEFAULT_STATE), "ALL_CLEAR");
});

test("fixtures are all valid states, labelled, and default to quiet", () => {
  assert.equal(DEFAULT_FIXTURE, "quiet");
  assert.ok(FIXTURE_IDS.length >= 5);
  for (const id of FIXTURE_IDS) {
    const f = FIXTURES[id];
    assert.ok(f.label && f.note, `${id} must be labelled`);
    assert.deepEqual(normalizeState(f.state), f.state, `${id} must already be a valid state`);
  }
  assert.deepEqual(FIXTURES.quiet.state, DEFAULT_STATE);
});

test("fixture selection parses ?fixture= and refuses unknown ids", () => {
  assert.deepEqual(fixtureFromSearch(""), { id: "quiet", explicit: false });
  assert.deepEqual(fixtureFromSearch("?fixture=up"), { id: "up", explicit: true });
  assert.deepEqual(fixtureFromSearch("?a=1&fixture=OPS-ALERT"), { id: "ops-alert", explicit: true });
  assert.deepEqual(fixtureFromSearch("?fixture=nonsense"), { id: "quiet", explicit: false });
  assert.deepEqual(fixtureFromSearch("?fixture=%E0%A4%A"), { id: "quiet", explicit: false });
  assert.equal(isFixtureId("toString"), false, "prototype keys are not fixtures");
});

test("adapter projects the chair's published lean and nothing more", () => {
  const base = { chair: null, lastError: null, tick_age_s: 2, snap: { health: { spot: "LIVE", kalshi: "LIVE" } } };
  assert.deepEqual(fromServerFrame(base), DEFAULT_STATE);
  assert.deepEqual(fromServerFrame({ ...base, chair: { lean: "UP" } }), { ...DEFAULT_STATE, satoshi: "DIRECTIONAL", direction: "UP" });
  assert.deepEqual(fromServerFrame({ ...base, chair: { lean: "DOWN" } }), { ...DEFAULT_STATE, satoshi: "DIRECTIONAL", direction: "DOWN" });
  assert.deepEqual(fromServerFrame({ ...base, chair: { lean: "WAIT" } }), { ...DEFAULT_STATE, satoshi: "WAIT" });
});

test("adapter: the warden reads real integrity signals only; the alchemist is never given a fictional state", () => {
  const base = { chair: null, lastError: null, tick_age_s: 2, snap: { health: { spot: "LIVE", kalshi: "LIVE" } } };
  assert.equal(fromServerFrame({ ...base, lastError: "boom" }).warden, "ALERT");
  assert.equal(fromServerFrame({ ...base, snap: { health: { spot: "DOWN", kalshi: "LIVE" } } }).warden, "ALERT");
  assert.equal(fromServerFrame({ ...base, snap: { health: { spot: "STALE", kalshi: "LIVE" } } }).warden, "INVESTIGATING");
  assert.equal(fromServerFrame({ ...base, tick_age_s: STALE_TICK_S + 1 }).warden, "INVESTIGATING");
  assert.equal(fromServerFrame({ ...base, tick_age_s: -1 }).warden, "INVESTIGATING");
  for (const lean of ["UP", "DOWN", "WAIT"] as const) {
    assert.equal(fromServerFrame({ ...base, chair: { lean } }).alchemist, "IDLE");
  }
});

test("the vocabulary, fixtures and adapter do no I/O (structural)", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const f of ["./states.ts", "./fixtures.ts", "./adapter.ts"]) {
    const code = strip(readFileSync(new URL(f, import.meta.url), "utf8"));
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/.test(code), `${f} must do no I/O`);
    assert.ok(!/from\s+["']@\/lib\/desk\/(engine|store|server-engine|learner|persist)/.test(code), `${f} must not import the desk engine`);
  }
});
