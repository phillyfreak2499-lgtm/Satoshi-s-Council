import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const output = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (id) => id in overrides ? overrides[id] : id.endsWith(".css") ? {} : require(id),
    module,
    module.exports,
  );
  return module.exports;
}
const model = load("src/lib/desk/chair-signal.ts");
const { CHAIR_DIRECTIONAL_SCALE_MAX, chairSignalOf, signalReading, signalDescription } = model;
const { ChairSignalGauge } = load("src/components/desk/ChairSignalGauge.tsx", { "@/lib/desk/chair-signal": model });
const input = (score, bar = 0.54, aggressiveness = 1, lean = "WAIT") => ({ score, bar, aggressiveness, lean });
const render = (chair, extra = {}) => renderToStaticMarkup(createElement(ChairSignalGauge, { chair, ...extra }));

test("marker shows raw directional lean while the call line uses current aggressiveness", () => {
  const s = chairSignalOf(input(0.494, 0.542, 1.15, "UP"));
  assert.ok(Math.abs(s.effective - 0.5681) < 1e-12);
  assert.ok(Math.abs(s.rawThreshold - 0.542 / 1.15) < 1e-12);
  assert.equal(s.met, true);
  assert.ok(Math.abs(s.position - (50 + (0.494 / CHAIR_DIRECTIONAL_SCALE_MAX) * 50)) < 1e-12);
  assert.ok(s.position > s.thresholdUpPosition);
  assert.equal(signalReading(s), "lean +0.494 · call ±0.471");
});

test("the same Chair lean stays in the same place when only call conditions change", () => {
  const easy = chairSignalOf(input(0.3, 0.24, 1));
  const hard = chairSignalOf(input(0.3, 0.72, 1));
  const faster = chairSignalOf(input(0.3, 0.72, 1.15));
  assert.equal(easy.position, hard.position);
  assert.equal(hard.position, faster.position);
  assert.notEqual(easy.thresholdUpPosition, hard.thresholdUpPosition);
  assert.notEqual(hard.thresholdUpPosition, faster.thresholdUpPosition);
  assert.ok(easy.thresholdUpPosition < faster.thresholdUpPosition);
  assert.ok(faster.thresholdUpPosition < hard.thresholdUpPosition);
});

test("the fixed directional scale is symmetric and uses the full track", () => {
  assert.equal(CHAIR_DIRECTIONAL_SCALE_MAX, 1.12);
  assert.equal(chairSignalOf(input(0)).position, 50);
  assert.equal(chairSignalOf(input(CHAIR_DIRECTIONAL_SCALE_MAX)).position, 100);
  assert.equal(chairSignalOf(input(-CHAIR_DIRECTIONAL_SCALE_MAX)).position, 0);
  for (const score of [0.1, 0.4, 0.8]) {
    const up = chairSignalOf(input(score));
    const down = chairSignalOf(input(-score));
    assert.ok(Math.abs(up.position + down.position - 100) < 1e-12);
    assert.ok(Math.abs(up.thresholdUpPosition + up.thresholdDownPosition - 100) < 1e-12);
  }
});

test("only marker geometry clips; extreme numeric readings remain honest", () => {
  const s = chairSignalOf(input(4, 0.5));
  assert.equal(s.position, 100);
  assert.equal(s.score, 4);
  assert.equal(s.effective, 4);
  assert.match(signalReading(s), /lean \+4\.000/);
  assert.match(signalDescription(s), /numeric reading is not clipped/);
  assert.equal(chairSignalOf(input(-4, 0.5)).position, 0);
});

test("zero aggressiveness preserves visible lean but makes the call line unreachable", () => {
  const s = chairSignalOf(input(0.2, 0.5, 0));
  assert.ok(s.position > 50);
  assert.equal(s.effective, 0);
  assert.equal(s.rawThreshold, null);
  assert.equal(s.thresholdDownPosition, 0);
  assert.equal(s.thresholdUpPosition, 100);
  assert.equal(s.met, false);
  assert.match(signalReading(s), /call unreachable/);
});

test("missing and invalid values are unavailable, never an invented neutral reading", () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "0.5"]) {
    for (const key of ["score", "bar", "aggressiveness"]) {
      const chair = { ...input(0.2), [key]: bad };
      assert.equal(chairSignalOf(chair), null);
    }
  }
  assert.equal(chairSignalOf(input(0.2, 0)), null);
  assert.equal(chairSignalOf(input(0.2, -1)), null);
  assert.equal(chairSignalOf(input(0.2, 0.5, -1)), null);
  assert.equal(chairSignalOf(input(Number.MAX_VALUE, 0.5, Number.MAX_VALUE)), null);
  const html = render(input(NaN));
  assert.match(html, /Signal unavailable/);
  assert.ok(!html.includes('class="chair-signal__marker"'));
  assert.ok(!html.includes("aria-valuenow"));
});

test("crossing the signal threshold never promotes WAIT or manufactures a fill", () => {
  const chair = Object.freeze(input(0.7, 0.54, 1, "WAIT"));
  const s = chairSignalOf(chair);
  assert.equal(s.met, true);
  assert.equal(s.decision, "WAIT");
  const html = render(chair);
  assert.match(html, /Actual Chair decision: WAIT/);
  assert.match(html, /paper entry is separate/);
  assert.ok(!html.includes("Paper FILLED"));
  assert.equal(chair.lean, "WAIT");
  assert.equal(chairSignalOf(input(0.2, 0.54, 1, "UP")).decision, "UP");
});

test("SSR exposes directional score as the meter value, not distance-to-call", () => {
  const html = render(input(-0.7));
  assert.match(html, /role="meter"/);
  assert.match(html, /aria-valuemin="-1\.12"/);
  assert.match(html, /aria-valuemax="1\.12"/);
  assert.match(html, /aria-valuenow="-0\.7"/);
  assert.match(html, /aria-valuetext=/);
  assert.match(html, /aria-label="Pause liquid animation"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /data-animating="false"/);
  assert.match(html, />DOWN<\/span>/);
  assert.match(html, />UP<\/span>/);
});

test("threshold ticks move independently over a continuous directional field", () => {
  const css = read("src/components/desk/ChairSignalGauge.css");
  const component = read("src/components/desk/ChairSignalGauge.tsx");
  assert.match(css, /chair-signal__axis[^}]*height: 12px/s);
  assert.match(css, /chair-signal__tick--down \{ left: var\(--signal-threshold-down\); \}/);
  assert.match(css, /chair-signal__tick--up \{ left: var\(--signal-threshold-up\); \}/);
  assert.ok(!css.includes("chair-signal__tick--down { left: 25%; }"));
  assert.ok(!css.includes("chair-signal__tick--up { left: 75%; }"));
  assert.match(css, /Continuous directional field/);
  assert.match(component, /--signal-threshold-down/);
  assert.match(component, /--signal-threshold-up/);
  assert.match(component, /marker does not move just because the call requirement changes/i);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation-play-state: paused/);
  const marker = css.slice(css.indexOf(".chair-signal__marker {"), css.indexOf(".chair-signal__marker::before"));
  assert.ok(!marker.includes("animation:"));
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /document\.hidden/);
  assert.match(component, /feedHealthy/);
  assert.ok(!component.includes("Math.random"));
  assert.ok(!component.includes("setInterval"));
});

test("the Floor uses the display-only gauge while decision modules remain disconnected", () => {
  const floor = read("src/components/desk/SatoshiTab.tsx");
  assert.match(floor, /<ChairSignalGauge/);
  assert.ok(!floor.includes('>score vs bar</Tip>'));
  // Redundant threshold/status wording lives only in the presentation CSS cleanup;
  // the Chair engine and paper book never import the gauge model.
  for (const path of ["chair.ts", "server-engine.ts", "selective-entry.ts", "book-floor.ts"]) {
    assert.ok(!read(`src/lib/desk/${path}`).includes("chair-signal"), `${path} must not read this presentation`);
  }
});
