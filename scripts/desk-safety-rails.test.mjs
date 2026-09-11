/**
 * Structural guards on the desk's safety rails.
 *
 * These rails live in modules whose import graph the TypeScript test runner
 * cannot load without extension-qualifying every relative import in the repo,
 * so they are asserted against the source text instead. That is weaker than a
 * unit test at proving behaviour, and stronger than nothing at proving the rail
 * is still wired: each assertion fails loudly if someone removes the line that
 * makes a hold, a gate, or a floor actually bite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("the live paper floor is decided by one constant, and reverting is one line", () => {
  const src = read("src/lib/desk/book-floor.ts");
  assert.match(src, /export const FLOOR_LIVE_CENTS = 80;/, "live floor constant missing");
  assert.match(src, /export const FLOOR_SHADOW_CENTS = 70;/, "shadow floor constant missing");
  assert.match(src, /export const FLOOR_LIVE_SINCE = "/, "trial start timestamp missing");
  // The gate reads the constant, never a literal.
  assert.match(src, /export function bookable\(cents: number\): boolean \{\s*\n\s*return realAsk\(cents\) && cents >= FLOOR_LIVE_CENTS;/);
  assert.ok(!/cents >= 80\b/.test(src), "the live floor must not be hard-coded in the gate");
  // The shadow book is explicitly not a gate.
  assert.match(src, /export function bookableShadow/);
  assert.match(src, /cents >= FLOOR_SHADOW_CENTS/);
});

/** The body of the function that decides a paper fill, in either engine. */
function noteCallBody(src) {
  const at = src.indexOf("function noteCall(");
  assert.ok(at > 0, "noteCall not found");
  const body = src.slice(at, src.indexOf("\nfunction ", at + 10));
  assert.ok(body.length > 100, "noteCall body looked empty");
  return body;
}

test("only the live floor gates a fill; the shadow floor is never consulted to book", () => {
  for (const rel of ["src/lib/desk/server-engine.ts", "src/lib/desk/engine.ts"]) {
    const body = noteCallBody(read(rel));
    assert.match(body, /if \(!bookable\(cents\)\) return;/, `${rel} must gate fills on bookable()`);
    // The fill decision may RECORD a shadow entry, but must never branch on the
    // shadow floor: the only predicate that can stop or allow a fill is bookable().
    assert.ok(
      !/bookableShadow\(/.test(body),
      `${rel}: noteCall must not read the shadow floor — record it in a helper instead`,
    );
  }
});

test("the shadow book records, and does so before the live floor has its say", () => {
  const src = read("src/lib/desk/server-engine.ts");
  const shadowAt = src.indexOf("noteShadowFill(e, snap, chair.lean, cents);");
  const gateAt = src.indexOf("if (!bookable(cents)) return;");
  assert.ok(shadowAt > 0, "shadow capture missing");
  assert.ok(gateAt > 0, "live gate missing");
  assert.ok(shadowAt < gateAt, "the shadow entry must be captured before the live floor returns");
  assert.match(src, /shadow_entry_cents, shadow_ev_cents/, "ledger must persist the shadow columns");
  // And the research dimensions a performance cube needs, captured at the fill.
  for (const col of ["entry_regime", "entry_secs_left", "entry_conf", "entry_spread_cents", "entry_touch_size"]) {
    assert.match(src, new RegExp(col), `ledger must persist ${col}`);
  }
  const entryAt = src.indexOf("noteEntryState(e, snap, chair, cents);");
  assert.ok(entryAt > 0, "entry state must be captured on the decision path");
});

test("TAKER's frozen constants are still the frozen values", () => {
  const src = read("src/lib/desk/taker.ts");
  assert.match(src, /export const TAKER_FROZEN_AT = "2026-09-09";/);
  assert.match(src, /export const TAKER_MIN_TRADES = 8;/);
  assert.match(src, /export const TAKER_DEADBAND = 0\.06;/);
  assert.match(src, /export const TAKER_FULL_AT = 0\.25;/);
});

test("INDEX carries its 24-in-regime bar on both seeds", () => {
  const src = read("src/lib/desk/skills.ts");
  for (const id of ["INDEX.settle_fair", "INDEX.locked_avg"]) {
    const at = src.indexOf(`id: "${id}"`);
    assert.ok(at > 0, `${id} seed missing`);
    const block = src.slice(at, at + 900);
    assert.match(block, /start: "SHADOW"/, `${id} must start SHADOW`);
    assert.match(block, /min_regime_n: INDEX_MIN_REGIME_N/, `${id} must carry the regime bar`);
  }
  assert.match(read("src/lib/desk/skill-gate.ts"), /export const INDEX_MIN_REGIME_N = 24;/);
});

test("a held card cannot be chosen as a seat's vote, and cannot be auto-promoted", () => {
  const bots = read("src/lib/desk/bots.ts");
  assert.match(bots, /\.filter\(\(s\) =>\s*\n?\s*voteEligible\(s, ctx\.snap\.regime_key\),?\s*\n?\s*\)/,
    "the selection pool must be filtered by voteEligible");
  const learner = read("src/lib/desk/learner.ts");
  // Both promoters: the huddle's SHADOW -> LIVE gate and rethinkSeat's n>=8 swap.
  assert.match(learner, /\(s\.n >= 8 \|\| s\.ev_n >= 8\) && promoteEligible\(s\)/);
  assert.match(learner, /promoteEligible\(card\) &&/);
});

test("a research bar is policy in code: a stale save cannot drop it", () => {
  assert.match(read("src/lib/desk/persist.ts"), /\.\.\.\(seedObj \? seedGate\(seedObj\) : \{\}\)/);
});

test("WARDEN, ORBIT and WIRE are still non-voting", () => {
  assert.match(
    read("src/lib/desk/chair.ts"),
    /CHAIR_NON_VOTERS = new Set<SeatId>\(\["WARDEN", "ORBIT", "WIRE"\]\)/,
  );
});

test("book-derived evidence is quarantined after a sequence gap", () => {
  const book = read("src/lib/desk/lab-book.ts");
  assert.match(book, /export function markBookGap/);
  assert.match(book, /export function bookTrusted/);
  // Only a snapshot clears staleness.
  assert.match(book, /b\.ok = true;\s*\n\s*\/\/[^\n]*\n\s*b\.stale = false;/);
  const lab = read("src/lib/desk/lab.server.ts");
  assert.match(lab, /for \(const b of L\.books\.values\(\)\) markBookGap\(b, t\);/);
  assert.match(lab, /if \(!bookTrusted\(b\)\) return;/);
});

test("trade direction reads the canonical field first in every parser", () => {
  assert.match(read("src/lib/desk/kalshi-wire.ts"), /\["taker_outcome_side", "taker_side"\]/);
  for (const rel of ["src/lib/desk/lab.server.ts", "src/lib/desk/server-feeds.ts"]) {
    const src = read(rel);
    assert.match(src, /takerOutcomeSide\(/, `${rel} must use the canonical reader`);
    assert.ok(
      !/taker_side \?\? |String\(msg\.taker_side/.test(src),
      `${rel} must not read the deprecated field directly`,
    );
  }
});

test("a bad run cannot invert a seat: the chair flips no signs", () => {
  const chair = read("src/lib/desk/chair.ts");
  // No sign flip, and no status that claims one.
  assert.ok(!/signed = -signed/.test(chair), "the chair must not negate a seat's signed contribution");
  assert.ok(!/status = "INVERT"/.test(chair), "no seat may be marked INVERT");
  // Authority is reduced through the pure verdict instead.
  assert.match(chair, /fadeVerdict\(learner\.seat_recent\[vote\.seat\] \?\? \[\], learner\.fade_strength\[vote\.seat\] \?\? 0\)/);
  assert.match(chair, /fadeScale = verdict\.scale;/);
  // And the verdict can only ever quiet a seat.
  const fade = read("src/lib/desk/fade.ts");
  assert.match(fade, /Always in \[0, 1\] — a sign is never flipped/);
  assert.ok(!/scale: -/.test(fade), "a fade scale must never be negative");
});

test("no copy claims a live floor the book does not actually pay", () => {
  const floor = read("src/lib/desk/book-floor.ts");
  const live = Number(floor.match(/export const FLOOR_LIVE_CENTS = (\d+);/)[1]);
  const shadow = Number(floor.match(/export const FLOOR_SHADOW_CENTS = (\d+);/)[1]);
  assert.ok(live > shadow, "the shadow floor must be the looser one");

  // Unambiguous present-tense claims about where the book fills. An arithmetic
  // example ("100 contracts at 70¢ pay 147¢") is fine; "fills at 70¢" is not.
  const claims = [
    new RegExp(`only fills? at ${shadow}¢`, "i"),
    new RegExp(`books? at ${shadow}¢ or better`, "i"),
    new RegExp(`at or above the ${shadow}¢ floor`, "i"),
    new RegExp(`under the ${shadow}¢ floor`, "i"),
    new RegExp(`fills? only at ${shadow}¢`, "i"),
  ];
  // updates.ts is the dated changelog: a past note describing the old rule is a
  // record of what was true then and must not be edited.
  for (const rel of [
    "src/lib/desk/glossary.ts",
    "src/lib/desk/readiness.ts",
    "src/components/desk/BooksTab.tsx",
    "src/components/desk/SatoshiTab.tsx",
    "src/components/desk/TopStrip.tsx",
    "src/lib/desk/chair-words.ts",
  ]) {
    const src = read(rel);
    for (const re of claims) {
      assert.ok(!re.test(src), `${rel} still claims the live floor is ${shadow}¢ (${re})`);
    }
  }
});
