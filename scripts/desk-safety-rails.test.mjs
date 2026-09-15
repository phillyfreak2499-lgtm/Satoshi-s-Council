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
import { readdirSync, readFileSync } from "node:fs";
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
  const entryAt = src.indexOf("noteEntryState(e, snap, chair, votes, cents);");
  assert.ok(entryAt > gateAt, "same-tick entry state must be captured after the live floor passes");
});

test("S2-10: the paper book refuses a non-positive current edge before any fill is recorded", () => {
  // The pure guard lives in the book module: it selects the booking side's own edge
  // and passes only finite, strictly-positive edges — no second fair/fee formula.
  const floor = read("src/lib/desk/book-floor.ts");
  assert.match(floor, /export function paperBookEdgeOk\(/, "paperBookEdgeOk must be exported from book-floor");
  assert.match(
    floor,
    /lean === "UP" \? snap\.edge_up : snap\.edge_down/,
    "the guard must read the booking side's own current edge (edge_up for UP, edge_down for DOWN)",
  );
  assert.match(floor, /Number\.isFinite\(edge\) && edge > 0/, "the guard must pass only finite, strictly-positive edges (fail closed)");
  const gi = floor.indexOf("export function paperBookEdgeOk(");
  const guard = floor.slice(gi, floor.indexOf("\n}", gi) + 2);
  assert.ok(
    !/takerFee|fair_yes|fee_yes|fee_no/.test(guard),
    "the edge guard must reuse snap.edge_up/edge_down, never recompute fair or fees (no second formula)",
  );

  // The server paper-book boundary consults the guard — on decideChair's post-stick
  // chair.lean — AFTER the WAIT early-return and BEFORE any path that records a fill
  // (shadow capture, live floor, entry-state capture, call-log write). Fail closed
  // with a bare return; no booking, no mutation.
  const body = noteCallBody(read("src/lib/desk/server-engine.ts"));
  assert.match(body, /if \(!paperBookEdgeOk\(snap, chair\.lean\)\) return;/, "noteCall must gate fills on the current-edge guard");
  const iWait = body.indexOf('if (chair.lean !== "UP" && chair.lean !== "DOWN")');
  const iGuard = body.indexOf("if (!paperBookEdgeOk(snap, chair.lean)) return;");
  const iShadow = body.indexOf("noteShadowFill(");
  const iFloor = body.indexOf("if (!bookable(cents)) return;");
  const iEntry = body.indexOf("noteEntryState(");
  const iCallLog = body.indexOf("e.callLog = [");
  assert.ok(iWait >= 0 && iGuard > iWait, "the edge guard must sit AFTER the WAIT early-return (WAIT is unaffected)");
  assert.ok(iShadow > iGuard, "the edge guard must run BEFORE the 70¢ shadow capture (both books refuse non-positive edge)");
  assert.ok(iFloor > iGuard, "the edge guard must run BEFORE the live price floor");
  assert.ok(iEntry > iGuard, "the edge guard must run BEFORE the entry-state capture");
  assert.ok(iCallLog > iGuard, "the edge guard must run BEFORE the paper position is written");
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
    // window.$ticker.tsx phrased it with the fee clause in between — "books on paper
    // at the ask plus Kalshi's fee, at 70¢ or better" — which slipped past every
    // pattern above. An arithmetic example never says "or better", so this is safe.
    new RegExp(`at ${shadow}¢ or better`, "i"),
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
    // The PUBLIC routes were missing from this list, and both had drifted: faq.tsx
    // said "only fills at 70¢ or better" and every /window/<ticker> page said "at 70¢
    // or better" — a present-tense claim about a floor the book has not paid since
    // FLOOR_LIVE_SINCE. The rail covered six internal files and none of the pages a
    // visitor actually reads.
    "src/routes/faq.tsx",
    "src/routes/window.$ticker.tsx",
  ]) {
    const src = read(rel);
    for (const re of claims) {
      assert.ok(!re.test(src), `${rel} still claims the live floor is ${shadow}¢ (${re})`);
    }
  }

  // Banning the stale number is only half of it: the copy could also be deleted, and
  // a visitor would then be told nothing about the gate that decides whether a read
  // becomes a fill. Each public page must state the LIVE floor.
  for (const rel of ["src/routes/faq.tsx", "src/routes/window.$ticker.tsx"]) {
    const src = read(rel);
    assert.ok(
      src.includes(`${live}¢`),
      `${rel} must state the live floor (${live}¢): a visitor cannot otherwise tell why a read did not fill`,
    );
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

/**
 * Every research reader still excludes the known-invalid windows.
 *
 * The exclusion is only worth having if no aggregate can quietly bypass it. A
 * new report that reads desk_ledger and forgets the predicate would silently
 * re-admit the 2026-09-10 block, and the number would look fine.
 *
 * Listed explicitly rather than globbed: adding a research reader should be a
 * decision that includes answering "does this count invalid windows?", and an
 * unlisted file failing this test is that question being asked.
 */
/**
 * No write may identify a ledger row by ticker alone.
 *
 * `desk_ledger` is unique on (ticker, close_time) -- migration 0005 -- so a ticker
 * is not a row. On 2026-09-10 nine rows shared one, and the official_value backfill
 * wrote `where ticker = $1 and official_value is null`: correct by luck when a
 * ticker happens to name one window, silently wrong when it does not. Grading has
 * gone through the window-identity invariant since #133; this was the one write
 * left that did not.
 */
/**
 * The in-memory replay buffer is keyed by WINDOW, never by ticker alone.
 *
 * A ticker is not a window. On 2026-09-10 nine consecutive closes carried one
 * ticker. Keyed by ticker alone, under that shape: if a series for the reused ticker
 * remained in memory, later closes would resolve to that same series, so their
 * samples and timing could blend into the earlier window's — and `partial` could not
 * see it, because that flag tests where a series starts and the start would be
 * legitimate.
 *
 * Whether that blending occurred on 2026-09-10 is UNDETERMINED: no desk_replay row
 * exists for that ticker at all. This rail guards a proven property of the code, not
 * a proven historical event.
 *
 * It is rail-guarded rather than left to review because a dropped window shows up as
 * absence and a blended one does not.
 */
/**
 * The PERSISTED replay identity is the window too, and every reader that ties a replay
 * to a ledger row says which window it means.
 *
 * S2-2A keyed the in-memory buffer by (ticker, close_time). The table itself was still
 * `ticker primary key`, so a second close sharing a ticker could not be stored at all:
 * `on conflict (ticker) do nothing` discarded it with no error and no counter. And four
 * readers associated a replay to a ledger row by ticker alone, which mis-attaches a
 * series without needing any duplicate row to exist.
 */
test("the persisted replay identity is the window, and readers name it", () => {
  // 1 · SCHEMA. The key is both halves, and cannot quietly go back.
  const mig = read("migrations/0028_desk_replay_window_identity.sql");
  assert.match(mig, /primary key \(ticker, close_time\)/, "the new key is the window");
  const created = read("migrations/0014_desk_replay.sql");
  assert.match(created, /ticker {6}text primary key/, "0014 is left as the record of what was");
  // No migration may re-establish a ticker-only identity on this table.
  for (const f of readdirSync(join(ROOT, "migrations")).filter((x) => x.endsWith(".sql"))) {
    if (f === "0014_desk_replay.sql") continue;
    const src = read(`migrations/${f}`);
    assert.doesNotMatch(
      src,
      /desk_replay[\s\S]{0,200}?primary key \(ticker\)/,
      `${f} must not key desk_replay on the ticker alone`,
    );
  }

  // 2 · WRITER. The conflict target is the window.
  const rep = codeOf("src/lib/desk/replay.server.ts");
  assert.match(rep, /on conflict \(ticker, close_time\) do nothing/, "conflict on the window");
  assert.doesNotMatch(rep, /on conflict \(ticker\)/, "never on the ticker alone");

  // 3 · READERS. Every desk_replay <-> ledger association carries close_time. Checked
  // per statement, not per file, so one fixed join cannot vouch for an unfixed one.
  const readers = readdirSync(join(ROOT, "src/lib/desk"))
    .filter((f) => f.endsWith(".server.ts"))
    .map((f) => `src/lib/desk/${f}`);
  let associations = 0;
  for (const rel of readers) {
    const src = codeOf(rel);
    // Statements that name both tables are associations; ones that read only the
    // replay table (sitemap, the research traces) are not and are left alone.
    for (const m of src.matchAll(/desk_replay\s+r\b[^`]*/g)) {
      const stmt = m[0];
      if (!/desk_ledger/.test(stmt) && !/l\.ticker/.test(stmt)) continue;
      associations += 1;
      assert.match(
        stmt,
        /close_time\s*=\s*(r|l)\.close_time/,
        `${rel}: a replay<->ledger association must match close_time, not the ticker alone`,
      );
    }
  }
  assert.ok(associations >= 3, `expected the known associations, found ${associations}`);
  // And the one that reads the other way round (ledger r, replay l) — BOOKS' exists().
  const books = codeOf("src/lib/desk/books.server.ts");
  assert.match(
    books,
    /from desk_replay r\s*\n?\s*where r\.ticker = l\.ticker and r\.close_time = l\.close_time/,
    "the BOOKS replay-exists flag must match the window",
  );
  assert.doesNotMatch(
    books,
    /from desk_replay r where r\.ticker = l\.ticker\)/,
    "not the ticker alone",
  );

  // 4 · PUBLIC TICKER-ONLY LOOKUP fails closed on ambiguity and never guesses. The
  // sequence lives in replay-lookup.ts so it can be tested; the rail pins both the
  // rule there and the queries the server hands it.
  const look = codeOf("src/lib/desk/replay-lookup.ts");
  assert.match(look, /found\.length === 1 \? found\[0\]!\.close_time : null/, "exactly one, or null");
  for (const guess of [/order by/, /\.sort\(/, /Math\.max/, /\.at\(-1\)/, /\[0\]!\.close_time : found/]) {
    assert.doesNotMatch(look, guess, `ambiguity must not be resolved by ${guess}`);
  }
  assert.match(rep, /select close_time from desk_replay where ticker = \$\{t\} limit 2/, "an ambiguity probe");
  assert.doesNotMatch(rep, /order by close_time desc\s*\n?\s*limit 1/, "never the newest");
  assert.doesNotMatch(rep, /order by close_time asc\s*\n?\s*limit 1/, "never the oldest");
  assert.doesNotMatch(rep, /where ticker = \$\{t\} limit 1/, "a bare limit 1 would be a guess");
  // The payload query is addressed by BOTH halves, so its limit 1 names one row by
  // construction rather than choosing among several.
  assert.match(
    rep,
    /where r\.ticker = \$\{t\} and r\.close_time = \$\{closeIso\}/,
    "the payload is fetched by the resolved window",
  );

  // 5 · CACHE. Composite-keyed, and the identity is probed before it is consulted.
  assert.match(look, /return `\$\{ticker\}\|\$\{closeIso\}`/, "the cache key is both halves");
  const fn = look.slice(look.indexOf("export async function lookupOneWindow"));
  const probeAt = fn.indexOf("await probe(ticker)");
  const getAt = fn.indexOf("cache.get(key)");
  const refuseAt = fn.indexOf("if (closeIso == null) return null;");
  assert.ok(probeAt >= 0 && refuseAt > probeAt, "the refusal follows the probe");
  assert.ok(getAt > refuseAt, "the cache is consulted only once the window is resolved");
  assert.doesNotMatch(fn, /cache\.get\(ticker\)/, "no ticker-only cache read");
  assert.doesNotMatch(fn, /cache\.set\(ticker,/, "no ticker-only cache write");
  // The key the cache is actually addressed by must be built from BOTH halves. Without
  // this, `const key = ticker` defeats the composite identity while every
  // cache.get(ticker)/cache.set(ticker) check above still passes — a gap a mutation
  // found before this PR was committed.
  assert.match(fn, /const key = payloadKey\(ticker, closeIso\);/, "the cache key is the composite one");
  assert.match(fn, /cache\.get\(key\)/, "and the cache is addressed by it");
  assert.match(fn, /cache\.set\(key,/, "on the way in too");
  // And the server hands it the shared key, so the two cannot disagree.
  assert.match(rep, /export \{ payloadKey as recentKey \};/, "one cache-key definition");
  assert.doesNotMatch(rep, /recent\.get\(ticker\)/, "no ticker-only cache read in the server file");
  assert.doesNotMatch(rep, /recent\.set\(ticker,/, "no ticker-only cache write in the server file");
});

test("the replay buffer is keyed by window, not by ticker", () => {
  const rep = codeOf("src/lib/desk/replay.server.ts");
  const win = codeOf("src/lib/desk/replay-window.ts");

  // Identity lives in the pure module, and the server file goes through it rather
  // than holding a ticker-keyed Map of its own.
  assert.match(rep, /from "\.\/replay-window"/, "replay.server must use the window store");
  assert.match(rep, /new WindowStore<ReplayCols>\(\)/, "the buffer is a WindowStore");
  assert.doesNotMatch(rep, /new Map<string, Series>\(\)/, "no raw ticker-keyed map may return");

  // The four ticker-only accesses the old keying used, named exactly.
  for (const bad of [
    /series\.get\(snap\.ticker\)/,
    /series\.set\(snap\.ticker\b/,
    /series\.get\(ticker\)/,
    /series\.delete\(ticker\)/,
    /series\.delete\(snap\.ticker\)/,
  ]) {
    assert.doesNotMatch(rep, bad, `ticker-only buffer access: ${bad}`);
  }

  // And the accesses that remain carry both halves.
  assert.match(rep, /openSlot\(\s*series,\s*snap\.ticker,\s*snap\.close_time,/, "sampling opens a window slot");
  assert.match(rep, /series\.get\(ticker, closeMs\)/, "the live lookup takes the window");
  assert.match(rep, /series\.take\(ticker, closeMs\)/, "recording consumes one window");

  // Both exported entry points take the close. A signature that drops it is how a
  // caller would silently go back to naming a ticker.
  assert.match(rep, /export function replayLive\(ticker: string, closeMs: number\)/, "replayLive takes the window");
  assert.match(
    rep,
    /export async function recordReplay\(ticker: string, closeMs: number, winner:/,
    "recordReplay takes the window it graded",
  );

  // 1 · THE GRADER PASSES THE CLOSE IT ALREADY VALIDATED. applyGrade is only reached
  // when officialHit returns a settle, so snap.close_time has been through the
  // window-identity invariant. Any OTHER clock here would be a second answer about
  // which window graded.
  const eng = codeOf("src/lib/desk/server-engine.ts");
  assert.match(eng, /recordReplay\(snap\.ticker, snap\.close_time, finish\)/, "the grader names the window");
  assert.doesNotMatch(eng, /recordReplay\(snap\.ticker, finish\)/, "never by ticker alone");
  // Just the call's arguments, not the neighbouring code — a loose slice picks up
  // other windows' clocks from nearby statements and fails for the wrong reason.
  const recArgs = /recordReplay\(([^)]*)\)/.exec(eng)?.[1] ?? "";
  assert.equal(recArgs.trim(), "snap.ticker, snap.close_time, finish", "exactly the graded window");
  // Matched on a word boundary, not by substring: "p.close_time" is a substring of
  // "snap.close_time", so a plain includes() check fails on the correct code.
  for (const wrongClock of ["Date.now()", "snap.as_of", "w.close_time", "booked.close_time", "p.close_time"]) {
    const boundary = new RegExp(`(^|[^A-Za-z0-9_.])${wrongClock.replace(/[.()]/g, "\\$&")}`);
    assert.doesNotMatch(recArgs, boundary, `the replay write must use snap.close_time, not ${wrongClock}`);
  }
  // Same for the live read: the window being graded, not another clock.
  assert.match(eng, /replayLive\(snap\.ticker, snap\.close_time\)/, "the live read names the window");
  assert.doesNotMatch(eng, /replayLive\(snap\.ticker\)/, "never by ticker alone");

  // 4 · WRONG CLOSE, PINNED AT THE SERVER BOUNDARY TOO. recordReplay must reach the
  // buffer through exactly one exact take and bail before any database work when the
  // window is not there — so an unknown close cannot consume a ticker's other window.
  const recFn = rep.slice(rep.indexOf("export async function recordReplay"));
  const recBody = recFn.slice(0, recFn.indexOf("\n}"));
  assert.equal(
    (recBody.match(/series\./g) ?? []).length,
    1,
    "exactly one buffer access in recordReplay, so it cannot read one window and drop another",
  );
  assert.match(recBody, /const s = series\.take\(ticker, closeMs\);\s*\n\s*if \(!s\) return;/, "take then bail");
  assert.ok(
    recBody.indexOf("if (!s) return;") < recBody.indexOf("await sql()"),
    "an unknown window returns before any database work",
  );

  // 5 · THE STALE-PRUNE POLICY IS UNCHANGED: one hour, strict >, and only when a new
  // window opens. The only difference this change makes is that a second close sharing
  // a ticker now opens its own series — which is also what lets the prune run at all
  // during a frozen ticker.
  assert.match(win, /export const STALE_MS = 3_600_000;/, "same one-hour retention");
  assert.match(win, /if \(nowMs - v\.close_time > maxAgeMs\)/, "same strict > comparison");
  assert.match(win, /store\.pruneStale\(asOfMs, opts\.staleMs \?\? STALE_MS\)/, "pruned as a window opens");
  const openFn = win.slice(win.indexOf("export function openSlot"));
  const pruneAt = openFn.indexOf("pruneStale(");
  const setAt = openFn.indexOf("store.set(");
  assert.ok(pruneAt >= 0 && setAt > pruneAt, "the prune runs on the new-window branch, before the series is stored");
  assert.equal((win.match(/pruneStale\(/g) ?? []).length, 2, "one definition, one call — no second policy");

  // The store itself offers no ticker-only way in: every method takes both halves.
  for (const m of ["get", "set", "take"]) {
    assert.match(
      win,
      new RegExp(`${m}\\(ticker: string, closeMs: number`),
      `WindowStore.${m} must require both halves`,
    );
  }
  assert.match(win, /return `\$\{ticker\}\|\$\{closeMs\}`/, "the key is both halves");
  // A series' window is fixed at creation; nothing may rewrite it afterwards.
  //
  // Narrowed in S2-2B: the original pattern was `/\.close_time\s*=/`, which also matched
  // SQL equality predicates like `l.close_time = r.close_time` — exactly the both-halves
  // joins S2-2B adds. The rule was only ever about a buffered SERIES being moved onto
  // another window, so it now names the series receivers and excludes comparisons.
  for (const [src, where] of [
    [win, "the window store"],
    [rep, "the server file"],
  ]) {
    assert.doesNotMatch(
      src,
      /\b(s|series|slot\.series)\.close_time\s*=[^=]/,
      `a buffered series' window must never be reassigned (${where})`,
    );
  }
});

test("no write identifies a ledger row by ticker alone", () => {
  const writers = readdirSync(join(ROOT, "src/lib/desk"))
    .filter((f) => f.endsWith(".server.ts") || f === "server-engine.ts")
    .map((f) => `src/lib/desk/${f}`);

  let seen = 0;
  for (const rel of writers) {
    const src = codeOf(rel);
    // Every `update desk_ledger ... where ...` statement, to the closing backtick.
    for (const m of src.matchAll(/update\s+desk_ledger\b[\s\S]*?`/g)) {
      seen += 1;
      const stmt = m[0];
      assert.match(stmt, /\bticker\s*=/, `${rel}: a ledger write must match on ticker`);
      assert.match(
        stmt,
        /\bclose_time\s*=/,
        `${rel}: this write matches a ledger row by ticker alone. A ticker is not a row ` +
          `(unique (ticker, close_time)); nine rows shared one on 2026-09-10. Match close_time too.`,
      );
    }
  }
  assert.ok(seen >= 1, "the official_value write must still exist to be checked");

  // And that one write goes through the shared invariant before it fires, rather
  // than trusting that asking Kalshi about a ticker returns that ticker's market.
  const lab = codeOf("src/lib/desk/lab.server.ts");
  // between() scans for its end marker from the START of the file, so the end marker
  // has to be something that genuinely follows this function.
  const fn = between(lab, "async function backfillOfficial", "function currentTicker");
  const fnRefusal = fn.slice(fn.indexOf("if (!verdict.ok)"));
  assert.match(lab, /from "\.\/window-identity"/, "the backfill must import the invariant");
  assert.match(lab, /mayWriteOfficial\(/, "the backfill must consult it");
  assert.match(
    lab,
    /if \(!verdict\.ok\) \{/,
    "a refused verdict must short-circuit the write, not be logged and ignored",
  );
  assert.match(lab, /backfillRefused \+= 1/, "a refusal must leave a breadcrumb");

  // The CLOSE WITNESS is `close_time` and nothing else. Kalshi's `expiration_time` is
  // the deprecated legacy expiry clock — a different measurement — so substituting it
  // would compare the row's close against something that does not mean the same thing
  // and call the result an identity check. Absent is passed as 0, "not carried".
  const vAt = lab.indexOf("const verdict = mayWriteOfficial(");
  assert.ok(vAt >= 0, "the verdict call must exist");
  const verdictCall = lab.slice(vAt, lab.indexOf("});", vAt) + 3);
  assert.match(verdictCall, /close_ms: Date\.parse\(String\(m\.close_time \?\? ""\)\) \|\| 0/, "close_time only");
  for (const wrong of [
    "expiration_time",
    "expected_expiration_time",
    "latest_expiration_time",
    "settlement_ts",
    "receipt_ts",
  ]) {
    assert.doesNotMatch(
      verdictCall,
      new RegExp(wrong),
      `the close witness must not fall back to ${wrong} — it is not close_time`,
    );
  }

  // And the refusal must use the line written for THIS path. The grading line says
  // "not graded, not taught", which is false of a row that has already graded and
  // already taught — backfillOfficial only withholds one column.
  assert.match(lab, /officialFaultLine\(/, "the official-value path has its own diagnostic");
  assert.doesNotMatch(fnRefusal, /\bfaultLine\(/, "the grading line must not be borrowed here");
  const wi = codeOf("src/lib/desk/window-identity.ts");
  assert.match(wi, /official_value not written/, "the official line names what was withheld");
  assert.match(wi, /not graded, not taught/, "the grading line keeps its own wording");
  // FAIL CLOSED WITH NO CLOSE WITNESS. An allowed official verdict must never be
  // reached with both close-time witnesses failing: an unparseable ticker AND a payload
  // carrying no usable close leaves nothing tying the fetched market to THIS row, and
  // an echoed ticker is not a witness because the request supplied it. The narrowed
  // UPDATE stops one statement touching many rows, not the same wrong value reaching
  // each of them in turn.
  const mwAt = wi.indexOf("export function mayWriteOfficial");
  assert.ok(mwAt >= 0, "mayWriteOfficial must exist");
  const mwEnd = wi.indexOf("\n}", mwAt);
  const mw = wi.slice(mwAt, mwEnd > mwAt ? mwEnd : undefined);
  assert.match(
    mw,
    /if \(tickerTimeOk !== true && !checks\.close_ok\) \{/,
    "the zero-witness guard must be present, and must require at least one witness",
  );
  // The guard has to sit BEFORE the success return, or it cannot withhold anything.
  const guardAt = mw.indexOf("if (tickerTimeOk !== true && !checks.close_ok)");
  const okAt = mw.indexOf("return { ok: true, checks };");
  assert.ok(guardAt >= 0 && okAt > guardAt, "the guard must precede the ok:true return");
  // One success return only, so there is no second path around the guard.
  assert.equal(
    (mw.match(/return \{ ok: true/g) ?? []).length,
    1,
    "exactly one allowed exit, so the guard cannot be bypassed",
  );
  // Absence of evidence is not labelled a mismatch.
  const guardBlock = mw.slice(guardAt, okAt);
  assert.match(guardBlock, /fault: "official-identity-unverifiable"/, "named for what it is");
  assert.doesNotMatch(guardBlock, /mismatch/, "nothing disagreed, so it is not a mismatch");
  // And it is not treated as a contradiction by the loud/quiet predicate.
  assert.match(
    wi,
    /fault !== "no-settle-for-window" && fault !== "official-identity-unverifiable"/,
    "absent evidence must not read as an inconsistency",
  );

  const ofAt = wi.indexOf("export function officialFaultLine");
  assert.ok(ofAt >= 0, "the official-value line must exist");
  const ofEnd = wi.indexOf("\n}", ofAt);
  assert.doesNotMatch(
    wi.slice(ofAt, ofEnd > ofAt ? ofEnd : undefined),
    /not graded|not taught/,
    "the official line must not claim the row was ungraded or untaught",
  );
  // The SELECT has to carry both halves, or the narrow write cannot be expressed.
  assert.match(lab, /select ticker, \(extract\(epoch from close_time\)/, "select both halves of the identity");
  // And nothing here may invent a value when identity disagrees.
  assert.doesNotMatch(fn, /official_value = \$\{?v \|\|/, "no fallback value on refusal");
});

test("research readers exclude the known-invalid windows", () => {
  // Coverage is one question, not twenty-eight: does this query read the bare
  // table? Research reads the desk_ledger_research view, which carries the
  // exclusion once. A new aggregate that reads the view is correct by
  // construction; one that reads desk_ledger must appear in the allowlist below
  // with a reason, which is the point at which someone has to think about it.
  // A READ exemption is not a WRITE exemption. The official_value backfill was
  // allowlisted here with a read reason — "must reach every row" — and the file's
  // one bare-table statement was an UPDATE that identified its row by ticker
  // alone, which is the 2026-09-10 half-identity. One allowlist cannot sanction
  // both, so reads and writes are listed separately and a write reason has to say
  // which columns of the row's identity it matches on.
  const ALLOWED_BARE = {
    "src/lib/desk/skill-score-audit.server.ts": [
      "read-only grading receipts must retain excluded inputs and their credit-skip reason; " +
        "the count is receipts, never research wins, EV or learner credit. No operating consumer.",
    ],
    "src/lib/desk/books.server.ts": [
      "timestamp-only coverage scan must include quarantined rows so they are not falsely labeled missing; all research totals still use desk_ledger_research",
    ],
    "src/lib/desk/server-engine.ts": [
      "the ledger INSERT itself",
      "the durable-write read-back, which must see the row it just wrote",
      "the 6h gap scan and the 90d reconciliation — these MUST see every row, or " +
        "each quarantined window reads as a MISSING ledger row and alerts falsely",
    ],
    "src/lib/desk/lab.server.ts": [
      "the official_value backfill's SELECT, which must reach every row that is " +
        "still missing its official value",
    ],
    "src/lib/desk/replay.server.ts": ["the replay viewer: one named window, shown for forensics"],
    "src/lib/desk/kalshi-reconcile.server.ts": [
      "S2-7 independent reconciliation: it must audit EVERY window, including the " +
        "quarantined/identity-invalid rows, which it classifies as TICKER_CLOSE_MISMATCH. " +
        "Reading desk_ledger_research would hide exactly the corrupted rows the audit exists " +
        "to surface. Read-only SELECT; the external truth is fetched from Kalshi, never this table.",
    ],
  };

  // Writes are listed on their own, and every entry names the identity it matches.
  const ALLOWED_WRITE = {
    "src/lib/desk/lab.server.ts": ["official_value, on (ticker, close_time), only when it is null"],
  };

  const readers = readdirSync(join(ROOT, "src/lib/desk"))
    .filter((f) => f.endsWith(".server.ts") || f === "server-engine.ts")
    .map((f) => `src/lib/desk/${f}`);

  for (const rel of readers) {
    const src = codeOf(rel);
    // Bare reads: desk_ledger not followed by _research or _patterns.
    const bare = (src.match(/\bdesk_ledger\b(?!_)/g) ?? []).length;
    if (bare === 0) continue;
    assert.ok(
      ALLOWED_BARE[rel],
      `${rel} reads desk_ledger directly (${bare}x). Research must read ${"desk_ledger_research"}; ` +
        `if this read genuinely needs every row, add it to ALLOWED_BARE with the reason.`,
    );
  }

  // A write needs its OWN entry. Being allowlisted to read every row has never been
  // a reason to write to one, and for the official_value backfill that conflation
  // is exactly how a ticker-only UPDATE sat behind a read justification.
  for (const rel of readers) {
    const src = codeOf(rel);
    if (!/update\s+desk_ledger\b/.test(src)) continue;
    assert.ok(
      ALLOWED_WRITE[rel],
      `${rel} WRITES to desk_ledger. A read entry in ALLOWED_BARE does not cover that; ` +
        `add it to ALLOWED_WRITE with the identity the write matches on.`,
    );
    for (const reason of ALLOWED_WRITE[rel]) {
      assert.match(
        reason,
        /close_time/,
        `${rel}: a ledger-write reason must name close_time — a ticker is not a row.`,
      );
    }
  }

  // And the files that DO read research data must be reading the view.
  for (const rel of [
    "src/lib/desk/cube.server.ts",
    "src/lib/desk/redundancy.server.ts",
    "src/lib/desk/excursion.server.ts",
    "src/lib/desk/crew.server.ts",
    "src/lib/desk/ledger-clerk.server.ts",
    "src/lib/desk/readiness.server.ts",
    "src/lib/desk/recap.server.ts",
    "src/lib/desk/books.server.ts",
    "src/lib/desk/brief.server.ts",
    "src/lib/desk/taker.server.ts",
    "src/lib/desk/arena.server.ts",
    "src/lib/desk/pit.server.ts",
  ]) {
    assert.match(codeOf(rel), /desk_ledger_research/, `${rel} must read the research view`);
  }

  // desk_samples and desk_replay carry no quality column, so those readers apply
  // the registry in JS instead. Same rule, different mechanism.
  for (const rel of ["src/lib/desk/seat-signal.server.ts", "src/lib/desk/research-status.server.ts"]) {
    const src = read(rel);
    assert.match(src, /from "\.\/research-quality/, `${rel} must import the registry`);
    assert.match(src, /isCountable\(/, `${rel} must apply the registry`);
  }
});

test("the 2026-09-10 exclusion is still registered", () => {
  const src = read("src/lib/desk/research-quality.ts");
  assert.match(src, /2026-09-10-ticker-reuse/);
  assert.match(src, /2026-09-10T07:15:00\.000Z/);
  assert.match(src, /2026-09-10T09:00:00\.000Z/);
  assert.match(src, /windows: 8/);
});

/**
 * The settlement identity invariant is still the thing that decides a grade.
 *
 * The matcher it replaced checked ticker while ignoring the clock, then the clock
 * while ignoring the ticker. Either half-check returning a settle is how one
 * market's result graded nine windows, so neither shape may come back.
 */
test("grading goes through the window-identity invariant", () => {
  const src = read("src/lib/desk/server-engine.ts");
  assert.match(src, /from "\.\/window-identity"/, "the engine must import the invariant");
  const fn = between(src, "function officialHit(", "function noteIdentityFault(");
  assert.match(fn, /matchSettle\(/, "officialHit must delegate to the invariant");
  assert.doesNotMatch(fn, /official_settles\.find/, "no hand-rolled settle matching may return");
  assert.doesNotMatch(fn, /90_000/, "the tolerance belongs to the invariant, not the engine");
  assert.match(fn, /noteIdentityFault\(/, "a contradiction must be recorded");
});

/**
 * A window decided but not yet settled has to survive a restart.
 *
 * Before this, `pending` lived only in process memory: a deploy between the
 * close and Kalshi's result lost the snapshot, and the window was never graded.
 */
test("pending windows are persisted and restored", () => {
  const src = read("src/lib/desk/server-engine.ts");
  assert.match(src, /pending: e\.pending\.slice\(-PENDING_CAP\)/, "persistState must write pending");
  assert.match(src, /sanitizePending<PendingWindow>\(raw\.pending/, "loadState must restore pending");
  assert.match(src, /identity_faults: e\.identityFaults/, "the fault log must outlive the process");

  // Merely including pending in the periodic state blob is not enough. PR #178
  // deployed across the 22:00 UTC rollover and exposed the gap: the window was
  // added in memory, but the process restarted before the throttled save ran.
  const settle = between(codeOf("src/lib/desk/server-engine.ts"), "async function settleIfNeeded(", "async function liveSnap(");
  const iAdd = settle.indexOf("e.pending = addKeyed(");
  const iPersist = settle.indexOf("await persistState(e, true)", iAdd);
  assert.ok(iAdd >= 0, "the unresolved window must still enter the pending set");
  assert.ok(iPersist > iAdd, "the pending decision must be durably awaited at the settlement boundary");
  assert.match(src, /await settleIfNeeded\(e, snap, votes, chair, prev\)/, "the tick must wait for that durability boundary");
});

/**
 * A window teaches once, ever — including across a restart.
 *
 * Persisting `pending` created a new hazard: applyGrade force-persists at its end,
 * so if the window were removed from pending AFTER grading, a crash in that gap
 * would restore an already-graded window and teach from it a second time. The
 * ledger dedupes its own row; the learner does not.
 */
test("grading is idempotent and pending is left before grading, not after", () => {
  const src = read("src/lib/desk/server-engine.ts");
  const grade = between(src, "function applyGrade(", "function liveSnap(");
  assert.match(grade, /e\.gradedKeys\.includes\(key\)/, "applyGrade must refuse a second grade");
  assert.match(src, /graded_keys: e\.gradedKeys/, "the graded set must be persisted");

  // Ordering, asserted by position — on comment-stripped source, because the
  // comment explaining this rule names applyGrade before the line it guards, and
  // a positional check against raw text would read the prose as the code.
  const block = between(
    codeOf("src/lib/desk/server-engine.ts"),
    "const hit = officialHit(e, snap, w.ticker, w.close_time);",
    "e.pending = addKeyed(",
  );
  const iRemove = block.indexOf("removeKeyed");
  const iGrade = block.indexOf("applyGrade");
  assert.ok(iRemove >= 0 && iGrade >= 0, "both calls must still be here");
  assert.ok(iRemove < iGrade, "pending must be cleared BEFORE applyGrade force-persists");
});

/**
 * The claim must be recorded before the learner is touched, and persisted after.
 *
 * persistState writes the learner, the graded set and pending as ONE jsonb upsert,
 * so whatever is in memory at persist time lands together or not at all. That only
 * protects the learner if the key is claimed BEFORE the first mutation: claimed
 * after, a persist could carry an advanced learner and no claim, and the next boot
 * would teach the same window again.
 */
test("applyGrade claims the window before it mutates the learner", () => {
  const fn = between(codeOf("src/lib/desk/server-engine.ts"), "function applyGrade(", "function liveSnap(");
  const iClaim = fn.indexOf("e.gradedKeys = [");
  const iMutate = fn.indexOf("gradeWindow(e.learner");
  const iPersist = fn.indexOf("persistState(e, true)");
  assert.ok(iClaim >= 0, "the claim must still be here");
  assert.ok(iMutate >= 0, "gradeWindow must still be the first learner mutation");
  assert.ok(iPersist >= 0, "applyGrade must still force-persist");
  assert.ok(iClaim < iMutate, "the key must be claimed BEFORE the learner is mutated");
  assert.ok(iMutate < iPersist, "the persist that makes both durable must come after");

  // And the refusal must guard the mutation, not merely be present somewhere.
  const iGuard = fn.indexOf("e.gradedKeys.includes(key)");
  assert.ok(iGuard >= 0 && iGuard < iClaim, "the already-graded check must precede the claim");
});

/**
 * The durable blob must carry all three together. A persist that wrote the learner
 * without the graded set or pending would reintroduce the double-teach window.
 */
test("the persisted blob carries learner, graded set and pending together", () => {
  const src = codeOf("src/lib/desk/server-engine.ts");
  const body = between(src, "const state = JSON.stringify({", "await db`");
  for (const field of ["learner:", "graded_keys:", "pending:"]) {
    assert.ok(body.includes(field), `persistState must write ${field} in the same blob`);
  }
  // One statement, so it is atomic. Sliced forward from the insert rather than
  // with between(): its end marker is searched from the start of the file, and a
  // backtick-semicolon occurs in many earlier template literals.
  const i = src.indexOf("insert into desk_state");
  assert.ok(i >= 0, "persistState must still upsert desk_state");
  assert.match(src.slice(i, i + 300), /on conflict \(id\) do update set state =/);
});

/**
 * PAPER ONLY. The desk must have no way to place a real order.
 *
 * The Lab adds automatic promotion, which changes which paper policy generates the
 * site's answer. That is the moment to make the boundary a test rather than an
 * intention: a promotion engine is only safe while there is nothing downstream of
 * it that could reach a venue.
 *
 * Checked on comment-stripped source so the prose explaining the ban does not trip
 * the ban.
 */
test("PAPER ONLY: no order-submission or execution path exists", () => {
  // The actual mechanisms, not words that also occur in English. An earlier version
  // of this rail banned "deposit" and flagged the site's own disclaimer — "no
  // account, no deposit and no live-trading arm" — which is the promise, not a
  // breach of it. Request signing is also legitimate here: the Kalshi websocket is
  // authenticated and read-only.
  //
  // Kalshi order entry is POST /trade-api/v2/portfolio/orders. That endpoint and the
  // order verbs cannot appear in innocent prose, so they are the right things to ban.
  const BANNED = [
    /\bcreateOrder\b/i,
    /\bplaceOrder\b/i,
    /\bsubmitOrder\b/i,
    /\bcancelOrder\b/i,
    /\bportfolio\s*\/\s*orders\b/i,
    /\/trade-api\/v2\/portfolio/i,
    /\bexecuteTrade\b/i,
    /\bsendOrder\b/i,
  ];
  const files = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const next = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(next);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.includes(".test.")) files.push(next);
    }
  };
  walk("src");
  walk("server");
  assert.ok(files.length > 50, `expected to scan the app, found ${files.length} files`);

  for (const rel of files) {
    const code = codeOf(rel);
    for (const re of BANNED) {
      assert.doesNotMatch(code, re, `${rel} contains a banned execution token (${re}). The desk is paper only.`);
    }
  }

  // The Kalshi client may read markets and the public tape. It must never be given
  // a writing verb against the portfolio surface.
  const ws = codeOf("src/lib/desk/kalshi-ws.server.ts");
  assert.doesNotMatch(ws, /method:\s*["'`]POST["'`]/i, "the Kalshi client must not POST");
});

/**
 * The Lab observes; it never decides.
 *
 * Its writer runs at settle, from durable state, inside a void-ed async so it
 * cannot throw into the tick or delay it. If a decision module ever imported it,
 * a research measurement would have become an input to the live answer.
 */
test("the Lab is off the decision path", () => {
  const LAB = ["policy-lab.server", "exit-arena", "promotion-gates"];
  // Modules that decide what the desk does.
  for (const rel of [
    "src/lib/desk/chair.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/scalp.ts",
    "src/lib/desk/learner.ts",
    "src/lib/desk/skills.ts",
  ]) {
    const code = codeOf(rel);
    for (const m of LAB) {
      assert.doesNotMatch(code, new RegExp(`from "\\./${m}`), `${rel} must not import ${m}`);
    }
  }

  // In the engine the call must sit inside a void-ed async with a catch, like the
  // other settle-time research writers.
  const eng = read("src/lib/desk/server-engine.ts");
  assert.match(eng, /recordExitArena\(/, "the engine must record the arena at settle");
  const block = between(eng, "// THE LAB's exit competition", "if (windowsHuddleDue(");
  assert.match(block, /void \(async \(\) => \{/, "must not be awaited on the tick");
  assert.match(block, /\.catch\(/, "must not throw into the tick");

  // THE ARENA READS THE REPLAY BEFORE PERSISTENCE CONSUMES IT (S2-4).
  //
  // recordReplay's `series.take` runs synchronously before its first await, so a
  // replayLive() call sitting AFTER recordReplay in applyGrade reads null — which is
  // how every graded Chair-filled window's exit measurement was lost. The read must be
  // captured before the destructive take, and the arena block must consume that
  // snapshot rather than re-reading the (by-then-gone) buffer.
  // Slice applyGrade by hand: between() scans its end marker from the file start, so a
  // generic "\nfunction " marker would match an earlier declaration.
  const gradeStart = eng.indexOf("function applyGrade");
  assert.ok(gradeStart >= 0, "applyGrade must exist");
  const gradeFn = eng.slice(gradeStart, eng.indexOf("\nfunction ", gradeStart + 1) + 1 || undefined);
  const captureAt = gradeFn.indexOf("replayLive(snap.ticker, snap.close_time)");
  const consumeAt = gradeFn.indexOf("recordReplay(snap.ticker, snap.close_time, finish)");
  assert.ok(captureAt >= 0, "the exit-arena replay must be captured with replayLive by both halves");
  assert.ok(consumeAt >= 0, "recordReplay must still consume the window");
  assert.ok(
    captureAt < consumeAt,
    "the replay must be captured BEFORE recordReplay's destructive take, or the arena reads null",
  );
  // The capture is synchronous — outside any void-ed async — so it runs before the
  // take, not on a later microtask. It must NOT live inside the exit-arena IIFE.
  assert.doesNotMatch(
    block,
    /replayLive\(/,
    "the arena block must use the pre-captured snapshot, not re-read the consumed buffer",
  );
  assert.match(block, /path: exitReplayPath/, "the arena measures the captured path");
  // The capture fails CLOSED and never fabricates: a miss yields null, no neighbour.
  assert.match(
    gradeFn,
    /const s = replayLive\(snap\.ticker, snap\.close_time\);\s*\n?\s*return s \? pointsFromReplay\(s\.cols\) : null;/,
    "the capture returns the exact window's points or null — no fallback replay",
  );
  // And only for a booked position, so a Chair sit-out still writes no arena row.
  assert.match(
    gradeFn,
    /booked && booked\.cents > 0\s*\n?\s*\? \(\(\) => \{/,
    "the capture is gated on a booked position",
  );
  // Exactly one destructive consumer of the buffer: recordReplay. The arena never takes.
  assert.doesNotMatch(gradeFn, /series\.take\(/, "applyGrade must not take the buffer directly");
  assert.equal(
    (gradeFn.match(/recordReplay\(/g) ?? []).length,
    1,
    "recordReplay is the single destructive consumer, called once",
  );
});

/**
 * Promotion thresholds are frozen constants, and the Lab cannot rewrite them.
 *
 * The seductive failure available to an automated desk is to notice a candidate
 * just missing a bar and move the bar.
 */
test("promotion thresholds are frozen and nothing mutates them", () => {
  const gates = codeOf("src/lib/desk/promotion-gates.ts");
  for (const name of [
    "COMPONENT_MIN",
    "FULL_FLOOR_MIN",
    "ECONOMIC",
    "RISK",
    "REGIME",
    "STABILITY",
    "COOLDOWN",
    "PROBATION",
    "ROLLBACK",
  ]) {
    assert.match(gates, new RegExp(`export const ${name} = Object\\.freeze\\(`), `${name} must be frozen`);
  }
  // No assignment into a threshold anywhere in the app.
  for (const rel of ["src/lib/desk/promotion-gates.ts", "src/lib/desk/policy-lab.server.ts"]) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /(COMPONENT_MIN|FULL_FLOOR_MIN|ECONOMIC|RISK|REGIME|STABILITY|COOLDOWN|PROBATION|ROLLBACK)\.\w+\s*=[^=]/);
  }
});

/**
 * Candidate creation is a code change, not a runtime event.
 *
 * The registry is a hand-written frozen list. A system that can append to it could
 * generate parameter variants until one looked profitable, which is the difference
 * between research and data mining.
 */
test("the candidate registry cannot be extended at runtime", () => {
  const reg = codeOf("src/lib/desk/floor-policy.ts");
  assert.match(reg, /export const COMPONENTS: readonly Component\[\] = Object\.freeze\(/);
  // No code anywhere may push into the registry or build candidates in a loop over
  // parameter ranges.
  for (const rel of ["src/lib/desk/floor-policy.ts", "src/lib/desk/policy-lab.server.ts", "src/lib/desk/promotion-gates.ts"]) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /COMPONENTS\.push|EXIT_CANDIDATES\.push/, `${rel} must not append candidates`);
  }
});

/**
 * The initial Champion is the unchanged desk, and the migration seeds exactly that.
 */
test("the Lab ships with the current desk as Champion and nothing promoted", () => {
  const sql = read("migrations/0025_desk_policy_lab.sql");
  assert.match(sql, /'FLOOR_V1', 1, 'CHAIR_V1', 'ENTRY_80_V1', 'HOLD_V1', 'RISK_NONE_V1', 'CHAMPION'/);
  assert.match(sql, /on conflict \(policy_id\) do nothing/, "a re-run must not reset promotion history");
  const policy = codeOf("src/lib/desk/floor-policy.ts");
  assert.match(policy, /exit_policy: EXIT_HOLD_V1\.id/, "the incumbent exit is HOLD");
  assert.match(policy, /status: "CHAMPION"/);
});

/**
 * Candidate definitions cannot read their own scorecards.
 *
 * The dependency direction must be one-way:
 *
 *   Floor / replay  ->  Lab observation        (an observation reads definitions)
 *   Lab observation  -X-> candidate parameters (a definition never reads results)
 *
 * If a definition module could reach the observations, a later change could make a
 * parameter depend on how that parameter has been scoring — which is self-tuning
 * wearing the costume of a frozen candidate, and it would be invisible in a diff
 * that only added an import.
 *
 * Enforced structurally: the definition modules are PURE. floor-policy.ts and
 * promotion-gates.ts import nothing at all, and exit-arena.ts imports only fee math
 * and the definitions themselves.
 */
test("candidate definitions are pure and cannot read observations", () => {
  const imports = (rel) =>
    (codeOf(rel).match(/^\s*import[\s\S]*?from\s*["']([^"']+)["']/gm) ?? []).map((m) =>
      /from\s*["']([^"']+)["']/.exec(m)[1],
    );

  // The two definition modules carry no dependencies whatsoever.
  for (const rel of ["src/lib/desk/floor-policy.ts", "src/lib/desk/promotion-gates.ts"]) {
    assert.deepEqual(
      imports(rel),
      [],
      `${rel} must stay a pure definition module: frozen configuration with no way to reach data`,
    );
  }

  // The simulator may use fee math and the definitions. Nothing else.
  assert.deepEqual(imports("src/lib/desk/exit-arena.ts").sort(), ["./clock.ts", "./floor-policy.ts"]);

  // And none of the three may reach the database or any server module by any route.
  for (const rel of [
    "src/lib/desk/floor-policy.ts",
    "src/lib/desk/promotion-gates.ts",
    "src/lib/desk/exit-arena.ts",
  ]) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /getSql|@\/lib\/db|\.server["']|labStanding|desk_policy_observations/, `${rel} must not reach observations`);
  }

  // The writer depends on the definitions, which is the permitted direction.
  const writer = codeOf("src/lib/desk/policy-lab.server.ts");
  assert.match(writer, /from "\.\/floor-policy"/, "the observation layer reads the definitions");
  assert.match(writer, /from "\.\/exit-arena"/);
});

/**
 * Observations are only ever written forward, from a window the desk just graded.
 *
 * A backfill would fill a candidate's prospective count with history it never
 * predicted, and every promotion afterwards would rest on it. The writer takes ONE
 * settled window and writes the candidates for it; there is no path that walks the
 * ledger or the replay table to populate the past.
 */
test("there is no path that backfills candidate observations", () => {
  const writer = codeOf("src/lib/desk/policy-lab.server.ts");
  // No reads of historical windows to write from.
  assert.doesNotMatch(writer, /from desk_ledger\b/, "the writer must not walk the ledger");
  assert.doesNotMatch(writer, /from desk_replay\b/, "nor the replay table");
  // Its only insert is the single-window one.
  const inserts = writer.match(/insert into desk_policy_observations/g) ?? [];
  assert.equal(inserts.length, 1, "exactly one write path");
  // And the engine calls it with the window it just graded, not a range.
  const eng = codeOf("src/lib/desk/server-engine.ts");
  const block = between(eng, "void (async () => {", "if (windowsHuddleDue(");
  assert.match(block, /closeMs: snap\.close_time/, "the window being graded, not a backfilled one");
});

/**
 * Promotion has no actuator, and the ladder explaining why is on the record.
 *
 * This rail is meant to be FAILED, once, deliberately, by whoever adds Stage 2 —
 * at which point they have to read the preconditions they are about to satisfy or
 * skip. Prose alone can be deleted without anyone noticing; a failing test cannot.
 */
test("the Floor cannot be promoted yet, and the order of authority is recorded", () => {
  const gates = read("src/lib/desk/promotion-gates.ts");
  // The ladder, in order. Each step is what makes the next one safe.
  for (const step of [
    "measurement trusted",
    "CI enforceable",
    "health externally watched",
    "governance introduced",
    "authority last",
  ]) {
    assert.ok(gates.includes(step), `the order of authority must name "${step}"`);
  }

  // No actuator: nothing in the app may write to the champion table. The only
  // INSERT lives in migration 0025, which seeds the unchanged desk as FLOOR_V1.
  const walk = (rel, out = []) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const next = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(next, out);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.includes(".test.")) out.push(next);
    }
    return out;
  };
  for (const rel of [...walk("src"), ...walk("server")]) {
    const code = codeOf(rel);
    if (!/desk_floor_policy/.test(code)) continue;
    assert.doesNotMatch(
      code,
      /(update|insert\s+into|delete\s+from)\s+desk_floor_policy/i,
      `${rel} writes to desk_floor_policy. Promotion is not implemented, and the actuator ` +
        `requires the preconditions recorded in promotion-gates.ts.`,
    );
  }

  // And the gate evaluator still only reports.
  const gatesCode = codeOf("src/lib/desk/promotion-gates.ts");
  assert.doesNotMatch(gatesCode, /getSql|@\/lib\/db|\.server["']/, "the evaluator must stay pure");
  assert.match(gatesCode, /all_required_passed/, "it reports a precondition, not a decision");
});

/**
 * The timestamped path is MEASUREMENT ONLY, and that is enforced, not promised.
 *
 * The four index-based consumers were deliberately left alone: every calibration
 * record, seat threshold and learned weight in production was fitted against the old
 * numbers, so redefining what "d60" means is a separate decision with its own
 * research-era boundary. This rail fails if someone wires the new reading into a
 * decision without making that decision explicitly.
 */
test("no decision path reads the timestamped path or its parity measurement", () => {
  const walk = (rel, out = []) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const next = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(next, out);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.includes(".test.")) out.push(next);
    }
    return out;
  };

  // Where the measurement is allowed to exist at all. Everything else must not name it.
  const allowed = new Set([
    "src/lib/desk/path-time.ts", // the pure helper
    "src/lib/desk/candle-time.ts", // reading the candle's own timestamp
    "src/lib/desk/path-parity.server.ts", // the shadow write
    "src/lib/desk/server-feeds.ts", // builds the timestamped twin off the feed
    "src/lib/desk/live.ts", // carries it onto the snapshot, beside the old array
    "src/lib/desk/demo.ts", // shapes a synthetic one; the recorder refuses demo
    "src/lib/desk/types.ts", // the field declarations
    "src/lib/desk/server-engine.ts", // the one fire-and-forget sample per minute
    "server/routes/path-parity.get.ts", // the admin-gated read
  ]);

  // The seats and rules that read the OLD path. None of them may read the new one.
  const consumers = [
    "src/lib/desk/dsl.ts",
    "src/lib/desk/bots.ts",
    "src/lib/desk/tape.ts",
    "src/lib/desk/features.ts",
  ];
  for (const rel of consumers) {
    const code = codeOf(rel);
    assert.match(code, /yes_mid_path/, `${rel} should still read the legacy path`);
    assert.doesNotMatch(
      code,
      /yes_mid_path_pts|moveOver|path-time|desk_path_parity/,
      `${rel} is a decision path. Migrating it redefines every calibration record ` +
        `fitted against the index-based d30/d60/d120 and needs its own research era.`,
    );
  }

  for (const rel of [...walk("src"), ...walk("server")]) {
    if (allowed.has(rel)) continue;
    const code = codeOf(rel);
    assert.doesNotMatch(
      code,
      /yes_mid_path_pts|desk_path_parity|path-parity\.server/,
      `${rel} reads the shadow measurement. It is measurement only: no seat, DSL rule, ` +
        `threshold, Chair input, learned weight or skill status may consult it.`,
    );
  }
});

/**
 * The legacy comparator stays faithful to production, NaN and all.
 *
 * Sanitising it would make the shadow rows describe a desk that does not exist, and
 * the NaN is the interesting part: `Math.abs(NaN) >= k` is false, so a non-finite
 * reading arrives downstream as a quiet tape rather than as an error.
 */
test("the legacy comparator is not sanitised, and the three outcomes stay apart", () => {
  const code = codeOf("src/lib/desk/path-time.ts");

  // The short-path zero production actually returns.
  assert.match(code, /if \(path\.length < back\) return 0;/, "production's zero is reproduced");

  // No finite guard may be added to the subtraction itself.
  const body = code.slice(code.indexOf("export function legacyMove"));
  const fn = body.slice(0, body.indexOf("\n}"));
  assert.doesNotMatch(
    fn,
    /\?\?\s*0|\|\|\s*0|isFinite\([ab]\)/,
    "legacyMove must not coerce a non-finite input to 0: production does not, and a " +
      "cleaned-up comparator would be measuring a desk that does not exist.",
  );

  // All three legacy outcomes, and all three true-reading outcomes, are named.
  for (const state of ["numeric", "short-path", "non-finite", "no-coverage", "empty"]) {
    assert.ok(code.includes(`"${state}"`), `the state "${state}" must be representable`);
  }
  // And a null divergence says which side was missing.
  for (const state of ["legacy-non-finite", "true-unavailable", "both-unavailable", "measured"]) {
    assert.ok(code.includes(`"${state}"`), `divergence state "${state}" must be representable`);
  }

  // The shadow table keeps them apart too, including the counter worth watching.
  const sql = read("migrations/0027_desk_path_parity.sql");
  // A reading is never stored without the two facts that qualify it: how far the
  // measured span sat from the requested horizon, and how stale its END was.
  for (const col of [
    "overshoot_ms",
    "legacy_overshoot_ms",
    "newest_age_ms",
    "newest_t",
    // Decision-relative geometry: span length alone cannot say WHERE the interval sits,
    // and without these a zero span overshoot would later be read as exact horizon
    // coverage when the whole interval may be shifted into the past.
    "anchor_t",
    "anchor_age_ms",
    "decision_overshoot_ms",
    "decision_fidelity",
  ]) {
    assert.match(
      sql,
      new RegExp(`${col}\\s`),
      `${col} must be stored: without it a row reads as a measurement of the present ` +
        `over the requested interval, when it may be neither.`,
    );
  }
  // And the helper must not quietly equate the requested horizon with the span.
  assert.match(
    code,
    /overshoot_ms: m\.ok \? m\.span_ms - h\.ms : null/,
    "overshoot must be span minus request, computed from the real span",
  );
  // The decision-relative ages must come from the decision clock, not be inferred from
  // the span — inferring them would reintroduce the very conflation they exist to stop.
  assert.match(code, /anchor_age_ms: m\.ok && haveClock \? nowMs! - m\.from_t : null/);
  // And no tuned freshness cutoff may be smuggled in: fidelity is structural.
  assert.doesNotMatch(
    code,
    /STALE_NEWEST_MS|FRESH_.*_MS\s*=/,
    "decision fidelity must stay structural; choosing a freshness cutoff is policy",
  );
  for (const v of ["decision-aligned", "end-shifted", "end-ahead", "unknown"]) {
    assert.ok(code.includes(`"${v}"`), `fidelity class "${v}" must be representable`);
  }
  assert.match(sql, /legacy_state\s+text not null/, "the legacy outcome is stored, not inferred");
  assert.match(sql, /true_state\s+text not null/);
  assert.match(sql, /divergence_state\s+text not null/);
  assert.match(sql, /desk_path_parity_legacy_state/, "the non-finite counter is indexed");
});

/**
 * A candle timestamp is never invented.
 *
 * An approximated timestamp would corrupt the one measurement this whole change
 * exists to take, and a start-of-period timestamp used as an end would shift every
 * close by a full interval — exactly the class of error being hunted.
 */
test("the candle timestamp is read or refused, never approximated", () => {
  const code = codeOf("src/lib/desk/candle-time.ts");
  // Start timestamps are adjusted forward and labelled, never silently merged.
  assert.match(code, /start-adjusted/, "a start-dated row is marked as adjusted");
  assert.match(code, /CANDLE_END_FIELDS/, "end fields are preferred");
  // Units are normalised rather than assumed.
  assert.match(code, /raw >= 1e12/, "a millisecond value is not multiplied again");
  assert.match(code, /raw >= 1e9/, "a second value is");

  // The feed drops an untimed row rather than dating it from the wall clock.
  const feeds = codeOf("src/lib/desk/server-feeds.ts");
  const i = feeds.indexOf("const yes_path_pts");
  const j = feeds.indexOf("const settles", i);
  assert.ok(i > 0 && j > i, "the candle block must be findable");
  const block = feeds.slice(i, j);
  assert.match(block, /if \(got\.ok\) yes_path_pts\.push/, "only a read timestamp is kept");
  assert.doesNotMatch(
    block,
    /t:\s*(Date\.now\(\)|nowMs)\s*[,}]/,
    "an untimed candle must be counted and dropped, not stamped with the wall clock",
  );

  // And the old bare array is still built from the same rows, unchanged.
  assert.match(block, /yes_path\.push\(px\)/, "the legacy array must keep its contents");
});

/**
 * The shadow write cannot steer anything, structurally.
 *
 * It returns void, so there is no result for a tick to branch on, and it refuses
 * demo snapshots, whose spacing is synthetic.
 */
test("the shadow write returns nothing and refuses synthetic paths", () => {
  const code = codeOf("src/lib/desk/path-parity.server.ts");
  assert.match(
    code,
    /export async function recordPathParity\(s: ParitySample\): Promise<void>/,
    "it must return void: a caller with no result cannot branch on the measurement",
  );
  assert.match(code, /DEMO/, "demo paths carry invented spacing and must be refused");
  assert.match(code, /on conflict \(sample_key\) do nothing/, "a replay must not revise a row");

  // The engine's hook is fire-and-forget and swallows its own failure.
  const eng = codeOf("src/lib/desk/server-engine.ts");
  assert.match(eng, /void recordPathParity\(/, "the tick must not await the measurement");
});

/**
 * The shadow insert's column list matches its value list, and every column exists.
 *
 * This write lives inside a deliberately SILENT catch, so a column/value mismatch or a
 * typo'd column name would throw, be swallowed, and lose every row with no error
 * anywhere — a measurement that fails invisibly is worse than one that is absent
 * loudly. A hand-written 37-column insert is exactly where that drifts, so it is
 * checked mechanically rather than by eye.
 */
test("the path-parity insert cannot drift from its table", () => {
  const src = read("src/lib/desk/path-parity.server.ts");
  const i = src.indexOf("insert into desk_path_parity (");
  const j = src.indexOf(") values (", i);
  const k = src.indexOf("on conflict", j);
  assert.ok(i > 0 && j > i && k > j, "the insert must be findable");

  const splitTop = (t) => {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of t) {
      if ("({[".includes(ch)) depth++;
      if (")}]".includes(ch)) depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter((x) => x && !x.startsWith("--"));
  };

  const cols = splitTop(src.slice(i + "insert into desk_path_parity (".length, j));
  const valsRaw = src.slice(j + ") values (".length, k);
  const vals = splitTop(valsRaw.slice(0, valsRaw.lastIndexOf(")")));
  assert.equal(
    cols.length,
    vals.length,
    `${cols.length} columns against ${vals.length} values — the write would throw into a silent catch`,
  );

  // Every column must actually exist on the table.
  const sql = read("migrations/0027_desk_path_parity.sql");
  const body = sql.slice(
    sql.indexOf("create table if not exists desk_path_parity ("),
    sql.indexOf("\n);"),
  );
  const declared = new Set([...body.matchAll(/^ {2}(\w+)\s/gm)].map((m) => m[1]));
  for (const c of cols) {
    assert.ok(declared.has(c), `column "${c}" is written but not declared in 0027`);
  }

  // Non-finite numbers must not reach an integer column: Postgres rejects NaN, and the
  // rejection would vanish into the same silent catch.
  assert.match(
    src,
    /function int\(v: number\): number \| null/,
    "a finite-or-null coercion must exist for numbers that could be NaN",
  );
  assert.doesNotMatch(
    src,
    /\$\{Math\.round\(s\./,
    "Math.round on a possibly-NaN input writes NaN to an integer column; use int()",
  );
});

/**
 * Gate confidence is never printed as a percentage.
 *
 * `chair_conf` is the Chair's GATE confidence: chair.ts sets it from the weighted vote
 * and, when gates fail, CLAMPS it to 70-92 by a count of failed gates. A calibrated
 * probability is never clamped by a gate count. A rendered capture of the live Floor
 * showed the GAVEL table printing "76%", "79%", "82%" under CONF, which reads as a
 * chance of winning for a number that means nothing of the kind.
 *
 * The ARENA's percentages are deliberately NOT covered: those are the visitor's OWN
 * stated probability, which the desk scores for calibration against their hit rate, so
 * a percent sign there is correct.
 */
test("the chair's gate confidence is never rendered as a percentage", () => {
  for (const rel of ["src/components/desk/SatoshiTab.tsx", "src/components/desk/BooksTab.tsx"]) {
    const code = codeOf(rel);
    // `{x.conf}%`, `{conf}%`, `${conf}%` — any chair-side conf immediately followed by a
    // percent sign. Chamber's `width: ${conf}%` is a CSS length, not a printed number,
    // and lives in its own file.
    assert.doesNotMatch(
      code,
      /\{\s*(?:[A-Za-z_$][\w$]*\.)?conf\s*\}\s*%/,
      `${rel} prints the chair's gate confidence with a percent sign. chair.ts clamps ` +
        `that number to 70-92 on a gate-failure count, so "76%" reads as a 76% chance ` +
        `of winning for a quantity that is not a probability.`,
    );
    assert.doesNotMatch(
      code,
      /\$\{\s*(?:[A-Za-z_$][\w$]*\.)?conf\s*\}%/,
      `${rel} interpolates the chair's gate confidence with a percent sign.`,
    );
  }

  // And the helper that names these quantities must keep them apart.
  const fc = codeOf("src/lib/desk/floor-clarity.ts");
  assert.match(fc, /"gate-confidence"/);
  assert.match(fc, /"calibrated-probability"/);
  assert.doesNotMatch(
    fc,
    /value: v == null \? "—" : `\$\{v\}%`/,
    "chairConfidenceLabel must not append a percent sign",
  );
});

/**
 * The Floor's user-facing order, and price provenance kept inside the call.
 *
 * Stage 1 requires CALL -> WHY -> BITCOIN VS STRIKE -> EVIDENCE + COUNTER -> YOUR CALL
 * + LAST REPLAY -> COMPACT RECORD. The first draft rendered the price block as its own
 * <section> in the Floor's gap-4 list, which made it a distinct card with its own ARIA
 * landmark sitting between the call and the why — displacing WHY from being the first
 * explanatory section. Asserted here so a later edit cannot quietly reintroduce that.
 */
test("the Floor's order puts WHY first after the call, with prices inside the call", () => {
  const src = read("src/components/desk/SatoshiTab.tsx");
  const floor = src.slice(src.indexOf("flex-col gap-4 py-4"));

  // CallPrices must be INSIDE the chair stage, not a sibling of it.
  const stage = src.indexOf('id="chair-stage"');
  const prices = src.indexOf("<CallPrices");
  assert.ok(stage > 0 && prices > stage, "CallPrices must render inside the chair stage");
  // And it must not be its own landmark section.
  // codeOf, not read: the explanatory comment inside CallPrices names "<section>" as the
  // thing it stopped being, and a raw read would match that prose instead of the markup.
  const comp = codeOf("src/components/desk/FloorClarity.tsx");
  const block = comp.slice(comp.indexOf("export function CallPrices"), comp.indexOf("export function WhyBlock"));
  assert.doesNotMatch(
    block,
    /<section/,
    "CallPrices must be a nested div like EconomicsBox, not a section between CALL and WHY",
  );

  // The top-level order, by first appearance in the Floor's flex list.
  const order = ["WhyBlock", "ChairEyes", "EvidenceBlock", "ArenaPanel", "LastReplayCard", "CompactRecord"];
  let at = -1;
  for (const name of order) {
    const i = floor.indexOf(`<${name}`);
    assert.ok(i > 0, `${name} must be on the Floor`);
    assert.ok(i > at, `${name} is out of order: expected ${order.join(" -> ")}`);
    at = i;
  }
  // The supporting research must follow the record, not precede it.
  for (const after of ["Chamber", "ChairScoreboard", "GavelList", "SeatsList"]) {
    assert.ok(
      floor.indexOf(`<${after}`) > floor.indexOf("<CompactRecord"),
      `${after} is supporting material and must come after the record`,
    );
  }

  // One instance each: a reorder must never become a duplicate.
  for (const name of [...order, "ChairBoard", "CallPrices", "Chamber", "ChairScoreboard"]) {
    const n = src.split(`<${name}`).length - 1;
    assert.equal(n, 1, `${name} is instantiated ${n} times; the Floor must hold exactly one`);
  }
});

/**
 * A locked paper entry is not a decision snapshot.
 *
 * server-engine.ts noteCall returns early when `!bookable(cents)` — "the read stands on
 * screen, the fill waits ... a later tick at the floor can still fill this window" — so
 * the recorded instant is the FILL's, which can be minutes after the read. Nothing on
 * the frame records decision-time market state, so that label must stay unavailable
 * rather than borrow the entry's frozen numbers.
 */
test("the resting book size is never printed raw", () => {
  // `touch` is a contract count from Kalshi's fractional-precision book, so the raw
  // value is 146.24058733173328. `String(eco.touch)` printed all of it. The unit test
  // covers the formatter; this covers the CALL SITE, which no unit test reaches.
  const tab = codeOf("src/components/desk/SatoshiTab.tsx");
  assert.doesNotMatch(
    tab,
    /String\(eco\.touch\)/,
    "a fractional size rendered through String() prints eighteen digits",
  );
  assert.match(tab, /fmtContracts\(eco\.touch\)/, "the touch cell must go through the formatter");
});

test("every surface that prepends a word to invalidate_if uses the one shared rule", () => {
  // Two surfaces do: the Floor's evidence sentence and the Diagnostics field whose LABEL
  // is already the words "invalidate if". Both shipped the value raw and read it doubled
  // ("The read is off if if ...", "invalidate if -> if quote age > 25s"). A second
  // call-site fix would drift from the first, so the rule is exported and reused.
  const tab = codeOf("src/components/desk/SatoshiTab.tsx");
  assert.match(
    tab,
    /<Field k="invalidate if" v=\{invalidateCondition\(chair\.invalidate_if\)\} \/>/,
    'the Diagnostics field must strip the joining word: its label already says "invalidate if"',
  );
  assert.doesNotMatch(
    tab,
    /<Field k="invalidate if" v=\{chair\.invalidate_if\}/,
    "the raw value under that label renders a doubled \"if\"",
  );
  // And the sentence must go through the same helper rather than inlining the regex.
  const fc = codeOf("src/lib/desk/floor-clarity.ts");
  assert.match(fc, /export function invalidateCondition/, "one exported rule");
  assert.match(
    fc,
    /const cond = invalidateCondition\(w\.invalidate_if\);/,
    "invalidateLine must reuse it, not carry its own copy",
  );
  // The stored value is never rewritten anywhere.
  assert.doesNotMatch(fc, /invalidate_if\s*=/, "invalidate_if must never be assigned");
});

test("the decision snapshot never borrows the paper entry's price or instant", () => {
  const fc = codeOf("src/lib/desk/floor-clarity.ts");
  const block = fc.slice(fc.indexOf('kind: "decision"'), fc.indexOf('kind: "market"'));
  assert.match(block, /cents: null/, "a decision price is not recorded anywhere on the frame");
  assert.match(block, /at: null/, "and neither is a decision instant");
  assert.doesNotMatch(block, /book\.cents/, "it must not read the fill's price");
  assert.doesNotMatch(block, /openFill/, "it must not read the fill's timestamp");
  assert.doesNotMatch(block, /marketCents/, "and it must not read the live ask");
});

// ---------------------------------------------------------------------------
// S2-5 — the Chair's decision-time market snapshot (measurement only).
//
// These rails protect what a unit test cannot reach through the server import
// graph: that the decision snapshot is identified by the WINDOW, is insert-once,
// is captured from the decision tick and never a fill/grade/quote, and that no
// decision consumer ever reads it back. The event RULE and the field capture are
// behaviourally tested in src/lib/desk/decision-snapshot.test.ts; the DB identity
// in scripts/migrations-apply.test.mjs.
// ---------------------------------------------------------------------------

test("S2-5: the decision snapshot is written once per (ticker, close_time, snapshot_kind)", () => {
  const src = codeOf("src/lib/desk/decision-snapshot.server.ts");
  assert.match(
    src,
    /on conflict \(ticker, close_time, snapshot_kind\) do nothing/,
    "the insert must be idempotent on the full window+kind key",
  );
  // A conflict must never REWRITE an earlier read.
  assert.ok(!/do update/i.test(src), "on conflict must not update: a later tick cannot rewrite the first read");
  // The restart read-back resolves the EXACT window, never the ticker alone.
  const lookup = src.slice(src.indexOf("async function lookupWindow"), src.indexOf("async function insertSnapshot"));
  assert.ok(lookup.length > 0, "lookupWindow must exist");
  assert.match(lookup, /ticker = \$\{ticker\}\s+and\s+close_time = \$\{closeIso\}/, "lookup matches both halves of the window");
  // Restart recovery depends on reading the PERSISTED opening lean back, so a
  // FIRST_DIRECTIONAL after an opening WAIT can still fire (and after a directional
  // opening stays suppressed). If this stops carrying the real lean, M10 breaks.
  assert.match(lookup, /out\.openingLean = r\.chair_lean/, "lookupWindow recovers the persisted opening lean");
});

test("S2-5: the writer never re-reads the market, a fill, a grade, or a replay to fill a row", () => {
  for (const rel of ["decision-snapshot.server.ts", "decision-snapshot-writer.ts"]) {
    const src = codeOf(`src/lib/desk/${rel}`);
    for (const banned of ["loadBundle", "bundleToSnapshot", "liveSnap", "fetch(", "server-feeds", '"./live"', "'./live'"]) {
      assert.ok(!src.includes(banned), `${rel} must not re-read the market (${banned})`);
    }
    for (const banned of ["replay.server", "desk_ledger", "entry_", "desk_replay", "desk_samples", "callLog", "official_"]) {
      assert.ok(!src.includes(banned), `${rel} must not read later state (${banned})`);
    }
  }
});

test("S2-5: write failures are observable, never swallowed", () => {
  // Fix 1: the orchestration must not catch/swallow — a store rejection has to
  // propagate so the engine's outer .catch routes it to noteErr and the window is
  // not marked done (retry stays possible).
  const writer = codeOf("src/lib/desk/decision-snapshot-writer.ts");
  assert.ok(!/\btry\b/.test(writer), "the writer must not wrap persistence in try/catch");
  assert.ok(!/\.catch\(|\bcatch\s*\(/.test(writer), "the writer must not swallow a store rejection");
  // record() returns the promise (so a rejection is observable), serialized per window.
  assert.match(writer, /return mine;/, "record returns the chained promise so failures are observable");
  // The server adapter returns the writer's promise rather than voiding it internally.
  const server = codeOf("src/lib/desk/decision-snapshot.server.ts");
  assert.match(server, /return writer\.record\(row\);/, "recordDecisionSnapshot returns the writer promise");
  assert.ok(!/\bcatch\b/.test(server), "the server adapter must not swallow DB errors");
});

test("S2-5: OPENING is the first CAPTURED read — serialized, frozen, retried", () => {
  // Fix 3: per-window serialization so DB latency cannot reorder which read is OPENING.
  const writer = codeOf("src/lib/desk/decision-snapshot-writer.ts");
  assert.match(writer, /const chains = new Map/, "a per-window serialization chain exists");
  assert.match(writer, /const prev = chains\.get\(key\) \?\? Promise\.resolve\(\);/, "each write chains off the previous one for the window");
  assert.match(writer, /prev\.then\(\s*\(\) => persistOne\(row\),\s*\(\) => persistOne\(row\),?\s*\)/, "the next write runs only after the previous settles");
  // The first-captured OPENING row is frozen and retried verbatim until durable.
  assert.match(writer, /if \(plan\.insertOpening && !st\.openingRow\) st\.openingRow = row;/, "the first opening row is frozen once");
  assert.match(writer, /if \(st\.openingRow && !st\.openingDone\)/, "the frozen opening row is retried until durable");
  // FIRST_DIRECTIONAL gets the same freeze + retry after a durable WAIT opening.
  assert.match(writer, /if \(fd\.insertFirstDirectional && !st\.firstDirectionalRow\) st\.firstDirectionalRow = row;/, "the first directional row is frozen once");
  assert.match(writer, /if \(st\.firstDirectionalRow\) \{/, "the frozen directional row is retried until durable");
});

test("S2-5: no historical backfill — the migration creates structure only", () => {
  const sql = read("migrations/0029_desk_decision_snapshots.sql");
  const code = sql.replace(/--.*$/gm, " "); // strip SQL line comments: prose explains the ban
  assert.ok(!/insert\s+into/i.test(code), "the migration must not INSERT any row");
  assert.ok(!/\bselect\b/i.test(code) || !/\bfrom\b/i.test(code), "no INSERT-SELECT or read from another table");
  assert.match(code, /create table if not exists desk_decision_snapshots/i, "it creates the table");
  assert.match(code, /primary key \(ticker, close_time, snapshot_kind\)/i, "window+kind identity");
  assert.match(code, /check \(snapshot_kind in \('OPENING', 'FIRST_DIRECTIONAL'\)\)/i, "only the two bounded kinds");
});

test("S2-5: OPENING is the first read; FIRST_DIRECTIONAL only after an opening WAIT, never duplicated", () => {
  const src = codeOf("src/lib/desk/decision-snapshot.ts");
  assert.match(src, /if \(!f\.openingExists\) \{\s*return \{ insertOpening: true, insertFirstDirectional: false \}/, "OPENING = first read");
  assert.match(
    src,
    /!f\.firstDirectionalExists &&\s*f\.openingLean === "WAIT" &&\s*isDirectional\(f\.currentLean\)/,
    "FIRST_DIRECTIONAL is guarded by !exists && openingLean===WAIT && directional",
  );
  assert.ok(!/insertOpening: true, insertFirstDirectional: true/.test(src), "a single tick never writes both kinds");
});

test("S2-5: unknown freshness sentinels are stored as NULL, never as fact", () => {
  // Fix 2: from live.ts, quote_ts `?? 0` (and quote_age_s = quote_ts>0?real:999),
  // quote_seq `?? 0` (feed treats >0 as a real sequence), print_age_s = trade_ts?real:999.
  const src = codeOf("src/lib/desk/decision-snapshot.ts");
  assert.match(src, /const hasQuoteClock = Number\.isFinite\(qts\) && qts > 0;/, "quote clock presence is gated on quote_ts > 0");
  assert.match(src, /quote_last_change_ms: hasQuoteClock \? Math\.round\(qts\) : null,/, "no quote clock → NULL, never epoch 1970");
  assert.match(src, /quote_age_s: hasQuoteClock \? fin\(snap\.quote_age_s\) : null,/, "no quote clock → NULL age, never 999");
  assert.match(src, /quote_seq: Number\.isFinite\(qseq\) && qseq > 0 \? Math\.round\(qseq\) : null,/, "seq 0 (no sequence) → NULL, never a fake 0");
  assert.match(src, /print_age_s: Number\.isFinite\(pa\) && pa < 999 \? pa : null,/, "print age ≥ 999 (unknown) → NULL, never a fake 999");
});

test("S2-5: the decision snapshot is captured at the decision tick, before the fill path, non-blocking", () => {
  const src = read("src/lib/desk/server-engine.ts");
  const code = codeOf("src/lib/desk/server-engine.ts");
  // Captured from the finalized (snap, chair) pair, AFTER decideChair and BEFORE
  // the paper-fill path (noteCall), so the read is recorded independent of the fill.
  const iChair = code.indexOf("decideChair(e, votes, snap, lastSide(e, snap))");
  const iCap = code.indexOf("noteDecisionSnapshot(e, snap, chair)", iChair);
  const iCall = code.indexOf("noteCall(e, snap, chair, votes)", iChair);
  assert.ok(iChair >= 0, "the tick's decideChair call is present");
  assert.ok(iCap > iChair, "capture happens after the finalized Chair result");
  assert.ok(iCall > iCap, "capture happens BEFORE noteCall (the paper-fill path)");
  // Fire-and-forget: voided with a .catch that routes a failure to noteErr; never awaited.
  assert.match(code, /void recordDecisionSnapshot\(row\)\.catch\(/, "the write is non-blocking with a catch");
  assert.match(code, /noteErr\(e, "decision-snapshot"/, "a failure is routed to the durable error ring");
  assert.ok(!/await recordDecisionSnapshot/.test(code), "the decision write is never awaited on the tick");
  assert.match(code, /decisionSnapshotFrom\(snap, chair\)/, "built from this tick's snap and chair");
  // Exactly one call site: the fill and grade paths must not write a decision snapshot.
  assert.equal((code.match(/recordDecisionSnapshot\(/g) || []).length, 1, "one writer call site only");
  assert.equal((code.match(/decisionSnapshotFrom\(/g) || []).length, 1, "one capture call site only");
  const applyGrade = src.slice(src.indexOf("function applyGrade"), src.indexOf("function applyGrade") + 3000);
  assert.ok(!applyGrade.includes("DecisionSnapshot"), "applyGrade (the grade path) never writes a decision snapshot");
});

test("S2-5: no decision consumer reads the decision snapshot back", () => {
  for (const rel of ["bots.ts", "chair.ts", "chair-v2.ts", "features.ts", "dsl.ts", "learner.ts", "book-floor.ts"]) {
    const code = codeOf(`src/lib/desk/${rel}`);
    assert.ok(!code.includes("decision-snapshot"), `${rel} must not import the S2-5 decision snapshot`);
  }
});

test("S2-5: no provider-origin timestamp is invented; the quote clock is named a last-change clock", () => {
  const sql = read("migrations/0029_desk_decision_snapshots.sql");
  const sqlCode = sql.replace(/--.*$/gm, " ");
  const pure = read("src/lib/desk/decision-snapshot.ts");
  const writer = codeOf("src/lib/desk/decision-snapshot.server.ts");
  assert.match(sqlCode, /quote_last_change_at timestamptz/, "the quote clock column is named for what it is");
  assert.ok(!/provider_ts/.test(sqlCode), "the migration stores no provider_ts column");
  assert.ok(!/provider_ts/.test(writer), "the writer reads no provider_ts");
  assert.match(pure, /quote_last_change_ms: hasQuoteClock \? Math\.round\(qts\) : null/, "quote_ts is stored as a last-change clock, NULL when absent");
});

test("S2-5: a contradictory (ticker, close) window is refused via the shared tickerAgrees invariant", () => {
  // S2-5 follow-up (rollover identity). The stale-ticker/new-close pair the feed emits
  // for a tick or two after a window boundary must never be measured — and the refusal
  // must reuse the repo's existing invariant, never a local parser.
  const writer = codeOf("src/lib/desk/decision-snapshot-writer.ts");
  assert.match(writer, /import \{ tickerAgrees \} from "\.\/window-identity\.ts";/, "the writer reuses the shared tickerAgrees");
  // No local ticker parsing may stand in for the invariant.
  assert.ok(!writer.includes(".exec("), "no local regex ticker parse in the writer");
  assert.ok(!writer.includes("tickerCloseMs"), "the writer does not re-implement ticker-time parsing");
  // The guard refuses ONLY a positive disagreement (=== false), and runs BEFORE the
  // per-window chain / freeze / insert, so a mismatched pair cannot flow into persistence.
  const recordBody = writer.slice(writer.indexOf("function record("));
  const iGuard = recordBody.indexOf("tickerAgrees(row.ticker, row.close_time_ms) === false");
  const iChain = recordBody.indexOf("chains.get(key)");
  assert.ok(iGuard >= 0, "the writer guards on tickerAgrees === false");
  assert.ok(iChain > iGuard, "the identity guard precedes the chain/freeze/insert");

  // The engine capture emits a deduplicated, named breadcrumb and skips — before the writer call.
  const eng = codeOf("src/lib/desk/server-engine.ts");
  const nds = eng.slice(eng.indexOf("function noteDecisionSnapshot"), eng.indexOf("async function tick("));
  assert.ok(nds.length > 0, "noteDecisionSnapshot exists");
  const iEngGuard = nds.indexOf("tickerAgrees(snap.ticker, snap.close_time) === false");
  const iRecord = nds.indexOf("recordDecisionSnapshot(row)");
  assert.ok(iEngGuard >= 0, "the engine guards on the same invariant");
  assert.ok(iRecord > iEngGuard, "the guard precedes recordDecisionSnapshot (the contradictory tick is skipped)");
  assert.match(nds, /"decision-snapshot-identity"/, "a named identity breadcrumb scope");
  assert.match(nds, /"ticker-close-time-mismatch"/, "names the mismatch");
  assert.match(eng, /lastDecisionIdentityKey/, "the breadcrumb is deduplicated, not spammed every tick");
});

test("Stage2 freshness: the live observation clock is truthfully named and read by no decision consumer", () => {
  // Defect A: ObsStamp.provider_ts was the last-CHANGE clock (quote_ts), not a
  // provider event time. Renamed to quote_last_change_at — truthful, and still read
  // by nothing that decides. (OfficialSettle.provider_ts is a genuine provider
  // settlement time and is out of scope; it may keep its name.)
  const types = codeOf("src/lib/desk/types.ts"); // comment-stripped: the doc prose may mention the old name
  const obsBlock = types.slice(types.indexOf("export type ObsStamp"), types.indexOf("export type OfficialSettle"));
  assert.ok(obsBlock.length > 0, "ObsStamp type must exist");
  assert.ok(!/provider_ts/.test(obsBlock), "ObsStamp must not carry the misnamed provider_ts");
  assert.match(obsBlock, /quote_last_change_at: number;/, "ObsStamp carries the truthfully-named last-change clock");
  // The live producer assigns the last-change clock under the truthful name, not provider_ts.
  const live = codeOf("src/lib/desk/live.ts");
  assert.match(live, /quote_last_change_at: quote_ts,/, "live.ts assigns quote_ts as the last-change clock, truthfully named");
  assert.ok(!/obs: \{[\s\S]*?provider_ts/.test(live), "live.ts obs must not reintroduce provider_ts");
  // Measurement-only: no decision consumer reads the renamed clock (or the old name).
  for (const rel of ["bots.ts", "chair.ts", "chair-v2.ts", "features.ts", "dsl.ts", "learner.ts", "book-floor.ts"]) {
    const code = codeOf(`src/lib/desk/${rel}`);
    assert.ok(!code.includes("quote_last_change_at"), `${rel} must not read quote_last_change_at (measurement stays out of decisions)`);
    assert.ok(!code.includes("provider_ts"), `${rel} must not read provider_ts`);
  }
});

test("S2-7: historical reconciliation takes external truth from Kalshi, never the ledger, and never writes", () => {
  const pure = codeOf("src/lib/desk/kalshi-reconcile.ts");
  const server = codeOf("src/lib/desk/kalshi-reconcile.server.ts");

  // (1) External truth comes from the Kalshi public fetch path. The host list lives
  // in the server; the exact per-market URL is built by the pure orchestrator (S2-7A
  // moved the request template into kalshi-reconcile.ts so it is unit-testable).
  assert.match(server, /kalshi\.com\/trade-api\/v2/, "the server runner fetches the Kalshi public market path");
  assert.match(pure, /\/markets\/\$\{encodeURIComponent\(ticker\)\}/, "it fetches the EXACT market by ticker");

  // (2) The authoritative (external) winner/value are read from the payload `m.`,
  // never from a desk_ledger field. The internal side is only ever `internal.`.
  assert.ok(!/external_winner[^=]*=\s*internal\./.test(pure), "external winner is never the ledger winner");
  assert.match(pure, /function officialWinner\(m: OfficialMarket\)/, "official winner is parsed from the market payload");
  assert.match(pure, /m\.expiration_value/, "the official underlying is the payload's expiration_value");
  // The ledger's winner/official_value are the audited side, not the truth side.
  assert.ok(!/settlement.*desk_ledger|desk_ledger.*as.*external/.test(pure), "no ledger field is treated as external truth");

  // (3) Exact identity: ticker AND close, reusing the repo invariant.
  assert.match(pure, /from "\.\/window-identity\.ts"/, "identity reuses window-identity");
  assert.match(pure, /tickerAgrees\(/, "the ticker's embedded close is checked");
  assert.match(pure, /Math\.abs\(extClose - internal\.close_time_ms\) <= CLOSE_TOLERANCE_MS/, "the payload close must agree within the repo tolerance");

  // (3b) The close witness is `close_time` ONLY. `expiration_time` is a different,
  // deprecated expiry clock and is NEVER substituted for it — the same rule
  // mayWriteOfficial enforces. Scoped to closeMsOf so the type/comment elsewhere
  // naming the field does not mask a reintroduced fallback.
  const closeFn = pure.match(/function closeMsOf[\s\S]*?\n}/)?.[0] ?? "";
  assert.ok(closeFn.length > 0, "closeMsOf is present");
  assert.ok(!/expiration/.test(closeFn), "the close witness reads close_time only — never expiration_time");

  // (3c) A payload with no usable external identity (no ticker, or no close witness
  // at all) is its own explicit state — never silently a MATCH.
  assert.match(pure, /EXTERNAL_IDENTITY_UNVERIFIABLE/, "missing external identity is UNVERIFIABLE, not a match");
  assert.match(pure, /externalTickerOk === true && \(externalCloseOk === true \|\| tickerCloseWitness\)/, "a MATCH requires an exact present ticker AND at least one close witness");

  // (3d) Official-value agreement uses the repo's established 0.05 tolerance
  // (lab.server.ts settlement receipts), not a looser invented epsilon.
  assert.match(pure, /VALUE_EPSILON = 0\.05\b/, "official-value tolerance matches the repo's 0.05");

  // (4) No nearest/latest/guessing market selection: the fetch is one EXACT ticker,
  // never a list query or a nearest/latest heuristic. (The report's earliest/latest
  // RANGE fields are not market selection.)
  assert.ok(!server.includes("/markets?"), "no list query — the fetch is the exact /markets/{ticker}");
  assert.ok(!server.includes("series_ticker"), "no series-list selection");
  assert.ok(!/\bnearest\b/.test(server), "no nearest-market fallback");
  assert.ok(!/status=settled|status=closed/.test(server), "no status-list scan to pick a market");

  // (5) + (8) Read-only: SELECT + GET only, no writes, no backfill, in either file.
  for (const [rel, src] of [["kalshi-reconcile.ts", pure], ["kalshi-reconcile.server.ts", server]]) {
    for (const w of ["insert into", "update ", "delete from", "alter table", " upsert", "on conflict"]) {
      assert.ok(!src.toLowerCase().includes(w), `${rel} must not ${w.trim()} (read-only audit)`);
    }
  }
  assert.match(server, /select ticker,/, "the server reads desk_ledger via SELECT only");

  // (6) No Chair/seat/learner/decision imports in either file.
  for (const [rel, src] of [["kalshi-reconcile.ts", pure], ["kalshi-reconcile.server.ts", server]]) {
    for (const dep of ["./chair", "./chair-v2", "./bots", "./learner", "./dsl", "./book-floor", "./seats"]) {
      assert.ok(!src.includes(`"${dep}`), `${rel} must not import ${dep}`);
    }
  }

  // (7) No real-order / trading-auth path. Precise checks so legitimate tokens
  // ("order by", "ctrl.signal") don't false-positive: the reconciler must not import
  // the auth module, POST, send an Authorization header, or touch an orders endpoint.
  for (const [rel, src] of [["kalshi-reconcile.ts", pure], ["kalshi-reconcile.server.ts", server]]) {
    assert.ok(!src.includes("kalshi-auth"), `${rel} must not import the trading-auth module`);
    assert.ok(!/method:\s*"POST"|getJsonPost/.test(src), `${rel} must not POST`);
    assert.ok(!/Authorization|KALSHI-ACCESS|signPss|\/orders?\b|\/portfolio\b/i.test(src), `${rel} must not touch an auth/order endpoint`);
  }
});

test("S2-7: no decision consumer imports the reconciliation surface", () => {
  for (const rel of ["bots.ts", "chair.ts", "chair-v2.ts", "features.ts", "dsl.ts", "learner.ts", "book-floor.ts", "server-engine.ts"]) {
    const code = codeOf(`src/lib/desk/${rel}`);
    assert.ok(!code.includes("kalshi-reconcile"), `${rel} must not import the S2-7 reconciliation`);
  }
});

test("S2-7: the reconciliation is reachable ONLY as a manual, read-only CLI — never auto-invoked by the desk", () => {
  // (1) The manual entrypoint exists: npm script → the CLI file, which calls the
  // runner and prints the rendered report.
  const pkg = JSON.parse(read("package.json"));
  const cliCmd = pkg.scripts?.["reconcile:kalshi"] ?? "";
  assert.ok(cliCmd.includes("scripts/reconcile-kalshi.ts"), "npm run reconcile:kalshi invokes the CLI script");

  const cli = codeOf("scripts/reconcile-kalshi.ts");
  assert.ok(cli.length > 0, "the CLI script exists");
  assert.match(cli, /runReconciliation/, "the CLI calls runReconciliation()");
  assert.match(cli, /renderReconReport/, "the CLI prints the rendered report");

  // (2) Read-only: SELECT + public GET only, no writes of any kind.
  for (const w of ["insert into", "update ", "delete from", "alter table", " upsert", "on conflict"]) {
    assert.ok(!cli.toLowerCase().includes(w), `the CLI must not ${w.trim()} (read-only audit)`);
  }

  // (3) No trading-auth / order path — the Kalshi read is the public market data.
  assert.ok(!cli.includes("kalshi-auth"), "the CLI must not import the trading-auth module");
  assert.ok(!/method:\s*"POST"|getJsonPost/.test(cli), "the CLI must not POST");
  assert.ok(!/Authorization|KALSHI-ACCESS|signPss|\/orders?\b|\/portfolio\b/i.test(cli), "the CLI must not touch an auth/order endpoint");

  // (4) Never auto-invoked: no production desk module imports the CLI or calls the
  // runner, and nothing wires it into tick / a loop / a cron.
  for (const rel of ["server-engine.ts", "bots.ts", "chair.ts", "chair-v2.ts", "features.ts", "dsl.ts", "learner.ts", "book-floor.ts"]) {
    const code = codeOf(`src/lib/desk/${rel}`);
    assert.ok(!code.includes("reconcile-kalshi"), `${rel} must not import the manual reconciliation CLI`);
    assert.ok(!/runReconciliation/.test(code), `${rel} must not invoke runReconciliation`);
  }
});

test("S2-7A: the manual auditor's transport is conservative — low concurrency, paced, bounded retries, Retry-After, no historical endpoint", () => {
  const pure = codeOf("src/lib/desk/kalshi-reconcile.ts");
  const server = codeOf("src/lib/desk/kalshi-reconcile.server.ts");

  // (1) Conservative default concurrency (1), used by both the batch and the runner.
  assert.match(pure, /RECONCILE_CONCURRENCY_DEFAULT = 1\b/, "default reconciliation concurrency is 1");
  assert.match(pure, /opts\.concurrency \?\? RECONCILE_CONCURRENCY_DEFAULT/, "reconcileWindows uses the conservative default");
  assert.match(server, /concurrency: opts\.concurrency \?\? RECONCILE_CONCURRENCY_DEFAULT/, "the runner defaults to the conservative concurrency (no hardcoded burst)");

  // (2) Bounded inter-market pacing exists and is injectable for tests.
  assert.match(pure, /INTER_MARKET_DELAY_MS_DEFAULT = \d+/, "an inter-market delay default exists");
  assert.match(pure, /delayMs\?: number; sleep\?: \(ms: number\) => Promise<void>/, "reconcileWindows accepts an injectable delay + sleep");
  assert.match(pure, /await sleep\(delayMs\)/, "the batch paces between fetches");

  // (3) Bounded retries with exponential backoff, and Retry-After honored.
  assert.match(pure, /function fetchMarketViaHosts\(/, "the conservative fetch orchestrator exists");
  assert.match(pure, /MAX_ATTEMPTS_PER_MARKET_DEFAULT = [1-4]\b/, "the per-market attempt budget is small and bounded");
  assert.match(pure, /base \* 2 \*\* i/, "exponential backoff between transient attempts");
  assert.match(pure, /Math\.min\(cap, base \* 2 \*\* i\)/, "backoff is capped");
  assert.match(pure, /r\.retryAfterMs != null/, "Retry-After is honored when present");
  assert.match(pure, /function parseRetryAfterMs\(/, "Retry-After parsing is a pure, tested helper");
  // A 404 is not retried with backoff: its branch continues without sleeping.
  assert.match(pure, /if \(r\.status === "not_found"\) \{\s*sawNotFound = true;\s*continue;/, "a 404 rotates hosts without backoff, never spins");

  // (4) The exact endpoint is unchanged and there is no historical endpoint anywhere.
  assert.match(pure, /\/markets\/\$\{encodeURIComponent\(ticker\)\}/, "the exact /markets/{ticker} endpoint");
  for (const [rel, src] of [["kalshi-reconcile.ts", pure], ["kalshi-reconcile.server.ts", server]]) {
    assert.ok(!/\/history\b|historical|\/settlements?\b/.test(src), `${rel} must not use a historical endpoint`);
  }
  // (5) The server transport delegates status→attempt to the pure classifier (which
  // reads the Retry-After header) and the conservative orchestrator.
  assert.match(server, /classifyHttpStatus\(res\.status, res\.ok, res\.headers\.get\("retry-after"\)/, "the server delegates status classification (incl. Retry-After) to the pure classifier");
  assert.match(server, /fetchMarketViaHosts\(KALSHI_HOSTS/, "the live client delegates to the conservative orchestrator");
  assert.match(server, /catch \{\s*return \{ status: "retryable", retryAfterMs: null \};/, "a thrown fetch (timeout/network) is retryable");

  // (6) Transient policy, pure and testable. 429 OR any 5xx is retryable and carries
  // the parsed Retry-After (honored for BOTH, not just 429); a non-429 4xx is fatal;
  // a fatal stops the orchestrator immediately (no spin).
  assert.match(pure, /function classifyHttpStatus\(/, "the status classifier is a pure, tested helper");
  assert.match(pure, /status === 429 \|\| status >= 500/, "429 and any 5xx are retryable");
  assert.match(pure, /return \{ status: "retryable", retryAfterMs: parseRetryAfterMs\(retryAfterHeader, nowMs\) \}/, "retryable carries the parsed Retry-After for 429 AND 5xx");
  assert.match(pure, /if \(!ok\) return \{ status: "fatal" \}/, "a non-429 4xx is fatal (non-retryable)");
  assert.match(pure, /if \(r\.status === "fatal"\) return \{ ok: false, reason: "unavailable" \}/, "a fatal response stops immediately — never spins or rotates");

  // (7) Mixed 404/transient final reason: not_found ONLY when every attempt was a 404;
  // any transient mixed in (no success) is unavailable.
  assert.match(pure, /reason: sawNotFound && !sawTransient \? "not_found" : "unavailable"/, "not_found requires every attempt to be a 404");

  // (8) Pacing is a single shared gate across the batch (global), not worker-local.
  assert.match(pure, /let gate: Promise<void> = Promise\.resolve\(\);/, "a single shared pacing gate for the whole batch");
  assert.match(pure, /const paceStart = \(\): Promise<void> =>/, "a shared paceStart gate regulates fetch starts");
  assert.match(pure, /gate = mine;/, "each start chains onto the shared gate (globally serialized starts)");
  assert.ok(!/let fetchedHere/.test(pure), "no worker-local pacing flag (would allow an initial burst at concurrency > 1)");
});

test("S2-8: Chair v2 trains and scores on the research-quality-valid population only, stays shadow-only, and invents no QTY cutoff", () => {
  const eng = codeOf("src/lib/desk/server-engine.ts");
  const v2 = codeOf("src/lib/desk/chair-v2.ts");

  // (1) Training population. refitV2 selects the newest quality-valid graded samples by
  // joining the ledger's research view on EXACT (ticker, close_time) identity, and the join
  // is applied BEFORE the 3000 cap — so a known-invalid window can never take a training slot.
  const refit = between(eng, "async function refitV2(", "async function refreshV2Stats(");
  assert.match(
    refit,
    /from desk_samples s\s*\n\s*join desk_ledger_research l on l\.ticker = s\.ticker and l\.close_time = s\.close_time/,
    "refitV2 joins the research view on exact identity",
  );
  assert.match(refit, /where s\.winner is not null order by s\.close_time desc limit 3000/, "graded, newest-first, capped at 3000 — after the quality join");
  assert.equal((refit.match(/from desk_samples/g) || []).length, 1, "refitV2 reads desk_samples exactly once, and that read is the joined one (no unfiltered training query)");

  // Provenance is stamped on the fit (metadata only), derived from the real data/roster.
  assert.match(refit, /fitted\.population = V2_POPULATION;/, "population provenance is recorded");
  assert.match(refit, /fitted\.trained_through = newestTrainedMs\(rows\.map\(\(r\) => r\.close_time\)\);/, "trained_through is the newest included sample");
  assert.match(refit, /fitted\.features_version = v2FeaturesVersion\(\);/, "features_version is recorded from the real roster");

  // (2) v2-side evaluation. brier_v2 / brier_market / ev_v2 / calls_v2 are computed in the
  // SAME query that joins the research view — the identical population the v1 side reads.
  const stats = between(eng, "async function refreshV2Stats(", "function v2Frame(");
  assert.match(stats, /brier_v2[\s\S]*?from desk_samples s\s*\n\s*join desk_ledger_research/, "the v2 metrics are computed over the research-view join");
  assert.match(stats, /coalesce\(sum\(s\.v2_ev\), 0\) as ev_v2/, "ev_v2 is over the joined valid population");
  assert.match(stats, /s\.v2_lean in \('UP','DOWN'\)/, "calls_v2 is over the joined valid population");
  assert.match(stats, /::int as calls_v2/, "calls_v2 is selected in the joined query");
  assert.match(stats, /coalesce\(sum\(l\.ev_cents\), 0\) as ev_v1/, "the v1 comparison shares that exact query/population");
  // The raw sample counts (not a v1/v2 comparison) stay raw — this ticket changed eligibility
  // for the four named metrics only.
  assert.match(stats, /count\(\*\)::int as n_samples/, "n_samples is still counted");
  assert.match(stats, /count\(winner\)::int as n_graded/, "n_graded is still counted");

  // (3) The daily digest's v2 scoreboard counts the same valid population (inner join, not left).
  const digest = between(eng, "async function digestV2Bits(", "const PULSE_MS");
  assert.match(digest, /join desk_ledger_research l on l\.ticker = s\.ticker and l\.close_time = s\.close_time/, "the digest joins the research view");
  assert.ok(!/left join desk_ledger_research/.test(digest), "the digest no longer LEFT-joins (which would count invalid windows in the v2 net/calls)");

  // (4) No QTY_FIX / research-era cutoff anywhere in the v2 train/score/digest path. The prior
  // audit established QTY_FIX_AT is not a v2 boundary; valid pre-fix rows stay eligible.
  for (const [name, slice] of [["refitV2", refit], ["refreshV2Stats", stats], ["digestV2Bits", digest]]) {
    assert.ok(!/QTY_FIX|research-era|eraAt|splitByEra/.test(slice), `${name} must not introduce a QTY_FIX / research-era cutoff`);
  }

  // (5) Provenance is metadata only: the optional fields exist on V2Weights (so pre-S2-8 blobs
  // still load) and the prediction path never reads them.
  assert.match(v2, /population\?: string;/, "V2Weights carries an optional population label");
  assert.match(v2, /trained_through\?: number \| null;/, "V2Weights carries optional trained_through");
  assert.match(v2, /features_version\?: string;/, "V2Weights carries optional features_version");
  const predict = between(v2, "export function predictV2(", "export function fitLogistic(");
  for (const f of ["population", "trained_through", "features_version"]) {
    assert.ok(!predict.includes(f), `predictV2 must not read provenance field ${f}`);
  }
  // features_version is derived from the roster, never a clock.
  const fv = between(v2, "export function v2FeaturesVersion(", "export function newestTrainedMs(");
  assert.match(fv, /V2_FEATURES/, "features_version is derived from V2_FEATURES");
  assert.ok(!/Date\.now|Date\.parse|new Date/.test(fv), "features_version must not embed a timestamp");

  // (6) SHADOW-ONLY. The live chair is v2-free, and the v2 decision functions are invoked only
  // by the shadow sampler noteV2 — never by the live decision. v2 gains no authority.
  const chair = codeOf("src/lib/desk/chair.ts");
  assert.ok(!/v2/i.test(chair), "Chair v1 (chair.ts) contains no v2 reference — v2 has no authority");
  const note = between(eng, "function noteV2(", "function noteTaker(");
  assert.ok(note.includes("predictV2(") && note.includes("decideV2("), "noteV2 is the shadow sampler");
  assert.equal((eng.match(/\bdecideV2\(/g) || []).length, 1, "decideV2 is called exactly once — only in the shadow sampler");
  assert.equal((eng.match(/\bpredictV2\(/g) || []).length, 1, "predictV2 is called exactly once — only in the shadow sampler");

  // (7) FREEZE. The live chair's authority path is untouched: Chair v1 still reads learner.seat_w,
  // and this ticket added no migration (desk_samples keeps its schema — no quality column on it).
  assert.match(chair, /learner\.seat_w/, "Chair v1 still reads learner.seat_w (authority path unchanged)");
  assert.ok(!/research_quality/.test(read("migrations/0006_desk_samples.sql")), "desk_samples schema is unchanged — no migration was added for this ticket");
});

test("S2-9: the online learner is gated on research-quality validity at the update boundary, prospective only", () => {
  const eng = codeOf("src/lib/desk/server-engine.ts");

  // (1) The canonical registry is the authority — isCountable from research-quality, no new registry.
  assert.match(read("src/lib/desk/server-engine.ts"), /import \{ isCountable \} from "\.\/research-quality"/, "server-engine imports the canonical isCountable");

  // (2) A single gate at the learner-update boundary in applyGrade, keyed on the window's own
  // close time (the identity desk_ledger_research / isCountable use).
  const grade = eng.slice(eng.indexOf("function applyGrade("), eng.indexOf("function applyGrade(") + 3500);
  assert.ok(grade.length > 0, "applyGrade is present");
  assert.match(grade, /if \(isCountable\(snap\.close_time\)\) \{/, "applyGrade gates the learner teaching on isCountable(snap.close_time)");

  // (3) All THREE learner-teaching calls occur exactly once and are INSIDE the gate (after it),
  // so an invalid window mutates no learner state: gradeWindow (seat_n/hits/recent/fade/skills/
  // graded_windows), settleAll (scalp calibration), reviewSeats.
  const iGate = grade.indexOf("if (isCountable(snap.close_time))");
  const iGrade = grade.indexOf("gradeWindow(");
  const iSettle = grade.indexOf("settleAll(");
  const iReview = grade.indexOf("reviewSeats(");
  const iLedger = grade.indexOf("enqueueLedger(");
  assert.equal((grade.match(/\bgradeWindow\(/g) || []).length, 1, "gradeWindow is called exactly once in applyGrade");
  assert.equal((grade.match(/\bsettleAll\(/g) || []).length, 1, "settleAll is called exactly once in applyGrade");
  assert.equal((grade.match(/\breviewSeats\(/g) || []).length, 1, "reviewSeats is called exactly once in applyGrade");
  assert.ok(iGate >= 0 && iGate < iGrade && iGrade < iSettle && iSettle < iReview, "the gate precedes all three learner-teaching calls");

  // (4) Prospective only: the ledger row is still enqueued AFTER the gated block, so a quarantined
  // window keeps its record (the row stays; it simply earns no learner credit).
  assert.ok(iLedger > iReview, "the ledger enqueue stays outside/after the gate — the quarantined row is still written");

  // (5) No QTY_FIX / research-era cutoff in the gate path; no learner reset/reconstruction added.
  assert.ok(!/QTY_FIX|research-era|eraAt|splitByEra/.test(grade), "no QTY_FIX / research-era cutoff in the grade path");
  assert.ok(!/rebuildSeatWeights\(|seat_n = \{\}|seat_hits = \{\}|seat_recent = \{\}/.test(grade), "applyGrade performs no learner reset/reconstruction");

  // (6) FREEZE. The gate is in the caller; learner.ts and chair.ts are untouched by this ticket —
  // neither gained a quality/era import, and the learner math constant is unchanged.
  assert.ok(!/research-quality|research-era|isCountable|QTY_FIX/.test(codeOf("src/lib/desk/learner.ts")), "learner.ts is unchanged — no quality/era cutoff leaked into the learner math");
  assert.ok(!/research-quality|isCountable/.test(codeOf("src/lib/desk/chair.ts")), "Chair v1 (chair.ts) is untouched by this ticket");
  assert.match(read("src/lib/desk/math.ts"), /export const WARM_N = 20;/, "learner calibration constant WARM_N is unchanged");
});


test("the client desk restores browser state only after hydration", () => {
  const eng = codeOf("src/lib/desk/engine.ts");
  const initial = between(eng, "let settings: Settings", "const listeners =");
  assert.match(initial, /let learner: Learner = freshLearner\(\);/, "the first learner frame is deterministic");
  assert.match(initial, /let callLog: CallLogRow\[\] = \[\];/, "the first call-log frame is deterministic");
  assert.doesNotMatch(initial, /loadPersisted\(|loadCallLog\(/, "module initialization must not read browser storage");

  const start = between(eng, "export function startEngine()", "export function stopEngine()");
  assert.match(start, /const persisted = loadPersisted\(\);/, "saved learner state is restored after mount");
  assert.match(start, /callLog = loadCallLog\(settings\.source\);/, "saved calls are restored after mount");
});


test("public Settings hides shared-desk controls until the owner key is verified", () => {
  const settings = read("src/components/desk/SettingsTab.tsx");
  const publicView = between(
    settings,
    '<div data-tour="tour-settings"',
    "{ownerMode ? (",
  );
  assert.match(publicView, /<AlertsPanel ownerMode=\{ownerMode\}/, "viewer alerts stay public");
  assert.match(publicView, /<DisplayPanel \/>/, "viewer display preferences stay public");
  assert.match(publicView, /<OwnerAccess /, "owner access is a collapsed gate");
  assert.doesNotMatch(
    publicView,
    /Poll interval|Data source|Adaptive confluence bar|Bar override|Mute seats|Seat weights|Adaptive thresholds|Skill library|Pattern ledger|ArenaAdminPanel|ReadinessPanel/,
    "operator controls must not render in the public settings view",
  );

  const ownerView = between(settings, "{ownerMode ? (", "</>\n      ) : null}");
  assert.match(ownerView, /ReadinessPanel/, "verified owners retain readiness");
  assert.match(ownerView, /ArenaAdminPanel/, "verified owners retain Arena controls");
  assert.match(ownerView, /Poll interval/, "verified owners retain shared-desk controls");
  assert.match(ownerView, /Seat weights/, "verified owners retain research diagnostics");

  const gate = between(settings, "async function ownerKeyIsValid", "export function SettingsTab");
  assert.match(gate, /fetch\(`\/readiness\?key=/, "the server verifies the owner key");
  assert.match(gate, /return r\.ok;/, "controls unlock only after a successful verification response");

  const alerts = read("src/components/desk/AlertsPanel.tsx");
  assert.match(
    alerts,
    /\{ownerMode \? \([\s\S]*Desk watchdog[\s\S]*\) : null\}/,
    "the owner watchdog stays inside verified owner mode",
  );
});
