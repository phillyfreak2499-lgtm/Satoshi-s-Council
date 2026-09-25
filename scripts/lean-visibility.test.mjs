/**
 * Directional Lean — the visibility pass. Presentation only.
 *
 * Guided: the specialist section sits directly under the SATOSHI verdict and
 * before the lower panels; directional reads first, the strongest few visible,
 * neutral and no-read seats folded. Pro: the tape prints DIRECTIONAL LEAN and
 * a Bullish / Bearish / Neutral / NO READ word beside each number. Seat page: a
 * compact "Directional Lean: 37 · Bearish" line at the top, linking to the full
 * meter block lower down. Plain-language status lines map from the frame's own
 * status. No probability or confidence language, no decision module imported
 * by presentation code, no change to the decision modules.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");
const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/^\s*\/\/.*$/gm, " ");

function load(rel, extra = {}) {
  const cache = new Map();
  const resolveId = (from, id) => {
    const base = id.startsWith("@/") ? join(process.cwd(), "src", id.slice(2)) : resolve(dirname(from), id);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.ts$/, ".tsx")]) if (existsSync(c) && !c.endsWith("/")) return c;
    throw new Error(`cannot resolve ${id} from ${from}`);
  };
  const run = (file) => {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    cache.set(file, exports);
    vm.runInNewContext(code, { exports, require: (id) => (id in extra ? extra[id] : id.startsWith(".") || id.startsWith("@/") ? run(resolveId(file, id)) : require(id)) });
    return exports;
  };
  return run(join(process.cwd(), rel));
}
function proFloorLabels() {
  const src = read("src/lib/desk/pro-floor.ts");
  const pick = (name) => { const start = src.indexOf(`export const ${name}`); return src.slice(start, src.indexOf("});", start) + 3); };
  const code = ts.transpileModule(`${pick("VOICE_LABEL")}\n${pick("SUPPRESSION_LABEL")}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports });
  return exports;
}
const CSS = { "./SeatLeanMeter.css": {} };
const lib = load("src/lib/desk/seat-lean.ts");
const { seatDirectionalLean, leanPlainLine, leanSummaryText, guidedLeanOrder, GUIDED_LEAN_VISIBLE, GUIDED_WAITING_LEAD } = lib;
const { SeatLeanSummary } = load("src/components/desk/SeatLeanMeter.tsx", CSS);
const { SpecialistLeans } = load("src/components/desk/SpecialistLeans.tsx", CSS);
const { CouncilEvidenceTape } = load("src/components/desk/ProFloor/CouncilEvidenceTape.tsx", { ...CSS, "@/lib/desk/pro-floor": proFloorLabels() });
const text = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const WINDOW = { ticker: "KXBTC15M-26SEP2514-T85000", close_time: 1_790_000_000_000, as_of: 1_789_999_500_000 };
const fact = (over = {}) => ({
  seat: "DRIFT", callsign: "VEC", family: "structure", eyes: "ret 5/15/30", raw_lean: "UP", raw_conf: 70, raw_retained: true, final_lean: "WAIT", final_conf: 70,
  final_conf_transformed: true, voice: "suppressed", suppression: "below-speak-bar", health_warning: false, speak_bar: 52, aggregated: true,
  health: "LIVE", status: "LIVE", weight: 0, contribution: 0, why: "trend holds on 15/30", skill_used: "DRIFT.aligned_3h", skill_status: "LIVE", ...over,
});
const lean = (over = {}) => seatDirectionalLean(fact(over), WINDOW);
const sitting = (seat, callsign) => lean({ seat, callsign, raw_lean: "WAIT", raw_conf: 0, voice: "waiting", suppression: null, skill_used: "SIT", skill_status: "SIT" });
const down = (seat, callsign) => lean({ seat, callsign, voice: "unhealthy", suppression: "feed", health: "DOWN", raw_lean: "WAIT", raw_conf: 0 });
const FORBIDDEN = [/confidence/i, /probabilit/i, /\bodds\b/i, /\bchance\b/i, /win rate/i, /\bbuy\b/i, /\bsell\b/i];
const scrub = (t) => t.replace(/It is not a probability/g, "");

test("1. Guided renders the specialist section directly after the official decision area and before the lower panels", () => {
  const src = read("src/components/desk/GuidedFloorView.tsx");
  const verdict = src.indexOf('aria-labelledby="guided-call"');
  const specialists = src.indexOf("<SpecialistLeans ");
  const lastCall = src.indexOf("<LastCallPanel ");
  const change = src.indexOf("<WhatWouldChange ");
  const happened = src.indexOf("<WhatHappened ");
  assert.ok(verdict > 0 && specialists > verdict, "the SATOSHI verdict section is rendered first");
  assert.ok(specialists < lastCall && lastCall < change && change < happened, "specialists, then the last paper call, then the explanatory panels");
  assert.equal((src.match(/<SpecialistLeans /g) ?? []).length, 1);
  assert.match(src, /<SpecialistLeans leans=\{leans\} waiting=\{read\.label === "WAIT"\} \/>/);
  // The verdict heading itself is untouched.
  assert.match(src, /\{read\.label === "WAIT" \? <Tip k="term\.wait">WAIT<\/Tip> : read\.label\}/);
});

test("2. the Pro tape visibly prints DIRECTIONAL LEAN and a direction word beside each number", () => {
  const seats = [fact(), fact({ seat: "WICK", callsign: "PIN", raw_lean: "DOWN", raw_conf: 60 }), fact({ seat: "TAPE", callsign: "TPE", raw_lean: "WAIT", raw_conf: 0, voice: "waiting", suppression: null, skill_used: "SIT", skill_status: "SIT" }), fact({ seat: "INDEX", callsign: "IDX", voice: "unhealthy", suppression: "feed", health: "DOWN", raw_lean: "WAIT", raw_conf: 0 })];
  const html = renderToString(React.createElement(CouncilEvidenceTape, { facts: { seats }, onJump: () => {}, window: WINDOW }));
  const t = text(html);
  assert.ok((t.match(/DIRECTIONAL LEAN/g) ?? []).length >= 5, "the column header, the note and every phone row carry the label");
  assert.match(t, /85 Bullish/);
  assert.match(t, /20 Bearish/);
  assert.match(t, /50 Neutral/);
  assert.match(t, /— NO READ/);
  assert.match(t, /0 strongly bearish, 50 neutral, 100 strongly bullish/);
  assert.match(t, /It is not a probability and not a SATOSHI call\./);
  // The word is decorative beside a row button that already announces the lean; the button names are unchanged in shape.
  const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 8);
  for (const l of labels) assert.match(l, /Directional Lean \d+ of 100|no directional read/);
  assert.equal((html.match(/seat-lean seat-lean--mini/g) ?? []).length, 8);
  // The tape's pre-existing RAW/FINAL note names the rewritten "recorded confidence" column; the pass adds no such word.
  const added = scrub(t).replace(/An asterisk marks a recorded confidence the pipeline rewrote on a forced sit\./, "").replace(/ conf status/, " status");
  for (const banned of FORBIDDEN) assert.doesNotMatch(added, banned);
  const words = [...html.matchAll(/<span class="seat-lean__value font-mono text-micro" data-direction="[A-Z_]+" aria-hidden="true">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(words, ["Bullish", "Bearish", "Neutral", "NO READ", "Bullish", "Bearish", "Neutral", "NO READ"], "desktop and phone rows, one word each");
});

test("3. the seat page top area carries a compact lean summary linking to the full meter block", () => {
  const page = codeOf("src/routes/seat.$id.tsx");
  const summary = page.indexOf("<SeatLeanSummary ");
  const card = page.indexOf("<BotCard seat={id}");
  const record = page.indexOf(">Record<");
  assert.ok(summary > 0 && summary < card && card < record, "summary, then the seat card with the full meter, then the record");
  assert.match(page, /meterId=\{`seat-lean-\$\{id\}`\}/);
  assert.match(read("src/components/desk/BotCard.tsx"), /<div id=\{`seat-lean-\$\{seat\}`\} className="border-t border-border px-3 py-2">\s*<SeatLeanMeter key=\{leanKey\(lean\)\}/, "the full meter block keeps its place lower on the card and is the link target");
  assert.match(page, /SATOSHI heard: <LeanChip lean=\{vote\.lean\} \/>/, "what SATOSHI decided sits beside the research lean, labelled as such");
  const html = renderToString(React.createElement(SeatLeanSummary, { lean: lean({ raw_lean: "DOWN", raw_conf: 74 }), meterId: "seat-lean-DRIFT" }));
  const t = text(html);
  assert.match(t, /^Directional Lean: 13 · Bearish Bearish read — not strong enough for SATOSHI to count\. Full meter ↓/);
  assert.match(html, /href="#seat-lean-DRIFT"/);
  assert.match(html, /data-lean-key="KXBTC15M-26SEP2514-T85000\|1790000000000\|DRIFT"/);
  assert.match(html, /data-direction="BEARISH"/);
  assert.equal(leanSummaryText(lean({ raw_lean: "DOWN", raw_conf: 74 })), "Directional Lean: 13 · Bearish");
  assert.equal(leanSummaryText(down("DRIFT", "VEC")), "Directional Lean: No read");
  const noRead = text(renderToString(React.createElement(SeatLeanSummary, { lean: down("DRIFT", "VEC") })));
  assert.match(noRead, /^Directional Lean: No read No qualifying directional read right now\./);
  assert.doesNotMatch(noRead, /Full meter/);
  const stale = text(renderToString(React.createElement(SeatLeanSummary, { lean: lean({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, health: "STALE", health_warning: true }) })));
  assert.match(stale, /Directional Lean: 85 · Bullish STALE Bullish read — SATOSHI counted it\. Read exists, but the supporting feed is stale\./);
});

test("4. no probability, confidence or trading language is introduced anywhere in the pass", () => {
  const html = [
    renderToString(React.createElement(SeatLeanSummary, { lean: lean(), meterId: "x" })),
    renderToString(React.createElement(SpecialistLeans, { leans: [lean(), lean({ seat: "WICK", callsign: "PIN", raw_lean: "DOWN", raw_conf: 60 }), sitting("TAPE", "TPE"), down("INDEX", "IDX")], waiting: true })),
  ].map(text).join(" ");
  for (const banned of FORBIDDEN) assert.doesNotMatch(scrub(html), banned);
  for (const file of ["src/components/desk/SpecialistLeans.tsx", "src/components/desk/SeatLeanMeter.tsx", "src/lib/desk/seat-lean.ts"]) {
    for (const banned of [/probabilit/i, /win rate/i, /\bodds\b/i]) assert.doesNotMatch(scrub(codeOf(file)), banned, `${file}`);
    assert.doesNotMatch(codeOf(file), /animation|@keyframes|blink/i, `${file} adds no animation`);
  }
  for (const line of Object.values(lib).filter((v) => typeof v === "string")) for (const banned of FORBIDDEN) assert.doesNotMatch(scrub(line), banned);
});

test("5. and 6. the official SATOSHI verdict stays above and separate, and the paper position stays separate", () => {
  const html = renderToString(React.createElement(SpecialistLeans, { leans: [lean()], waiting: true }));
  const t = text(html);
  assert.match(t, /^Follow a specialist What each specialist sees SATOSHI is waiting, but individual specialists may still have research leans\./);
  assert.match(t, /its read is research, not a call, and it is not a paper position\./);
  assert.match(t, /It is not a probability and not a SATOSHI call\./);
  assert.doesNotMatch(html, /guided-call|aria-live|term\.wait/, "the section carries no verdict heading of its own");
  assert.doesNotMatch(t, /Satoshi · the current read/, "the verdict strip is not repeated here");
  assert.equal(GUIDED_WAITING_LEAD, "SATOSHI is waiting, but individual specialists may still have research leans.");
  const quiet = text(renderToString(React.createElement(SpecialistLeans, { leans: [lean()], waiting: false })));
  assert.doesNotMatch(quiet, /SATOSHI is waiting/, "the lead-in prints only while SATOSHI waits");
  const guided = read("src/components/desk/GuidedFloorView.tsx");
  assert.ok(guided.indexOf('aria-labelledby="guided-call"') < guided.indexOf("<SpecialistLeans "));
  assert.match(guided, /<LastCallPanel last=\{last\} \/>/, "the paper-position panel is its own panel, after the specialists");
  assert.doesNotMatch(read("src/components/desk/LastCallPanel.tsx"), /seat-lean|SeatLean/, "the paper-position panel does not carry the meter");
  for (const f of ["src/components/desk/ProFloor/PaperPositionCard.tsx", "src/components/desk/ProFloor/ProChairCard.tsx"]) assert.doesNotMatch(read(f), /seat-lean|SeatLean|SpecialistLeans/);
});

test("7. Guided keeps directional seats visible, the strongest few first, and folds neutral and no-read seats", () => {
  const directional = [
    lean({ seat: "DRIFT", callsign: "VEC", raw_conf: 60 }),
    lean({ seat: "WICK", callsign: "PIN", raw_lean: "DOWN", raw_conf: 90 }),
    lean({ seat: "STRIKE", callsign: "STK", raw_conf: 80 }),
    lean({ seat: "CHAIN", callsign: "CHN", raw_lean: "DOWN", raw_conf: 55 }),
    lean({ seat: "CARRY", callsign: "CRY", raw_conf: 70 }),
    lean({ seat: "VEL", callsign: "VEL", raw_lean: "DOWN", raw_conf: 66 }),
  ];
  const quiet = [sitting("TAPE", "TPE"), down("INDEX", "IDX"), sitting("ODDS", "ODD")];
  const html = renderToString(React.createElement(SpecialistLeans, { leans: [...quiet, ...directional], waiting: true }));
  const t = text(html);
  const order = [...t.matchAll(/\b(DRIFT|WICK|STRIKE|CHAIN|CARRY|VEL|TAPE|INDEX|ODDS)\b/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  assert.deepEqual(order.slice(0, 6), ["WICK", "STRIKE", "CARRY", "VEL", "DRIFT", "CHAIN"], "strongest first by the existing order model");
  assert.deepEqual([...directional].sort(guidedLeanOrder).map((l) => l.seat), ["WICK", "STRIKE", "CARRY", "VEL", "DRIFT", "CHAIN"]);
  assert.equal(GUIDED_LEAN_VISIBLE, 4);
  const [beforeFold, afterFold] = html.split("<details");
  for (const seat of ["WICK", "STRIKE", "CARRY", "VEL"]) assert.match(beforeFold, new RegExp(`\\b${seat}\\b`), `${seat} is visible without a tap`);
  for (const seat of ["DRIFT", "CHAIN", "TAPE", "INDEX", "ODDS"]) assert.doesNotMatch(beforeFold, new RegExp(`\\b${seat}\\b`), `${seat} is folded`);
  assert.match(text(afterFold), /2 more directional reads/);
  assert.match(t, /3 seats are neutral or without a read/);
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.equal((html.match(/data-lean-key="/g) ?? []).length, 9, "every seat still renders its meter, folded or not");
  const none = text(renderToString(React.createElement(SpecialistLeans, { leans: quiet })));
  assert.match(none, /No specialist has a directional read this frame\. That is a real answer, not a gap\./);
  assert.doesNotMatch(none, /more directional/);
});

test("8. the plain-language status copy maps from the frame's own status and direction", () => {
  const cases = [
    [lean({ raw_lean: "DOWN", raw_conf: 60 }), "Bearish read — not strong enough for SATOSHI to count."],
    [lean(), "Bullish read — not strong enough for SATOSHI to count."],
    [lean({ suppression: "authority" }), "Bullish read — SATOSHI did not count it."],
    [lean({ suppression: null }), "Bullish read — SATOSHI did not count it."],
    [lean({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: false }), "Directional research read — SATOSHI has not counted it."],
    [lean({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: true }), "Bullish read — SATOSHI counted it."],
    [lean({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, health: "STALE", health_warning: true }), "Bullish read — SATOSHI counted it. Read exists, but the supporting feed is stale."],
    [lean({ raw_lean: "DOWN", raw_conf: 60, health: "STALE", health_warning: true }), "Bearish read — not strong enough for SATOSHI to count. Read exists, but the supporting feed is stale."],
    [lean({ skill_status: "SHADOW" }), "Bullish research read — SATOSHI does not count this seat this window."],
    [lean({ voice: "muted", suppression: null }), "Bullish research read — SATOSHI does not count this seat this window."],
    [sitting("TAPE", "TPE"), "No qualifying directional read right now."],
    [down("INDEX", "IDX"), "No qualifying directional read right now."],
    [lean({ raw_retained: false }), "No qualifying directional read right now."],
  ];
  for (const [l, expected] of cases) assert.equal(leanPlainLine(l), expected, `${l.status} ${l.direction}`);
  // The technical status is still on the Pro meter and in every announcement; Guided prefers the plain line.
  const { SeatLeanMeter } = load("src/components/desk/SeatLeanMeter.tsx", CSS);
  const pro = text(renderToString(React.createElement(SeatLeanMeter, { lean: lean({ raw_lean: "DOWN", raw_conf: 60 }), mode: "pro" })));
  assert.match(pro, /Status: BELOW BAR/);
  assert.match(pro, /Bearish read — not strong enough for SATOSHI to count\./);
  const guided = text(renderToString(React.createElement(SeatLeanMeter, { lean: lean({ raw_lean: "DOWN", raw_conf: 60 }), mode: "guided" })));
  assert.match(guided, /Status: Bearish read — not strong enough for SATOSHI to count\./);
  assert.doesNotMatch(guided, /BELOW BAR|Card:|DRIFT\.aligned_3h/);
  assert.equal(lean().statusPlain, "Research only — SATOSHI did not hear this vote.", "the announcement copy the read model already carries is untouched");
});

test("9. presentation code imports no decision module", () => {
  const forbidden = /from "(@\/lib\/desk\/|\.\/|\.\.\/)(chair|bots|learner|book-floor|server-engine|persist|selective-entry|council-authority|call-recovery-candidate|shadow-lab[^"]*)"/;
  for (const file of ["src/lib/desk/seat-lean.ts", "src/components/desk/SeatLeanMeter.tsx", "src/components/desk/SpecialistLeans.tsx", "src/components/desk/ProFloor/CouncilEvidenceTape.tsx"]) {
    assert.doesNotMatch(read(file), forbidden, file);
    assert.doesNotMatch(read(file), /Date\.now|fetch\(|localStorage|setInterval/, file);
  }
  assert.doesNotMatch(read("src/lib/desk/seat-lean.ts"), /fact\.[a-z_]+\s*=[^=]/, "no assignment into the input");
  assert.match(read("src/components/desk/SpecialistLeans.tsx"), /guidedLeanOrder/, "the section sorts by the one order model");
  assert.doesNotMatch(read("src/components/desk/SpecialistLeans.tsx"), /50 \+ |\/ 2\b|raw_conf|raw_lean/, "never re-derives a lean");
});

test("10. no Chair, booking, learner or experiment module references the presentation pass", () => {
  for (const file of ["src/lib/desk/chair.ts", "src/lib/desk/bots.ts", "src/lib/desk/book-floor.ts", "src/lib/desk/selective-entry.ts", "src/lib/desk/server-engine.ts", "src/lib/desk/call-recovery-candidate.ts", "src/lib/desk/shadow-lab-mid-recovery.ts", "src/lib/desk/shadow-lab-mid-recovery.server.ts", "src/lib/desk/pro-floor.ts"]) {
    assert.doesNotMatch(read(file), /seat-lean|SeatLean|SpecialistLeans|leanPlainLine/, file);
  }
  // The read model's mapping is untouched: the same pins the unit tests hold.
  assert.equal(lean().score, 85);
  assert.equal(lean({ raw_lean: "DOWN", raw_conf: 70 }).score, 15);
  assert.equal(lean({ raw_lean: "WAIT", raw_conf: 0 }).score, 50);
  assert.equal(lean({ raw_retained: false }).score, null);
});

// ---------------------------------------------------------------------------
// Codex P2 on #334: unknown suppression reasons stay unexplained; Guided ranks by strength.
// ---------------------------------------------------------------------------

test("11. only BELOW BAR earns strength-based copy; a plain SUPPRESSED read names no reason the frame cannot prove", () => {
  const belowBar = lean({ suppression: "below-speak-bar" });
  assert.equal(belowBar.status, "BELOW BAR");
  assert.equal(leanPlainLine(belowBar), "Bullish read — not strong enough for SATOSHI to count.");
  for (const suppression of ["authority", "correlated", "unknown", null, undefined]) {
    const suppressed = lean({ suppression });
    assert.equal(suppressed.status, "SUPPRESSED", String(suppression));
    const line = leanPlainLine(suppressed);
    assert.equal(line, "Bullish read — SATOSHI did not count it.");
    assert.doesNotMatch(line, /strong|weak|low|bar|confidence/i, "no invented reason");
  }
  assert.equal(leanPlainLine(lean({ suppression: "authority", raw_lean: "DOWN", raw_conf: 60 })), "Bearish read — SATOSHI did not count it.");
  assert.equal(leanPlainLine(lean({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: false })), "Directional research read — SATOSHI has not counted it.");
  assert.equal(leanPlainLine(lean({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: true })), "Bullish read — SATOSHI counted it.");
  // STALE appends its warning to every directional line, unchanged.
  for (const [over, base] of [
    [{ suppression: "authority" }, "Bullish read — SATOSHI did not count it."],
    [{ suppression: "below-speak-bar" }, "Bullish read — not strong enough for SATOSHI to count."],
    [{ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: true }, "Bullish read — SATOSHI counted it."],
  ]) {
    assert.equal(leanPlainLine(lean({ ...over, health: "STALE", health_warning: true })), `${base} Read exists, but the supporting feed is stale.`);
  }
  assert.equal(leanPlainLine(lean({ suppression: "authority", raw_retained: false, health: "STALE", health_warning: true })), "No qualifying directional read right now.", "no read means no warning to append");
  const { SeatLeanMeter } = load("src/components/desk/SeatLeanMeter.tsx", CSS);
  const pro = text(renderToString(React.createElement(SeatLeanMeter, { lean: lean({ suppression: "authority" }), mode: "pro" })));
  assert.match(pro, /Status: SUPPRESSED/);
  assert.match(pro, /Bullish read — SATOSHI did not count it\./);
  assert.doesNotMatch(pro, /not strong enough/);
});

test("12. Guided ranks every directional read by strength: a weak SPEAKING read sits behind stronger research-only reads", () => {
  const speaking = (seat, callsign, side, conf) => lean({ seat, callsign, raw_lean: side, raw_conf: conf, voice: "speaking", suppression: null, final_lean: side, final_conf_transformed: false, aggregated: true });
  const research = (seat, callsign, side, conf, over = {}) => lean({ seat, callsign, raw_lean: side, raw_conf: conf, ...over });
  const leans = [
    speaking("TAPE", "TPE", "UP", 56),                                   // 78 → 28: SPEAKING but weak
    research("DRIFT", "VEC", "UP", 90),                                   // 95 → 45: BELOW BAR
    research("WICK", "PIN", "DOWN", 88, { skill_status: "SHADOW" }),      // 6 → 44: SHADOW
    research("CHAIN", "CHN", "DOWN", 80, { skill_status: "BENCH" }),      // 10 → 40: BENCH
    research("STRIKE", "STK", "UP", 70, { suppression: "authority" }),    // 85 → 35: SUPPRESSED
    speaking("CARRY", "CRY", "DOWN", 66),                                 // 17 → 33: SPEAKING
    sitting("ODDS", "ODD"), down("INDEX", "IDX"),
  ];
  const before = JSON.stringify(leans);
  const sorted = [...leans].sort(guidedLeanOrder);
  assert.deepEqual(sorted.map((l) => l.seat), ["DRIFT", "WICK", "CHAIN", "STRIKE", "CARRY", "TAPE", "ODDS", "INDEX"]);
  assert.equal(sorted[0].isAuthorizedSpeaker, false, "the strongest read is research-only and still shows first");
  assert.equal(sorted.findIndex((l) => l.seat === "TAPE"), 5, "the weak SPEAKING read is behind four stronger reads");
  const html = renderToString(React.createElement(SpecialistLeans, { leans, waiting: true }));
  const [visible, ...folds] = html.split("<details");
  for (const seat of ["DRIFT", "WICK", "CHAIN", "STRIKE"]) assert.match(visible, new RegExp(`\\b${seat}\\b`), `${seat} visible`);
  for (const seat of ["CARRY", "TAPE", "ODDS", "INDEX"]) assert.doesNotMatch(visible, new RegExp(`\\b${seat}\\b`), `${seat} folded`);
  assert.equal(folds.length, 2, "one fold for the extra directional reads, one for the quiet seats");
  assert.match(text(folds[0]), /2 more directional reads CARRY CRY .* TAPE TPE /, "the extra directional reads, strongest first");
  assert.match(text(folds[1]), /2 seats are neutral or without a read ODDS ODD .* INDEX IDX /, "neutral before no read");
  // Display order changes nothing about the seats themselves.
  assert.equal(JSON.stringify(leans), before, "sorting mutates no lean");
  assert.deepEqual(sorted.map((l) => [l.seat, l.status, l.isAuthorizedSpeaker, l.score]).sort(), leans.map((l) => [l.seat, l.status, l.isAuthorizedSpeaker, l.score]).sort(), "status, authority and score are untouched");
  assert.equal(leans.find((l) => l.seat === "TAPE").status, "SPEAKING");
  assert.equal(leans.find((l) => l.seat === "DRIFT").status, "BELOW BAR");
});

test("13. Guided tie ordering is deterministic and mirrored strengths tie", () => {
  const research = (seat, callsign, side, conf) => lean({ seat, callsign, raw_lean: side, raw_conf: conf });
  const tied = [research("WICK", "PIN", "DOWN", 70), research("DRIFT", "VEC", "UP", 70), research("CHAIN", "CHN", "UP", 70), sitting("TAPE", "TPE"), sitting("ODDS", "ODD"), down("VEL", "VEL"), down("INDEX", "IDX")];
  for (const input of [tied, [...tied].reverse(), [tied[2], tied[0], tied[6], tied[1], tied[4], tied[5], tied[3]]]) {
    assert.deepEqual([...input].sort(guidedLeanOrder).map((l) => l.seat), ["CHAIN", "DRIFT", "WICK", "ODDS", "TAPE", "INDEX", "VEL"], "equal strength orders by seat id; neutral before no read");
  }
  assert.equal(guidedLeanOrder(tied[0], tied[1]) + guidedLeanOrder(tied[1], tied[0]), 0, "antisymmetric");
  assert.equal(guidedLeanOrder(tied[0], tied[0]), 0);
});
