import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

function loadPure() {
  const src = read("src/lib/desk/lab-v4-v5.ts");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const fee = (cents) => {
    if (!(cents > 0) || cents >= 100) return 0;
    const p = cents / 100;
    return Math.ceil(7 * p * (1 - p) * 100) / 100;
  };
  vm.runInNewContext(js, {
    exports,
    Math,
    Number,
    Object,
    Array,
    console,
    require: (id) => {
      if (String(id).includes("clock")) return { takerFeeCents: fee };
      throw new Error(`unexpected require ${id}`);
    },
  });
  return exports;
}

test("V4 has no WAIT state or confidence threshold", () => {
  const v = loadPure();
  assert.equal(v.forcedSide(0.5001), "UP");
  assert.equal(v.forcedSide(0.4999), "DOWN");
  assert.equal(v.forcedSide(0.5, "DOWN"), "DOWN");
  const src = read("src/lib/desk/lab-v4-v5.ts");
  assert.doesNotMatch(src, /MIN_CONF|confidence threshold|price floor/i);
});

test("V4 locks a stable local peak without requiring a probability level", () => {
  const v = loadPure();
  let s = v.emptyForcedTiming();
  for (const [at, p] of [[1000, 0.5001], [8000, 0.5001], [15000, 0.5001]]) {
    const step = v.stepForcedTiming(s, p, at, 500);
    assert.equal(step.lock, false);
    s = step.state;
  }
  const done = v.stepForcedTiming(s, 0.5001, 22001, 480);
  assert.equal(done.lock, true);
  assert.equal(done.reason, "STABLE_PEAK");
  assert.equal(done.side, "UP");
});

test("V4 keeps watching while certainty is still improving and deadline always forces a side", () => {
  const v = loadPure();
  let s = v.emptyForcedTiming();
  for (const [at, p] of [[1000, 0.51], [8000, 0.52], [15000, 0.53], [22001, 0.54]]) {
    const step = v.stepForcedTiming(s, p, at, 500);
    assert.equal(step.lock, false);
    s = step.state;
  }
  const deadline = v.stepForcedTiming(v.emptyForcedTiming(), 0.50001, 30_000, 19.9);
  assert.equal(deadline.lock, true);
  assert.equal(deadline.reason, "DEADLINE");
  assert.equal(deadline.side, "UP");
});

test("V5 enters only positive expected value after executable spread and fee", () => {
  const v = loadPure();
  const enter = v.profitDecision(null, 0.8, { yes_bid: 59, yes_ask: 60, no_bid: 39, no_ask: 40 });
  assert.equal(enter.action, "ENTER");
  assert.equal(enter.to_side, "UP");
  assert.ok(enter.expected_gain_cents > 0);

  const none = v.profitDecision(null, 0.5, { yes_bid: 44, yes_ask: 55, no_bid: 44, no_ask: 55 });
  assert.equal(none.action, "NONE");
});

test("V5 can exit or flip the same one-contract paper position", () => {
  const v = loadPure();
  const exit = v.profitDecision("UP", 0.6, { yes_bid: 62, yes_ask: 63, no_bid: 37, no_ask: 40 });
  assert.equal(exit.action, "EXIT");
  assert.equal(exit.from_side, "UP");
  assert.equal(exit.to_side, null);

  const flip = v.profitDecision("UP", 0.2, { yes_bid: 40, yes_ask: 41, no_bid: 58, no_ask: 59 });
  assert.equal(flip.action, "FLIP");
  assert.equal(flip.from_side, "UP");
  assert.equal(flip.to_side, "DOWN");
  assert.ok(flip.expected_gain_cents > 0);
});

test("V4/V5 observer is one-way research and writes only its own tables", () => {
  const src = read("src/lib/desk/lab-v4-v5.server.ts");
  const health = read("server/routes/healthz.get.ts");
  assert.match(health, /ensureLabV4V5Observer/);
  assert.match(src, /getServerFrame/);
  for (const forbidden of ["noteCall(", "applyDeskOp", "selectiveBlock", "decideChair(", "runChair(", "onLean("]) {
    assert.ok(!src.includes(forbidden), `observer reaches ${forbidden}`);
  }
  const writes = [...src.matchAll(/insert into\s+(\w+)/gi)].map((m) => m[1]);
  assert.ok(writes.length >= 4);
  for (const table of writes) assert.ok(table.startsWith("desk_v4_") || table.startsWith("desk_v5_"), table);
});

test("database rails make V4 calls immutable and V5 actions auditable", () => {
  const migration = read("migrations/0041_desk_v4_v5_shadow.sql");
  assert.match(migration, /primary key \(ticker, close_time\)[\s\S]*desk_v4_calls/i);
  assert.match(migration, /check \(side in \('UP','DOWN'\)\)/i);
  assert.doesNotMatch(migration, /winner\s+text/i);
  assert.match(migration, /primary key \(ticker, close_time, seq\)/i);
  assert.match(migration, /action in \('ENTER','EXIT','FLIP'\)/i);
  assert.match(migration, /foreign key \(ticker, close_time\) references desk_v5_windows/i);
});

test("the whole-Lab inventory gives every experiment a question, reader and exit criterion", () => {
  const src = read("src/lib/desk/lab-inventory.ts");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Set, Object, Array, Number, console });
  assert.equal(exports.validateLabInventory().length, 0);
  const ids = exports.LAB_INVENTORY.map((x) => x.id);
  for (const id of ["taker-v1", "chair-v3", "path-parity", "call-quality", "v4-forced", "v5-profit-hunter"]) {
    assert.ok(ids.includes(id), id);
  }
});
