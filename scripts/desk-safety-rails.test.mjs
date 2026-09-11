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

/**
 * Source with comments removed.
 *
 * A guard that greps a whole file for a banned token finds it in the comment
 * explaining why it is banned, and then fails on a file that is correct. Every
 * "this must not appear" check runs on this; assertions about the prose itself
 * run on the raw source.
 */
/**
 * The slice of `src` between two markers, with both required to exist.
 *
 * `indexOf` returns -1 for a marker that has been renamed away, and
 * `slice(start, -1)` then quietly widens to almost the whole file — so a guard
 * scoped to one function silently starts matching the rest of the module and
 * either passes or fails for the wrong reason. Failing loudly here is the point.
 */
function between(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b);
  assert.ok(i >= 0, `slice marker not found: ${a}`);
  assert.ok(j > i, `slice marker not found after the first: ${b}`);
  return src.slice(i, j);
}

const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

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

test("Phase 2 research has no path to the chair, a seat, or the learner", () => {
  // TAPE 2.0, VEL 2.0 and STRIKE 2.0 are measurement. The guarantee is structural,
  // not a promise in a comment: nothing that decides anything may import them.
  const research = ["tape2", "vel2", "strike2", "strike2.server", "cube", "cube.server", "excursion", "excursion.server", "redundancy", "redundancy.server", "seat-signal", "seat-signal.server",
    "whale2", "research-status", "research-status.server",
    "absorption", "absorption.server"];
  const deciders = [
    "src/lib/desk/chair.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/dsl.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/skills.ts",
    "src/lib/desk/chair2.ts",
    "src/lib/desk/coach.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/features.ts",
    "src/lib/desk/clock.ts",
  ];
  for (const rel of deciders) {
    let src;
    try {
      src = read(rel);
    } catch {
      continue; // a file that does not exist cannot import anything
    }
    for (const mod of research) {
      const re = new RegExp(`from "\\./${mod.replace(".", "\\.")}(\\.ts)?"`);
      assert.ok(!re.test(src), `${rel} imports ${mod} — research must not reach a decision`);
    }
  }
});

test("STRIKE 2.0 states it is shadow and cannot promote itself", () => {
  const srv = read("src/lib/desk/strike2.server.ts");
  // The read-out carries its own constraints, so a reader of the raw JSON cannot
  // mistake a good-looking Brier for permission.
  assert.match(srv, /votes: false/);
  assert.match(srv, /shadow: true/);
  assert.match(srv, /index_min_regime_n: INDEX_MIN_REGIME_N/);
  // It reads. It does not write, grade, or promote. Matched on code shapes, so the
  // prose explaining that it cannot promote itself does not trip its own guard.
  for (const banned of [/\binsert into\b/i, /\bupdate \w+ set\b/i, /\bdelete from\b/i, /\bpromote\w*\(/]) {
    assert.ok(!banned.test(srv), `strike2.server.ts contains ${banned} — it must be read-only`);
  }
  // The incumbent skill is untouched: STRIKE's own constants are not imported here.
  assert.ok(!/from "\.\/skills(\.ts)?"/.test(srv), "the study must not reach the skill table");
});

test("the research read-out is admin-gated and off the public boards", () => {
  const route = read("server/routes/strike2.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
  assert.match(route, /return new Response\("not found", \{ status: 404 \}\)/);
  // Not linked from any shipped page: a research endpoint nobody audits is worse
  // than no endpoint, and one on the floor invites reading it as a signal.
  for (const rel of ["src/components/desk/BooksTab.tsx", "src/components/desk/SatoshiTab.tsx"]) {
    assert.ok(!/\/strike2/.test(read(rel)), `${rel} links the research endpoint onto the floor`);
  }
});

test("the calibrator cannot learn from a window before that window closed", () => {
  // The single property that makes the tape arm's 70k samples legitimate rather
  // than 70k readings of 332 answers.
  const src = read("src/lib/desk/strike2.ts");
  // Evidence is buffered and released by time, not folded in at prediction time.
  assert.match(src, /flush\(r\.t\);/);
  assert.match(src, /pending\.push\(/);
  // The learn call inside the loop is the deferred one, never a direct learn(r).
  const loop = between(src, "for (const r of sorted)", "const buckets =");
  assert.ok(!/learn\(table, z, r\.up\)/.test(loop), "a row is folded in at prediction time");
  assert.match(loop, /flush = |flush\(/);
});

test("the cube reports, and cannot reach back into anything it reports on", () => {
  const srv = read("src/lib/desk/cube.server.ts");
  for (const banned of [/\binsert into\b/i, /\bupdate \w+ set\b/i, /\bdelete from\b/i, /\bpromote\w*\(/, /\bsetKnob\b/]) {
    assert.ok(!banned.test(srv), `cube.server.ts contains ${banned} — it must be read-only`);
  }
  assert.match(srv, /votes: false/);
  assert.match(srv, /tunes_nothing: true/);
  // Admin-gated and not linked from the floor: a slice-and-dice tool on a public
  // page invites reading the best cell as a result.
  const route = read("server/routes/cube.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
  assert.match(route, /return new Response\("not found", \{ status: 404 \}\)/);
  for (const rel of ["src/components/desk/BooksTab.tsx", "src/components/desk/SatoshiTab.tsx"]) {
    assert.ok(!/\/cube/.test(read(rel)), `${rel} links the cube onto the floor`);
  }
});

test("a cell can never be called a finding on its point estimate alone", () => {
  // The failure mode the cube exists to resist. `clears` must depend on the
  // interval's lower bound, and a thin cell must never clear.
  const src = read("src/lib/desk/cube.ts");
  assert.match(src, /clears: !thin && w != null && needs != null && w\.lo \* 100 > needs/);
  assert.ok(!/clears: .*hit > needs/.test(src), "clears is reading the point estimate");
  // And the look-elsewhere accounting is not optional.
  assert.match(src, /expected_by_chance/);
  assert.match(src, /0\.025 \* tested/);
});

test("MAE/MFE is descriptive and says so where it could be misread", () => {
  const src = read("src/lib/desk/excursion.ts");
  // Marked at the BID. Marking at the ask would invent a spread of profit on
  // every call and inflate every MFE.
  assert.match(src, /side === "UP" \? m\.yes_bid : 100 - m\.yes_ask/);
  // The verdict must never read as a take-profit level.
  assert.ok(!/take profit/i.test(codeOf("src/lib/desk/excursion.ts")), "a take-profit rule leaked into the verdict");
  assert.match(src, /hindsight/);
  assert.match(src, /tested on windows recorded afterwards/);
  // And it must put the winners' drawdown beside the losers' peak.
  assert.match(src, /-winners\.avg_mae >= losers\.avg_mfe/);

  const srv = read("src/lib/desk/excursion.server.ts");
  for (const banned of [/\binsert into\b/i, /\bupdate \w+ set\b/i, /\bdelete from\b/i, /\bpromote\w*\(/]) {
    assert.ok(!banned.test(srv), `excursion.server.ts contains ${banned} — it must be read-only`);
  }
  assert.match(srv, /votes: false/);
  // Only settled, single-leg calls: a scalp exited at a mark has no single answer.
  assert.match(srv, /and l\.settle_cents in \(0, 100\)/);
  assert.match(srv, /and coalesce\(l\.calls, 1\) = 1/);
  // The entry is the recorded fill, never the first sample.
  assert.match(srv, /findIndex\(\(v\) => Number\(v\) === 1\)/);

  const route = read("server/routes/excursion.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
  assert.match(route, /return new Response\("not found", \{ status: 404 \}\)/);
});

test("the redundancy study cannot mute, gag or reweight a seat", () => {
  const srv = read("src/lib/desk/redundancy.server.ts");
  for (const banned of [/\binsert into\b/i, /\bupdate \w+ set\b/i, /\bdelete from\b/i, /\bsetKnob\b/, /\bgag\w*\(/, /\bbench\w*\(/, /\bmute\w*\(/]) {
    assert.ok(!banned.test(srv), `redundancy.server.ts contains ${banned} — it must be read-only`);
  }
  assert.match(srv, /votes: false/);
  assert.match(srv, /mutes_nothing: true/);

  const src = read("src/lib/desk/redundancy.ts");
  // The tally is a proxy, and the report has to say so where a reader will see it.
  assert.match(src, /PROXY/);
  assert.match(src, /prospectively/);
  assert.match(src, /candidate to run gagged in shadow, not a seat to mute/);

  // The non-voting three and the two shadow seats stay out of the tally, and the
  // exclusion list is fixed in source rather than read from live skill state —
  // today's gate does not describe what was eligible last week.
  for (const id of ["ORBIT", "WIRE", "CHEAP", "INDEX"]) {
    assert.match(srv, new RegExp(`\\b${id}: "`), `${id} is not excluded from the tally`);
  }
  assert.match(srv, /const TALLY = STUDIED\.filter\(\(s\) => !\(s in NOT_HEARD\)\);/);

  const route = read("server/routes/redundancy.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
  assert.match(route, /return new Response\("not found", \{ status: 404 \}\)/);
});

test("the seat-signal study judges against the price, not against a coin flip", () => {
  const src = read("src/lib/desk/seat-signal.ts");
  // The bar is the market's OWN claim on the objected windows, compared against
  // the interval. Testing against 50% would call every seat useless, and testing
  // against the point estimate would manufacture findings.
  assert.match(src, /a\.market_said > a\.actual_hi/);
  assert.match(src, /a\.market_said < a\.actual_lo/);
  // The verdict lines themselves must not mention 50 at all — `mid > 50`
  // elsewhere is legitimate, it picks which side the price favours.
  const decide = between(src, "const informative =", "return {\n    seat,");
  assert.ok(!/\b50\b/.test(decide), `a 50% bar leaked into the verdict logic: ${decide}`);
  // And the seat's own win rate must play no part in the verdict: a seat can be
  // wrong about direction and still right that the price was too rich.
  assert.ok(!/seat_right/.test(decide), "the verdict is reading the seat's own hit rate");
  // And the point that a seat need not pick the winner to be worth something.
  assert.match(src, /does NOT require the seat to pick the winner/);
  // Split across a template-literal concatenation in the source, so matched in pieces.
  assert.match(src, /led away from the truth, which is worse than a seat/);
  assert.match(src, /that says nothing\./);

  const srv = read("src/lib/desk/seat-signal.server.ts");
  for (const banned of [/\binsert into\b/i, /\bupdate \w+ set\b/i, /\bdelete from\b/i, /\bsetKnob\b/, /\bpromote\w*\(/]) {
    assert.ok(!banned.test(srv), `seat-signal.server.ts contains ${banned} — it must be read-only`);
  }
  assert.match(srv, /votes: false/);
  assert.match(srv, /reweights_nothing: true/);
  // Silence is not agreement: a zero evidence must not be folded in as a vote
  // for the price, which would credit every quiet seat with the market's record.
  assert.match(srv, /const lean = ev > 0 \? "UP" : ev < 0 \? "DOWN" : null;/);
  // The seat's read and the price must come from the same instant.
  // Checked on the query, not the prose: the doc comment explains why the ledger
  // is the wrong source, so a naive whole-file match trips on its own reasoning.
  const query = between(srv, "await db<Row>`", "order by close_time");
  assert.match(query, /from desk_samples/);
  assert.ok(!/desk_ledger/.test(query), "the ledger's grade-frame vote is a different moment from this price");

  const route = read("server/routes/seat-signal.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
  assert.match(route, /return new Response\("not found", \{ status: 404 \}\)/);
});

test("the lab records the new measurements without letting them into its fair value", () => {
  // lab.server is the one file that both imports TAPE 2.0 / VEL 2.0 and feeds a
  // seat: the LAB seat votes off labFairNow. The import guard above cannot see
  // that, because the leak would be inside this file rather than across an
  // import. So the fair-value path is read directly and must be clean.
  const lab = read("src/lib/desk/lab.server.ts");
  const fnBody = (name) => {
    const i = lab.indexOf(`export function ${name}`);
    assert.ok(i > 0, `${name} not found in lab.server.ts`);
    const j = lab.indexOf("\n}", i);
    return lab.slice(i, j);
  };
  for (const fn of ["labFairNow", "labFairState"]) {
    const body = fnBody(fn);
    assert.ok(!/tape2|vel2/i.test(body), `${fn} reads the shadow microstructure — that is a path to a vote`);
  }
  // And the only readers of the measurements are the two accessors the replay uses.
  assert.match(lab, /export function tape2Now\(ticker: string\): Tape2Features \| null/);
  assert.match(lab, /export function vel2Now\(ticker: string\): Vel2Features \| null/);
});

test("the incumbent STRIKE is compared honestly: a threshold gets no Brier score", () => {
  const srv = read("src/lib/desk/strike2.server.ts");
  const arm = between(srv, "function incumbentArm", "function round1");
  // It never produced a probability, so scoring one would be scoring a number
  // the desk invented on its behalf and then judged it by.
  // Checked as a CALL, not as a word: the note itself explains that it has no
  // Brier score, so a whole-text match trips on its own disclaimer.
  assert.ok(!/\bbrier\s*\(/i.test(arm), "the incumbent is being Brier-scored against a probability it never produced");
  assert.match(arm, /A threshold, not a probability, so it has no Brier score/);
  // The only honest comparison: its hit rate against what the market charged for
  // the same side at the same instant.
  assert.match(arm, /edge: round1\(hit - said\)/);
  assert.match(arm, /saidSum \+= side === "UP" \? mid : 100 - mid;/);
  // Silence is counted, not dropped: a threshold sits out most windows and a
  // hit rate over only the ones it liked would look far better than it is.
  assert.match(arm, /quiet \+= 1;/);
  assert.match(srv, /Near zero means it is repeating the price\./);
});

test("the cube keeps the retired era out of every cut", () => {
  const srv = read("src/lib/desk/cube.server.ts");
  // Split before anything is measured, on settlement rather than leg count.
  assert.match(srv, /const retired = all\.filter\(\(r\) => r\.entry != null && !r\.settled\);/);
  assert.match(srv, /const rows = all\.filter\(\(r\) => r\.entry == null \|\| r\.settled\);/);
  // Every dimension is built on `rows`, never on `all`.
  const dimBlock = between(srv, "const dims: CubeDim[] = [", "// Decision-state cuts");
  assert.ok(!/cubeDim\([^,]+, all,/.test(dimBlock), "a dimension is cut over the pooled rows");
  // And the retired block is reported once, out of the dimension list.
  assert.match(srv, /buildCube\(rows, dims, notYet, retired\)/);
  const cube = read("src/lib/desk/cube.ts");
  assert.match(cube, /retired_era: \{ cell: CubeCell; why: string \} \| null;/);
  // Short single-line fragments: these sentences wrap across comment lines.
  assert.match(cube, /so pooling them/);
  assert.match(cube, /makes the current desk look far worse than it is/);
  assert.match(srv, /pooling them does not merely add noise/);
});

test("Phase 2 research definitions are frozen with a date and a bug-only exception", () => {
  const frozen = read("src/lib/desk/frozen.test.ts");
  assert.match(frozen, /PHASE 2 RESEARCH IS FROZEN AS OF 2026-09-11/);
  assert.match(frozen, /may change only for a PROVEN/);
  // Every Phase 2 constant that decides what a number MEANS is pinned there.
  for (const c of ["Z_BUCKET", "Z_MAX", "SHRINK_K", "MIN_CELL_N", "MEANINGFUL_CENTS", "MIN_SWINGS", "DUPLICATE_PCT", "MIN_AGAINST", "PERSIST_MS", "VEL2_HORIZONS"]) {
    assert.ok(frozen.includes(c), `${c} is not pinned in frozen.test.ts`);
  }
  // And the bands, which decide which calls are compared with which.
  for (const b of ["priceBand", "confBand", "marginBand", "minsBand", "spreadBand", "touchBand"]) {
    assert.ok(frozen.includes(b), `${b}'s edges are not pinned`);
  }
});

test("the local book cannot hold a level with no size behind it", () => {
  // The bug: decimal quantities do not sum exactly, so a level cancelled to
  // nothing lands on ~1e-13 and a `size > 0` test keeps it. In production 89.4%
  // of recorded resting sizes were residue like that, and TAPE 2.0's normalised
  // OFI divided by it and reported ~1e17 for a quantity that is a share.
  const book = read("src/lib/desk/lab-book.ts");
  assert.match(book, /export const QTY_EPS = 1e-6;/);
  assert.match(book, /export function hasSize\(n: unknown\): boolean/);
  // Every place a level is stored or read must go through it — a single
  // surviving `size > 0` puts the phantoms back.
  assert.match(book, /if \(hasSize\(size\)\) map\.set\(price, size\);/);
  assert.match(book, /if \(!px \|\| !hasSize\(sz\)\) continue;/);
  assert.match(book, /if \(hasSize\(s\) && p > px\)/);
  assert.match(book, /for \(const \[price, size\] of b\.yes\) if \(hasSize\(size\)\)/);
  assert.match(book, /if \(!hasSize\(size\)\) continue;/);
  // And no bare positivity test is left guarding a size.
  assert.ok(!/if \(size > 0\)/.test(book), "a bare `size > 0` size guard is back");
  assert.ok(!/if \(s > 0 && p > px\)/.test(book), "top() is back to a bare positivity test");

  // The ratio that blew up keeps its own floor, because an unbounded
  // denominator is a trap even once the book is clean.
  const tape = read("src/lib/desk/tape2.ts");
  assert.match(tape, /export const MIN_OFI_DEPTH = 1e-6;/);
  assert.match(tape, /if \(!\(depth >= MIN_OFI_DEPTH\)\) return 0;/);
});

test("WHALE 2.0 is a separate record from the incumbent volume proxy", () => {
  // A proxy and a measurement that disagree are two pieces of evidence. Pooling
  // their calibration histories would destroy both.
  const w = read("src/lib/desk/whale2.ts");
  assert.match(w, /THE TWO ARE/);
  assert.match(w, /NEVER MERGED/);
  // It knows nothing about candles: no volume-proxy input can reach it.
  assert.ok(!/vol_median|vol_last|candle/i.test(codeOf("src/lib/desk/whale2.ts")), "the real-print lab is reading the volume proxy");
  // Impact is measured from the MIDPOINT, never the traded side — a print
  // consumes the touch, so measuring there reports the trade's own mechanics.
  assert.match(w, /WHY IMPACT IS MEASURED FROM THE MIDPOINT/);
  assert.ok(!/yes_ask|yes_bid/.test(codeOf("src/lib/desk/whale2.ts")), "impact is being read off a traded side");
  // Continuation and reversal are one comparison, so a print cannot be both.
  assert.match(w, /continued: moved && follow! > 0,/);
  assert.match(w, /reversed: moved && follow! < 0,/);
  // Absorption requires a large print AND a measured future: a missing horizon
  // must never be read as "no response".
  assert.match(w, /absorbed:\s*pctile != null && pctile >= LARGE_PCTILE && follow != null/);
  // Nothing votes on it.
  // Nothing votes on it, asserted the only way that cannot be argued with: the
  // module is a pure leaf with no imports, so there is no path from it to
  // anything that decides. (Matching words like "seat" would only find the
  // sentence in its own verdict saying that no seat reads it.)
  assert.ok(!/^\s*import\s/m.test(codeOf("src/lib/desk/whale2.ts")), "whale2 is no longer a pure leaf");

  // Each print is ranked only against prints BEFORE it.
  const lab = read("src/lib/desk/lab.server.ts");
  assert.match(lab, /clustered\.slice\(0, i\)\.map\(\(x\) => x\.size\)/);
});

test("the research board counts prospective sample apart from total, and promotes nothing", () => {
  const rs = read("src/lib/desk/research-status.ts");
  // The ladder has no rung above measurable.
  assert.ok(
    !/"promote"|"adopt"|"trust"|"live"/.test(codeOf("src/lib/desk/research-status.ts")),
    "a promotion rung appeared on the status ladder",
  );
  assert.match(rs, /\| "measurable"/);
  // A result is withheld, not merely labelled, below the bar — a number beside a
  // thin sample reads as a finding whatever the status column says.
  assert.match(rs, /result: status === "measurable" \? r\.result : null/);

  const srv = read("src/lib/desk/research-status.server.ts");
  assert.match(srv, /promotes_nothing: true/);
  for (const banned of [/\binsert into\b/i, /\bupdate \w+ set\b/i, /\bdelete from\b/i, /\bpromote\w*\(/]) {
    assert.ok(!banned.test(srv), `research-status.server.ts contains ${banned} — it must be read-only`);
  }
  // The six watched seats are listed, and listed as watched rather than acted on.
  for (const seat of ["DRIFT", "CASCADE", "CHAIN", "TAPE", "WICK", "FADE"]) {
    assert.ok(srv.includes(seat), `${seat} is missing from the watchlist`);
  }
  assert.match(srv, /watching, not rewarded/);
  assert.match(srv, /watching, not inverted/);
  // The corrected measurement restarts its clock instead of pooling.
  assert.match(srv, /restarted: true/);
  // Single-line fragment: this sentence wraps across a string concatenation.
  assert.match(srv, /unusable and none is pooled/);
  // The corrected row's clock reads the shared boundary, not a pasted date.
  assert.match(srv, /since: t\.restarted \? QTY_FIX_AT : REPLAY_SHADOW_SINCE,/);

  const route = read("server/routes/research.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
});

test("the quantity-fix era is a boundary in the data, not a note in a comment", () => {
  const era = read("src/lib/desk/research-era.ts");
  assert.match(era, /export const QTY_FIX_AT = "2026-09-11T03:47:17\.000Z";/);
  // The split returns two named sets and nothing holding both, so pooling has
  // to be written on purpose rather than being what happens by default.
  assert.match(era, /export type EraSplit<T> = \{/);
  assert.match(era, /pre: T\[\];/);
  assert.match(era, /post: T\[\];/);
  assert.ok(!/\ball: T\[\]/.test(era), "the split offers a pooled array");
  // An unreadable timestamp must fall to the unusable era, never the clean one.
  assert.match(era, /if \(!Number\.isFinite\(ms\)\) return "pre-qty-fix";/);

  // The absorption row stores its era rather than deriving it on read, so a
  // query cannot blend the two by forgetting a date filter.
  const mig = read("migrations/0023_desk_absorption.sql");
  assert.match(mig, /era\s+text not null/);
  const srv = read("src/lib/desk/absorption.server.ts");
  assert.match(srv, /\$\{eraAt\(r\.t\)\}/);
  // Both boundaries are applied, and the rows failing either are counted rather
  // than vanishing: a study that silently narrows its sample is worse than one
  // that reports a small one.
  assert.match(srv, /const post = split\.post\.filter\(\(r\) => printCtxUsable\(r\.t\)\);/);
  assert.match(srv, /const ctxDropped = split\.post\.length - post\.length;/);
  assert.match(srv, /absorptionReport\(post, split\.pre\.length \+ ctxDropped, controls\)/);
  assert.ok(!/split\.pre\.concat|\.\.\.split\.pre/.test(srv), "pre-fix rows are being pooled in");

  // The context boundary is its own moment, with its own reason.
  assert.match(era, /export const PRINT_CTX_FIX_AT = "/);
  assert.match(era, /export function printCtxUsable\(/);
  assert.match(era, /production data is not edited by hand/);
});

test("absorption is judged against the price, never a hit rate, and cannot self-promote", () => {
  const a = read("src/lib/desk/absorption.ts");
  // The measurement: realized versus what the market implied, against the interval.
  assert.match(a, /const beyond = implied < lo \|\| implied > hi;/);
  // Nothing is classified at write time; bands live here and are frozen.
  assert.match(a, /export const PCTILE_BANDS = \[80, 90, 95\] as const;/);
  assert.match(a, /export const RESPONSE_BANDS = \[0\.5, 1, 2\] as const;/);
  assert.match(a, /FROZEN 2026-09-11, before any post-fix outcome existed/);
  // A missing future is never absorption — otherwise every late print qualifies.
  assert.match(a, /if \(r\.move_30s == null\) return false;/);
  // The fee is imported, not a second copy of the formula.
  assert.match(a, /export const feeAt = takerFeeCentsExact;/);
  // Below the floor, every falsification line is withheld INCLUDING "no effect".
  assert.match(a, /including "no effect"/);
  assert.match(a, /export const MIN_PROSPECTIVE = 30;/);
  // And a surviving effect still does not promote.
  assert.match(a, /earns more sample and a conversation, not a promotion/);

  const srv = read("src/lib/desk/absorption.server.ts");
  assert.match(srv, /thresholds_in_production: false/);
  assert.match(srv, /votes: false/);
  // It writes only its own table.
  const writes = [...codeOf("src/lib/desk/absorption.server.ts").matchAll(/insert into (\w+)|update (\w+) set|delete from (\w+)/gi)];
  for (const m of writes) {
    const table = m[1] ?? m[2] ?? m[3];
    assert.equal(table, "desk_absorption", `absorption.server writes ${table}`);
  }
  const route = read("server/routes/absorption.get.ts");
  assert.match(route, /adminKeyOk\(key\)/);
});

test("BUY and SELL, and single and clustered, are never pooled", () => {
  const a = read("src/lib/desk/absorption.ts");
  // The grid walks both sides and both shapes explicitly.
  assert.match(a, /for \(const side of \["UP", "DOWN"\] as const\)/);
  assert.match(a, /for \(const shape of \["single", "clustered"\] as const\)/);
  assert.match(a, /shape === "single" \? r\.cluster_n === 1 : r\.cluster_n > 1/);
  // And the report surfaces all four separately.
  for (const f of ["buy_single", "buy_clustered", "sell_single", "sell_clustered"]) {
    assert.ok(a.includes(f), `${f} is missing from the report`);
  }
});

test("every control the owner asked for is wired, including the other signals", () => {
  const srv = read("src/lib/desk/absorption.server.ts");
  for (const name of [
    "market probability", "regime", "distance to strike", "seconds remaining",
    "STRIKE 2.0 fair", "VEL 2.0 residual", "TAPE 2.0 OFI", "DRIFT", "CASCADE", "size against depth",
  ]) {
    assert.ok(srv.includes(`control("${name}"`), `the ${name} control is missing`);
  }
  // An effect living in one band of a control is that control in disguise.
  const a = read("src/lib/desk/absorption.ts");
  assert.match(a, /independent: survives >= 2/);
});

test("the seat context a print carries records its own staleness", () => {
  // The lab runs on the websocket and the seats on the brain tick, so a print's
  // DRIFT and CASCADE are as of the last tick. A study that could not see the
  // age would read a four-minute-old value as a reading of that moment.
  const lab = read("src/lib/desk/lab.server.ts");
  assert.match(lab, /seat_age_ms: d\.t \? Math\.round\(t - d\.t\) : null,/);
  assert.match(read("migrations/0023_desk_absorption.sql"), /seat_age_ms\s+integer/);
  // Evidence uses the desk's own converter, not a second scale.
  assert.match(read("src/lib/desk/server-engine.ts"), /drift: seatEvidence\(votes\.find/);
});

test("a window's prints survive the rollover that settles it", () => {
  // Found in production: zero prints were written after the first window graded.
  // A window settles AFTER the snapshot has rolled to the next one, so a single
  // current-window buffer is wiped on the roll and the settle then finds
  // nothing — the data is destroyed a moment before the only code that wants it
  // runs. Replay already keeps a per-ticker map; whale now does too.
  const lab = read("src/lib/desk/lab.server.ts");
  assert.match(lab, /whale: Map<string, \{ prints: StampedPrint\[\]; marks: WhaleMark\[\]; t: number \}>;/);
  // Nothing may clear a window's buffer on the ticker roll.
  const roll = between(lab, "if (L.tape2Ticker !== tk) {", "const b = L.books.get(tk);");
  assert.ok(!/whale/i.test(roll), "the ticker roll is clearing whale state again");
  // And the settle-time reader must look up BY TICKER, never against the
  // current one, which by then is already the next window.
  assert.match(lab, /const w = L\.whale\.get\(ticker\);/);
  const reader = between(lab, "export function whalePrintRecords", "function clusterStamped");
  assert.ok(!/tape2Ticker/.test(reader), "the reader is checking the current ticker again");
  assert.ok(!/currentTicker/.test(reader), "the reader is checking the current ticker again");
  // Buffers for windows that never settled are pruned rather than kept forever.
  assert.match(lab, /if \(t - v\.t > WHALE_WINDOW_KEEP_MS\) L\.whale\.delete\(k\);/);
  // A settled window is forgotten only AFTER the write returns — a read
  // followed by a failed write must not be what loses the data.
  const eng = read("src/lib/desk/server-engine.ts");
  const block = between(eng, "const rows = whalePrintRecords(", "e.lastError = `absorption");
  assert.ok(
    block.indexOf("await recordPrints(") < block.indexOf("forgetWhaleWindow("),
    "the buffer is discarded before the write is known to have succeeded",
  );
});

test("a print carries the state of the world at the moment it landed", () => {
  // Found in production: all 501 prints of the first recorded window carried one
  // identical order-flow reading, one regime, one spread and one distance — the
  // context was read at SETTLE, so every conditioning test, which is the point
  // of the study, was reading a single constant. BTC and depth came back null
  // entirely, because their buffers had already been cleared by the ticker roll.
  const lab = read("src/lib/desk/lab.server.ts");
  assert.match(lab, /type StampedPrint = Print & \{/);
  // Stamped where the print arrives.
  const FIELDS = ["ofi_norm", "spread", "depth", "touch", "dist", "sigma", "fair_yes", "vel_resid", "drift_ev", "cascade_ev", "seat_age_ms", "regime"];
  const type = between(lab, "type StampedPrint = Print & {", "/** One instant of the window");
  const stamp = between(lab, "function noteWhalePrint", "function whaleFor");
  for (const f of FIELDS) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(type), `${f} is not on StampedPrint`);
    // Property shorthand is legitimate, so the name is matched rather than "name:".
    assert.ok(new RegExp(`\\b${f}\\b`).test(stamp), `${f} is not stamped at print time`);
  }
  // And read back from the print, never from live lab state.
  const reader = between(lab, "export function whalePrintRecords", "function clusterStamped");
  for (const f of ["ofi_norm: c.ofi_norm", "spread: c.spread", "dist: c.dist", "regime: c.regime", "fair_yes: c.fair_yes", "vel_resid: c.vel_resid", "drift_ev: c.drift_ev", "cascade_ev: c.cascade_ev", "seat_age_ms: c.seat_age_ms"]) {
    assert.ok(reader.includes(f), `the reader is not using the print's own ${f.split(":")[0]}`);
  }
  assert.ok(!/L\.tape2Last|L\.vel2Last|L\.deskState/.test(reader), "the reader is reading live lab state again");

  // BTC comes off the window's own marks, not the VEL buffer the roll clears.
  assert.match(lab, /function btcMoveOver\(marks: readonly WhaleMark\[\]/);
  assert.match(lab, /w\.marks\.push\(\{ t, mid, spot:/);

  // A burst keeps the FIRST print's context: the decision was taken then, and
  // averaging across the burst would invent a reading nobody saw.
  assert.match(lab, /out\.push\(\{ \.\.\.p, prints: 1 \}\);/);
  assert.match(lab, /carrying the FIRST print's context forward/);

  // Staleness is not clamped: a negative age means the state arrived after the
  // print, which is a fault worth seeing rather than hiding behind a zero.
  assert.match(stamp, /seat_age_ms: d\.t \? Math\.round\(t - d\.t\) : null,/);
  assert.ok(!/seat_age_ms: .*Math\.max\(0/.test(stamp), "staleness is being clamped to zero again");
});
