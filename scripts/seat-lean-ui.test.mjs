/**
 * Directional Lean — what the page actually prints.
 *
 * Renders the meter the way the server does and checks the copy: the label is
 * DIRECTIONAL LEAN, the disclaimer says it is not a probability and not a
 * SATOSHI call, no forbidden word (confidence, probability, odds, chance)
 * appears, the meter carries meter semantics with a text value, NO READ is an
 * image with text, and the Guided form speaks plainly. It also pins that the
 * SATOSHI verdict and paper-position surfaces are untouched by the feature.
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

const { seatDirectionalLean } = load("src/lib/desk/seat-lean.ts");
const { SeatLeanMeter, SeatLeanMini } = load("src/components/desk/SeatLeanMeter.tsx", { "./SeatLeanMeter.css": {} });
const text = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const WINDOW = { ticker: "KXBTC15M-26SEP2514-T85000", close_time: 1_790_000_000_000, as_of: 1_789_999_500_000 };
const fact = (over = {}) => ({
  seat: "DRIFT", callsign: "VEC", family: "structure", eyes: "ret 5/15/30", raw_lean: "UP", raw_conf: 70, final_lean: "WAIT", final_conf: 70,
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
  assert.match(t, /Research read: UP/);
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
  assert.match(t, /Bearish Bullish Research read/, "the scale is labelled at both ends");
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

test("a new window is a new element: the meter is keyed by the window it was read in", () => {
  const a = seatDirectionalLean(fact(), WINDOW);
  const b = seatDirectionalLean(fact({ raw_lean: "WAIT", raw_conf: 0, voice: "waiting", suppression: null, final_conf_transformed: false }), { ...WINDOW, ticker: "NEXT", close_time: WINDOW.close_time + 900_000 });
  assert.match(renderToString(React.createElement(SeatLeanMeter, { lean: a })), /data-window="KXBTC15M-26SEP2514-T85000"/);
  assert.match(renderToString(React.createElement(SeatLeanMeter, { lean: b })), /data-window="NEXT"/);
  assert.match(read("src/components/desk/BotCard.tsx"), /<SeatLeanMeter key=\{`\$\{snap\.ticker\}:\$\{snap\.close_time\}`\}/, "the seat card remounts the meter per window");
  assert.match(read("src/components/desk/GuidedFloorView.tsx"), /key=\{`\$\{l\.window\.ticker\}:\$\{l\.seat\}`\}/);
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
  assert.match(read("src/components/desk/GuidedFloorView.tsx"), /seatFacts\(chair, votes, knobs, snap\.as_of\)\.filter\(\(f\) => f\.aggregated\)/);
  assert.match(read("src/components/desk/GuidedFloorView.tsx"), /\{read\.label === "WAIT" \? <Tip k="term\.wait">WAIT<\/Tip> : read\.label\}/, "the SATOSHI read heading is unchanged");
  assert.doesNotMatch(read("src/components/desk/ProFloor/PaperPositionCard.tsx"), /seat-lean|SeatLean/, "the paper position card does not carry the meter");
  assert.doesNotMatch(read("src/components/desk/ProFloor/ProChairCard.tsx"), /seat-lean|SeatLean/, "the Chair card does not carry the meter");
  assert.doesNotMatch(read("src/lib/desk/chair.ts"), /seat-lean|SeatLean/);
  assert.doesNotMatch(read("src/lib/desk/bots.ts"), /seat-lean|SeatLean/);
  assert.doesNotMatch(read("src/lib/desk/book-floor.ts"), /seat-lean|SeatLean/);
});
