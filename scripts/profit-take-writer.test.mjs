import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the real writer and simulator; replace only the database transport.
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(rel, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(readFileSync(new URL(rel, import.meta.url), "utf8")), {
    module, exports: module.exports,
    require: (id) => { assert.ok(id in dependencies, `unexpected import ${id}`); return dependencies[id]; },
    Date, Math, Number, Set, Map,
  });
  return module.exports;
}
const math = load("../src/lib/desk/math.ts");
const clock = load("../src/lib/desk/clock.ts", { "./math.ts": math });
const policy = load("../src/lib/desk/floor-policy.ts");
const arena = load("../src/lib/desk/exit-arena.ts", { "./clock.ts": clock, "./floor-policy.ts": policy });
const start = Date.parse(policy.EXIT_TAKE90_V2.frozen_at);
const plain = (v) => JSON.parse(JSON.stringify(v));

function harness() {
  const fills = [];
  const observations = new Map();
  const db = async (strings, ...params) => {
    const sql = strings.join("");
    if (sql.includes("insert into desk_policy_fills")) {
      fills.push(plain(params));
      return [];
    }
    assert.ok(sql.includes("insert into desk_policy_observations"), "only research writes allowed");
    assert.ok(sql.includes("on conflict (candidate_id, ticker, close_time) do nothing"));
    const key = [params[3], params[1], params[2]].join("|");
    if (observations.has(key)) return [];
    observations.set(key, plain(params));
    return [{ id: observations.size }];
  };
  const writer = load("../src/lib/desk/policy-lab.server.ts", {
    "@/lib/db": { getSql: async () => db },
    "./clock": clock, "./floor-policy": policy, "./exit-arena": arena,
  });
  return { writer, fills, observations };
}
function fixture(t) {
  return {
    ticker: "paper-prospective-fixture",
    closeMs: start + 900_000,
    winner: "DOWN",
    entry: { side: "UP", cents: 93, t },
    path: [
      { t: t + 4000, yes_bid: 92, yes_ask: 94 },
      { t: t + 8000, yes_bid: 96, yes_ask: 97 },
    ],
  };
}

test("the writer excludes a recovered pre-definition entry from TAKE90 V2", async () => {
  const h = harness();
  assert.equal(await h.writer.recordExitArena(fixture(start - 1), policy.FLOOR_V1), 5);
  assert.equal([...h.observations.values()].some((r) => r[3] === "TAKE90_V2"), false);
  assert.equal([...h.observations.values()].some((r) => r[3] === "TAKE90_V1"), true);
});

test("the writer gives V2 a separate row on the same original fill, without revising V1", async () => {
  const h = harness();
  const w = fixture(start);
  assert.equal(await h.writer.recordExitArena(w, policy.FLOOR_V1), 6);
  const rows = [...h.observations.values()];
  assert.equal(new Set(rows.map((r) => r[0])).size, 1, "all candidates reference one fill");
  const old = rows.find((r) => r[3] === "TAKE90_V1");
  const revised = rows.find((r) => r[3] === "TAKE90_V2");
  assert.equal(old[24], -3, "V1's losing target sale remains recorded");
  assert.equal(revised[24], 1, "V2 waits for a positive net sale");
  assert.equal(revised[5], 2, "separate frozen version");
  assert.equal(revised[7], "ENTRY_80_V1", "original entry policy retained");
  assert.equal(policy.FLOOR_V1.exit_policy, "HOLD_V1");
  assert.equal(await h.writer.recordExitArena(w, policy.FLOOR_V1), 0, "retry preserves recorded observations");
});

test("no position creates no exit evidence", async () => {
  const h = harness();
  assert.equal(await h.writer.recordExitArena({ ...fixture(start), entry: null }, policy.FLOOR_V1), 0);
  assert.equal(h.fills.length, 0);
  assert.equal(h.observations.size, 0);
});
