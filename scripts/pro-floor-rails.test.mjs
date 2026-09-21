/**
 * The Pro Floor cockpit — safety rails.
 *
 * The redesign is a PRESENTATION change. These rails hold that in source: the
 * read model and its components cannot reach the telemetry experiment, the
 * database, the Chair's decision implementation, the learner's writers or the
 * booking path; the page offers no wager and no order; a gate confidence is
 * never dressed as a probability; a raw seat read never merges with a final
 * vote; and the existing Guided Floor and specialist desks are untouched.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const READ_MODEL = "src/lib/desk/pro-floor.ts";
const COMPONENTS = [
  "src/components/desk/ProFloor/ProOverview.tsx",
  "src/components/desk/ProFloor/ProDecisionStrip.tsx",
  "src/components/desk/ProFloor/ProChairCard.tsx",
  "src/components/desk/ProFloor/ProScoreBar.tsx",
  "src/components/desk/ProFloor/MarketModelCard.tsx",
  "src/components/desk/ProFloor/EvidenceFamilies.tsx",
  "src/components/desk/ProFloor/CouncilEvidenceTape.tsx",
  "src/components/desk/ProFloor/DecisionGates.tsx",
  "src/components/desk/ProFloor/DataHealthCard.tsx",
  "src/components/desk/ProFloor/PaperPositionCard.tsx",
  "src/components/desk/ProFloor/panels.tsx",
];
const ALL = [READ_MODEL, ...COMPONENTS];

test("the Pro Floor never reads the telemetry experiment or its tables", () => {
  for (const rel of ALL) {
    const src = codeOf(rel);
    for (const banned of [
      "telemetry", "desk_seat_reads", "desk_chair_evals", "noteSeatTelemetry", "seatTelemetryHealth",
      "SEAT_TELEMETRY_ENABLED",
    ]) {
      assert.doesNotMatch(src, new RegExp(esc(banned), "i"), `${rel} must not reference ${banned}`);
    }
  }
});

test("the Pro Floor has no database, no network and no server round trip of its own", () => {
  for (const rel of ALL) {
    const src = codeOf(rel);
    for (const banned of [
      "@/lib/db", "getSql", "createServerFn", "fetch(", "desk_ledger", ".server\"", ".server'",
      "insert into", "update desk", "delete from",
    ]) {
      assert.doesNotMatch(src, new RegExp(esc(banned)), `${rel} must not reference ${banned}`);
    }
  }
});

test("the read model imports no decision code and cannot write anywhere", () => {
  const src = codeOf(READ_MODEL);
  for (const banned of [
    "./chair\"", "./chair.ts", "./chair'", "./chair-v2", "./chair-v3", "./bots", "./crew", "./learner",
    "./server-engine", "./record", "./books.server", "./promotion-gates", "./skill-gate",
    "runChair", "runBots", "promoteToLive", "persistState", "patchSettings", "recordSystemEvent",
  ]) {
    assert.doesNotMatch(src, new RegExp(esc(banned)), `${READ_MODEL} must not reference ${banned}`);
  }
  // It has no clock, no randomness and no storage: the same frame must replay identically.
  for (const banned of ["Date.now", "new Date(", "Math.random", "setTimeout", "setInterval", "localStorage", "sessionStorage", "process.env"]) {
    assert.doesNotMatch(src, new RegExp(esc(banned)), `${READ_MODEL} must not reference ${banned}`);
  }
  // Its runtime imports are the existing presentation helpers and leaf modules only.
  const imports = [...read(READ_MODEL).matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...imports].sort(),
    ["./book-floor.ts", "./chair-signal.ts", "./economics.ts", "./floor-clarity.ts", "./math.ts", "./seats.ts"],
    "only existing pure helpers",
  );
});

test("the Pro Floor adds no execution path and offers the viewer no wager", () => {
  for (const rel of ALL) {
    const src = read(rel);
    for (const banned of [
      "BUY UP", "TAKE DOWN", "BET NOW", "YOUR TRADE", "YOU SHOULD", "OVERRIDE SATOSHI", "CHAIR MISSED",
      "place order", "placeOrder", "createOrder", "portfolio/orders", "KALSHI_API_KEY", "wallet",
    ]) {
      assert.doesNotMatch(src, new RegExp(esc(banned), "i"), `${rel} must not contain ${banned}`);
    }
    // No imperative pitch to the reader, in any casing.
    assert.doesNotMatch(src, /\bbet\b/i, `${rel} must not say bet`);
  }
});

test("there is no second Chair: the Pro Floor counts, it does not aggregate a rival opinion", () => {
  const src = codeOf(READ_MODEL);
  assert.match(src, /label: "Evidence balance"/, "the summary is named a balance, never a call");
  assert.match(src, /not a second opinion/, "and says so in the payload itself");
  for (const banned of ["desk_lean", "deskLean", "desk lean", "our call", "houseCall", "alt_chair", "altChair"]) {
    assert.doesNotMatch(src, new RegExp(esc(banned), "i"), `${READ_MODEL} must not invent ${banned}`);
  }
  // The balance carries no aggregate direction field to be mistaken for one.
  const balance = src.slice(src.indexOf("export type BalanceFacts"), src.indexOf("export function balanceFacts"));
  assert.doesNotMatch(balance, /\blean\b|\bcall\b|recommendation/, "BalanceFacts exposes no lean");
  // No new weighting is applied to seats anywhere in the module.
  assert.doesNotMatch(src, /\*\s*weight|weight\s*\*/, "no seat weighting is applied here");
});

test("gate confidence is labelled as a gate number and never rendered as a percentage", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /chairConfidenceLabel\(chair\)/, "the existing labeller is reused, not reimplemented");
  assert.doesNotMatch(model, /confidence[^\n]*%/, "no percent sign is attached to a confidence");
  const card = read("src/components/desk/ProFloor/ProChairCard.tsx");
  assert.match(card, /gate confidence \{conclusion\.confidence\.value\}/);
  assert.match(card, /\{conclusion\.confidence\.gloss\}/, "the gloss is printed beside it");
  const strip = read("src/components/desk/ProFloor/ProDecisionStrip.tsx");
  assert.match(strip, /gate confidence \{conclusion\.confidence\.value\}/);
  for (const rel of COMPONENTS) {
    assert.doesNotMatch(read(rel), /confidence[^\n]*\}%/, `${rel} must not suffix a confidence with %`);
  }
});

test("a derived model value is never presented as a quoted price or a chance of winning", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /kind: CentsKind/, "every cents figure carries its kind");
  assert.match(model, /not a calibrated chance of winning/);
  assert.match(model, /DERIVED by the desk's model/);
  const card = read("src/components/desk/ProFloor/MarketModelCard.tsx");
  assert.match(card, /<KindTag kind="derived" \/>/, "the fair value is tagged on screen");
  assert.match(card, /Market <span className="text-subtle">— executable/);
  assert.match(card, /Model <span className="text-subtle">— derived, not quoted/);
  // The mid fallback inside markSide is disclosed rather than shown as an ask.
  assert.match(model, /priced_ask_is_fallback/);
  assert.match(card, /no quoted ask on that side/);
});

test("a missing number is unavailable, never a zero", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /const priceLike = kind === "executable" \|\| kind === "derived";/);
  assert.match(model, /realCents\(c\)/, "price-like values go through the existing predicate");
  assert.match(model, /realAge\(snap\.spot_age_s\)/, "the 999 sentinel is an unknown age, not an age");
  const panels = read("src/components/desk/ProFloor/panels.tsx");
  assert.match(panels, /— <span className="text-micro">unavailable<\/span>/);
  assert.match(panels, /title=\{f\.unavailable_why \|\| f\.note\}/, "and the reason is available to the reader");
});

test("a raw seat read and a final vote stay separate facts, with the forced-sit transform marked", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /raw_lean: Lean \| null;/);
  assert.match(model, /raw_conf: number \| null;/);
  assert.match(model, /final_lean: Lean;/);
  assert.match(model, /final_conf_transformed: boolean;/);
  const tape = read("src/components/desk/ProFloor/CouncilEvidenceTape.tsx");
  assert.match(tape, /<span>raw read<\/span>/);
  assert.match(tape, /<span>final voice<\/span>/);
  assert.match(tape, /final_conf_transformed/, "the transform is marked in the tape");
  assert.match(tape, /RAW is what the specialist saw/);
  const families = read("src/components/desk/ProFloor/EvidenceFamilies.tsx");
  assert.match(families, /A number in brackets is a RAW read the Chair never heard/);
});

test("a suppression reason is never inferred when the frame cannot prove it", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /suppression = rawConf != null && rawConf < speakBar \? "below-speak-bar" : null;/);
  assert.match(model, /suppression: SuppressionReason \| null/);
  const tape = read("src/components/desk/ProFloor/CouncilEvidenceTape.tsx");
  assert.match(tape, /SUPPRESSION_LABEL\[s\.suppression\] : "suppressed"/, "an unprovable reason reads simply suppressed");
});

test("the WAIT explanation never promises that clearing one blocker produces a call", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /more_than_one_thing_missing/, "the existing clarity flag is carried");
  for (const [, sentence] of [...model.matchAll(/"(feed-condition|hard-gate|under-bar|no-edge)": "([^"]+)"/g)].map((m) => [m[1], m[2]])) {
    assert.doesNotMatch(sentence, /will call|would call|then SATOSHI|guarantee/i, `a WAIT sentence must not promise a call: ${sentence}`);
  }
  const bar = read("src/components/desk/ProFloor/ProScoreBar.tsx");
  assert.match(bar, /No single change guarantees a call\./);
  assert.match(bar, /necessary, not sufficient/);
  assert.doesNotMatch(bar, /If score gains|will call/i);
  const card = read("src/components/desk/ProFloor/ProChairCard.tsx");
  assert.match(card, /Clearing any single one of them would still not produce a call\./);
});

test("the score bar uses the Chair's own comparison and never substitutes a new calculation", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /const evidence = num\(chair\.vs_bar\);/, "the quantity is vs_bar");
  assert.match(model, /const required = num\(chair\.bar\);/);
  assert.match(model, /chair\.gates\?\.find\(\(g\) => g\.id === "bar"\)/, "the verdict is the Chair's own gate");
  assert.match(model, /const met = gate \? gate\.pass : null;/, "and is null when the frame has none");
  const bar = read("src/components/desk/ProFloor/ProScoreBar.tsx");
  assert.match(bar, /the same comparison its gate records/);
  // It may format a margin, but it must never decide whether the bar was met.
  assert.match(bar, /const cleared = s\.met === true;/);
  assert.doesNotMatch(bar, /aggressiveness\s*\*|\*\s*s\.aggressiveness/, "the component never rebuilds vs_bar");
  assert.doesNotMatch(bar, />=\s*s\.required|s\.evidence\s*>=/, "and never re-runs the comparison");
});

test("invalidation stays a condition that ends a read, never an entry trigger", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /invalidateCondition\(why\.invalidate_if\)/, "the existing helper is reused");
  assert.match(model, /invalidateLine\(why\)/);
  // The rule itself is stated in the source, where the next editor will read it.
  assert.match(read(READ_MODEL), /never reversed into an entry trigger/);
  const card = read("src/components/desk/ProFloor/ProChairCard.tsx");
  assert.match(card, /what breaks it/);
  assert.doesNotMatch(card, /enter when|buy when|trigger when/i);
});

test("fee, edge, fair value, the floor test and freshness have no second implementation here", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /economicsOf\(snap, chair\.lean\)/, "the economics box is reused whole");
  assert.match(model, /freshness\(snap\)/);
  assert.match(model, /bookState\(snap, chair\.lean, log\)/);
  assert.match(model, /whyFacts\(chair, input\.plain \?\? ""\)/);
  // No arithmetic that would recreate a fee, an edge or a breakeven.
  for (const banned of ["takerFee", "0.07 *", "Math.ceil(7"]) {
    assert.doesNotMatch(model, new RegExp(esc(banned)), `${READ_MODEL} must not recompute ${banned}`);
  }
  for (const rel of COMPONENTS) {
    const src = codeOf(rel);
    assert.doesNotMatch(src, /takerFee|economicsOf\(/, `${rel} must not compute economics itself`);
  }
});

test("the cockpit is wired into the existing Pro Floor, and the Guided Floor is untouched", () => {
  const tab = read("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /<ProOverview/);
  assert.match(tab, /votes=\{votes\}/);
  assert.match(tab, /density=\{density\}/);
  // The existing chair stage is preserved inside the cockpit, not replaced.
  assert.match(tab, /headline=\{\s*<CouncilFloorRoom lean=\{chair\.lean\} density=\{density\}>/);
  assert.match(tab, /<ChairBoard snap=\{snap\}/);
  const app = read("src/components/desk/DeskApp.tsx");
  assert.match(app, /votes=\{frame\.votes\}/, "the raw seat reads reach the Pro Floor");
  assert.match(app, /floorMode === "pro"/);
  assert.match(app, /floorMode === "guided" && \(\s*\n\s*<GuidedFloor/, "the guided branch is unchanged");
  // No third floor was created.
  assert.doesNotMatch(app, /ExpertFloor|TraderFloor|QuantFloor|AdvancedFloor/);
  assert.doesNotMatch(read("src/components/desk/prefs.ts"), /expert|trader|quant|advanced/i);
  assert.match(read("src/components/desk/prefs.ts"), /export type FloorMode = "pro" \| "guided"/);
  assert.match(read("src/components/desk/prefs.ts"), /export type FloorDensity = "quiet" \| "full"/);
});

test("both densities show the same numbers; Full desk only adds detail", () => {
  const overview = read("src/components/desk/ProFloor/ProOverview.tsx");
  // Everything the core view shows is unconditional; only the tape is gated.
  assert.match(overview, /<ProDecisionStrip facts=\{facts\} \/>/);
  assert.match(overview, /<ProChairCard facts=\{facts\}/);
  assert.match(overview, /<ProScoreBar facts=\{facts\} \/>/);
  assert.match(overview, /<EvidenceFamilies facts=\{facts\}/);
  assert.match(overview, /<DecisionGates facts=\{facts\}/);
  assert.match(overview, /<DataHealthCard facts=\{facts\} \/>/);
  assert.match(overview, /\{full \? <CouncilEvidenceTape/, "the full tape is the density-gated piece");
  assert.match(overview, /const full = density === "full";/);
  const tab = read("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /Both show the same numbers/);
});

test("the cockpit is memoized and does not recompute its facts on every render", () => {
  const overview = codeOf("src/components/desk/ProFloor/ProOverview.tsx");
  assert.match(overview, /useMemo\(\s*\(\) => proFloorFacts\(/);
  assert.match(overview, /\[snap, chair, votes, callLog, knobs, plain\]/, "keyed on the frame, not on a clock");
  assert.doesNotMatch(overview, /useEffect|setInterval|setState/, "no per-tick work of its own");
});

test("state is never carried by colour alone, and every row is reachable", () => {
  const families = read("src/components/desk/ProFloor/EvidenceFamilies.tsx");
  const tape = read("src/components/desk/ProFloor/CouncilEvidenceTape.tsx");
  const gates = read("src/components/desk/ProFloor/DecisionGates.tsx");
  const panels = read("src/components/desk/ProFloor/panels.tsx");
  // The lean word itself is printed next to any colour.
  assert.match(families, /s\.final_lean/);
  assert.match(tape, /\{s\.final_lean\}/);
  // The gate dot is decorative; the state word carries the meaning.
  assert.match(panels, /aria-hidden="true"/);
  assert.match(gates, /\{g\.pass \? "clear" : g\.hard \? "block" : "tax"\}/);
  // Interactive rows are buttons with labels and a 44px target.
  for (const src of [families, tape]) {
    assert.match(src, /type="button"/);
    assert.match(src, /aria-label=/);
    assert.match(src, /min-h-11/);
  }
  assert.match(gates, /aria-expanded=\{open\}/);
  assert.match(read("src/components/desk/ProFloor/ProScoreBar.tsx"), /role="img"[\s\S]*?aria-label=/, "the bar describes itself");
  assert.match(panels, /aria-labelledby=\{`pro-\$\{id\}`\}/, "every panel heading is associated");
});

test("clicking an evidence family jumps to its existing specialist desk", () => {
  const families = read("src/components/desk/ProFloor/EvidenceFamilies.tsx");
  assert.match(families, /onJump: \(seat: SeatId\) => void/);
  assert.match(families, /onJump\(s\.seat\)/);
  const tab = read("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /onJump=\{onJump\}/, "the existing jump handler is reused");
  const app = read("src/components/desk/DeskApp.tsx");
  assert.match(app, /const jump = \(seat: SeatId\) =>/, "and still resolves through TAB_SEATS");
  assert.match(app, /TAB_SEATS/);
});

test("the five evidence families are the repository's own, not a new taxonomy", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /TAB_SEATS/, "families come from the existing map");
  assert.match(model, /Object\.keys\(TAB_SEATS\) as SeatTab\[\]/);
  for (const label of ["STRUCTURE", "TAPE", "DERIVS", "BOOK", "CONTEXT"]) {
    assert.match(model, new RegExp(esc(label)), `${label} is kept`);
  }
  assert.match(model, /CHAIR_NON_VOTER_IDS/, "the pit crew is identified from the shared set");
  assert.match(model, /RETIRED_SEAT_IDS/);
  // And the specialist tabs themselves still exist.
  const app = read("src/components/desk/DeskApp.tsx");
  for (const id of ["structure", "tape", "derivs", "book", "context", "crew", "atelier", "settings", "books", "board"]) {
    assert.match(app, new RegExp(esc(`"${id}"`)), `the ${id} tab is retained`);
  }
});

test("only UI-only beacons were added, and none of them tracks trading intent", () => {
  const beacon = read("src/lib/desk/beacon.ts");
  assert.match(beacon, /"floor_density_toggle"/);
  assert.match(beacon, /"floor_gates_expand"/);
  assert.doesNotMatch(beacon, /trade|order|wager|bet|position_open/i);
  const tab = read("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /beacon\("floor_density_toggle"\)/);
});

// ---------------------------------------------------------------------------
// Review round 2: the five semantics the UI could previously misstate
// ---------------------------------------------------------------------------

test("no venue or perpetual value is ever labelled the settlement index", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /venue_index: number \| null;/);
  assert.match(model, /venue_basis_bps: number \| null;/);
  assert.doesNotMatch(model, /^\s*index: number \| null;/m, "no ambiguous `index` field survives");
  assert.doesNotMatch(model, /^\s*basis_bps:/m);
  assert.match(read(READ_MODEL), /PERPETUAL-vs-spot basis/, "the source is stated where the next editor reads it");
  for (const rel of COMPONENTS) {
    const src = read(rel);
    // Denying the claim is the point; only an AFFIRMATIVE one is forbidden.
    assert.doesNotMatch(src, /label="settlement index"/i, `${rel} must not label a value the settlement index`);
    assert.doesNotMatch(src, /settles on (this|the) index/i, `${rel} must not say the contract settles on it`);
    assert.doesNotMatch(src, /(?<!not )the settlement index(?!\.)/i, `${rel} must not assert a settlement index`);
  }
  const card = read("src/components/desk/ProFloor/MarketModelCard.tsx");
  assert.match(card, /label="venue index"/);
  assert.match(card, /perp vs spot/);
  assert.match(card, /A perpetual-futures index from OKX\/Binance/, "and says which feed it is");
});

test("executable economics are suppressed whenever the priced ask is a midpoint fallback", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /const executable = side != null && realCents\(quoted\) && !fallback;/);
  assert.match(model, /cents: executable \? eco\.edge : null,/, "no edge without a quoted ask");
  assert.match(model, /breakeven_pct: executable \? eco\.breakeven : null,/);
  assert.match(model, /bookable: executable \? eco\.bookable : null,/, "and no floor verdict about a midpoint");
  assert.match(model, /bookable: boolean \| null;/, "so the type admits `cannot be assessed`");
  // The number survives only as a clearly derived diagnostic.
  assert.match(model, /diagnostic_edge: CentsFact;/);
  assert.match(model, /label: "model vs mid"/);
  assert.match(read(READ_MODEL), /not an edge anyone could take/);
  // The contradictory wording is gone.
  const card = read("src/components/desk/ProFloor/MarketModelCard.tsx");
  assert.doesNotMatch(card, /fair less the real ask less the fee/, "the old claim is replaced");
  assert.match(card, /fair less the real quoted ask less the fee/);
  assert.match(card, /\{model\.executable \? null : \(/, "the diagnostic row only appears when nothing is executable");
  assert.match(card, /model\.bookable == null/, "the floor cell handles the unassessable case");
});

test("a STALE feed does not silence a seat: the final vote is classified first", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /const speaksNow = finalLean === "UP" \|\| finalLean === "DOWN";/);
  // The speaking branch must come BEFORE the health branch, or a STALE speaker
  // is removed from the counts while the Chair is still hearing it.
  const speaks = model.indexOf("} else if (speaksNow) {");
  const unhealthy = model.indexOf('health === "DOWN" || health === "STALE"');
  assert.ok(speaks > 0 && unhealthy > 0, "both branches exist");
  assert.ok(speaks < unhealthy, "the final vote decides before the feed state does");
  assert.match(model, /health_warning: health === "STALE",/);
  assert.match(model, /stale_speakers: seats\.filter\(\(s\) => s\.voice === "speaking" && s\.health_warning\)\.length,/);
  assert.match(read(READ_MODEL), /only scales its confidence/, "the reason is recorded in source");
  // And the warning is visible beside the vote rather than replacing it.
  assert.match(read("src/components/desk/ProFloor/CouncilEvidenceTape.tsx"), /STALE feed/);
  assert.match(read("src/components/desk/ProFloor/EvidenceFamilies.tsx"), /health_warning/);
});

test("a raw read falls back to the final vote only when the vote was not transformed", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /const rawLean = vote\?\.raw_lean \?\? \(forced \? null : finalLean\);/);
  assert.match(model, /const rawConf = num\(vote\?\.raw_conf\) \?\? \(forced \? null : finalConf\);/);
  // The repo-wide convention this matches, and the reason the fallback stops at
  // a forced sit, are both stated in source.
  assert.match(read(READ_MODEL), /raw_lean \?\? lean/);
  assert.match(read(READ_MODEL), /ONLY when the vote was not transformed/);
});

test("all clear covers every feed and check the card displays", () => {
  const model = codeOf(READ_MODEL);
  assert.match(model, /feed\("spot", h\?\.spot\);/);
  assert.match(model, /feed\("kalshi", h\?\.kalshi\);/);
  assert.match(model, /feed\("derivs", h\?\.derivs\);/, "derivatives count, because the card shows them");
  assert.match(model, /if \(fresh\.gap !== "ok"\) blockers\.push/);
  assert.match(model, /spot_divergent === true\) blockers\.push/);
  assert.match(model, /basis_wide === true\) blockers\.push/);
  assert.match(model, /all_clear: blockers\.length === 0,/, "the badge is the list, so they cannot disagree");
  assert.match(model, /blockers: string\[\];/);
  assert.doesNotMatch(model, /all_clear: h\?\.spot === "LIVE" && h\?\.kalshi === "LIVE"/, "the narrow check is gone");
  // The card names what is not clear rather than saying something vague.
  const card = read("src/components/desk/ProFloor/DataHealthCard.tsx");
  assert.match(card, /\$\{h\.blockers\.length\} not clear/);
  assert.match(card, /Not clear: \{h\.blockers\.join\(" · "\)\}/);
});
