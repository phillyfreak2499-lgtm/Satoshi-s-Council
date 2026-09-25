/**
 * Directional Lean — what the page actually prints.
 *
 * Renders the meter the way the server does and checks the copy: the label is
 * DIRECTIONAL LEAN, the disclaimer says it is not a probability and not a
 * SATOSHI call, no forbidden word (confidence, probability, odds, chance)
 * appears, the meter carries meter semantics with a text value, NO READ is an
 * image with text, and the Guided form speaks plainly. Every meter element is
 * keyed by the complete window identity plus the seat; a labelled row button
 * announces the lean in its own name; a directional vote without a Chair row
 * is never announced as heard; a frame without both raw fields is NO READ. It
 * also pins that the SATOSHI verdict and paper-position surfaces are untouched.
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

const CSS = { "./SeatLeanMeter.css": {} };
/**
 * The tape needs only pro-floor's two label maps at runtime (its other imports
 * are types). pro-floor itself pulls the whole desk math, which this plain
 * loader cannot evaluate, so the two maps are taken verbatim from the source.
 */
function proFloorLabels() {
  const src = read("src/lib/desk/pro-floor.ts");
  const pick = (name) => { const start = src.indexOf(`export const ${name}`); return src.slice(start, src.indexOf("});", start) + 3); };
  const code = ts.transpileModule(`${pick("VOICE_LABEL")}\n${pick("SUPPRESSION_LABEL")}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports });
  return exports;
}
const { seatDirectionalLean, leanKey } = load("src/lib/desk/seat-lean.ts");
const { SeatLeanMeter, SeatLeanMini } = load("src/components/desk/SeatLeanMeter.tsx", CSS);
const { CouncilEvidenceTape } = load("src/components/desk/ProFloor/CouncilEvidenceTape.tsx", { ...CSS, "@/lib/desk/pro-floor": proFloorLabels() });
const text = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const keyRe = (key) => new RegExp(`data-lean-key="${key.replace(/[|]/g, "\\|")}"`);
const WINDOW = { ticker: "KXBTC15M-26SEP2514-T85000", close_time: 1_790_000_000_000, as_of: 1_789_999_500_000 };
const fact = (over = {}) => ({
  seat: "DRIFT", callsign: "VEC", family: "structure", eyes: "ret 5/15/30", raw_lean: "UP", raw_conf: 70, raw_retained: true, final_lean: "WAIT", final_conf: 70,
  final_conf_transformed: true, voice: "suppressed", suppression: "below-speak-bar", health_warning: false, speak_bar: 52, aggregated: true,
  health: "LIVE", status: "LIVE", weight: 0, contribution: 0, why: "trend holds on 15/30", skill_used: "DRIFT.aligned_3h", skill_status: "LIVE", ...over,
});
const FORBIDDEN = [/confidence/i, /probabilit/i, /\bodds\b/i, /\bchance\b/i, /win rate/i];

test("the Pro meter prints the label, the number, the research side, the status and the disclaimer", () => {
  const lean = seatDirectionalLean(fact(), WINDOW);
  const html = renderToString(React.createElement(SeatLeanMeter, { lean, mode: "pro", showDisclaimer: true, feedAgeS: 1.2 }));
  const t = text(html);
  assert.match(t, /DIRECTIONAL LEAN/);
  assert.match(t, /85 · Bullish/);
  assert.match(t, /Bearish Bullish Research read: UP/, "the scale is labelled at both ends");
  assert.match(t, /Status: BELOW BAR/);
  assert.match(t, /Card: DRIFT\.aligned_3h/);
  assert.match(t, /Strength: 70/);
  assert.match(t, /Updated: 2026-09-2\d \d\d:\d\d:\d\d UTC · feed 1\.2s/);
  assert.match(t, /Research only — SATOSHI did not hear this vote\./);
  assert.match(t, /trend holds on 15\/30/);
  assert.match(t, /Directional Lean shows research direction and intensity\. It is not a probability and not a SATOSHI call\./);
  assert.match(html, /role="meter"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  assert.match(html, /aria-valuenow="85"/);
  assert.match(html, /aria-valuetext="DRIFT: Directional Lean 85 of 100, bullish, research read UP\. Research only — SATOSHI did not hear this vote\."/);
  assert.match(html, /--lean-position:85%/);
  for (const banned of FORBIDDEN) assert.doesNotMatch(t.replace(/It is not a probability/, ""), banned);
});

test("the Guided meter speaks plainly: a word, a plain status, one reason, no number", () => {
  const lean = seatDirectionalLean(fact({ raw_lean: "DOWN", raw_conf: 60 }), WINDOW);
  const html = renderToString(React.createElement(SeatLeanMeter, { lean, mode: "guided" }));
  const t = text(html);
  assert.match(t, /DIRECTIONAL LEAN Bearish/);
  assert.doesNotMatch(t, /\b20 ·/, "no number in Guided");
  assert.doesNotMatch(t, /Research read:|Card:|Strength:/);
  assert.match(t, /Status: Research only — SATOSHI did not hear this vote\./);
  assert.match(t, /trend holds on 15\/30/);
  assert.match(html, /aria-valuenow="20"/, "assistive tech still gets the value");
});

test("NO READ renders as an image with text and no marker; STALE is printed beside a stale read", () => {
  const down = seatDirectionalLean(fact({ voice: "unhealthy", suppression: "feed", health: "DOWN", raw_lean: "WAIT", raw_conf: 0 }), WINDOW);
  const html = renderToString(React.createElement(SeatLeanMeter, { lean: down, mode: "pro" }));
  assert.match(html, /role="img"/);
  assert.doesNotMatch(html, /aria-value(now|min|max|text)=/, "an image carries no range attributes");
  assert.match(html, /aria-labelledby="[^"]+" aria-describedby="[^"]+"/, "the image is named by the label and described by the sentence");
  assert.doesNotMatch(html, /seat-lean__marker/);
  assert.match(text(html), /NO READ/);
  assert.match(text(html), /Status: DOWN/);
  assert.match(text(html), /Feed down — no read this frame\./);
  const stale = seatDirectionalLean(fact({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, health: "STALE", health_warning: true }), WINDOW);
  const s = renderToString(React.createElement(SeatLeanMeter, { lean: stale, mode: "pro" }));
  assert.match(text(s), /STALE Status: SPEAKING/);
  assert.match(s, /seat-lean__stale/);
});

test("the mini form carries the full text for assistive tech and never a forbidden word", () => {
  const lean = seatDirectionalLean(fact(), WINDOW);
  const html = renderToString(React.createElement(SeatLeanMini, { lean }));
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="DRIFT: Directional Lean 85 of 100, bullish, research read UP\. Research only — SATOSHI did not hear this vote\."/);
  assert.match(text(html), /^85$/);
  for (const banned of FORBIDDEN) assert.doesNotMatch(html.replace(/It is not a probability/, ""), banned);
});

test("every meter element is keyed by the complete window identity plus the seat, so a new window is a new element", () => {
  const w = WINDOW;
  const cases = [
    ["same seat, new close_time", { ...w, close_time: w.close_time + 900_000 }],
    ["same ticker, corrected close_time", { ...w, close_time: w.close_time + 1 }],
    ["new ticker", { ...w, ticker: "KXBTC15M-26SEP2515-T85100" }],
  ];
  const base = seatDirectionalLean(fact(), w);
  const baseKey = `${w.ticker}|${w.close_time}|DRIFT`;
  assert.equal(leanKey(base), baseKey);
  assert.match(renderToString(React.createElement(SeatLeanMeter, { lean: base })), keyRe(baseKey));
  assert.match(renderToString(React.createElement(SeatLeanMini, { lean: base })), keyRe(baseKey));
  for (const [name, win] of cases) {
    const next = seatDirectionalLean(fact(), win);
    assert.notEqual(leanKey(next), baseKey, name);
    assert.match(renderToString(React.createElement(SeatLeanMeter, { lean: next })), keyRe(leanKey(next)), name);
    assert.match(renderToString(React.createElement(SeatLeanMini, { lean: next })), keyRe(leanKey(next)), name);
  }
  // The root elements carry the key themselves, and every parent list keys on it too.
  const meterSrc = read("src/components/desk/SeatLeanMeter.tsx");
  assert.match(meterSrc, /<div key=\{key\}[^>]*data-lean-key=\{key\}/);
  assert.match(meterSrc, /<span\s+key=\{key\}/);
  assert.match(read("src/components/desk/BotCard.tsx"), /<SeatLeanMeter key=\{leanKey\(lean\)\}/, "the seat card remounts the meter per window");
  assert.match(read("src/components/desk/BotCard.tsx"), /<SeatLeanMini key=\{leanKey\(lean\)\}/);
  assert.equal((read("src/components/desk/GuidedFloorView.tsx").match(/key=\{leanKey\(l\)\}/g) ?? []).length, 2);
  const tape = read("src/components/desk/ProFloor/CouncilEvidenceTape.tsx");
  assert.equal((tape.match(/<li key=\{leanKey\(lean\)\}/g) ?? []).length, 2);
  assert.doesNotMatch(tape, /key=\{s\.seat\}/, "no row keyed by seat alone");
  assert.doesNotMatch(read("src/components/desk/GuidedFloorView.tsx"), /\$\{l\.window\.ticker\}:\$\{l\.seat\}/, "no row keyed by ticker and seat alone");
});

test("the evidence-row button announces the lean in its own accessible name, and the nested mini form is decorative", () => {
  const seats = [
    fact({ seat: "DRIFT", callsign: "VEC" }),
    fact({ seat: "WICK", callsign: "PIN", raw_lean: "DOWN", raw_conf: 60 }),
    fact({ seat: "TAPE", callsign: "TPE", raw_lean: "WAIT", raw_conf: 0, final_lean: "WAIT", final_conf_transformed: false, voice: "waiting", suppression: null, skill_used: "SIT", skill_status: "SIT" }),
    fact({ seat: "INDEX", callsign: "IDX", voice: "unhealthy", suppression: "feed", health: "DOWN", raw_lean: "WAIT", raw_conf: 0, final_lean: "WAIT" }),
  ];
  const html = renderToString(React.createElement(CouncilEvidenceTape, { facts: { seats }, onJump: () => {}, window: WINDOW }));
  const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => unescape(m[1]));
  assert.equal(labels.length, 8, "four seats, desktop and phone rows");
  const byName = (seat) => labels.filter((l) => l.startsWith(`${seat},`));
  assert.equal(byName("DRIFT").length, 2);
  for (const l of byName("DRIFT")) assert.match(l, /^DRIFT, raw UP 70, Directional Lean 85 of 100, bullish, research read UP\. Research only — SATOSHI did not hear this vote\. Final WAIT, /);
  for (const l of byName("WICK")) assert.match(l, /Directional Lean 20 of 100, bearish, research read DOWN\. Research only — SATOSHI did not hear this vote\. Final WAIT, /);
  for (const l of byName("TAPE")) assert.match(l, /Directional Lean 50 of 100, neutral, research read NEUTRAL\. Sitting — no direction read\. Final WAIT, /);
  for (const l of byName("INDEX")) assert.match(l, /^INDEX, raw WAIT, no directional read\. Feed down — no read this frame\. Final WAIT, /);
  for (const l of labels) assert.match(l, /\. Open its desk\.$/, "the status and the action stay in the name");
  // The nested mini forms are hidden from assistive tech, so nothing conflicts with the button's name.
  const minis = [...html.matchAll(/<span[^>]*class="seat-lean seat-lean--mini[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(minis.length, 8);
  for (const m of minis) {
    assert.match(m, /aria-hidden="true"/);
    assert.doesNotMatch(m, /role="img"|aria-label=/);
  }
  assert.match(text(html), /It is not a probability and not a SATOSHI call\./);
});

test("a directional vote without a Chair row is announced as a research read, never as heard by SATOSHI", () => {
  const noRow = seatDirectionalLean(fact({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: false }), WINDOW);
  const html = renderToString(React.createElement(SeatLeanMeter, { lean: noRow, mode: "pro" }));
  assert.match(text(html), /Status: RESEARCH READ/);
  assert.match(text(html), /No Chair row yet, so SATOSHI has not aggregated it\./);
  assert.doesNotMatch(text(html), /SATOSHI heard/);
  assert.match(html, /aria-valuenow="85"/, "the read itself still shows");
  const withRow = seatDirectionalLean(fact({ voice: "speaking", suppression: null, final_lean: "UP", final_conf_transformed: false, aggregated: true }), WINDOW);
  assert.match(text(renderToString(React.createElement(SeatLeanMeter, { lean: withRow, mode: "pro" }))), /Status: SPEAKING/);
  assert.match(text(renderToString(React.createElement(SeatLeanMeter, { lean: withRow, mode: "guided" }))), /Status: SATOSHI heard this read\./);
  for (const l of [noRow, withRow]) {
    const t = text(renderToString(React.createElement(SeatLeanMeter, { lean: l, mode: "pro", showDisclaimer: true })));
    assert.match(t, /It is not a probability and not a SATOSHI call\./);
  }
});

test("a fact without both retained raw fields renders NO READ, never a manufactured number", () => {
  for (const over of [{ raw_retained: false }, { raw_retained: true, raw_conf: null }, { raw_retained: true, raw_conf: Number.NaN }, { raw_retained: true, raw_lean: null }]) {
    const partial = seatDirectionalLean(fact(over), WINDOW);
    const html = renderToString(React.createElement(SeatLeanMeter, { lean: partial, mode: "pro" }));
    assert.match(text(html), /NO READ/, JSON.stringify(over));
    assert.match(html, /role="img"/);
    assert.doesNotMatch(html, /aria-valuenow/);
    assert.doesNotMatch(text(html), /85 · |50 · Neutral/);
  }
});

test("the surfaces share one read model and the verdict and paper-position surfaces are untouched", () => {
  const model = read("src/lib/desk/seat-lean.ts");
  assert.doesNotMatch(model, /from "\.\/(chair|bots|learner|book-floor|server-engine|persist)/, "the read model never touches decision modules");
  assert.doesNotMatch(model, /fact\.[a-z_]+\s*=[^=]/, "no assignment into the input");
  assert.doesNotMatch(model, /Date\.now|fetch\(|localStorage|setInterval/);
  for (const file of ["src/components/desk/BotCard.tsx", "src/components/desk/ProFloor/CouncilEvidenceTape.tsx", "src/components/desk/GuidedFloorView.tsx"]) {
    assert.match(read(file), /seatDirectionalLean/, `${file} uses the shared read model`);
    assert.doesNotMatch(read(file), /50 \+ |\/ 2\b/, `${file} never re-derives the score`);
  }
  assert.match(read("src/components/desk/ProFloor/CouncilEvidenceTape.tsx"), /leanAnnouncement\(lean\)/, "the row name reuses the one announcement helper");
  assert.match(read("src/components/desk/GuidedFloorView.tsx"), /seatFacts\(chair, votes, knobs, snap\.as_of\)\.filter\(\(f\) => f\.aggregated\)/);
  assert.match(read("src/components/desk/GuidedFloorView.tsx"), /\{read\.label === "WAIT" \? <Tip k="term\.wait">WAIT<\/Tip> : read\.label\}/, "the SATOSHI read heading is unchanged");
  assert.doesNotMatch(read("src/components/desk/ProFloor/PaperPositionCard.tsx"), /seat-lean|SeatLean/, "the paper position card does not carry the meter");
  assert.doesNotMatch(read("src/components/desk/ProFloor/ProChairCard.tsx"), /seat-lean|SeatLean/, "the Chair card does not carry the meter");
  assert.doesNotMatch(read("src/components/desk/ProFloor/EvidenceFamilies.tsx"), /seat-lean|SeatLean/, "family cards stay out of scope");
  assert.doesNotMatch(read("src/lib/desk/chair.ts"), /seat-lean|SeatLean/);
  assert.doesNotMatch(read("src/lib/desk/bots.ts"), /seat-lean|SeatLean/);
  assert.doesNotMatch(read("src/lib/desk/book-floor.ts"), /seat-lean|SeatLean/);
});
