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
