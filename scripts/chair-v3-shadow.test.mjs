import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const src = readFileSync(new URL("src/lib/desk/chair-v3.ts", root), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(js, { exports, Math, Date, Object, Number, Array, Map, Set, console });
const { V3_FEATURES, V3_MAX_ADJUSTMENT, V3_MIN_TRAIN, zeroV3Features, v3FeaturesFromStored, predictV3, walkForwardV3 } = exports;

function weights(patch = {}) {
  const w = Object.fromEntries(V3_FEATURES.map((k) => [k, 0]));
  return { version: 1, n: V3_MIN_TRAIN, fitted_at: 1, lambda: 0.12, bias: 0, w, ...patch };
}

test("v3 without trained evidence is exactly the market prior", () => {
  const f = zeroV3Features();
  for (const p of [0.08, 0.25, 0.5, 0.82, 0.96]) {
    const got = predictV3(null, p, f);
    assert.equal(got.p_up, p);
    assert.equal(got.adjustment_pp, 0);
  }
});

test("market is an offset, never a trainable feature", () => {
  assert.equal(V3_FEATURES.includes("market"), false);
  assert.equal(V3_FEATURES.includes("fair_gap"), true);
});

test("even extreme learned corrections cannot move farther than ten points from market", () => {
  const f = zeroV3Features();
  const hi = predictV3(weights({ bias: 20 }), 0.5, f);
  const lo = predictV3(weights({ bias: -20 }), 0.5, f);
  assert.ok(Math.abs(hi.p_up - 0.6) < 1e-12);
  assert.ok(Math.abs(lo.p_up - 0.4) < 1e-12);
  assert.ok(Math.abs(V3_MAX_ADJUSTMENT - 0.10) < 1e-12);
  assert.equal(hi.capped, true);
  assert.equal(lo.capped, true);
});

test("stored Council evidence is bounded and main fair enters only as a gap to the market", () => {
  const f = v3FeaturesFromStored({ STRIKE: 50, FADE: -50 }, 0.5, 0.8);
  assert.equal(f.STRIKE, 1);
  assert.equal(f.FADE, -1);
  assert.ok(f.fair_gap > 0 && f.fair_gap <= 1);
});

test("strict walk-forward can learn a genuine independent correction without future leakage", () => {
  const rows = [];
  for (let i = 0; i < 520; i++) {
    const f = zeroV3Features();
    f.STRIKE = i % 2 === 0 ? 0.8 : -0.8;
    rows.push({ close_time: i * 900000, winner: i % 2 === 0 ? "UP" : "DOWN", market_p: 0.5, features: f });
  }
  const report = walkForwardV3(rows);
  assert.equal(report.n_scored, 520 - V3_MIN_TRAIN);
  assert.ok(report.v3_brier < report.market_brier, JSON.stringify(report));
  assert.ok(report.max_abs_adjustment_pp <= 10.001);
});

test("v3 remains a one-way read-only research island", () => {
  const server = readFileSync(new URL("src/lib/desk/chair-v3.server.ts", root), "utf8");
  const route = readFileSync(new URL("server/routes/research/chair-v3.get.ts", root), "utf8");
  assert.match(server, /historical-strict-walk-forward/);
  assert.ok(!/insert into|update\s+desk_|delete from/i.test(server));
  assert.match(route, /adminKeyOk\(key\)/);
  for (const path of ["src/lib/desk/chair.ts", "src/lib/desk/server-engine.ts", "src/lib/desk/selective-entry.ts", "src/lib/desk/book-floor.ts"]) {
    const code = readFileSync(new URL(path, root), "utf8");
    assert.ok(!code.includes("chair-v3"), `${path} imports Chair v3`);
  }
});
