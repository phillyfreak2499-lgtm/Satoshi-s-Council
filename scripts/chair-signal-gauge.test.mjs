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
const { chairSignalOf, signalReading, signalDescription } = model;
const { ChairSignalGauge } = load("src/components/desk/ChairSignalGauge.tsx", { "@/lib/desk/chair-signal": model });
const input = (score, bar = 0.54, aggressiveness = 1, lean = "WAIT") => ({ score, bar, aggressiveness, lean });
const render = (chair, extra = {}) => renderToStaticMarkup(createElement(ChairSignalGauge, { chair, ...extra }));

test("the gauge uses the Chair's effective score, not its unadjusted score", () => {
  const s = chairSignalOf(input(0.494, 0.542, 1.15, "UP"));
  assert.ok(Math.abs(s.effective - 0.5681) < 1e-12);
  assert.equal(s.met, true);
  assert.ok(s.position > 75);
  assert.equal(signalReading(s), "+0.568 / ±0.542");
});

test("both threshold ticks and the neutral center have exact symmetric positions", () => {
  assert.equal(chairSignalOf(input(0)).position, 50);
  for (const bar of [0.24, 0.54, 0.72]) {
    assert.equal(chairSignalOf(input(bar, bar)).position, 75);
    assert.equal(chairSignalOf(input(-bar, bar)).position, 25);
    assert.equal(chairSignalOf(input(bar, bar)).met, true);
    assert.equal(chairSignalOf(input(-bar, bar)).met, true);
    assert.equal(chairSignalOf(input(bar - 0.000001, bar)).met, false);
    assert.equal(chairSignalOf(input(-bar + 0.000001, bar)).met, false);
  }
});

test("only marker geometry clips; extreme numeric readings remain honest", () => {
  const s = chairSignalOf(input(4, 0.5));
  assert.equal(s.position, 100);
  assert.equal(s.effective, 4);
  assert.match(signalReading(s), /\+4\.000/);
  assert.match(signalDescription(s), /numeric reading is not clipped/);
  assert.equal(chairSignalOf(input(-4, 0.5)).position, 0);
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
  assert.equal(chairSignalOf(input(0.2, 0.5, 0)).position, 50);
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

test("SSR gives the gauge a labeled meter, explicit directions, and an animation pause", () => {
  const html = render(input(-0.7));
  assert.match(html, /role="meter"/);
  assert.match(html, /aria-valuemin="-2"/);
  assert.match(html, /aria-valuemax="2"/);
  assert.match(html, /aria-valuetext=/);
  assert.match(html, /aria-label="Pause liquid animation"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /data-animating="false"/);
  assert.match(html, />DOWN<\/span>/);
  assert.match(html, />UP<\/span>/);
});

test("the instrument keeps a 12px track and separates optical motion from the marker", () => {
  const css = read("src/components/desk/ChairSignalGauge.css");
  const component = read("src/components/desk/ChairSignalGauge.tsx");
  assert.match(css, /chair-signal__axis[^}]*height: 12px/s);
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

test("the Floor replaces its old bar while decision modules remain disconnected", () => {
  const floor = read("src/components/desk/SatoshiTab.tsx");
  assert.match(floor, /<ChairSignalGauge/);
  assert.ok(!floor.includes('>score vs bar</Tip>'));
  assert.match(floor, /const gap = signal\?\.margin \?\? null/);
  for (const path of ["chair.ts", "server-engine.ts", "selective-entry.ts", "book-floor.ts"]) {
    assert.ok(!read(`src/lib/desk/${path}`).includes("chair-signal"), `${path} must not read this presentation`);
  }
});
