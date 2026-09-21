/**
 * Floor navigation — the two-view product, held in place.
 *
 * Satoshi's Council ships TWO ways to watch one live window: the Guided Floor
 * in plain language, and the Pro Floor with the whole research surface. These
 * rails exist because the failure mode is not a crash, it is a slow drift —
 * one view quietly becoming hard to reach, or the two being merged into a
 * single compromise that serves neither reader.
 *
 * So they pin the things a redesign would erode first: that both modes still
 * exist and still render from separate branches, that the control which moves
 * between them is always on the page rather than inside a menu, that it is
 * spelled out in both places rather than abbreviated, and that the canonical
 * deep link keeps working.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
/** Comments stripped, so a rail cannot be satisfied by prose about the rule. */
const codeOf = (rel) =>
  read(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const APP = "src/components/desk/DeskApp.tsx";
const PREFS = "src/components/desk/prefs.ts";
const HOME = "src/components/desk/CouncilHome.tsx";

// ---------------------------------------------------------------------------
// 1-2. Two modes, two branches
// ---------------------------------------------------------------------------

test("FloorMode is exactly guided and pro — no third floor, no merged floor", () => {
  const prefs = read(PREFS);
  assert.match(prefs, /export type FloorMode = "pro" \| "guided";/);
  // Nothing else may creep into the union.
  const union = /export type FloorMode = ([^;]+);/.exec(prefs)[1];
  const members = union.split("|").map((s) => s.trim().replace(/"/g, ""));
  assert.deepEqual(members.slice().sort(), ["guided", "pro"]);
  for (const banned of ["expert", "trader", "quant", "advanced", "simple", "basic", "hybrid"]) {
    assert.doesNotMatch(prefs, new RegExp(banned, "i"), `FloorMode must not gain a "${banned}" mode`);
  }
  assert.doesNotMatch(codeOf(APP), /ExpertFloor|TraderFloor|QuantFloor|AdvancedFloor|UnifiedFloor/);
});

test("Guided and Pro remain separate render branches, each mounted only in its own mode", () => {
  const app = codeOf(APP);
  // Requirement 3: GuidedFloor renders only under the guided branch.
  assert.match(app, /floorMode === "guided" && \(\s*\n\s*<GuidedFloor/, "GuidedFloor is mounted by the guided branch");
  // Requirement 4: the Pro Floor renders only under the pro branch.
  assert.match(app, /floorMode === "pro" && \(\s*\n\s*<SatoshiTab/, "SatoshiTab is mounted by the pro branch");
  // Neither component may be rendered outside a floorMode guard.
  for (const tag of ["<GuidedFloor", "<SatoshiTab"]) {
    const uses = app.split(tag).length - 1;
    assert.equal(uses, 1, `${tag} should be rendered exactly once, inside its own branch`);
  }
  // And they are not collapsed into one component taking a mode prop.
  assert.doesNotMatch(app, /<(Guided|Satoshi)\w*\s+mode=\{floorMode\}/, "the two views must not be merged behind a prop");
});

// ---------------------------------------------------------------------------
// 5-6. The switch is always on the page, never only in a menu
// ---------------------------------------------------------------------------

test("the floor-view switch renders in BOTH modes, at the same place, outside any menu", () => {
  const app = codeOf(APP);
  assert.match(app, /function FloorModeSwitch\(/, "there is one switch component");
  // Rendered unconditionally: not inside a `floorMode === ...` ternary.
  assert.match(app, /^\s*<FloorModeSwitch mode=\{floorMode\} onMode=\{setFloorMode\} \/>/m);
  assert.equal(app.split("<FloorModeSwitch").length - 1, 1, "exactly one switch, so both modes get the same one");
  // It sits above the Pro-only secondary nav, which is the only mode-dependent row.
  const switchAt = app.indexOf("<FloorModeSwitch");
  const secondaryAt = app.indexOf('aria-label="Pro Floor sections"');
  assert.ok(switchAt > 0 && secondaryAt > switchAt, "the view switch comes before the Pro sections");
  // The switch itself is a <nav>, not a dropdown.
  const body = app.slice(app.indexOf("function FloorModeSwitch"), app.indexOf("const NAV_TAB ="));
  assert.match(body, /<nav\s+aria-label="Floor view"/);
  assert.doesNotMatch(body, /DropdownMenu|<details|popover/i, "the switch is never a menu");
});

test("Guided Floor is not reachable only through Desk tools", () => {
  const app = codeOf(APP);
  // The old mobile-only dropdown entry is gone.
  assert.doesNotMatch(app, /onGuided/, "the Desk tools menu no longer carries the Guided entry");
  const menu = app.slice(app.indexOf("function MoreMenu"), app.indexOf("export function DeskApp"));
  assert.ok(menu.length > 200 && menu.includes("Desk tools"), "the slice really is the Desk tools menu");
  assert.doesNotMatch(menu, /Guided/, "Desk tools must not be the way to find Guided");
  // Nothing hides either segment behind a breakpoint.
  const body = app.slice(app.indexOf("function FloorModeSwitch"), app.indexOf("const NAV_TAB ="));
  assert.doesNotMatch(body, /hidden sm:flex|sm:hidden|hidden md:/, "neither segment may be hidden at any width");
});

test("both labels are spelled out, and the control is touch- and keyboard-usable", () => {
  const app = codeOf(APP);
  const body = app.slice(app.indexOf("function FloorModeSwitch"), app.indexOf("const NAV_TAB ="));
  assert.match(body, /"Guided Floor"/, "the guided segment says Guided Floor");
  assert.match(body, /"Pro Floor"/, "the pro segment says Pro Floor");
  assert.doesNotMatch(body, /"Overview"/, "Overview is a Pro section, never a floor view");
  assert.match(body, /min-h-11/, "44px touch target");
  assert.match(body, /aria-current=\{on \? "page" : undefined\}/, "the active view is announced");
  assert.match(body, /<button\n?\s+key=\{id\}\n?\s+type="button"/, "native buttons, so keyboard and focus work for free");
  // Overview stays in the Pro row, where it belongs.
  assert.match(app, /\{ id: "satoshi", label: "Overview" \}/);
  assert.match(app, /aria-label="Pro Floor sections"/, "Pro's own nav is labelled as subordinate");
});

// ---------------------------------------------------------------------------
// 7-9. URLs
// ---------------------------------------------------------------------------

test("?view=guided selects Guided, Pro clears it, and ?guided=true is not canonical", () => {
  const app = codeOf(APP);
  // Requirement 7.
  assert.match(app, /sp\.get\("view"\) === "guided"/, "the address selects Guided");
  assert.match(app, /get\("view"\) === "guided" \? "guided" : "pro"/, "including on the very first render");
  // Requirement 8: leaving Guided removes the parameter rather than negating it.
  assert.match(
    app,
    /if \(floorMode === "guided" && tab === "satoshi"\) u\.searchParams\.set\("view", "guided"\);\s*\n\s*else u\.searchParams\.delete\("view"\);/,
    "Pro drops view=guided from the address",
  );
  assert.doesNotMatch(app, /set\("view",\s*"pro"\)/, "Pro is the bare URL, not a second parameter value");
  // Requirement 9: no alternate spelling anywhere in the app or the home page.
  for (const rel of [APP, HOME, PREFS]) {
    assert.doesNotMatch(read(rel), /guided=true|guided=1|\?guided\b/, `${rel} must not use ?guided=`);
  }
});

test("the home page offers both doors explicitly, and claims no advantage for either", () => {
  const home = read(HOME);
  assert.match(home, /href="\/desk\?view=guided"/, "Guided has its own canonical entry");
  assert.match(home, /href="\/desk"/, "Pro remains one click away");
  assert.match(home, /Start with Guided Floor/);
  assert.match(home, /Open Pro Floor/);
  assert.match(home, /See the Council’s live decision in plain English/);
  assert.match(home, /Full evidence, prices, model, gates and diagnostics/);
  // Same window, same call — and no accuracy claim to dress one up.
  assert.match(home, /same live window and the same call/i);
  const homeCode = codeOf(HOME);
  for (const claim of [
    /more accurate/i,
    /better results?/i,
    /higher win/i,
    /outperform/i,
    /smarter call/i,
    /improved accuracy/i,
  ]) {
    assert.doesNotMatch(homeCode, claim, "neither view may claim better research");
  }
  // Paper-only messaging survives the rewrite.
  assert.match(home, /Paper research\. Public prices\. No live orders\./);
});

// ---------------------------------------------------------------------------
// First-visit default and the saved preference
// ---------------------------------------------------------------------------

test("a first visit opens Guided, and a browser that chose Pro keeps getting Pro", async () => {
  const { floorModeFromStored, FIRST_VISIT_FLOOR_MODE } = await import("../src/components/desk/prefs.ts");
  assert.equal(FIRST_VISIT_FLOOR_MODE, "guided", "a new reader meets the plain-language view first");
  // Never chosen: the key was never written.
  assert.equal(floorModeFromStored(null), null, "absent means no choice yet");
  // Chose Guided, and chose Pro — including the legacy empty string Pro used
  // to be stored as. Reading that as "no choice" would silently move every
  // existing Pro reader to Guided.
  assert.equal(floorModeFromStored("guided"), "guided");
  assert.equal(floorModeFromStored("pro"), "pro");
  assert.equal(floorModeFromStored(""), "pro", "the legacy empty string is an explicit Pro choice");
  // Pro is written explicitly from now on, so the ambiguity cannot come back.
  assert.match(read(PREFS), /set\(FLOOR_MODE_KEY, mode === "guided" \? "guided" : "pro"\)/);
  assert.match(read(PREFS), /export function readFloorMode\(\): FloorMode \{\s*\n\s*return readStoredFloorMode\(\) \?\? FIRST_VISIT_FLOOR_MODE;/);
});

test("an explicit link outranks the saved preference, so shared URLs open what they name", () => {
  const app = codeOf(APP);
  assert.match(app, /function urlPinsFloorMode\(\)/);
  assert.match(app, /if \(!urlPinsFloorMode\(\)\) setFloorModeState\(readFloorMode\(\)\);/);
  const body = app.slice(app.indexOf("function urlPinsFloorMode"), app.indexOf("const NAV_TAB ="));
  assert.ok(body.length > 100 && body.length < 600, "the slice really is just that function");
  assert.match(body, /sp\.get\("view"\) === "guided"/, "?view=guided pins Guided");
  assert.match(body, /sp\.has\("tab"\) \|\| sp\.has\("seat"\)/, "a Pro deep link pins Pro");
  // The preference is browser-only: no server, no frame, no desk state.
  assert.doesNotMatch(read(PREFS), /fetch\(|createServerFn|getSql|process\.env/, "preferences never leave the browser");
});

// ---------------------------------------------------------------------------
// Neither view may be flattened into the other
// ---------------------------------------------------------------------------

test("Guided stays the simple view: no evidence tape, gates or diagnostics leak into it", () => {
  const guided = codeOf("src/components/desk/GuidedFloor.tsx");
  for (const advanced of [
    "ProOverview",
    "CouncilEvidenceTape",
    "DecisionGates",
    "EvidenceFamilies",
    "MarketModelCard",
    "DataHealthCard",
    "ProScoreBar",
    "proFloorFacts",
  ]) {
    assert.ok(!guided.includes(advanced), `the Guided Floor must not pull in ${advanced}`);
  }
  // It keeps its one obvious way through to Pro.
  assert.match(guided, /onPro/, "Guided offers a way to the full view");
});

test("Pro keeps its full surface, and its density control", () => {
  const tab = codeOf("src/components/desk/SatoshiTab.tsx");
  assert.match(tab, /<ProOverview/, "the Pro cockpit still mounts");
  assert.match(tab, /density=\{density\}/, "Core / Full desk density survives");
  const overview = codeOf("src/components/desk/ProFloor/ProOverview.tsx");
  for (const section of [
    "MarketModelCard",
    "EvidenceFamilies",
    "DecisionGates",
    "DataHealthCard",
    "PaperPositionCard",
    "ProScoreBar",
  ]) {
    assert.ok(overview.includes(section), `Pro must keep ${section}`);
  }
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("this is a navigation change only: no decision, model or storage source is touched", () => {
  // The switch moves a view; it never reaches anything that decides or records.
  const app = codeOf(APP);
  const body = app.slice(app.indexOf("function FloorModeSwitch"), app.indexOf("const NAV_TAB ="));
  for (const banned of [
    "runChair",
    "SPEAK_CONF",
    "sit_mass",
    "learner",
    "bookFloor",
    "telemetry",
    "getSql",
    "insert into",
    "createServerFn",
  ]) {
    assert.ok(!body.includes(banned), `the view switch must not reference ${banned}`);
  }
  // Both views read the one shared frame, so they cannot disagree about the call.
  assert.match(app, /snap=\{frame\.snap\}\n?\s*chair=\{frame\.chair\}/, "Guided reads the shared frame");
  assert.match(app, /const \{ frame \} = useDesk\(\)|useDesk\(\)/, "there is a single frame source");
});
